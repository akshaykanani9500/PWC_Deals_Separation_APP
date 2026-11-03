/**
 * v1.4 (C): context and saving for the meeting / email / call dialogs.
 * - commsContext: who may be invited or e-mailed (team members + contacts), masked for roles without
 *   contacts.view.full; the client viewer gets nobody internal. Also whether the user may save to the log.
 * - logComms: saves a meeting / email / call to the project's communications log, linked to the stage / activity /
 *   task of the screen. Needs notes.add, an open project and not the client view.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Communication, CommsContext, CommsLogRequest, CommsPerson, Contact, ProjectMember, User } from '../../../shared/types';
import { maskContact } from '../../../shared/permissions';
import { loadContacts } from './data';
import { AiHttpError, scopeById, type ScopeKind } from './summary';
import { audit } from '../services/audit';

const has = (auth: AuthContext, a: string) => (auth.actions as string[]).includes(a);

export async function commsContext(db: Db, auth: AuthContext, kind: ScopeKind, id: string): Promise<CommsContext> {
  const scope = await scopeById(db, auth, kind, id);
  const project = scope.project!;
  const full = has(auth, 'contacts.view.full');
  const people: CommsPerson[] = [];
  if (auth.code !== 'CLIENT') {
    const members = await db.find<ProjectMember>('project_members', (m) => m.project_id === project.project_id);
    const ids = new Set([...members.map((m) => m.user_id), project.partner_user_id, project.manager_user_id].filter(Boolean) as string[]);
    const users = new Map((await db.all<User>('users')).map((u) => [u.user_id, u]));
    for (const uid of ids) {
      const u = users.get(uid);
      if (!u || u.is_active === 'N') continue;
      const m = members.find((x) => x.user_id === uid);
      people.push({
        id: u.user_id, name: u.full_name, kind: 'team', role: [m?.member_role, m?.workstream].filter(Boolean).join(', ') || undefined, org: 'PwC',
        email: u.email ? (full ? u.email : maskContact(u.email)) : undefined, phone: u.phone ? (full ? u.phone : maskContact(u.phone)) : undefined,
        emailMasked: !!u.email && !full, phoneMasked: !!u.phone && !full,
      });
    }
    const contacts: Contact[] = await loadContacts(db, auth, scope); // already masked for this role
    for (const c of contacts) {
      people.push({
        id: c.contact_id, name: c.full_name, kind: 'contact', role: c.role_title, org: c.org, side: c.side,
        email: c.email || undefined, phone: c.phone || undefined, emailMasked: !!c.email?.includes('•'), phoneMasked: !!c.phone?.includes('•'),
      });
    }
  } else {
    people.push({ id: auth.user.user_id, name: auth.user.full_name, kind: 'team', org: auth.user.org });
  }
  const closed = project.status === 'Closed';
  const canSave = auth.code !== 'CLIENT' && has(auth, 'notes.add') && !closed;
  const label = scope.task?.title ?? scope.activity?.name ?? scope.stage?.name ?? project.code_name;
  return {
    ref: { project_id: project.project_id, stage_id: scope.stage?.stage_id ?? null, activity_id: scope.activity?.activity_id ?? null, task_id: scope.task?.task_id ?? null, label, code_name: project.code_name },
    people,
    canSave,
    canEmail: auth.code !== 'CLIENT',
    saveReason: canSave ? undefined : auth.code === 'CLIENT' ? 'The client view is read-only.' : closed ? 'This project is closed and read-only.' : `Your role (${auth.persona.name}) cannot add to the project log.`,
  };
}

export async function logComms(db: Db, auth: AuthContext, body: CommsLogRequest): Promise<Communication> {
  if (!['Meeting', 'Email', 'Call'].includes(body.channel)) throw new AiHttpError(400, 'channel must be Meeting, Email or Call');
  if (typeof body.subject !== 'string' || !body.subject.trim()) throw new AiHttpError(400, 'subject is required');
  const scope = await scopeById(db, auth, body.scope, body.id);
  const project = scope.project!;
  if (auth.code === 'CLIENT') throw new AiHttpError(403, body.channel === 'Email' ? 'Email drafting is not available in the client view' : 'The client view is read-only.');
  if (!has(auth, 'notes.add')) {
    await audit(db, auth, 'access.denied', { type: 'communication', projectId: project.project_id, details: { needed: ['notes.add'] } });
    throw new AiHttpError(403, `Your role (${auth.persona.name}) cannot add to the project log.`);
  }
  if (project.status === 'Closed') throw new AiHttpError(403, 'This project is closed and read-only.');
  let contactId: string | null = null;
  if (body.contact_id) {
    const c = await db.get<Contact>('contacts', body.contact_id);
    if (c && c.project_id === project.project_id && c.is_deleted !== 'Y') contactId = c.contact_id;
  }
  const when = body.occurred_at && !Number.isNaN(Date.parse(body.occurred_at)) ? new Date(body.occurred_at).toISOString() : new Date().toISOString();
  const dur = body.duration_min == null ? null : Math.max(0, Math.min(600, Math.round(Number(body.duration_min) || 0)));
  const row = await db.insert<Communication>('communications', {
    project_id: project.project_id,
    stage_id: scope.stage?.stage_id ?? null, activity_id: scope.activity?.activity_id ?? null, task_id: scope.task?.task_id ?? null,
    channel: body.channel, subject: body.subject.trim().slice(0, 200), body: String(body.body ?? '').slice(0, 8000),
    from_name: auth.user.full_name, to_name: String(body.to_name ?? '').slice(0, 400) || undefined, contact_id: contactId,
    occurred_at: when, duration_min: dur,
  } as Partial<Communication>, auth.user.user_id);
  await audit(db, auth, 'communication.create', {
    type: scope.task ? 'task' : scope.activity ? 'activity' : scope.stage ? 'stage' : 'project',
    id: scope.task?.task_id ?? scope.activity?.activity_id ?? scope.stage?.stage_id ?? project.project_id,
    projectId: project.project_id, details: { channel: row.channel, subject: row.subject, comm_id: row.comm_id, via: 'comms-dialog' }, ai: !!body.aiDrafted,
  });
  return row;
}
