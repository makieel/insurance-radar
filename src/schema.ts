// 데이터와 화면 사이의 유일한 약속. 수집 → 가공 → 빌드의 모든 JSON이 이 형식을 따른다.
import { z } from 'zod';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 보험 종류. 화면 표기: auto 자동차, medical 실손, life 생명·건강·상해, general 제도·공통 */
export const CATEGORIES = ['auto', 'medical', 'life', 'general'] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;
export const CATEGORY_LABEL: Record<Category, string> = { auto: '자동차', medical: '실손', life: '생명·건강·상해', general: '제도·공통' };

/** 분류 결과. industry = 업계 동향, exclude = 기업보험·보험 무관 소식(버림) */
export const Topic = z.union([Category, z.literal('industry'), z.literal('exclude')]);
export type Topic = z.infer<typeof Topic>;

export const SOURCE_IDS = [
  'fsc-press', 'fsc-rule', 'fss-press', 'fss-alert',
  'knia-press', 'knia-rates', 'klia-press', 'kiri',
  'hanwha', 'kyobo', 'samsungfire', 'meritz',
  'insnews', 'insweek', 'insjournal', 'fins',
  'yna', 'chosun', 'donga', 'joongang',
  'naver',
] as const;
export const SourceId = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceId>;

/** 출처 종류. 묶음 대표를 고르는 순서도 이 순서다(gov가 가장 앞). */
export const SOURCE_KINDS = ['gov', 'assoc', 'insurer', 'press'] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const Attachment = z.object({
  name: z.string(),
  url: z.string(),
  type: z.enum(['pdf', 'hwp', 'other']),
});
export type Attachment = z.infer<typeof Attachment>;

/** 수집한 글 하나. 본문은 저장소에 남기지 않는다(BodyStore 참고). */
export const RawItem = z.object({
  /** `${source}:${출처 고유 번호}` 형식. 날짜가 바뀌어도 같은 글이면 같은 값 */
  id: z.string(),
  source: SourceId,
  title: z.string(),
  url: z.string(),
  /** 출처가 밝힌 게시일(KST) */
  published: IsoDate,
  /** 출처가 준 분류·담당부서 등 분류에 도움 되는 짧은 문자열 */
  hints: z.array(z.string()).default([]),
  attachments: z.array(Attachment).default([]),
});
export type RawItem = z.infer<typeof RawItem>;

/** 손해보험협회 공시실 자동차보험료 조정내역의 한 행 */
export const RateRow = z.object({
  company: z.string(),
  /** 개인용 / 업무용 / 영업용 등 */
  kind: z.string(),
  /** 전체 조정률(%). 인상 양수, 인하 음수 */
  total: z.number(),
  /** 시행시기 YYYYMMDD를 YYYY-MM-DD로 바꾼 값 */
  effective: IsoDate,
  reason: z.string(),
});
export type RateRow = z.infer<typeof RateRow>;

export const SourceStatus = z.object({
  source: SourceId,
  ok: z.boolean(),
  count: z.number().int(),
  error: z.string().nullable(),
  /** 대체 경로를 쓴 경우 등 화면에 보여 줄 짧은 안내. 예: "RSS 점검 중(503) → 목록 페이지로 수집" */
  note: z.string().nullable(),
  /** 설정에서 꺼져 있거나 필요한 키가 없어 건너뜀 */
  disabled: z.boolean().default(false),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

/** data/raw/YYYY-MM-DD.json */
export const RawSnapshot = z.object({
  date: IsoDate,
  generatedAt: z.string(),
  items: z.array(RawItem),
  rates: z.array(RateRow),
  status: z.array(SourceStatus),
});
export type RawSnapshot = z.infer<typeof RawSnapshot>;

export const SourceRef = z.object({ name: z.string(), url: z.string() });
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * "바뀌는 것" 항목 하나. 누적 목록 data/changes.json에 쌓인다.
 * - exact: 근거 문구에 연·월·일이 모두 있거나 공시표 값. date가 있다.
 * - period: 원문이 기간을 명시함('27.1분기 중 등). period가 있다. 정확한 날짜가 아니다.
 * - phrase: 그 밖의 원문 표현(다음 달부터 등). 날짜를 계산하지 않는다.
 */
export const Change = z.object({
  id: z.string(),
  category: Category,
  title: z.string(),
  when: z.enum(['exact', 'period', 'phrase']),
  date: IsoDate.nullable(),
  period: z.object({ start: IsoDate, end: IsoDate }).nullable(),
  /** 화면에 그대로 보여 줄 원문 표현. exact면 원문의 날짜 표기 */
  phrase: z.string(),
  /** 원문 근거 문장. 출처 본문에 글자 그대로 있어야 한다 */
  quote: z.string(),
  /** proposed = 입법·규정변경예고(확정 아님) */
  status: z.enum(['confirmed', 'proposed']),
  /** phrase 항목 중 원문과 기사 날짜로 이미 지났다고 판단할 수 있는 것 */
  past: z.boolean(),
  /** 발표일(또는 기사 날짜) */
  announced: IsoDate,
  sources: z.array(SourceRef).min(1),
  origin: z.enum(['rates', 'rule', 'ai']),
  rate: z.object({ company: z.string(), kind: z.string(), total: z.number() }).nullable(),
  firstSeen: IsoDate,
});
export type Change = z.infer<typeof Change>;

/** 같은 사건을 다룬 글 묶음. 대표는 SOURCE_KINDS 순서로 가장 공식적인 글 */
export const NewsGroup = z.object({
  id: z.string(),
  topic: z.union([Category, z.literal('industry')]),
  kind: SourceKind,
  title: z.string(),
  url: z.string(),
  published: IsoDate,
  firstSeen: IsoDate,
  sources: z.array(SourceRef).min(1),
  itemIds: z.array(z.string()).min(1),
  /** AI 요약(해요체 1~3문장). 없거나 검증에서 버려지면 null */
  summary: z.string().nullable(),
  /**
   * 개인(가입자·가족)에게 얼마나 중요한가. high = 내 보험료·보험금·약관·청구·가입 판단에 직접 영향,
   * medium = 알아 두면 좋은 소비자 정보, low = 업계 내부 이야기. 규칙으로 먼저 매기고 AI가 고친다. 아직 없으면 null.
   */
  relevance: z.enum(['high', 'medium', 'low']).nullable().default(null),
  /** 업계 동향 중 개인에게도 알릴 만큼 중요한 것(보험사 통합·정리, 예보료, 대형 제재 등). AI가 정한다 */
  important: z.boolean().default(false),
  /** 관련도를 정한 쪽 */
  relevanceBy: z.enum(['rule', 'ai']).nullable().default(null),
  /**
   * 지난 9개월 주요 소식 순위용 점수(1~5). "9개월 뒤에도 개인 가입자가 알아 둘 가치가 있는가".
   * 5 = 제도·보험료가 바뀌어 거의 모든 가입자에게 영향(예: 5세대 실손 출시, 자동차보험료 일제 인상), 1 = 거의 없음. AI가 매긴다. 아직 없으면 null.
   */
  importance: z.number().int().min(1).max(5).nullable().default(null),
  /** importance를 매긴 판정 기준 버전(config.ai.rubricVersion). 기준이 바뀌면 다시 매긴다. 규칙 점수면 null */
  importanceVersion: z.number().int().nullable().default(null),
});
export type NewsGroup = z.infer<typeof NewsGroup>;

/** data/daily/YYYY-MM-DD.json: 그날 처음 본 글의 묶음 */
export const DailyReport = z.object({
  date: IsoDate,
  generatedAt: z.string(),
  groups: z.array(NewsGroup),
  status: z.array(SourceStatus),
});
export type DailyReport = z.infer<typeof DailyReport>;

/** web/data/latest.json: 화면이 읽는 유일한 파일 */
export const Latest = z.object({
  date: IsoDate,
  generatedAt: z.string(),
  /** 오늘 기준 ±6개월 안의 변경 항목(phrase는 기간과 무관하게 보관 규칙대로) */
  changes: z.array(Change),
  /** 최근 3일 동안 처음 본 소식(보험사 발표 포함, 업계 동향·공식 발표 제외) */
  news: z.array(NewsGroup),
  /** 최근 30일 gov·assoc 발표 중 업계 동향이 아닌 것 */
  official: z.array(NewsGroup),
  /** 최근 14일 업계 동향 */
  industry: z.array(NewsGroup),
  /** 지난 9개월 주요 소식(importance 높은 순, 최대 limits.highlightsMax). news·official에 이미 보이는 묶음은 뺀다 */
  highlights: z.array(NewsGroup).default([]),
  /** 공시표 최근 행(시행일 내림차순, 최대 30행) */
  rates: z.array(RateRow),
  status: z.array(SourceStatus),
  counts: z.object({ newToday: z.number().int(), upcoming: z.number().int(), recent: z.number().int() }),
});
export type Latest = z.infer<typeof Latest>;
