/**
 * Access governance API (v1.3), mounted at /api/access. Rules: shared/access.ts.
 *   GET  /access/catalog                  what can be requested, durations, the approval rules
 *   GET  /access/requests?view=&projectId  requests I may see (mine, my approval inbox, or all I oversee)
 *   GET  /access/summary                  { inbox, mine } counts for the top-bar badge
 *   POST /access/requests                 { project_id, permission_code, justification, duration_days, grantee_user_id? }
 *   POST /access/requests/:id/decision    { decision: 'approve' | 'reject', note }
 *   POST /access/requests/:id/revoke      { reason }
 *   POST /access/requests/:id/cancel
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/Db';
import type { AuthContext, AuthedRequest } from '../auth-types';
import type { AccessGrant, AccessRequestRow, Persona, PersonaCode, Project, User } from '../../../shared/types';
import { PERMISSIONS } from '../../../shared/permissions';
import { GRANTABLE, GRANT_DURATIONS, grantable, grantState, level1Check, permissionLabel } from '../../../shared/access';
import { ah, HttpError } from '../errors';
import { buildAuthContext } from '../middleware/auth';
import { assertProjectAccess, visibleProjectIds } from '../services/access';
import { audit } from '../services/audit';

const base = (auth: AuthContext) => auth.baseActions ?? auth.actions;
const has = (auth: AuthContext, a: string) => (base(auth) as string[]).includes(a);
const PENDING = ['Pending L1', 'Pending L2'];

export function accessRouter(db: Db): Router {
  const r = Router();

  async function lookups() {
    const [users, personas, projects] = await Promise.all([db.all<User>('users', { includeDeleted: true }), db.all<Persona>('personas'), db.all<Project>('projects', { includeDeleted: true })]);
    const pcode = new Map(personas.map((p) => [p.persona_id, p.code]));
    const byId = new Map(users.map((u) => [u.user_id, u]));
    return {
      name: (id?: string | null) => (id ? byId.get(id)?.full_name : undefined),
      persona: (id?: string | null) => (id ? (pcode.get(byId.get(id)?.persona_id || '') as PersonaCode | undefined) : undefined),
      project: new Map(projects.map((p) => [p.project_id, p])),
    };
  }

  /** What may `auth` do with this request? (pure rules + the project-visibility check) */
  function rowPerms(auth: AuthContext, g: AccessGrant, visible: Set<string>, granteePersona?: PersonaCode) {
    const me = auth.user.user_id;
    const state = grantState(g);
    const l1Ok = has(auth, 'access.approve') && visible.has(g.project_id) && me !== g.grantee_user_id && !!granteePersona
      && level1Check(auth.code, base(auth), granteePersona, g.permission_code) === null;
    const approveL1 = state === 'Pending L1' && l1Ok && me !== g.requested_by;
    const approveL2 = state === 'Pending L2' && has(auth, 'access.review') && ![g.requested_by, g.grantee_user_id, g.l1_approver_id].includes(me);
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

  async function enrich(auth: AuthContext, rows: AccessGrant[]): Promise<AccessRequestRow[]> {
    const L = await lookups();
    const visible = await visibleProjectIds(db, auth);
    return rows.map((g) => {
      const gp = L.persona(g.grantee_user_id);
      const perm = grantable(g.permission_code);
      const project = L.project.get(g.project_id);
      return {
        ...g, state: grantState(g), label: permissionLabel(g.permission_code), risk_note: perm?.riskNote,
        project_code: project?.code_name, clean_team: project?.clean_team_required === 'Y',
        grantee_name: L.name(g.grantee_user_id), grantee_persona: gp, requested_by_name: L.name(g.requested_by),
        l1_name: L.name(g.l1_approver_id), l2_name: L.name(g.l2_approver_id), revoked_by_name: L.name(g.revoked_by),
        can: rowPerms(auth, g, visible, gp),
      };
    });
  }

  r.get('/catalog', ah(async (_req, res) => {
    res.json({
      grantable: GRANTABLE, durations: GRANT_DURATIONS,
      rules: [
        'Access is for one person on one project, and only for 7, 30 or 90 days.',
        'Level 1: a Partner or Manager on the project (or the Deals Leader) who holds the permission themselves and is more senior than the person getting it.',
        'Level 2: Risk & Quality checks need-to-know, clean-team and confidentiality before anything goes live.',
        'Nobody approves their own request; the level-2 approver must be a different person from the requester and the level-1 approver.',
        'Client users and control roles (Knowledge, Risk, Admin) keep fixed access. Every step is in the audit log, and access can be revoked at any time.',
      ],
    });
  }));

  r.get('/summary', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const rows = await enrich(auth, await db.all<AccessGrant>('access_grants'));
    res.json({
      inbox: rows.filter((x) => x.can.approveL1 || x.can.approveL2).length,
      mine: rows.filter((x) => x.grantee_user_id === auth.user.user_id && PENDING.includes(x.state)).length,
      activeForMe: rows.filter((x) => x.grantee_user_id === auth.user.user_id && x.state === 'Active').length,
    });
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
    out.sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
    res.json(out);
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
    const project = await assertProjectAccess(db, auth, body.project_id);
    if (project.status === 'Closed') throw new HttpError(400, 'This project is closed; access cannot be added.', 'VALIDATION');
    const perm = grantable(body.permission_code);
    if (!perm) throw new HttpError(400, 'This permission cannot be requested. Role-only rights (gates, close-out, audit, admin) never move between people.', 'VALIDATION');
    const me = auth.user.user_id;
    const granteeId = body.grantee_user_id || me;
    const sponsored = granteeId !== me;
    const deny = async (msg: string, status = 403): Promise<never> => {
      await audit(db, auth, 'access.denied', { type: 'access_grant', projectId: project.project_id, details: { reason: msg, permission: body.permission_code, grantee: granteeId } });
      throw new HttpError(status, msg, status === 403 ? 'FORBIDDEN' : 'VALIDATION');
    };
    if (!sponsored && !has(auth, 'access.request')) await deny('Your role cannot request extra access.');

    const grantee = await buildAuthContext(db, granteeId);
    if (!grantee) return deny('Unknown or inactive person.', 400);
    if (!perm.eligible.includes(grantee.code)) return deny(`${perm.label} cannot be given to the ${grantee.persona.name} role.`, 400);
    if (PERMISSIONS[grantee.code].actions.includes(perm.code)) return deny(`${grantee.user.full_name} already has this through their role.`, 400);
    if (!(await visibleProjectIds(db, grantee)).has(project.project_id)) return deny(`${grantee.user.full_name} is not staffed on ${project.code_name}. Add them to the team first.`, 400);
    if (sponsored) {
      if (!has(auth, 'access.approve')) await deny('Only a Partner, Manager or the Deals Leader can ask for access on behalf of someone else.');
      const why = level1Check(auth.code, base(auth), grantee.code, perm.code);
      if (why) await deny(why);
    }
    const dup = (await db.find<AccessGrant>('access_grants', (g) => g.project_id === project.project_id && g.grantee_user_id === granteeId && g.permission_code === perm.code))
      .find((g) => PENDING.includes(grantState(g)) || grantState(g) === 'Active');
    if (dup) throw new HttpError(409, `There is already a ${grantState(dup).toLowerCase()} request for this (${dup.grant_id}).`, 'VALIDATION');

    const now = new Date().toISOString();
    const row = await db.insert<AccessGrant>('access_grants', {
      project_id: project.project_id, grantee_user_id: granteeId, permission_code: perm.code, justification: body.justification,
      duration_days: body.duration_days, requested_by: me, status: sponsored ? 'Pending L2' : 'Pending L1',
      ...(sponsored ? { l1_approver_id: me, l1_decided_at: now, l1_note: 'Sponsored by the level-1 approver.' } : {}),
    }, me);
    await audit(db, auth, 'access.request', { type: 'access_grant', id: row.grant_id, projectId: project.project_id, details: { permission: perm.code, grantee: granteeId, days: body.duration_days, sponsored } });
    if (sponsored) await audit(db, auth, 'access.approve.l1', { type: 'access_grant', id: row.grant_id, projectId: project.project_id, details: { sponsored: true } });
    res.status(201).json((await enrich(auth, [row]))[0]);
  }));

  async function load(auth: AuthContext, id: string) {
    const g = await db.get<AccessGrant>('access_grants', id);
    if (!g || g.is_deleted === 'Y') throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    const visible = await visibleProjectIds(db, auth);
    if (!mayList(auth, g, visible)) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    const L = await lookups();
    return { g, perms: rowPerms(auth, g, visible, L.persona(g.grantee_user_id)) };
  }

  r.post('/requests/:id/decision', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional().nullable() }).parse(req.body);
    const { g, perms } = await load(auth, req.params.id);
    const state = grantState(g);
    const level = state === 'Pending L1' ? 1 : state === 'Pending L2' ? 2 : 0;
    if (!level) throw new HttpError(409, `This request is already ${state.toLowerCase()}.`, 'VALIDATION');
    const allowed = level === 1 ? perms.approveL1 : perms.approveL2;
    if (!allowed) {
      await audit(db, auth, 'access.denied', { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { reason: `not a level-${level} approver for this request` } });
      throw new HttpError(403, level === 1
        ? 'Level-1 approval needs a Partner or Manager on this project (or the Deals Leader) who holds this permission and is senior to the requester, and is not the requester.'
        : 'Level-2 approval is done by Risk & Quality, by someone other than the requester and the level-1 approver.', 'FORBIDDEN');
    }
    if (body.decision === 'reject' && (body.note ?? '').length < 5) throw new HttpError(400, 'Give a short reason when rejecting (at least 5 characters).', 'VALIDATION');
    const now = new Date();
    const pfx = level === 1 ? 'l1' : 'l2';
    const patch: Partial<AccessGrant> = { [`${pfx}_approver_id`]: auth.user.user_id, [`${pfx}_decided_at`]: now.toISOString(), [`${pfx}_note`]: body.note || null } as any;
    if (body.decision === 'reject') patch.status = 'Rejected';
    else if (level === 1) patch.status = 'Pending L2';
    else {
      // Re-check at go-live: the person must still be staffed on the project.
      const grantee = await buildAuthContext(db, g.grantee_user_id);
      if (!grantee || !(await visibleProjectIds(db, grantee)).has(g.project_id)) throw new HttpError(409, 'The person is no longer on this project; reject the request instead.', 'VALIDATION');
      patch.status = 'Active';
      patch.starts_at = now.toISOString();
      patch.expires_at = new Date(now.getTime() + (g.duration_days || 30) * 86400000).toISOString();
    }
    const row = await db.update<AccessGrant>('access_grants', g.grant_id, patch, auth.user.user_id);
    await audit(db, auth, body.decision === 'reject' ? 'access.reject' : `access.approve.l${level}`, { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { permission: g.permission_code, grantee: g.grantee_user_id, note: body.note, live: patch.status === 'Active' } });
    res.json((await enrich(auth, [row]))[0]);
  }));

  r.post('/requests/:id/revoke', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const body = z.object({ reason: z.string().trim().min(3, 'Give a short reason.').max(1000) }).parse(req.body ?? {});
    const { g, perms } = await load(auth, req.params.id);
    if (!perms.revoke) {
      await audit(db, auth, 'access.denied', { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { reason: 'cannot revoke' } });
      throw new HttpError(403, grantState(g) === 'Active' ? 'Only the person, a level-1 approver on this project or Risk & Quality can revoke this access.' : 'Only active access can be revoked.', 'FORBIDDEN');
    }
    const row = await db.update<AccessGrant>('access_grants', g.grant_id, { status: 'Revoked', revoked_by: auth.user.user_id, revoked_at: new Date().toISOString(), revoke_reason: body.reason }, auth.user.user_id);
    await audit(db, auth, 'access.revoke', { type: 'access_grant', id: g.grant_id, projectId: g.project_id, details: { permission: g.permission_code, grantee: g.grantee_user_id, reason: body.reason } });
    res.json((await enrich(auth, [row]))[0]);
  }));

  r.post('/requests/:id/cancel', ah(async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { g, perms } = await load(auth, req.params.id);
    if (!perms.cancel) throw new HttpError(403, 'Only the person who raised a pending request can cancel it.', 'FORBIDDEN');
    const row = await db.update<AccessGrant>('access_grants', g.grant_id, { status: 'Cancelled' }, auth.user.user_id);
    await audit(db, auth, 'access.cancel', { type: 'access_grant', id: g.grant_id, projectId: g.project_id });
    res.json((await enrich(auth, [row]))[0]);
  }));

  return r;
}
