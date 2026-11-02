/**
 * Access governance (v1.3): extra, time-bound permissions for one person on one project.
 *
 * How it works (modelled on how Big-4 deal teams handle "need-to-know" access):
 *   1. A team member asks for access for themselves, or a Partner / Manager sponsors it for someone in their team.
 *   2. LEVEL 1 - engagement approval: a Partner or Manager on that project (or the Deals Leader) who already holds the
 *      permission and is more senior than the person getting it. A sponsor who qualifies counts as level 1.
 *   3. LEVEL 2 - Risk & Quality: an independent check (need-to-know, clean team, independence, client confidentiality).
 *   4. Access goes live for 7, 30 or 90 days, is limited to that project, can be revoked at any time and every step is
 *      written to the audit log. Nobody can approve their own request, and no one can give a permission they do not hold.
 * Shared by the server (the real gate) and the client (explains the rules and hides buttons).
 */
import type { Action } from './permissions';
import type { PersonaCode } from './types';

export interface GrantablePermission {
  code: Action;
  label: string;
  description: string;
  /** Also switched on while this grant is active */
  implies?: Action[];
  /** Personas that may receive it */
  eligible: PersonaCode[];
  /** Shown to approvers, e.g. clean-team reminders */
  riskNote?: string;
}

export const GRANTABLE: GrantablePermission[] = [
  {
    code: 'finance.view', label: 'See project finance', eligible: ['MANAGER', 'LEAD', 'ANALYST'],
    description: 'Open the finance workspace of this project: fees, invoices, costs, funding and TSA charges (read-only).',
    riskNote: 'Fees and funding are commercially sensitive. On clean-team deals confirm the person is on the clean team.',
  },
  {
    code: 'finance.edit', label: 'Edit project finance', eligible: ['MANAGER', 'LEAD'], implies: ['finance.view'],
    description: 'Add and change funding sources, cost lines and invoices in the finance workspace.',
    riskNote: 'Edit rights on billing and funding need segregation of duties: the approver should not also be the person billing.',
  },
  {
    code: 'contacts.view.full', label: 'See full phone numbers and emails', eligible: ['ANALYST'],
    description: 'Unmasked client, seller and vendor contact details for this project.',
    riskNote: 'Personal data (DPDP Act): grant only when the person must contact these people directly.',
  },
  {
    code: 'task.edit', label: 'Edit any task in the project', eligible: ['ANALYST'],
    description: 'Change titles, owners, dates and priority of any task, not only tasks assigned to them.',
  },
  {
    code: 'activity.edit', label: 'Add and edit activities', eligible: ['ANALYST'],
    description: 'Add, rename and plan activities in every stage of this project.',
  },
];

export const GRANT_DURATIONS = [7, 30, 90] as const;

/** Seniority used for "higher level gives to lower level". */
export const RANK: Record<PersonaCode, number> = { EXEC: 6, PARTNER: 5, MANAGER: 4, LEAD: 3, ANALYST: 2, KM: 2, RISK: 2, ADMIN: 2, CLIENT: 0 };

export const LEVEL1_PERSONAS: PersonaCode[] = ['EXEC', 'PARTNER', 'MANAGER'];
export const LEVEL2_PERSONAS: PersonaCode[] = ['RISK'];

export function grantable(code: string): GrantablePermission | undefined {
  return GRANTABLE.find((g) => g.code === code);
}

/** Actions switched on by an active grant of `code` (the permission itself + anything it implies). */
export function grantActions(code: string): Action[] {
  const g = grantable(code);
  return g ? [g.code, ...(g.implies ?? [])] : [];
}

export function permissionLabel(code: string): string {
  return grantable(code)?.label ?? code;
}

/**
 * Can someone with persona `approver` (holding `approverActions` from their ROLE, not from grants) give `code` to a
 * person with persona `grantee` at level 1? Returns a reason when not.
 */
export function level1Check(approver: PersonaCode, approverActions: readonly string[], grantee: PersonaCode, code: string): string | null {
  if (!LEVEL1_PERSONAS.includes(approver)) return 'Only a Partner, Manager or the Deals Leader can give level-1 approval.';
  if (!approverActions.includes(code)) return 'You cannot approve a permission your own role does not have.';
  if (RANK[approver] <= RANK[grantee]) return 'Level-1 approval must come from someone more senior than the person getting access.';
  return null;
}

export type GrantState = 'Pending L1' | 'Pending L2' | 'Active' | 'Expired' | 'Rejected' | 'Revoked' | 'Cancelled';

/** Display state: an Active grant past its expiry shows as Expired (and is no longer applied). */
export function grantState(g: { status: string; expires_at?: string | null }, now = Date.now()): GrantState {
  if (g.status === 'Active' && g.expires_at && Date.parse(g.expires_at) <= now) return 'Expired';
  return g.status as GrantState;
}
