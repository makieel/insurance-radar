// AI 중요도: 지난 9개월 주요 소식 순위에 쓸 1~5 점수를 묶음마다 매긴다.
import type { NewsGroup } from '../schema.ts';
import { parseJsonObject, type ChatFn } from './models.ts';

export const IMPORTANCE_PROMPT = [
  '너는 개인 보험 소식의 중요도를 매기는 편집자다. 독자는 본인과 가족의 보험을 점검하는 일반인이다.',
  '묶음마다 importance를 1~5 정수로 정한다. 기준은 "9개월 뒤에도 개인 가입자·가족이 알아 둘 가치가 있는가."다.',
  '- 5: 제도·보험료가 바뀌어 거의 모든 가입자에게 영향. 예: 5세대 실손의료보험 출시, 자동차보험료 일제 인상·인하, 실손24 청구 전산화 확대.',
  '- 4: 많은 가입자에게 영향이 있는 변경·주의. 예: 특정 보험 표준약관 개정, 판매수수료 개편 시행, 대형 소비자경보.',
  '- 3: 일부 가입자에게 실질적인 정보. 예: 보험금 분쟁 판결로 보상 기준이 바뀜, 특정 보험사의 보험료 조정.',
  '- 2: 알아 두면 좋은 정도. 1: 거의 없음.',
  '- 범위: 민영 보험(자동차보험, 실손의료보험, 생명·건강·상해보험 등)에 가입한 개인과 가족이다. 국민건강보험(건보)·국민연금·고용·산재 같은 공적 사회보험과 복지 정책, 보험과 무관한 기사는 이 범위가 아니므로 1점이다. 다만 실손보험 등 민영 보험에 직접 영향이 있다고 원문이 밝힌 경우는 범위 안이다.',
  '- 제목·발췌에서 확인되는 내용만으로 판단한다. 판단이 어려우면 낮은 점수를 준다.',
].join('\n');

export const IMPORTANCE_FORMAT = [
  '아래 JSON 배열의 묶음마다 판정해 JSON 객체 하나만 답한다. 설명이나 코드 울타리를 붙이지 않는다.',
  '형식: {"items":[{"id":"묶음 id","importance":3}]}',
].join('\n');

/** 한 호출에 넣는 묶음 수 */
export const IMPORTANCE_BATCH = 30;
const EXCERPT_MAX = 500;

function isScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}

/**
 * 묶음 id → AI 중요도(1~5). 1~5 정수가 아닌 항목은 빠진다.
 * 호출이 하나라도 실패하면 빈 Map.
 */
export async function rateImportance(
  groups: { group: NewsGroup; source: string }[],
  chat: ChatFn,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (let i = 0; i < groups.length; i += IMPORTANCE_BATCH) {
    const batch = groups.slice(i, i + IMPORTANCE_BATCH);
    const ids = new Set(batch.map(({ group }) => group.id));
    const input = batch.map(({ group, source }) => ({
      id: group.id,
      title: group.title,
      published: group.published,
      sources: group.sources.map((s) => s.name),
      excerpt: source.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX),
    }));
    let answer: string;
    try {
      answer = await chat([
        { role: 'system', content: IMPORTANCE_PROMPT },
        { role: 'user', content: `${IMPORTANCE_FORMAT}\n\n${JSON.stringify(input)}` },
      ]);
    } catch (e) {
      console.warn(`중요도 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
      return new Map();
    }
    const items = parseJsonObject(answer)?.items;
    if (!Array.isArray(items)) {
      console.warn('중요도: 응답을 읽을 수 없음');
      continue;
    }
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const { id, importance } = raw as Record<string, unknown>;
      if (typeof id !== 'string' || !ids.has(id) || result.has(id)) continue;
      if (!isScore(importance)) {
        console.warn(`중요도 버림 ${id}: 값이 이상함`);
        continue;
      }
      result.set(id, importance);
    }
  }
  return result;
}
