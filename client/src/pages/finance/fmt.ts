/**
 * Money for the finance workspace: compact figures use at most 3 significant digits ($1.74M, $134K, $4.1M) so neighbouring
 * numbers read alike; exact figures (compact = false) are unchanged.
 */
import { money as base } from '../../lib/format';

export function money(v: number | null | undefined, currency = 'USD', compact = true): string {
  if (!compact || v === null || v === undefined || Number.isNaN(Number(v))) return base(v, currency, compact);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', notation: 'compact', maximumSignificantDigits: 3 }).format(Number(v));
  } catch { return base(v, currency, compact); }
}
