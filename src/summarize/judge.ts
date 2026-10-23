// AI 변경 판정. 근거 문장이 원문에 글자 그대로 있는지 코드로 확인하고, 시점은 그 문장에서 규칙으로 정한다.
import { exactDateIn, periodOf, phraseIsPast, whenPhraseIn } from '../analyze/dates-ko.ts';
import { CATEGORIES, Change } from '../schema.ts';
import type { Category, RawItem } from '../schema.ts';
import { cleanText, parseJsonObject, type ChatFn } from './models.ts';
import { ungrounded } from './grounding.ts';

export const JUDGE_PROMPT = [
  '너는 개인 보험의 "바뀌는 것"을 고르는 검토자다. 글마다 개인 보험(자동차·실손·생명·건강·상해 등)의 제도·약관·보험료 변경이고, 원문에 시행 시점이 있는지 판단한다.',
  '- 법령·감독규정·표준약관 개정, 제도 시행, 업계 전체나 특정 보험사의 보험료 조정은 변경이다.',
  '- 상품 출시, 국정감사 지적, 검토·추진 단계는 변경이 아니다. 원문에 시행 시점이 없어도 변경이 아니다.',
  '- quote는 원문에서 글자 그대로 복사한 한 문장이다. 시행 시점 표현이 들어 있어야 하고, 고치거나 줄이거나 이어 붙이지 않는다.',
  '- title은 무엇이 바뀌는지 40자 이내 한국어로 쓴다. 원문에 없는 숫자는 넣지 않는다.',
  '- category는 auto(자동차), medical(실손), life(생명·건강·상해), general(제도·공통) 중 하나다.',
  'JSON 객체 하나만 답한다: {"items":[{"id":"글 id","isChange":true,"title":"제목","quote":"원문 문장","category":"auto"}]}',
  '변경이 아니면 {"id":"글 id","isChange":false}로 답한다.',
].join('\n');

const BODY_MAX = 4000;
const TITLE_MAX = 80;
const QUOTE_MAX = 400;

export interface JudgeInput {
  item: RawItem;
  body: string;
  sourceName: string;
  topic: Category;
}

function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/** 판정 하나를 변경 항목으로. 근거나 시점이 없으면 null. */
function toChange(input: JudgeInput, raw: Record<string, unknown>, today: string): Change | null {
  const { item, body, sourceName, topic } = input;
  if (raw.isChange !== true) return null;
  const quote = cleanText(raw.quote, QUOTE_MAX);
  if (!quote || !body.includes(quote)) {
    console.warn(`판정 버림 ${item.id}: 근거 문장이 원문에 없음`);
    return null;
  }
  const announced = item.published;
  let when: Change['when'];
  let date: string | null = null;
  let period: Change['period'] = null;
  let phrase: string;
  let past = false;
  const exact = exactDateIn(quote);
  if (exact) {
    when = 'exact';
    date = exact.iso;
    phrase = exact.raw;
  } else {
    const found = whenPhraseIn(quote);
    if (!found) {
      console.warn(`판정 버림 ${item.id}: 근거 문장에 시행 시점이 없음`);
      return null;
    }
    phrase = found;
    period = periodOf(found, announced);
    if (period) {
      when = 'period';
    } else {
      when = 'phrase';
      past = phraseIsPast(found, announced, today);
    }
  }
  // 제목에 원문에 없는 숫자가 있으면 원래 글 제목을 쓴다
  const aiTitle = cleanText(raw.title, TITLE_MAX);
  const title = aiTitle && !ungrounded(aiTitle, `${item.title}\n${body}`, true) ? aiTitle : item.title.trim();
  const parsed = Change.safeParse({
    id: `c:${item.id}:ai`,
    category: isCategory(raw.category) ? raw.category : topic,
    title,
    when,
    date,
    period,
    phrase,
    quote,
    status: 'confirmed',
    past,
    announced,
    sources: [{ name: sourceName, url: item.url }],
    origin: 'ai',
    rate: null,
    firstSeen: today,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * 글 여러 개를 한 번에 판정한다. 호출이 실패하면 예외를 그대로 던진다(호출한 쪽이 다음 날로 미룬다).
 * 응답을 읽을 수 없으면 빈 배열.
 */
export async function judgeChanges(items: JudgeInput[], chat: ChatFn, today: string): Promise<Change[]> {
  if (!items.length) return [];
  const byId = new Map(items.map((input) => [input.item.id, input]));
  const payload = items.map(({ item, body }) => ({
    id: item.id,
    title: item.title,
    published: item.published,
    text: body.slice(0, BODY_MAX),
  }));
  const answer = await chat([
    { role: 'system', content: JUDGE_PROMPT },
    { role: 'user', content: JSON.stringify(payload) },
  ]);
  const list = parseJsonObject(answer)?.items;
  if (!Array.isArray(list)) {
    console.warn('판정: 응답을 읽을 수 없음');
    return [];
  }
  const out = new Map<string, Change>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = (raw as Record<string, unknown>).id;
    if (typeof id !== 'string' || out.has(id)) continue;
    const input = byId.get(id);
    if (!input) continue;
    const change = toChange(input, raw as Record<string, unknown>, today);
    if (change) out.set(id, change);
  }
  return [...out.values()];
}
