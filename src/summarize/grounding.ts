// AI 문장의 근거 규칙 검사. 보험은 금액·비율·날짜가 핵심이라 원문에 없는 숫자가 하나라도 있으면 버린다.

const NUMBER_RE = /\d[\d,]*(?:\.\d+)*/g;

function value(raw: string): string {
  return String(Number(raw.replace(/,/g, '')));
}

/**
 * 문자열의 숫자들. 쉼표를 빼고 값으로 맞춘다(85.0 → 85, 2,000 → 2000).
 * 점이 둘 이상인 날짜 표기('26.10.12)는 마디마다 나눈다(26, 10, 12).
 */
export function numbersIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(NUMBER_RE)) {
    const parts = m[0].split('.');
    if (parts.length > 2) out.push(...parts.map(value));
    else out.push(value(m[0]));
  }
  return out;
}

/** 원문 쪽은 너그럽게: 7.1일 → 7, 1도, '26 → 2026도 원문에 있는 숫자로 본다 */
function sourceNumbers(source: string): Set<string> {
  const set = new Set(numbersIn(source));
  for (const m of source.matchAll(NUMBER_RE)) for (const part of m[0].split('.')) set.add(value(part));
  for (const m of source.matchAll(/['‘’](\d{2})(?!\d)/g)) set.add(String(2000 + Number(m[1])));
  return set;
}

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?。])\s+/).filter((s) => s.trim()).length;
}

/**
 * 근거가 부족한 이유. 통과하면 null.
 * - 원문(제목 포함)에 없는 숫자가 있으면 버린다.
 * - 원문 발췌가 없으면 제목을 풀어 쓴 1문장만 허용한다.
 */
export function ungrounded(text: string, source: string, hasExcerpt: boolean): string | null {
  if (!text.trim()) return '빈 문장';
  const known = sourceNumbers(source);
  const missing = [...new Set(numbersIn(text))].filter((n) => !known.has(n));
  if (missing.length) return `원문에 없는 숫자: ${missing.join(', ')}`;
  if (!hasExcerpt && sentenceCount(text) >= 2) return '원문 발췌 없이 2문장 이상';
  return null;
}
