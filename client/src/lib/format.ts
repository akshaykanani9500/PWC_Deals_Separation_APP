/** Display formatting helpers (money, dates, percentages). */
export function money(v: number | null | undefined, currency = 'USD', compact = true): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const n = Number(v);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || 'USD',
      notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  return `${Math.round(Number(v))}%`;
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return Number(v).toLocaleString('en-US');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> '12 Nov 2026' (no timezone shift). */
export function date(v: string | null | undefined, withYear = true): string {
  if (!v) return '–';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const s = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return withYear ? `${s} ${m[1]}` : s;
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '–';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function relative(v: string | null | undefined): string {
  if (!v) return '–';
  const d = new Date(v).getTime();
  if (Number.isNaN(d)) return v;
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} d ago`;
  return dateTime(v);
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(due: string | null | undefined, status?: string): boolean {
  if (!due || status === 'Done') return false;
  return due.slice(0, 10) < today();
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}
