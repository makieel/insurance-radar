// AI 관련도 판정: 묶음이 개인(가입자·가족)에게 얼마나 중요한지 high·medium·low와 important로 고친다.
import type { NewsGroup } from '../schema.ts';
import { parseJsonObject, type ChatFn } from './models.ts';

export const RELEVANCE_PROMPT = [
  '너는 개인 보험 소식의 관련도를 매기는 편집자다. 독자는 본인과 가족의 보험을 점검하는 일반인이다.',
  '묶음마다 relevance를 high, medium, low 중 하나로 정하고, important를 true나 false로 정한다.',
  '- high: 내 보험료·보험금·약관·특약·청구·해지·가입 판단에 직접 영향. 예: 보험료 인상·인하, 제도·약관 변경 시행, 보험금 청구 방법 변경, 소비자 경보·피해 주의, 분쟁 판결로 보상 기준이 바뀌는 것.',
  '- medium: 알아 두면 좋은 소비자 정보. 예: 손해율 추이(보험료 변동 신호), 국감에서 나온 소비자 문제 지적, 상품 비교·가입 시 주의점, 새 보장 상품 출시.',
  '- low: 업계 내부 이야기. 예: 보험사 실적·주가, 설계사·GA 영업, 인사, 사회공헌, 행사, 업계 전망, 회계·자본 규제.',
  '- important(업계 소식 중 개인에게도 알릴 것): 보험사 통합·매각·정리(계약자 보호와 관련), 예금보험료·보험료에 번질 비용 변화, 대형 제재·검사, 업계 전체 보험료 방향. 해당하지 않으면 false.',
].join('\n');

export const RELEVANCE_FORMAT = [
  '아래 JSON 배열의 묶음마다 판정해 JSON 객체 하나만 답한다. 설명이나 코드 울타리를 붙이지 않는다.',
  '형식: {"items":[{"id":"묶음 id","relevance":"high","important":false}]}',
].join('\n');

/** 한 호출에 넣는 묶음 수 */
export const RELEVANCE_BATCH = 25;
const EXCERPT_MAX = 500;
const LEVELS = ['high', 'medium', 'low'] as const;
type Level = (typeof LEVELS)[number];

export interface RelevanceResult {
  relevance: Level;
  important: boolean;
}

function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

/**
 * 묶음 id → AI 관련도. 값이 이상한 항목은 빠진다(호출한 쪽은 규칙 값을 유지한다).
 * 호출이 하나라도 실패하면 빈 Map.
 */
export async function rateRelevance(
  groups: { group: NewsGroup; source: string }[],
  chat: ChatFn,
): Promise<Map<string, RelevanceResult>> {
  const result = new Map<string, RelevanceResult>();
  for (let i = 0; i < groups.length; i += RELEVANCE_BATCH) {
    const batch = groups.slice(i, i + RELEVANCE_BATCH);
    const ids = new Set(batch.map(({ group }) => group.id));
    const input = batch.map(({ group, source }) => ({
      id: group.id,
      title: group.title,
      sources: group.sources.map((s) => s.name),
      excerpt: source.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX),
    }));
    let answer: string;
    try {
      answer = await chat([
        { role: 'system', content: RELEVANCE_PROMPT },
        { role: 'user', content: `${RELEVANCE_FORMAT}\n\n${JSON.stringify(input)}` },
      ]);
    } catch (e) {
      console.warn(`관련도 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
      return new Map();
    }
    const items = parseJsonObject(answer)?.items;
    if (!Array.isArray(items)) {
      console.warn('관련도: 응답을 읽을 수 없음');
      continue;
    }
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const { id, relevance, important } = raw as Record<string, unknown>;
      if (typeof id !== 'string' || !ids.has(id) || result.has(id)) continue;
      if (!isLevel(relevance) || typeof important !== 'boolean') {
        console.warn(`관련도 버림 ${id}: 값이 이상함`);
        continue;
      }
      result.set(id, { relevance, important });
    }
  }
  return result;
}
