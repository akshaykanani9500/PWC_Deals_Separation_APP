/**
 * Access governance API (v1.3, risk-tiered in v1.4), mounted at /api/access. Rules: shared/access.ts.
 *   GET  /access/catalog                  what can be requested, durations, the approval rules and the policy matrix
 *   GET  /access/requests?view=&projectId  requests I may see (mine, my approval inbox, or all I oversee)
 *   GET  /access/summary                  { inbox, mine, activeForMe } counts
 *   GET  /access/feed                     v1.4 top-bar bell: { waiting, updates } (approvals for me + my latest status changes)
 *   GET  /access/preview?projectId&permission&grantee   v1.4 approval route with names, or why nobody could approve
 *   POST /access/requests                 { project_id, permission_code, justification, duration_days, grantee_user_id? }
 *   POST /access/requests/:id/decision    { decision: 'approve' | 'reject', note }
 *   POST /access/requests/:id/revoke      { reason }
 *   POST /access/requests/:id/cancel
 * Mutating calls return the enriched row plus `notice`: a plain-words line naming who acts next (used for toasts).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthContext, AuthedRequest } from '../auth-types';
import type { AccessGrant, AccessRequestRow } from '../../../shared/types';
import { PERMISSIONS } from '../../../shared/permissions';
import {
  APPROVAL_RULES, GRANTABLE, GRANT_DURATIONS, approvalMatrix, durationsFor, grantable, grantState, isEscalated, level1Check, needsLevel2,
  pendingAgeDays, pendingExpiresAt, permissionLabel, policyText,
} from '../../../shared/access';
import { ah, HttpError } from '../errors';
import { buildAuthContext } from '../middleware/auth';
import { assertProjectAccess, visibleProjectIds } from '../services/access';
import { audit } from '../services/audit';
import {
  type Directory, lastEvent, level1Approvers, level2Approvers, loadDirectory, longDate, namesList, nextStep, noApproverMessage, qualifiesLevel1, statusLine,
} from '../services/approvals';

const base = (auth: AuthContext) => auth.baseActions ?? auth.actions;
const has = (auth: AuthContext, a: string) => (base(auth) as string[]).includes(a);
const PENDING = ['Pending L1', 'Pending L2'];

export function accessRouter(db: Db): Router {
  const r = Router();

  /** What may `auth` do with this request? Approvers come from the same list the UI shows as "Next approver". */
  function rowPerms(auth: AuthContext, g: AccessGrant, visible: Set<string>, dir: Directory, next = nextStep(dir, g)) {
    const me = auth.user.user_id;
    const state = grantState(g);
    const mine = next.approvers.some((a) => a.user_id === me);
    const approveL1 = next.level === 1 && mine && has(auth, 'access.approve');
    const approveL2 = next.level === 2 && mine && has(auth, 'access.review');
    const granteePersona = dir.persona(g.grantee_user_id);
    const l1Ok = has(auth, 'access.approve') && visible.has(g.project_id) && me !== g.grantee_user_id && !!granteePersona
      && level1Check(auth.code, base(auth), granteePersona, g.permission_code) === null;
    return {
      approveL1, approveL2, reject: approveL1 || approveL2,
      cancel: PENDING.includes(state) && me === g.requested_by,
      revoke: state === 'Active' && (me === g.grantee_user_id || has(auth, 'access.review') || l1Ok),
    };
  }

  function mayList(auth: AuthContext, g: AccessGrant, visible: Set<string>) {
    const me = auth.user.user_id;
    if (g.grantee_user_id === me || g.requested_by === me) return true;
    if (has(auth, 'access.review') || auth.code === 'EXEC') return true;
    return has(auth, 'access.approve') && visible.has(g.project_id);
  }

  async function enrich(auth: AuthContext, rows: AccessGrant[], dir?: Directory): Promise<AccessRequestRow[]> {
    const L = dir ?? (await loadDirectory(db));
    const visible = await visibleProjectIds(db, auth);
    const now = Date.now();
    return rows.map((g) => {
      const gp = L.persona(g.grantee_user_id);
      const perm = grantable(g.permission_code);
      const project = L.project.get(g.project_id);
      const next = nextStep(L, g, now);
      const state = grantState(g, now);
      const ev = lastEvent(g, now);
      return {
        ...g, state, label: permissionLabel(g.permission_code), risk_note: perm?.riskNote,
        project_code: project?.code_name, clean_team: project?.clean_team_required === 'Y',
        grantee_name: L.name(g.grantee_user_id), grantee_persona: gp, requested_by_name: L.name(g.requested_by),
        l1_name: L.name(g.l1_approver_id), l2_name: L.name(g.l2_approver_id), revoked_by_name: L.name(g.revoked_by),
        can: rowPerms(auth, g, visible, L, next),
        policy: policyText(g.permission_code, project ?? null), needs_l2: needsLevel2(g.permission_code, project ?? null) || !!g.l2_decided_at || g.status === 'Pending L2',
        acting_role: perm?.actingRole ?? null,
        age_days: pendingAgeDays(g, now), escalated: isEscalated(g, now), pending_expires_at: PENDING.includes(state) ? pendingExpiresAt(g) : null,
        expired_pending: state === 'Expired' && g.status !== 'Active',
        next_level: next.level, next_approvers: next.approvers, blocked_reason: next.blocked,
        status_line: statusLine(L, g, next, now), last_event_at: ev.at, last_event_by: ev.by, last_event_kind: ev.kind,
      };
    });
  }

  r.get('/catalog', ah(async (_req, res) => {
    res.json({ grantable: GRANTABLE, durations: GRANT_DURATIONS, rules: APPROVAL_RULES, matrix: approvalMatrix() });
  }));

  r.get('/summary', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const visible = await visibleProjectIds(db, auth);
    const rows = await enrich(auth, (await db.all<AccessGrant>('access_grants')).filter((g) => mayList(auth, g, visible)));
    res.json({
      inbox: rows.filter((x) => x.can.approveL1 || x.can.approveL2).length,
      mine: rows.filter((x) => x.grantee_user_id === auth.user.user_id && PENDING.includes(x.state)).length,
      activeForMe: rows.filter((x) => x.grantee_user_id === auth.user.user_id && x.state === 'Active').length,
    });
  }));

  /** Top-bar bell: what waits for me (oldest / escalated first) and the latest changes on my own requests. */
  r.get('/feed', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const me = auth.user.user_id;
    const visible = await visibleProjectIds(db, auth);
    const rows = await enrich(auth, (await db.all<AccessGrant>('access_grants')).filter((g) => mayList(auth, g, visible)));
    const waiting = rows.filter((x) => x.can.approveL1 || x.can.approveL2)
      .sort((a, b) => Number(b.escalated) - Number(a.escalated) || a.created_at.localeCompare(b.created_at));
    const updates = rows.filter((x) => x.grantee_user_id === me || x.requested_by === me)
      .sort((a, b) => (b.last_event_at ?? '').localeCompare(a.last_event_at ?? '')).slice(0, 8);
    res.json({ waiting, updates });
  }));

  r.get('/requests', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { view = 'all', projectId } = req.query as Record<string, string | undefined>;
    const visible = await visibleProjectIds(db, auth);
    let rows = (await db.all<AccessGrant>('access_grants')).filter((g) => mayList(auth, g, visible));
    if (projectId) rows = rows.filter((g) => g.project_id === projectId);
    let out = await enrich(auth, rows);
    const me = auth.user.user_id;
    if (view === 'mine') out = out.filter((g) => g.grantee_user_id === me || g.requested_by === me);
    if (view === 'inbox') out = out.filter((g) => g.can.approveL1 || g.can.approveL2);
    out.sort((a, b) => (b.last_event_at || b.updated_at || b.created_at).localeCompare(a.last_event_at || a.updated_at || a.created_at));
    res.json(out);
  }));

  /** Shared checks for a new request; returns everything the preview and the create call need. */
  async function plan(auth: AuthContext, input: { project_id: string; permission_code: string; grantee_user_id?: string | null }, onDeny: (msg: string, status?: number) => Promise<never>) {
    const project = await assertProjectAccess(db, auth, input.project_id);
    if (project.status === 'Closed') return onDeny('This project is closed; access cannot be added.', 400);
    const perm = grantable(input.permission_code);
    if (!perm) return onDeny('This permission cannot be requested. Role-only rights (gates, close-out, audit, admin) never move between people.', 400);
    const me = auth.user.user_id;
    const granteeId = input.grantee_user_id || me;
    const sponsored = granteeId !== me;
    if (!sponsored && !has(auth, 'access.request')) await onDeny('Your role cannot request extra access.');
    const grantee = await buildAuthContext(db, granteeId);
    if (!grantee) return onDeny('Unknown or inactive person.', 400);
    if (!perm.eligible.includes(grantee.code)) return onDeny(`${perm.label} cannot be given to the ${grantee.persona.name} role.`, 400);
    if (!perm.actingRole && PERMISSIONS[grantee.code].actions.includes(perm.code as never)) return onDeny(`${grantee.user.full_name} already has this through their role.`, 400);
    if (!(await visibleProjectIds(db, grantee)).has(project.project_id)) return onDeny(`${grantee.user.full_name} is not staffed on ${project.code_name}. Add them to the team first.`, 400);
    const dir = await loadDirectory(db);
    const key = { project_id: project.project_id, grantee_user_id: granteeId, permission_code: perm.code, requested_by: me, status: 'Pending L1' as const, created_at: new Date().toISOString() };
    if (sponsored) {
      if (!has(auth, 'access.approve')) await onDeny('Only a Partner, Manager or the Deals Leader can ask for access on behalf of someone else.');
      const why = level1Check(auth.code, base(auth), grantee.code, perm.code);
      if (why) await onDeny(why);
      if (!qualifiesLevel1(dir, key, me, { sponsor: true })) await onDeny(`You are not staffed on ${project.code_name}, so you cannot sponsor access there.`);
    }
    const l2Needed = needsLevel2(perm.code, project);
    const l1 = sponsored ? [] : level1Approvers(dir, key);
    const l2 = l2Needed ? level2Approvers(dir, { ...key, l1_approver_id: sponsored ? me : null }) : [];
    const blocked = !sponsored && !l1.length ? noApproverMessage(dir, key, 1) : l2Needed && !l2.length ? noApproverMessage(dir, key, 2) : null;
    return { project, perm, me, granteeId, grantee, sponsored, dir, l2Needed, l1, l2, blocked };
  }

  r.get('/preview', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const q = z.object({ projectId: z.string().min(1), permission: z.string().min(1), grantee: z.string().optional() }).parse(req.query);
    try {
      const p = await plan(auth, { project_id: q.projectId, permission_code: q.permission, grantee_user_id: q.grantee || null }, async (msg) => { throw new HttpError(409, msg, 'VALIDATION'); });
      res.json({
        policy: policyText(p.perm.code, p.project), needsL2: p.l2Needed, durations: durationsFor(p.perm.code), sponsored: p.sponsored,
        level1: p.sponsored ? [{ user_id: p.me, name: auth.user.full_name, role: 'you, as sponsor' }] : p.l1, level2: p.l2, blocked: p.blocked,
      });
    } catch (e) {
      if (e instanceof HttpError && e.status !== 404) return res.json({ policy: policyText(q.permission), needsL2: false, durations: durationsFor(q.permission), level1: [], level2: [], blocked: e.message });
      throw e;
    }
  }));

  r.post('/requests', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({
      project_id: z.string().min(1),
      permission_code: z.string().min(1),
      justification: z.string().trim().min(15, 'Explain in at least 15 characters why the access is needed.').max(1000),
      duration_days: z.coerce.number().refine((d) => (GRANT_DURATIONS as readonly number[]).includes(d), 'Choose 7, 30 or 90 days.'),
      grantee_user_id: z.string().optional().nullable(),
    }).parse(req.body);
    const deny = async (msg: string, status = 403): Promise<never> => {
      await audit(db, auth, 'access.denied', { type: 'access_grant', projectId: body.project_id, details: { reason: msg, permission: body.permission_code, grantee: body.grantee_user_id || auth.user.user_id } });
      throw new HttpError(status, msg, status === 403 ? 'FORBIDDEN' : 'VALIDATION');
    };
    const p = await plan(auth, body, deny);
    const { project, perm, me, granteeId, sponsored } = p;
    if (!durationsFor(perm.code).includes(body.duration_days)) return deny(`${perm.label} can be given for ${perm.maxDays} days at most.`, 400);
    const dup = (await db.find<AccessGrant>('access_grants', (g) => g.project_id === project.project_id && g.grantee_user_id === granteeId && g.permission_code === perm.code))
      .find((g) => PENDING.includes(grantState(g)) || grantState(g) === 'Active');
    if (dup) throw new HttpError(409, `There is already a ${grantState(dup).toLowerCase()} request for this (${dup.grant_id}).`, 'VALIDATION');
    if (p.blocked) return deny(p.blocked, 409);

    const now = new Date();
    const live = sponsored && !p.l2Needed;
    const row = await db.insert<AccessGrant>('access_grants', {
      project_id: project.project_id, grantee_user_id: granteeId, permission_code: perm.code, justification: body.justification,
      duration_days: body.duration_days, requested_by: me, status: !sponsored ? 'Pending L1' : live ? 'Active' : 'Pending L2',
      ...(sponsored ? { l1_approver_id: me, l1_decided_at: now.toISOString(), l1_note: 'Sponsored by the level-1 approver.' } : {}),
      ...(live ? { starts_at: now.toISOString(), expires_at: new Date(now.getTime() + body.duration_days * 86400000).toISOString() } : {}),
    }, me);
    await audit(db, auth, 'access.request', { type: 'access_grant', id: row.grant_id, projectId: project.project_id, details: { permission: perm.code, grantee: granteeId, days: body.duration_days, sponsored } });
    if (sponsored) await audit(db, auth, 'access.approve.l1', { type: 'access_grant', id: row.grant_id, projectId: project.project_id, details: { sponsored: true, live } });
    const out = (await enrich(auth, [row]))[0];
    const riskNames = p.l2.map((a) => a.name).join(' or ');
    const notice = !sponsored
      ? `Sent. Next: level 1 — ${namesList(p.l1)}.${p.l2Needed ? ` Then Risk & Quality (${riskNames}).` : ' Level 1 is all this needs.'}`
      : live ? `Live now — sponsored by you (level 1 only). ${p.grantee.user.full_name} has it until ${longDate(row.expires_at)}.`
      : `Sponsored — level 1 is done. Now with Risk & Quality: ${riskNames}.`;
    res.status(201).json({ ...out, notice });
  }));

  async function load(auth: AuthContext, id: string) {
    const g = await db.get<AccessGrant>('access_grants', id);
    if (!g || g.is_deleted === 'Y') throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    const visible = await visibleProjectIds(db, auth);
    if (!mayList(auth, g, visible)) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    const dir = await loadDirectory(db);
    return { g, dir, perms: rowPerms(auth, g, visible, dir) };
  }

  r.post('/requests/:id/decision', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional().nullable() }).parse(req.body);
    const { g, dir, perms } = await load(auth, req.params.id);
    const state = grantState(g);
    const level = state === 'Pending L1' ? 1 : state === 'Pending L2' ? 2 : 0;
    if (!level) throw new HttpError(409, state === 'Expired' && g.status !== 'Active' ? 'This request expired after 7 days without a decision. Ask the person to request again if it is still needed.' : `This request is already ${state.toLowerCase()}.`, 'VALIDATION');
    const allowed = level === 1 ? perms.approveL1 : perms.approveL2;
    if (!allowed) {
      await audit(db, auth, 'access.denied', { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { reason: `not a level-${level} approver for this request` } });
      throw new HttpError(403, level === 1
        ? 'Level-1 approval needs a Partner or Manager on this project who holds this permission and is senior to the person, and is not the requester (the Deals Leader can step in once a request is escalated).'
        : 'Level-2 approval is done by Risk & Quality, by someone other than the requester and the level-1 approver.', 'FORBIDDEN');
    }
    if (body.decision === 'reject' && (body.note ?? '').length < 5) throw new HttpError(400, 'Give a short reason when rejecting (at least 5 characters).', 'VALIDATION');
    const project = dir.project.get(g.project_id);
    const now = new Date();
    const pfx = level === 1 ? 'l1' : 'l2';
    const patch: Partial<AccessGrant> = { [`${pfx}_approver_id`]: auth.user.user_id, [`${pfx}_decided_at`]: now.toISOString(), [`${pfx}_note`]: body.note || null } as any;
    let riskNames = '';
    if (body.decision === 'reject') patch.status = 'Rejected';
    else if (level === 1 && needsLevel2(g.permission_code, project ?? null)) {
      const l2 = level2Approvers(dir, { ...g, l1_approver_id: auth.user.user_id });
      if (!l2.length) throw new HttpError(409, noApproverMessage(dir, g, 2), 'VALIDATION');
      riskNames = l2.map((a) => a.name).join(' or ');
      patch.status = 'Pending L2';
    } else {
      // Re-check at go-live: the person must still be staffed on the project.
      const grantee = await buildAuthContext(db, g.grantee_user_id);
      if (!grantee || !(await visibleProjectIds(db, grantee)).has(g.project_id)) throw new HttpError(409, 'The person is no longer on this project; reject the request instead.', 'VALIDATION');
      patch.status = 'Active';
      patch.starts_at = now.toISOString();
      patch.expires_at = new Date(now.getTime() + (g.duration_days || 30) * 86400000).toISOString();
    }
    const row = await db.update<AccessGrant>('access_grants', g.grant_id, patch, auth.user.user_id);
    await audit(db, auth, body.decision === 'reject' ? 'access.reject' : `access.approve.l${level}`, { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { permission: g.permission_code, grantee: g.grantee_user_id, note: body.note, live: patch.status === 'Active' } });
    const who = dir.name(g.grantee_user_id) ?? 'The person';
    const notice = body.decision === 'reject' ? `Rejected. ${who} will see your reason.`
      : patch.status === 'Pending L2' ? `Approved. Now with Risk & Quality: ${riskNames}.`
      : `Approved — access is live until ${longDate(patch.expires_at)}.`;
    res.json({ ...(await enrich(auth, [row]))[0], notice });
  }));

  r.post('/requests/:id/revoke', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({ reason: z.string().trim().min(3, 'Give a short reason.').max(1000) }).parse(req.body ?? {});
    const { g, dir, perms } = await load(auth, req.params.id);
    if (!perms.revoke) {
      await audit(db, auth, 'access.denied', { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { reason: 'cannot revoke' } });
      throw new HttpError(403, grantState(g) === 'Active' ? 'Only the person, a level-1 approver on this project or Risk & Quality can revoke this access.' : 'Only active access can be revoked.', 'FORBIDDEN');
    }
    const row = await db.update<AccessGrant>('access_grants', g.grant_id, { status: 'Revoked', revoked_by: auth.user.user_id, revoked_at: new Date().toISOString(), revoke_reason: body.reason }, auth.user.user_id);
    await audit(db, auth, 'access.revoke', { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { permission: g.permission_code, grantee: g.grantee_user_id, reason: body.reason } });
    const self = g.grantee_user_id === auth.user.user_id;
    res.json({ ...(await enrich(auth, [row], dir))[0], notice: self ? `Access switched off: ${permissionLabel(g.permission_code)}.` : `Access revoked for ${dir.name(g.grantee_user_id)}. It is off straight away.` });
  }));

  r.post('/requests/:id/cancel', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { g, dir, perms } = await load(auth, req.params.id);
    if (!perms.cancel) throw new HttpError(403, 'Only the person who raised a pending request can cancel it.', 'FORBIDDEN');
    const row = await db.update<AccessGrant>('access_grants', g.grant_id, { status: 'Cancelled' }, auth.user.user_id);
    await audit(db, auth, 'access.cancel', { type: 'access_grant', id: g.grant_id, projectId: g.project_id });
    res.json({ ...(await enrich(auth, [row], dir))[0], notice: 'Request cancelled. The approvers no longer see it.' });
  }));

  return r;
}

