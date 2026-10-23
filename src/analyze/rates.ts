import { addDays } from '../lib/dates.ts';
import type { RateRow } from '../schema.ts';

/** 첫 실행에 올릴 행의 시행일 범위(일) */
const FIRST_RUN_DAYS = 183;

export function rateKey(r: RateRow): string {
  return `${r.company}|${r.kind}|${r.effective}|${r.total}`;
}

/** 전날 표에 없던 행. 첫 실행(prev가 빔)이면 시행일이 today−183일 이후인 행만 */
export function newRates(prev: RateRow[], curr: RateRow[], today: string): RateRow[] {
  const seen = new Set(prev.map(rateKey));
  const since = addDays(today, -FIRST_RUN_DAYS);
  const out: RateRow[] = [];
  for (const r of curr) {
    const key = rateKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    if (prev.length === 0 && r.effective < since) continue;
    out.push(r);
  }
  return out;
}
