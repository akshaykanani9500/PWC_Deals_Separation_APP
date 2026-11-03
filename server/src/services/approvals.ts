/**
 * v1.4 access governance helpers: who can approve the next step of a request (with names), the no-approver guard,
 * plain-words status lines / toast notices, and withdrawing access when someone leaves a project team.
 * Rules live in shared/access.ts; routes/access.ts is the API.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { AccessGrant, Persona, PersonaCode, Project, ProjectMember, User } from '../../../shared/types';
import { PERMISSIONS } from '../../../shared/permissions';
import { EXPIRE_PENDING_AFTER_DAYS, escalatesAt, grantable, grantState, isEscalated, level1Check, level1Who, needsLevel2, pendingExpiresAt, permissionLabel, LEVEL2_PERSONAS } from '../../../shared/access';
import { audit } from './audit';

export interface ApproverRef { user_id: string; name: string; role: string }

/** Short role words used in names lists ("Daniel Brooks (Manager)"). */
export const SHORT_ROLE: Record<PersonaCode, string> = {
  EXEC: 'Deals Leader', PARTNER: 'Partner', MANAGER: 'Manager', LEAD: 'Workstream Lead', ANALYST: 'Analyst', KM: 'Knowledge',
  RISK: 'Risk & Quality', CLIENT: 'Client', ADMIN: 'Admin',
};

/** A snapshot of users, personas, projects and staffing, loaded once per request. */
export interface Directory {
  users: User[];
  byId: Map<string, User>;
  persona: (id?: string | null) => PersonaCode | undefined;
  name: (id?: string | null) => string | undefined;
  active: (id?: string | null) => boolean;
  project: Map<string, Project>;
  /** Users staffed on a project: member rows + the named Partner / Manager. */
  staffed: (projectId: string) => Set<string>;
}

export async function loadDirectory(db: Db): Promise<Directory> {
  const [users, personas, projects, members] = await Promise.all([
    db.all<User>('users', { includeDeleted: true }), db.all<Persona>('personas'), db.all<Project>('projects', { includeDeleted: true }), db.all<ProjectMember>('project_members'),
  ]);
  const pcode = new Map(personas.map((p) => [p.persona_id, p.code]));
  const byId = new Map(users.map((u) => [u.user_id, u]));
  const project = new Map(projects.map((p) => [p.project_id, p]));
  const cache = new Map<string, Set<string>>();
  return {
    users, byId, project,
    persona: (id) => (id ? (pcode.get(byId.get(id)?.persona_id || '') as PersonaCode | undefined) : undefined),
    name: (id) => (id ? byId.get(id)?.full_name : undefined),
    active: (id) => { const u = id ? byId.get(id) : undefined; return !!u && u.is_deleted !== 'Y' && u.is_active !== 'N'; },
    staffed: (pid) => {
      let s = cache.get(pid);
      if (!s) {
        s = new Set(members.filter((m) => m.project_id === pid).map((m) => m.user_id));
        const p = project.get(pid);
        if (p?.partner_user_id) s.add(p.partner_user_id);
        if (p?.manager_user_id) s.add(p.manager_user_id);
        cache.set(pid, s);
      }
      return s;
    },
  };
}

type GrantKey = Pick<AccessGrant, 'project_id' | 'grantee_user_id' | 'permission_code'> & Partial<Pick<AccessGrant, 'requested_by' | 'l1_approver_id' | 'status' | 'created_at'>>;

const ref = (dir: Directory, id: string): ApproverRef => ({ user_id: id, name: dir.name(id) ?? id, role: SHORT_ROLE[dir.persona(id)!] ?? '' });

/** Does user `id` qualify to give level 1 for this request? `escalated` lets the Deals Leader in. */
export function qualifiesLevel1(dir: Directory, g: GrantKey, id: string, opts: { escalated?: boolean; sponsor?: boolean } = {}): boolean {
  const code = dir.persona(id);
  const granteeCode = dir.persona(g.grantee_user_id);
  if (!code || !granteeCode || !dir.active(id) || id === g.grantee_user_id) return false;
  // Level 1 (and sponsoring) needs someone staffed or named on the project. The Deals Leader is the one exception, and only
  // to unblock an escalated request; a sponsor must always be on the project.
  const staffed = dir.staffed(g.project_id).has(id);
  if (!staffed && !(code === 'EXEC' && opts.escalated && !opts.sponsor)) return false;
  return level1Check(code, PERMISSIONS[code].actions, granteeCode, g.permission_code) === null;
}

/** Everyone who can give level 1 now (never the requester of a self-request, never the grantee). */
export function level1Approvers(dir: Directory, g: GrantKey, now = Date.now()): ApproverRef[] {
  const escalated = !!g.created_at && isEscalated({ status: g.status ?? 'Pending L1', created_at: g.created_at }, now);
  const out = dir.users.filter((u) => u.user_id !== g.requested_by && qualifiesLevel1(dir, g, u.user_id, { escalated })).map((u) => ref(dir, u.user_id));
  const rank = (r: ApproverRef) => (r.role === 'Manager' ? 0 : r.role === 'Partner' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Everyone who can give level 2 (Risk & Quality, active, not the requester, grantee or level-1 approver). */
export function level2Approvers(dir: Directory, g: GrantKey): ApproverRef[] {
  return dir.users.filter((u) => {
    const code = dir.persona(u.user_id);
    return !!code && LEVEL2_PERSONAS.includes(code) && PERMISSIONS[code].actions.includes('access.review') && dir.active(u.user_id)
      && ![g.requested_by, g.grantee_user_id, g.l1_approver_id].includes(u.user_id);
  }).map((u) => ref(dir, u.user_id));
}

export const namesList = (xs: ApproverRef[]) => xs.map((x) => `${x.name} (${x.role})`).join(' or ');

/** The message used when nobody can approve a step. */
export function noApproverMessage(dir: Directory, g: GrantKey, level: 1 | 2): string {
  const label = permissionLabel(g.permission_code);
  const project = dir.project.get(g.project_id)?.code_name ?? g.project_id;
  if (level === 2) return `No active Risk & Quality reviewer can give level 2 for "${label}" on ${project}. Ask the platform admin to activate a Risk & Quality user.`;
  const who = level1Who(g.permission_code);
  return `No ${who} on ${project} can approve "${label}" for ${dir.name(g.grantee_user_id) ?? 'this person'}. Ask the Deals Leader to add a ${who} to the team.`;
}

export interface NextStep { level: 0 | 1 | 2; approvers: ApproverRef[]; blocked: string | null }

/** Who acts next on a request (state computed on read). */
export function nextStep(dir: Directory, g: AccessGrant, now = Date.now()): NextStep {
  const st = grantState(g, now);
  if (st === 'Pending L1') {
    const approvers = level1Approvers(dir, g, now);
    return { level: 1, approvers, blocked: approvers.length ? null : noApproverMessage(dir, g, 1) };
  }
  if (st === 'Pending L2') {
    const approvers = level2Approvers(dir, g);
    return { level: 2, approvers, blocked: approvers.length ? null : noApproverMessage(dir, g, 2) };
  }
  return { level: 0, approvers: [], blocked: null };
}

export const longDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

/** One line, for the bell and cards: what happened last / what happens next. */
export function statusLine(dir: Directory, g: AccessGrant, next: NextStep, now = Date.now()): string {
  const st = grantState(g, now);
  const l1 = dir.name(g.l1_approver_id);
  switch (st) {
    case 'Pending L1': return next.blocked ? `Stuck: ${next.blocked}` : `Waiting for level 1: ${namesList(next.approvers)}${isEscalated(g, now) ? ' (escalated)' : ''}`;
    case 'Pending L2': return next.blocked ? `Approved at level 1${l1 ? ` by ${l1}` : ''}. Stuck: ${next.blocked}` : `Approved at level 1${l1 ? ` by ${l1}` : ''}. Now with Risk & Quality: ${next.approvers.map((a) => a.name).join(' or ')}${isEscalated(g, now) ? ' (escalated)' : ''}`;
    case 'Active': return `Live until ${longDate(g.expires_at)}`;
    case 'Expired': return g.status === 'Active' ? `Ended on ${longDate(g.expires_at)}` : `Expired: no decision within ${EXPIRE_PENDING_AFTER_DAYS} days. Ask again if it is still needed.`;
    case 'Rejected': { const by = dir.name(g.l2_decided_at ? g.l2_approver_id : g.l1_approver_id); const note = g.l2_decided_at ? g.l2_note : g.l1_note; return `Rejected${by ? ` by ${by}` : ''}${note ? `: ${note}` : ''}`; }
    case 'Revoked': return `Revoked${dir.name(g.revoked_by) ? ` by ${dir.name(g.revoked_by)}` : ''}${g.revoke_reason ? `: ${g.revoke_reason}` : ''}`;
    case 'Cancelled': return 'Cancelled';
    default: return st;
  }
}

/** The latest event on a request and who caused it (null = the system, e.g. escalation / expiry). */
export function lastEvent(g: AccessGrant, now = Date.now()): { at: string; by: string | null; kind: string } {
  const st = grantState(g, now);
  const ev: { at: string; by: string | null; kind: string }[] = [{ at: g.created_at, by: g.requested_by ?? null, kind: 'requested' }];
  if (g.l1_decided_at) ev.push({ at: g.l1_decided_at, by: g.l1_approver_id ?? null, kind: st === 'Rejected' && !g.l2_decided_at ? 'rejected' : g.status === 'Active' && !g.l2_decided_at ? 'live' : 'approved_l1' });
  if (g.l2_decided_at) ev.push({ at: g.l2_decided_at, by: g.l2_approver_id ?? null, kind: st === 'Rejected' ? 'rejected' : 'live' });
  if (g.revoked_at) ev.push({ at: g.revoked_at, by: g.revoked_by ?? null, kind: 'revoked' });
  if (st === 'Cancelled' && g.updated_at) ev.push({ at: g.updated_at, by: g.updated_by ?? null, kind: 'cancelled' });
  if (g.created_at && (st === 'Pending L1' || st === 'Pending L2') && isEscalated(g, now)) ev.push({ at: escalatesAt(g)!, by: null, kind: 'escalated' });
  if (st === 'Expired') ev.push({ at: g.status === 'Active' ? g.expires_at! : pendingExpiresAt(g)!, by: null, kind: 'expired' });
  return ev.filter((e) => e.at).sort((a, b) => a.at.localeCompare(b.at)).pop()!;
}

/**
 * Removing someone from a project team: cancel their pending requests and revoke their live extra access there.
 * Returns how many items were withdrawn. Audited per item.
 */
export async function withdrawProjectAccess(db: Db, auth: AuthContext, projectId: string, userId: string, reason = 'Removed from the project team.'): Promise<number> {
  const now = new Date().toISOString();
  const rows = await db.find<AccessGrant>('access_grants', (g) => g.project_id === projectId && g.grantee_user_id === userId);
  let n = 0;
  for (const g of rows) {
    const st = grantState(g);
    if (st === 'Pending L1' || st === 'Pending L2') {
      await db.update<AccessGrant>('access_grants', g.grant_id, { status: 'Cancelled', revoke_reason: reason }, auth.user.user_id);
      await audit(db, auth, 'access.cancel', { type: 'access_grant', id: g.grant_id, projectId, details: { permission: g.permission_code, grantee: userId, reason, auto: true } });
      n++;
    } else if (st === 'Active') {
      await db.update<AccessGrant>('access_grants', g.grant_id, { status: 'Revoked', revoked_by: auth.user.user_id, revoked_at: now, revoke_reason: reason }, auth.user.user_id);
      await audit(db, auth, 'access.revoke', { type: 'access_grant', id: g.grant_id, projectId, details: { permission: g.permission_code, grantee: userId, reason, auto: true } });
      n++;
    }
  }
  return n;
}

export { grantable, needsLevel2 };
