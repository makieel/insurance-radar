import type { Config } from '../config.ts';
import type { Category, SourceKind } from '../schema.ts';

export type Relevance = 'high' | 'medium' | 'low';

function countIn(text: string, words: string[]): number {
  return words.filter((w) => w && text.includes(w)).length;
}

/** 개인에게 쓸모없는 글(실적 점유율, 인사, 행사 등). 개인 관련 단어가 함께 있으면 살린다 */
export function isNoise(title: string, kw: Config['keywords']): boolean {
  return countIn(title, kw.noise) > 0 && countIn(title, kw.personal) === 0;
}

/** 규칙 관련도. AI가 나중에 고칠 수 있는 첫 값이다 */
export function ruleRelevance(
  input: { title: string; hints: string[]; body: string | null; kind: SourceKind; topic: Category | 'industry' },
  kw: Config['keywords'],
): Relevance {
  if (input.topic === 'industry') return 'low';
  if (input.kind === 'gov') return 'high';
  const inTitle = countIn(input.title, kw.personal);
  if (inTitle >= 2) return 'high';
  if (inTitle === 1) return 'medium';
  return countIn((input.body ?? '').slice(0, 300), kw.personal) >= 2 ? 'medium' : 'low';
}
