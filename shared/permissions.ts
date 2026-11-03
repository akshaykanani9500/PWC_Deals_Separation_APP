/**
 * Permission model (used by BOTH server and client).
 * The server is the real gate; the client only hides buttons the user cannot use.
 *
 * A request is allowed when:
 *   1. the persona has the ACTION in PERMISSIONS, and
 *   2. the project is in the user's SCOPE (see projectScope), and
 *   3. for "own" actions, the record belongs to the user (assignee / owner / workstream lead).
 */
import type { PersonaCode } from './types';

export const ACTIONS = [
  'portfolio.view',        // dashboard KPIs across projects
  'project.view',
  'project.create',
  'project.edit',          // name, dates, status, description
  'project.close',         // start close-out
  'closeout.approve',      // approve knowledge items into the hub (consent/redaction check)
  'stage.edit',            // add / rename / reorder / remove stages
  'stage.gate.approve',    // approve a stage gate
  'activity.edit',         // add / edit / remove activities (LEAD: only in stages they own)
  'task.edit',             // add / edit / remove any task in the project
  'task.edit.own',         // edit status/notes of tasks assigned to me
  'finance.view',
  'finance.edit',
  'contacts.view.full',    // see phone & email unmasked
  'comms.view',            // emails, calls, meetings history
  'notes.add',
  'piku.use',
  'ai.suggest',            // "Get AI suggestion" in edit panels
  'knowledge.view',
  'knowledge.edit',
  'audit.view',
  'admin.data',            // data admin page: DB driver, sync, export for Oracle
  'access.request',        // ask for extra, time-bound access on a project (for yourself)
  'access.approve',        // level-1 (engagement) approver: sponsor or approve requests for your team
  'access.review',         // level-2 (Risk & Quality) approver: independent check before access goes live
] as const;
export type Action = (typeof ACTIONS)[number];

/** How a persona sees projects. */
export type ProjectScope = 'all' | 'member';

export interface PersonaPolicy {
  scope: ProjectScope;
  actions: Action[];
  /** Short line shown on the login screen */
  summary: string;
}

const READ_BASE: Action[] = ['project.view', 'comms.view', 'piku.use'];

export const PERMISSIONS: Record<PersonaCode, PersonaPolicy> = {
  EXEC: {
    scope: 'all',
    summary: 'Sees every project and the portfolio, finance included. Creates new projects. Does not edit day-to-day work.',
    actions: [...READ_BASE, 'portfolio.view', 'project.create', 'finance.view', 'contacts.view.full', 'notes.add', 'knowledge.view', 'audit.view', 'access.approve'],
  },
  PARTNER: {
    scope: 'member',
    summary: 'Owns client relationships. Full control of own projects, approves stage gates and closes projects.',
    actions: [...READ_BASE, 'portfolio.view', 'project.create', 'project.edit', 'project.close', 'stage.edit', 'stage.gate.approve',
      'activity.edit', 'task.edit', 'task.edit.own', 'finance.view', 'finance.edit', 'contacts.view.full', 'notes.add', 'ai.suggest', 'knowledge.view', 'access.approve'],
  },
  MANAGER: {
    scope: 'member',
    summary: 'Runs projects day to day: edits stages, activities and tasks, assigns people, starts close-out.',
    actions: [...READ_BASE, 'portfolio.view', 'project.create', 'project.edit', 'project.close', 'stage.edit', 'activity.edit', 'task.edit',
      'task.edit.own', 'finance.view', 'contacts.view.full', 'notes.add', 'ai.suggest', 'knowledge.view', 'access.request', 'access.approve'],
  },
  LEAD: {
    scope: 'member',
    summary: 'Leads a workstream: edits activities and tasks in the stages they own. No finance.',
    actions: [...READ_BASE, 'activity.edit', 'task.edit', 'task.edit.own', 'contacts.view.full', 'notes.add', 'ai.suggest', 'knowledge.view', 'access.request'],
  },
  ANALYST: {
    scope: 'member',
    summary: 'Updates status and notes on tasks assigned to them. Read-only elsewhere. Contacts masked.',
    actions: [...READ_BASE, 'task.edit.own', 'notes.add', 'knowledge.view', 'access.request'],
  },
  KM: {
    scope: 'all',
    summary: 'Knowledge manager: reviews close-out learnings into the AI knowledge hub. Read-only on projects.',
    actions: ['project.view', 'piku.use', 'portfolio.view', 'knowledge.view', 'knowledge.edit', 'closeout.approve'],
  },
  RISK: {
    scope: 'all',
    summary: 'Risk & Quality / DPO: read-only on all projects, sees the audit log, approves reuse consent at close-out and gives the second (final) approval on access requests.',
    actions: [...READ_BASE, 'portfolio.view', 'audit.view', 'closeout.approve', 'knowledge.view', 'access.review'],
  },
  CLIENT: {
    scope: 'member',
    summary: 'Client SMO viewer: read-only view of their own project. No fees, no internal emails, contacts masked.',
    actions: ['project.view', 'piku.use'],
  },
  ADMIN: {
    scope: 'all',
    summary: 'Platform admin: data admin page (database driver, sync, Oracle export). No access to client content edits.',
    actions: ['project.view', 'piku.use', 'portfolio.view', 'audit.view', 'admin.data', 'knowledge.view'],
  },
};

export function can(persona: PersonaCode, action: Action): boolean {
  return PERMISSIONS[persona]?.actions.includes(action) ?? false;
}

export function projectScope(persona: PersonaCode): ProjectScope {
  return PERMISSIONS[persona]?.scope ?? 'member';
}

/** Mask a phone/email for personas without contacts.view.full, e.g. "+91 98••••••12" / "r•••@buyer.com". */
export function maskContact(value: string | null | undefined): string {
  if (!value) return '';
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  const digits = value.replace(/\s/g, '');
  if (digits.length <= 4) return '••••';
  return `${digits.slice(0, 5)}••••••${digits.slice(-2)}`;
}

/** Project fields the CLIENT persona must never receive. */
export const CLIENT_HIDDEN_PROJECT_FIELDS = ['fee_budget', 'fee_billed', 'reuse_consent', 'tags'] as const;
/** Fields hidden from any persona without finance.view. */
export const FINANCE_FIELDS = ['fee_budget', 'fee_billed', 'tsa_monthly_cost', 'one_time_cost', 'funding_gap', 'spa_seller_cap', 'spa_clause_ref'] as const;
