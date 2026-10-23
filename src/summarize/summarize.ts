// 소식 묶음 요약: 한 번 호출로 여러 묶음을 요약하고, 규칙 검사와 두 번째 호출(검증)을 통과한 것만 남긴다.
import type { NewsGroup } from '../schema.ts';
import { cleanText, parseJsonObject, type ChatFn } from './models.ts';
import { ungrounded } from './grounding.ts';

export const SYSTEM_PROMPT = [
  '너는 개인 보험 소식을 요약하는 편집자다. 독자는 본인과 가족의 보험을 점검하는 일반인이다.',
  '규칙:',
  '- 묶음마다 해요체 1~3문장으로 요약한다. 원문 발췌가 비어 있으면 제목을 풀어 쓴 1문장만 쓴다.',
  '- 금액·비율·날짜·조건은 원문 표기 그대로 옮긴다. 원문에 없는 숫자는 쓰지 않는다.',
  '- 원문의 시제를 바꾸지 않는다. 앞으로 할 일("오는 21일 출시한다")을 이미 한 일("출시했어요")로 쓰지 않는다.',
  '- 원문에 없는 원인·전망·조언·평가를 덧붙이지 않는다.',
  '- 보험 가입·해지·전환을 권유하지 않는다.',
  '- 독자에게 무엇이 바뀌는지, 언제부터인지가 원문에 있으면 그것을 먼저 쓴다.',
].join('\n');

export const FORMAT_HINT = [
  '아래 JSON 배열의 묶음마다 요약을 만들어 JSON 객체 하나만 답한다. 설명이나 코드 울타리를 붙이지 않는다.',
  '형식: {"items":[{"id":"묶음 id","summary":"요약"}]}',
  '요약할 근거가 부족한 묶음은 빼고 답한다.',
].join('\n');

export const VERIFY_PROMPT = [
  '너는 보험 소식 요약의 사실 검증자다. 항목마다 요약을 원문(제목과 발췌)과 비교한다.',
  '요약에 원문에 없는 원인, 수치(금액·비율·날짜·건수), 발언, 전망, 조언이나 가입·해지 권유가 하나라도 있거나, 원문과 다른 내용이 있으면 그 항목의 id를 고른다.',
  'JSON 객체 하나만 답한다: {"unsupported":["id"]}. 문제가 없으면 {"unsupported":[]}.',
].join('\n');

const SUMMARY_MAX = 300;

function originalOf(group: NewsGroup, source: string): string {
  return `${group.title}\n${source}`;
}

/**
 * 묶음 요약. 결과는 묶음 id → 요약.
 * 첫 호출이 실패하면 예외를 그대로 던진다(호출한 쪽이 다음 날로 미룬다).
 * 검증 호출이 실패하거나 답을 읽을 수 없으면 이번 요약을 모두 버린다(빈 Map).
 */
export async function summarizeGroups(groups: { group: NewsGroup; source: string }[], chat: ChatFn): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!groups.length) return result;
  const byId = new Map(groups.map((g) => [g.group.id, g]));

  const input = groups.map(({ group, source }) => ({
    id: group.id,
    title: group.title,
    sources: group.sources.map((s) => s.name),
    excerpt: source,
  }));
  const answer = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${FORMAT_HINT}\n\n${JSON.stringify(input)}` },
  ]);
  const items = parseJsonObject(answer)?.items;
  if (!Array.isArray(items)) {
    console.warn('요약: 응답을 읽을 수 없음');
    return result;
  }

  const candidates = new Map<string, string>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, summary } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || candidates.has(id)) continue;
    const entry = byId.get(id);
    const text = cleanText(summary, SUMMARY_MAX);
    if (!entry || !text) continue;
    const reason = ungrounded(text, originalOf(entry.group, entry.source), entry.source.trim().length > 0);
    if (reason) {
      console.warn(`요약 버림 ${id}: ${reason}`);
      continue;
    }
    candidates.set(id, text);
  }
  if (!candidates.size) return result;

  const toVerify = [...candidates].map(([id, summary]) => {
    const entry = byId.get(id)!;
    return { id, original: originalOf(entry.group, entry.source), summary };
  });
  let unsupported: unknown;
  try {
    const verdict = await chat([
      { role: 'system', content: VERIFY_PROMPT },
      { role: 'user', content: JSON.stringify(toVerify) },
    ]);
    unsupported = parseJsonObject(verdict)?.unsupported;
  } catch (e) {
    console.warn(`요약 검증 실패, 이번 요약을 모두 버림: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  if (!Array.isArray(unsupported)) {
    console.warn('요약 검증 응답을 읽을 수 없음, 이번 요약을 모두 버림');
    return result;
  }
  const rejected = new Set(unsupported.filter((v): v is string => typeof v === 'string'));
  for (const [id, text] of candidates) {
    if (rejected.has(id)) console.warn(`요약 버림 ${id}: 검증에서 근거 없음`);
    else result.set(id, text);
  }
  return result;
}
