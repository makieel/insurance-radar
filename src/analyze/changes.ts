import { addDays } from '../lib/dates.ts';
import type { Category, Change, RateRow, RawItem, SourceRef } from '../schema.ts';
import { changeSentences, exactDateIn } from './dates-ko.ts';
import { similar } from './group.ts';

/** 손해보험협회 공시실 자동차보험료 조정내역 */
export const RATES_URL = 'https://kpub.knia.or.kr/carInsuranceDisc/adjustment/carAdjustmentCompare.do';
const RATES_SOURCE_NAME = '손보협회 공시실';
/** 보관 기간(일) */
const KEEP_DAYS = 183;

const RULE_WORD_RE = /시행|적용|부터|운영/;

/** AI 없이 만드는 변경: 연·월·일이 모두 있고 시행·적용·부터·운영이 같은 문장에 있는 것만 */
export function ruleChanges(input: { item: RawItem; body: string; topic: Category; sourceName: string; today: string }): Change[] {
  const { item, body, topic, sourceName, today } = input;
  const out: Change[] = [];
  const dates = new Set<string>();
  for (const sentence of changeSentences(body)) {
    if (!RULE_WORD_RE.test(sentence)) continue;
    const found = exactDateIn(sentence);
    if (!found || dates.has(found.iso)) continue;
    dates.add(found.iso);
    out.push({
      id: `c:${item.id}:${found.iso}`,
      category: topic,
      title: item.title.trim(),
      when: 'exact',
      date: found.iso,
      period: null,
      phrase: found.raw,
      quote: sentence,
      status: 'confirmed',
      past: false,
      announced: item.published,
      sources: [{ name: sourceName, url: item.url }],
      origin: 'rule',
      rate: null,
      firstSeen: today,
    });
  }
  return out;
}

const NOTICE_RE = /예고기간\s*:?\s*(\d{4})[-.]\s?(\d{1,2})[-.]\s?(\d{1,2})\.?\s*~\s*(\d{4})[-.]\s?(\d{1,2})[-.]\s?(\d{1,2})/;

/** 입법·규정변경예고 글: 예고기간을 근거로 한 "예고 · 확정 아님" 항목 */
export function noticeChange(input: { item: RawItem; topic: Category; sourceName: string; today: string }): Change | null {
  const { item, topic, sourceName, today } = input;
  for (const hint of item.hints) {
    const m = NOTICE_RE.exec(hint);
    if (!m) continue;
    const endMonth = Number(m[5]);
    const endDay = Number(m[6]);
    const end = `${m[4]}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    return {
      id: `c:${item.id}:notice`,
      category: topic,
      title: item.title.trim(),
      when: 'phrase',
      date: null,
      period: null,
      phrase: `예고기간 ~${endMonth}.${endDay}`,
      quote: hint.trim(),
      status: 'proposed',
      // 예고기간 끝 날짜는 원문에 연·월·일로 적혀 있으므로 지났는지 판단할 수 있다
      past: end < today,
      announced: item.published,
      sources: [{ name: sourceName, url: item.url }],
      origin: 'rule',
      rate: null,
      firstSeen: today,
    };
  }
  return null;
}

function formatTotal(total: number): string {
  return total > 0 ? `+${total}` : String(total);
}

/** 공시표의 새 행 하나 → 정확한 날짜의 변경 */
export function rateChange(row: RateRow, today: string): Change {
  const ymd = row.effective.replaceAll('-', '');
  return {
    id: `r:${row.company}:${row.kind}:${row.effective}`,
    category: 'auto',
    title: `${row.company} ${row.kind} 자동차보험료 ${formatTotal(row.total)}%`,
    when: 'exact',
    date: row.effective,
    period: null,
    phrase: `시행시기 ${ymd}`,
    quote: `${row.company} ${row.kind} ${row.total}% ${ymd} ${row.reason}`,
    status: 'confirmed',
    past: false,
    announced: today,
    sources: [{ name: RATES_SOURCE_NAME, url: RATES_URL }],
    origin: 'rates',
    rate: { company: row.company, kind: row.kind, total: row.total },
    firstSeen: today,
  };
}

function mergeSources(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const out = [...a];
  for (const s of b) if (!out.some((o) => o.url === s.url)) out.push(s);
  return out;
}

/** 같은 일을 다룬 다른 출처의 변경인지. 공시표 행은 회사·종목만 다른 제목이 비슷하므로 id로만 합친다. */
function sameEvent(a: Change, b: Change): boolean {
  if (a.origin === 'rates' || b.origin === 'rates') return false;
  if (a.category !== b.category) return false;
  const sameWhen = (a.date !== null && a.date === b.date) || a.phrase === b.phrase;
  return sameWhen && similar(a.title, b.title);
}

function expired(c: Change, today: string): boolean {
  const base = c.when === 'exact' ? c.date : c.when === 'period' ? c.period?.end : c.announced;
  return !!base && addDays(base, KEEP_DAYS) < today;
}

function sortKey(c: Change): string {
  return c.date ?? c.period?.start ?? c.announced;
}

/** 누적 목록에 새 변경을 합친다. 보관 기간이 지난 항목은 빼고 날짜 내림차순으로 돌려준다. */
export function mergeChanges(existing: Change[], incoming: Change[], today: string): Change[] {
  const out: Change[] = existing.map((c) => ({ ...c }));
  for (const inc of incoming) {
    const i = out.findIndex((c) => c.id === inc.id);
    if (i >= 0) {
      const prev = out[i];
      out[i] = { ...inc, sources: mergeSources(prev.sources, inc.sources), firstSeen: prev.firstSeen };
      continue;
    }
    const j = out.findIndex((c) => sameEvent(c, inc));
    if (j >= 0) {
      out[j] = { ...out[j], sources: mergeSources(out[j].sources, inc.sources) };
      continue;
    }
    out.push({ ...inc });
  }
  return out
    .filter((c) => !expired(c, today))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.id.localeCompare(b.id));
}
