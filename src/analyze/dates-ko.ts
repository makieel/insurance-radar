// 한국어 원문의 시행 시점 표현을 다룬다. 연·월·일이 모두 있을 때만 정확한 날짜로 본다.
import { isIsoDate } from '../lib/dates.ts';

/** 연도 앞 작은따옴표: ' ‘ ’ 모두 받는다 */
const Q = "['‘’]";
const SHORT_YEAR = `${Q}(\\d{2})`;
const FULL_YEAR = '(?<!\\d)((?:19|20)\\d{2})';

const EXACT_PATTERNS: RegExp[] = [
  // '26.10.12.  '26.9.10  ‘26.7.1일
  new RegExp(`${SHORT_YEAR}\\.\\s?(\\d{1,2})\\.\\s?(\\d{1,2})(?!\\d)(?:\\s?일|\\.)?`, 'g'),
  // 2027.1.1  2026-09-26
  new RegExp(`${FULL_YEAR}\\.\\s?(\\d{1,2})\\.\\s?(\\d{1,2})(?!\\d)(?:\\s?일|\\.)?`, 'g'),
  new RegExp(`${FULL_YEAR}-(\\d{2})-(\\d{2})(?!\\d)`, 'g'),
  // 2027년 1월 1일  '27년 1월 1일
  new RegExp(`${FULL_YEAR}년\\s*(\\d{1,2})월\\s*(\\d{1,2})일`, 'g'),
  new RegExp(`${SHORT_YEAR}년\\s*(\\d{1,2})월\\s*(\\d{1,2})일`, 'g'),
  // 20260926 (앞뒤가 숫자가 아님)
  new RegExp(`${FULL_YEAR}(\\d{2})(\\d{2})(?!\\d)`, 'g'),
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fullYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

function toIso(y: string, m: string, d: string): string | null {
  const iso = `${fullYear(y)}-${pad2(Number(m))}-${pad2(Number(d))}`;
  return isIsoDate(iso) ? iso : null;
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 문장에서 처음 나오는 완전한(연·월·일) 날짜. 존재하지 않는 날짜는 건너뛴다. */
export function exactDateIn(text: string): { iso: string; raw: string } | null {
  const found: { index: number; iso: string; raw: string }[] = [];
  for (const re of EXACT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const iso = toIso(m[1], m[2], m[3]);
      if (iso) found.push({ index: m.index ?? 0, iso, raw: m[0] });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
  return { iso: found[0].iso, raw: found[0].raw };
}

const YEAR = `(?:${SHORT_YEAR}|${FULL_YEAR})`;
const QUARTER_RE = new RegExp(`${YEAR}\\s*[.년]?\\s*([1-4])\\s*분기`);
const HALF_RE = new RegExp(`${YEAR}\\s*[.년]?\\s*([상하])반기`);
const MONTH_RE = new RegExp(`${YEAR}\\s*[.년]\\s*(\\d{1,2})\\s*월(?!\\s*\\d{1,2}\\s*일)`);
const YEAR_WITHIN_RE = new RegExp(`${YEAR}\\s*년\\s*중`);

/**
 * 원문이 명시한 기간. 연도 없는 표현(하반기, 7월 등)은 null.
 * 'YY.N월·YYYY년 N월 → 그 달, 'YY.N분기 → 그 분기, 'YY 상반기/하반기 → 그 반기,
 * 연말까지 → 발표일~그해 12-31, YYYY년 중·'YY년 중 → 그해.
 */
export function periodOf(phrase: string, announced: string): { start: string; end: string } | null {
  let m = QUARTER_RE.exec(phrase);
  if (m) {
    const y = fullYear(m[1] ?? m[2]);
    const q = Number(m[3]);
    return { start: `${y}-${pad2(q * 3 - 2)}-01`, end: lastDayOfMonth(y, q * 3) };
  }
  m = HALF_RE.exec(phrase);
  if (m) {
    const y = fullYear(m[1] ?? m[2]);
    return m[3] === '상' ? { start: `${y}-01-01`, end: `${y}-06-30` } : { start: `${y}-07-01`, end: `${y}-12-31` };
  }
  m = MONTH_RE.exec(phrase);
  if (m) {
    const y = fullYear(m[1] ?? m[2]);
    const mo = Number(m[3]);
    if (mo < 1 || mo > 12) return null;
    return { start: `${y}-${pad2(mo)}-01`, end: lastDayOfMonth(y, mo) };
  }
  m = YEAR_WITHIN_RE.exec(phrase);
  if (m) {
    const y = fullYear(m[1] ?? m[2]);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (/연말까지/.test(phrase) && isIsoDate(announced)) {
    return { start: announced, end: `${announced.slice(0, 4)}-12-31` };
  }
  return null;
}

const WHEN_CORES: string[] = [
  // 연·월·일
  `${Q}\\d{2}\\.\\s?\\d{1,2}\\.\\s?\\d{1,2}(?!\\d)(?:\\s?일|\\.)?`,
  `(?<!\\d)(?:19|20)\\d{2}\\.\\s?\\d{1,2}\\.\\s?\\d{1,2}(?!\\d)(?:\\s?일|\\.)?`,
  `(?:${Q}\\d{2}|(?<!\\d)(?:19|20)\\d{2})년\\s*\\d{1,2}월\\s*\\d{1,2}일`,
  `(?<!\\d)(?:19|20)\\d{6}(?!\\d)`,
  // 연도가 있는 분기·반기·월·연초·연말
  `(?:${Q}\\d{2}|(?<!\\d)(?:19|20)\\d{2})\\s*[.년]?\\s*(?:[1-4]\\s*분기|[상하]반기|\\d{1,2}\\s*월|초|말)`,
  `(?:${Q}\\d{2}|(?<!\\d)(?:19|20)\\d{2})년`,
  // 연도 없는 월·일
  `오는\\s*(?:\\d{1,2}월\\s*)?\\d{1,2}일`,
  `오는\\s*\\d{1,2}월`,
  `(?<![\\d.'‘’])\\d{1,2}\\.\\s?\\d{1,2}\\s?일`,
  `(?<![\\d.])\\d{1,2}월\\s*\\d{1,2}일`,
  `(?<![\\d.월\\s])\\s?\\d{1,2}일(?=\\s*부터)`,
  // 상대 표현
  `(?:올해|금년|내년)(?:\\s*(?:[1-4]\\s*분기|[상하]반기|\\d{1,2}\\s*월|초|말))?`,
  `(?<![\\d.])[1-4]\\s*분기`,
  `[상하]반기`,
  `연말|연초|연내`,
  `다음\\s?달|내달|이달|이번\\s?달`,
  `(?<![\\d.])\\d{1,2}\\s*월(?!\\s*\\d)`,
  `공포\\s*후\\s*\\d+\\s*(?:개월|년)`,
];
const WHEN_SUFFIX = '(?:\\s?\\([월화수목금토일]\\))?(?:\\s*(?:중|내)(?![가-힣]))?(?:\\s*(?:부터|까지|이후))?';
const WHEN_RES = WHEN_CORES.map((core) => new RegExp(`(?:${core})${WHEN_SUFFIX}`, 'g'));

/**
 * 문장에서 시행 시점 표현을 원문 그대로 잘라낸다.
 * 부터·까지·이후·중이 붙은 표현을 먼저, 그다음 앞에 나온 것, 같은 위치면 긴 것.
 */
export function whenPhraseIn(sentence: string): string | null {
  const found: { index: number; text: string; strong: boolean }[] = [];
  for (const re of WHEN_RES) {
    for (const m of sentence.matchAll(re)) {
      const text = m[0].trim();
      if (!text) continue;
      const index = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
      found.push({ index, text, strong: /(?:부터|까지|이후|중|내)$/.test(text) });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => Number(b.strong) - Number(a.strong) || a.index - b.index || b.text.length - a.text.length);
  return found[0].text;
}

/**
 * "오는 N일"·"N일부터"만 판단한다: 발표일과 같은 달이고 N ≥ 발표일의 일일 때 그 날이 today보다 앞이면 true.
 * 그 밖의 표현은 날짜를 계산하지 않으므로 false.
 */
export function phraseIsPast(phrase: string, announced: string, today: string): boolean {
  if (!isIsoDate(announced)) return false;
  const p = phrase.trim();
  const m = /^오는\s*(\d{1,2})일/.exec(p) ?? /^(\d{1,2})일\s*부터/.exec(p);
  if (!m) return false;
  const day = Number(m[1]);
  if (day < Number(announced.slice(8, 10))) return false;
  const date = `${announced.slice(0, 8)}${pad2(day)}`;
  return isIsoDate(date) && date < today;
}

const CHANGE_WORD_RE = /시행|적용|부터|운영|개정|인상|인하/;
const MAX_SENTENCE = 200;

/** 마침표 뒤 공백(숫자 뒤 마침표는 날짜로 보고 제외), "다." 뒤, 줄바꿈에서 문장을 나눈다. */
function splitSentences(text: string): string[] {
  return text.split(/\r?\n+|(?<=[^\d.\s][.?!])(?=\s)|(?<=다\.)(?=[^\s\d)\]"'’”])/);
}

/** 변경을 알리는 단어가 있는 문장. 원문 일부를 그대로 잘라 200자 이내로 만든다. */
export function changeSentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of splitSentences(text)) {
    const s = piece.trim();
    const m = CHANGE_WORD_RE.exec(s);
    if (!m) continue;
    if (s.length <= MAX_SENTENCE) {
      out.push(s);
      continue;
    }
    // 길면 변경 단어 주변을 원문 그대로 잘라 둔다
    const start = Math.max(0, Math.min(m.index - MAX_SENTENCE / 2, s.length - MAX_SENTENCE));
    out.push(s.slice(start, start + MAX_SENTENCE).trim());
  }
  return out;
}
