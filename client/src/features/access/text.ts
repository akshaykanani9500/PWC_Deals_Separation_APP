/** Plain-words helpers for access requests (cards, bell, panel). */
import type { AccessRequestRow, ApproverRef } from '@shared/types';
import { date } from '../../lib/format';

export const approverNames = (xs?: ApproverRef[]) => (xs ?? []).map((a) => `${a.name} (${a.role})`).join(' or ');

/** "Sent today" / "1 day waiting" / "4 days waiting". */
export function ageText(g: Pick<AccessRequestRow, 'age_days'>): string {
  const d = g.age_days ?? 0;
  return d <= 0 ? 'Sent today' : d === 1 ? '1 day waiting' : `${d} days waiting`;
}

/** Who acts next, in words. */
export function nextText(g: AccessRequestRow): string {
  if (g.blocked_reason) return g.blocked_reason;
  if (!g.next_level) return '';
  const who = approverNames(g.next_approvers);
  return g.next_level === 1 ? `Next: level 1 — ${who}` : `Next: Risk & Quality — ${who}`;
}

export const isPending = (g: AccessRequestRow) => g.state === 'Pending L1' || g.state === 'Pending L2';

/** Short status for "Your requests" in the bell. */
export function updateText(g: AccessRequestRow): string {
  if (g.state === 'Active') return `Live until ${date(g.expires_at)}`;
  return g.status_line ?? g.state;
}
