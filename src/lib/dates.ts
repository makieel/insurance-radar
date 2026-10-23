const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** KST(UTC+9) 기준 날짜 'YYYY-MM-DD'. */
export function kstDate(now: Date): string {
  return fromUtcMs(now.getTime() + KST_OFFSET_MS);
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** b - a (일 수). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = toUtcMs(s);
  return !Number.isNaN(ms) && fromUtcMs(ms) === s;
}
