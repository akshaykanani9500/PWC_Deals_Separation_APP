/**
 * Access governance (v1.3, risk-tiered in v1.4): extra, time-bound permissions for one person on one project.
 *
 * How it works (modelled on how Big-4 deal teams handle "need-to-know" access):
 *   1. A team member asks for access for themselves, or a Partner / Manager sponsors it for someone in their team.
 *   2. LEVEL 1 - engagement approval: a Partner or Manager staffed on that project who already holds the permission and is
 *      more senior than the person getting it. A sponsor who qualifies counts as level 1.
 *   3. LEVEL 2 - Risk & Quality: an independent check (need-to-know, clean team, independence, client confidentiality).
 *      v1.4: only for the riskier items (see `approvals` on each permission). Low-risk items go live on level 1.
 *   4. Access goes live for 7, 30 or 90 days (some items max 30), is limited to that project, can be revoked at any time
 *      and every step is written to the audit log. Nobody approves their own request, and no one gives what they do not hold.
 *   5. v1.4 ageing: a request pending for more than 3 days is "Escalated" (the Deals Leader can then also give level 1 when
 *      they qualify); after 7 days pending it expires on its own.
 *   6. v1.4 acting roles: "Act as Workstream Lead / Engagement Manager / Engagement Partner on this project" is a grant of
 *      that role's day-to-day actions (never gates, close-out, audit, admin, approvals) on ONE project.
 * Shared by the server (the real gate) and the client (explains the rules and hides buttons).
 */
import { PERMISSIONS, type Action } from './permissions';
import type { PersonaCode } from './types';

/** Who must approve: level 1 only, level 1 + Risk, or Risk only on clean-team projects. */
export type ApprovalPolicy = 'L1' | 'L1+L2' | 'L1+L2_IF_CLEAN_TEAM';

export interface GrantablePermission {
  /** An Action (e.g. finance.view) or an acting role (role.LEAD / role.MANAGER / role.PARTNER). */
  code: string;
  label: string;
  description: string;
  /** Also switched on while this grant is active */
  implies?: Action[];
  /** Personas that may receive it */
  eligible: PersonaCode[];
  /** Shown to approvers, e.g. clean-team reminders */
  riskNote?: string;
  /** v1.4: which approvals it needs */
  approvals: ApprovalPolicy;
  /** v1.4: longest allowed duration in days */
  maxDays: number;
  /** v1.4: level 1 must come from one of these personas (default: LEVEL1_PERSONAS) */
  l1Personas?: PersonaCode[];
  /** v1.4: an acting-role grant; the bundle is that persona's actions minus NEVER_GRANT */
  actingRole?: PersonaCode;
}

/** Rights that never move between people, not even inside an acting-role bundle. */
export const NEVER_GRANT: Action[] = ['stage.gate.approve', 'closeout.approve', 'project.close', 'project.create', 'access.approve', 'access.review',
  'audit.view', 'admin.data', 'portfolio.view', 'knowledge.edit'];

export const ACTING_ROLE_LABEL: Partial<Record<PersonaCode, string>> = { LEAD: 'Workstream Lead', MANAGER: 'Engagement Manager', PARTNER: 'Engagement Partner' };

const acting = (role: 'LEAD' | 'MANAGER' | 'PARTNER', eligible: PersonaCode[], description: string): GrantablePermission => ({
  code: `role.${role}`, label: `Act as ${ACTING_ROLE_LABEL[role]} on this project`, eligible, description, actingRole: role,
  approvals: 'L1+L2', maxDays: 30, l1Personas: ['PARTNER'],
  riskNote: 'Acting roles cover absence or a stretch assignment. Check the person is ready; gate approvals, close-out and access approvals stay with the real role holders.',
});

export const GRANTABLE: GrantablePermission[] = [
  {
    code: 'finance.view', label: 'See project finance', eligible: ['MANAGER', 'LEAD', 'ANALYST'], approvals: 'L1+L2_IF_CLEAN_TEAM', maxDays: 90,
    description: 'Open the finance workspace of this project: fees, invoices, costs, funding and TSA charges (read-only).',
    riskNote: 'Fees and funding are commercially sensitive. On clean-team deals confirm the person is on the clean team.',
  },
  {
    code: 'finance.edit', label: 'Edit project finance', eligible: ['MANAGER', 'LEAD'], implies: ['finance.view'], approvals: 'L1+L2', maxDays: 90, l1Personas: ['PARTNER'],
    description: 'Add and change funding sources, cost lines and invoices in the finance workspace.',
    riskNote: 'Edit rights on billing and funding need segregation of duties: the approver should not also be the person billing.',
  },
  {
    code: 'contacts.view.full', label: 'See full phone numbers and emails', eligible: ['ANALYST'], approvals: 'L1', maxDays: 30,
    description: 'Unmasked client, seller and vendor contact details for this project.',
    riskNote: 'Personal data (DPDP Act): grant only when the person must contact these people directly. 30 days at most.',
  },
  {
    code: 'task.edit', label: 'Edit any task in the project', eligible: ['ANALYST'], approvals: 'L1', maxDays: 90,
    description: 'Change titles, owners, dates and priority of any task, not only tasks assigned to them.',
  },
  {
    code: 'activity.edit', label: 'Add and edit activities', eligible: ['ANALYST'], approvals: 'L1', maxDays: 90,
    description: 'Add, rename and plan activities in every stage of this project.',
  },
  acting('LEAD', ['ANALYST'], 'Edit activities and tasks in the stages your workstream owns on this project, like a Workstream Lead.'),
  acting('MANAGER', ['ANALYST', 'LEAD'], 'Run this project day to day like an Engagement Manager: project details, stages, activities, tasks and finance (view). No gate approvals, close-out or access approvals.'),
  acting('PARTNER', ['ANALYST', 'LEAD', 'MANAGER'], 'Stand in for the Engagement Partner on this project: everything a Manager does plus finance edits. Gate approvals, close-out and access approvals stay with the real Partner.'),
];

export const GRANT_DURATIONS = [7, 30, 90] as const;

/** Pending requests: escalate after 3 days, expire after 7. */
export const ESCALATE_AFTER_DAYS = 3;
export const EXPIRE_PENDING_AFTER_DAYS = 7;
const DAY_MS = 86400000;

/** Seniority used for "higher level gives to lower level". */
export const RANK: Record<PersonaCode, number> = { EXEC: 6, PARTNER: 5, MANAGER: 4, LEAD: 3, ANALYST: 2, KM: 2, RISK: 2, ADMIN: 2, CLIENT: 0 };

export const LEVEL1_PERSONAS: PersonaCode[] = ['EXEC', 'PARTNER', 'MANAGER'];
export const LEVEL2_PERSONAS: PersonaCode[] = ['RISK'];

export function grantable(code: string): GrantablePermission | undefined {
  return GRANTABLE.find((g) => g.code === code);
}

export function isActingRole(code: string): boolean {
  return !!grantable(code)?.actingRole;
}

/** The actions an acting-role grant switches on: that persona's actions minus NEVER_GRANT. */
export function roleBundle(role: PersonaCode): Action[] {
  return (PERMISSIONS[role]?.actions ?? []).filter((a) => !NEVER_GRANT.includes(a));
}

/** Actions switched on by an active grant of `code` (the permission itself + anything it implies, or a role bundle). */
export function grantActions(code: string): Action[] {
  const g = grantable(code);
  if (!g) return [];
  if (g.actingRole) return roleBundle(g.actingRole);
  return [g.code as Action, ...(g.implies ?? [])];
}

export function permissionLabel(code: string): string {
  return grantable(code)?.label ?? code;
}

/** Durations allowed for a permission (7 / 30 / 90 capped by maxDays). */
export function durationsFor(code: string): number[] {
  const max = grantable(code)?.maxDays ?? 90;
  return GRANT_DURATIONS.filter((d) => d <= max);
}

type ProjectLike = { clean_team_required?: string | null } | null | undefined;

/** Does this permission need the Risk & Quality step on this project? */
export function needsLevel2(code: string, project: ProjectLike): boolean {
  const p = grantable(code)?.approvals;
  if (p === 'L1+L2') return true;
  if (p === 'L1+L2_IF_CLEAN_TEAM') return project?.clean_team_required === 'Y';
  return false;
}

/** Plain words for the policy. With a project: what applies there; without: the general rule. */
export function policyText(code: string, project?: ProjectLike): string {
  const g = grantable(code);
  if (!g) return '';
  if (project && g.approvals === 'L1+L2_IF_CLEAN_TEAM') return needsLevel2(code, project) ? 'Level 1 + Risk & Quality (clean-team deal)' : 'Level 1 only';
  return g.approvals === 'L1' ? 'Level 1 only' : g.approvals === 'L1+L2' ? 'Level 1 + Risk & Quality' : 'Level 1, plus Risk & Quality on clean-team deals';
}

/** Who may give level 1, in words (for messages). */
export function level1Who(code: string): string {
  const g = grantable(code);
  return g?.l1Personas?.length === 1 && g.l1Personas[0] === 'PARTNER' ? 'Partner' : 'Partner or Manager';
}

/**
 * Can someone with persona `approver` (holding `approverActions` from their ROLE, not from grants) give `code` to a
 * person with persona `grantee` at level 1? Returns a reason when not.
 */
export function level1Check(approver: PersonaCode, approverActions: readonly string[], grantee: PersonaCode, code: string): string | null {
  const g = grantable(code);
  if (!LEVEL1_PERSONAS.includes(approver)) return 'Only a Partner, Manager or the Deals Leader can give level-1 approval.';
  if (g?.l1Personas && !g.l1Personas.includes(approver)) return `Level-1 approval for "${g.label}" must come from an Engagement Partner on the project.`;
  if (!g?.actingRole && !approverActions.includes(code)) return 'You cannot approve a permission your own role does not have.';
  if (RANK[approver] <= RANK[grantee]) return 'Level-1 approval must come from someone more senior than the person getting access.';
  return null;
}

export type GrantState = 'Pending L1' | 'Pending L2' | 'Active' | 'Expired' | 'Rejected' | 'Revoked' | 'Cancelled';

type GrantLike = { status: string; expires_at?: string | null; created_at?: string | null };

/** Whole days a request has been waiting (from created_at). */
export function pendingAgeDays(g: GrantLike, now = Date.now()): number {
  if (!g.created_at) return 0;
  return Math.max(0, Math.floor((now - Date.parse(g.created_at)) / DAY_MS));
}

/** When a pending request expires by itself. */
export function pendingExpiresAt(g: GrantLike): string | null {
  return g.created_at ? new Date(Date.parse(g.created_at) + EXPIRE_PENDING_AFTER_DAYS * DAY_MS).toISOString() : null;
}

/** When a pending request is (or will be) escalated. */
export function escalatesAt(g: GrantLike): string | null {
  return g.created_at ? new Date(Date.parse(g.created_at) + ESCALATE_AFTER_DAYS * DAY_MS).toISOString() : null;
}

/**
 * Display state: an Active grant past its expiry shows as Expired (and is no longer applied); a request pending for
 * EXPIRE_PENDING_AFTER_DAYS or more also shows as Expired (it can no longer be approved). Computed on read.
 */
export function grantState(g: GrantLike, now = Date.now()): GrantState {
  if (g.status === 'Active' && g.expires_at && Date.parse(g.expires_at) <= now) return 'Expired';
  if ((g.status === 'Pending L1' || g.status === 'Pending L2') && g.created_at && now - Date.parse(g.created_at) >= EXPIRE_PENDING_AFTER_DAYS * DAY_MS) return 'Expired';
  return g.status as GrantState;
}

/** Still pending, but waiting ESCALATE_AFTER_DAYS or more. */
export function isEscalated(g: GrantLike, now = Date.now()): boolean {
  const st = grantState(g, now);
  return (st === 'Pending L1' || st === 'Pending L2') && !!g.created_at && now - Date.parse(g.created_at) >= ESCALATE_AFTER_DAYS * DAY_MS;
}

/** The permission -> approvals matrix, for the "How approval works" explainer. */
export function approvalMatrix() {
  return GRANTABLE.map((g) => ({
    code: g.code, label: g.label, eligible: g.eligible, acting: !!g.actingRole, policy: policyText(g.code),
    level1: g.l1Personas?.length === 1 && g.l1Personas[0] === 'PARTNER' ? 'Engagement Partner on the project' : 'Partner or Manager on the project who holds it',
    level2: g.approvals === 'L1' ? 'Not needed' : g.approvals === 'L1+L2' ? 'Risk & Quality' : 'Risk & Quality on clean-team deals only',
    maxDays: g.maxDays,
  }));
}

/** The approval rules in words (single source for the server catalog and the client explainer). */
export const APPROVAL_RULES: string[] = [
  'Access is for one person on one project, for 7, 30 or 90 days (some items 30 days at most).',
  'Level 1: a Partner or Manager staffed on the project who holds the permission themselves and is more senior than the person getting it. Finance edits and acting roles need the Engagement Partner.',
  'A Partner or Manager who sponsors access for their team member counts as level 1. When level 1 is all an item needs, it goes live straight away.',
  'Level 2: Risk & Quality checks need-to-know, clean team and confidentiality for the riskier items (finance edits, acting roles, finance on clean-team deals). It must be someone other than the requester and the level-1 approver.',
  `A request waiting ${ESCALATE_AFTER_DAYS} days or more is escalated: it is highlighted and the Deals Leader can also give level 1 when they qualify. After ${EXPIRE_PENDING_AFTER_DAYS} days without a decision it expires; ask again if it is still needed.`,
  'A request is refused up front when nobody could approve it (for example no Partner on the team); the message says who must be added.',
  'Removing someone from the team cancels their pending requests and revokes their extra access on that project.',
  'Acting roles never include stage-gate approval, close-out, creating or closing projects, access approvals, audit, admin or the portfolio view.',
  'Client users and control roles (Knowledge, Risk, Admin) keep fixed access. Every step is in the audit log, and access can be revoked at any time.',
];
