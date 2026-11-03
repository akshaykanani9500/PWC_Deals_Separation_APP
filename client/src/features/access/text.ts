/** Plain-words helpers for access requests (cards, bell, panel). */
import type { AccessRequestRow, ApproverRef } from '@shared/types';
import { date } from '../../lib/format';

export const approverNames = (xs?: ApproverRef[]) => (xs ?? []).map((a) => `${a.name} (${a.role})`).join(' or ');

/** "Sent 20 min ago" / "Sent 20 h ago" / "1 day waiting" / "4 days waiting" (from the real time, not the calendar day). */
export function ageText(g: Pick<AccessRequestRow, 'age_days' | 'created_at'>, now = Date.now()): string {
  const ms = g.created_at ? now - Date.parse(g.created_at) : NaN;
  if (Number.isFinite(ms)) {
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `Sent ${Math.max(1, Math.floor(ms / 60000))} min ago`;
    if (h < 24) return `Sent ${h} h ago`;
  }
  const d = g.age_days ?? 0;
  return d <= 1 ? '1 day waiting' : `${d} days waiting`;
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
  if (g.blocked_reason) return g.status_line ?? g.state;
  if (g.state === 'Pending L1') return `waiting for level 1${g.escalated ? ' (escalated)' : ''}`;
  if (g.state === 'Pending L2') return `approved at level 1${g.l1_name ? ` by ${g.l1_name}` : ''}, now with Risk & Quality${g.escalated ? ' (escalated)' : ''}`;
  return g.status_line ?? g.state;
}
