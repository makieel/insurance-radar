# 개인 관련도 개선과 일반 언론 4곳 추가 계획

> **For agentic workers:** 오케스트레이터가 과제(R1~R3)를 claw-pool 작업자에게 나눠 맡긴다. 작업자는 자기 과제와 아래 공통 부분, 그리고 원래 계획 `docs/superpowers/plans/2026-10-23-insurance-radar.md`의 "Global Constraints"를 따른다.

**Goal:** 화면에서 개인(가입자·가족)에게 중요한 소식이 80% 이상, 업계 소식은 10% 이내이고 중요한 것만 나오게 한다. 연합뉴스·조선일보·동아일보·중앙일보의 보험 기사를 출처에 더한다.

**왜:** 2026-10-23 배포 화면 102개 항목 중 개인에게 쓸모 있는 것은 약 15%였다. 최근 3일 수집 130건 중 128건이 업계지(보험 전문지 4곳)였고, 분류가 단어 맞추기라 "개인에게 중요한가"를 판단하지 못했고, 업계 동향 칸(57개)에 개수 제한이 없었다. 사용자 말: "단합대회 같은 걸 개인이 왜 알아야 함? 업계 소식은 전체의 10%로, 중요한 내용만. 개인에게 중요한 소식이 80% 이상."

## 이미 바꾼 것 (오케스트레이터, 이 계획의 기준 커밋)
- `src/schema.ts`: `SOURCE_IDS`에 `yna`, `chosun`, `donga`, `joongang`. `NewsGroup`에 `relevance: 'high'|'medium'|'low'|null`(기본 null), `important: boolean`(기본 false), `relevanceBy: 'rule'|'ai'|null`(기본 null).
- `src/store.ts`: `PendingAi.type`에 `'relevance'`.
- `config.json`: 출처 4곳(kind `press`).
- `test/fixtures/`: `yna-economy.xml`, `yna-finance.html`, `yna-article.html`, `chosun-economy.xml`, `donga-economy.xml`, `joongang-finance.html`, `joongang-article.html`(2026-10-23 수집).

## 관련도 정의 (R1·R2 공통)
- **high**: 내 보험료·보험금·약관·특약·청구·해지·가입 판단에 직접 영향. 예: 보험료 인상·인하, 제도·약관 변경 시행, 보험금 청구 방법 변경, 소비자 경보·피해 주의, 분쟁 판결로 보상 기준이 바뀌는 것.
- **medium**: 알아 두면 좋은 소비자 정보. 예: 손해율 추이(보험료 변동 신호), 국감에서 나온 소비자 문제 지적, 상품 비교·가입 시 주의점, 새 보장 상품 출시.
- **low**: 업계 내부 이야기. 예: 보험사 실적·주가, 설계사·GA 영업, 인사, 사회공헌, 행사, 업계 전망, 회계·자본 규제.
- **important**(업계 소식 중 개인에게도 알릴 것): 보험사 통합·매각·정리(계약자 보호와 관련), 예금보험료·보험료에 번질 비용 변화, 대형 제재·검사, 업계 전체 보험료 방향.

---

### Task R1: 규칙 관련도, 잡음 제외, 화면 비율 (클로드3)

**Files:** `src/analyze/relevance.ts` `test/relevance.test.ts` `src/cli/analyze.ts` `src/cli/build.ts` `test/analyze.test.ts` `test/build.test.ts` `src/config.ts` `config.json`

**Interfaces**
- `config.json` `keywords`에 `noise: string[]`(아예 버릴 글), `personal: string[]`(개인 관련 신호)를 더하고 `src/config.ts` 스키마에도 넣는다. noise 예: "M/S", "마감시황", "급등", "급락", "주가", "목표주가", "인사", "선임", "취임", "봉사", "기부", "후원", "사회공헌", "캠페인 동참", "스폰서", "단합대회", "총회", "시상", "창립", "설계사", "GA", "칼럼", "발행인", "IPO", "상장", "체크리스트", "골프", "MOU", "업무협약". personal 예: "보험료", "보험금", "약관", "특약", "청구", "가입자", "계약자", "소비자", "피해", "주의", "경보", "유의", "환급", "할인", "해지", "보장", "의무보험", "분쟁", "판결", "시행", "개정", "인상", "인하".
- `src/analyze/relevance.ts`
  - `export function isNoise(title: string, kw: Config['keywords']): boolean` — 제목에 noise 단어가 있고 personal 단어가 없으면 true.
  - `export function ruleRelevance(input: { title: string; hints: string[]; body: string | null; kind: SourceKind; topic: Category | 'industry' }, kw: Config['keywords']): 'high' | 'medium' | 'low'` — topic industry → low. kind gov → high(소비자경보 포함). 제목에 personal 단어 2개 이상 → high, 1개 → medium, 0개 → low(본문 앞 300자에 2개 이상이면 medium).
- `src/cli/analyze.ts`: 분류 직후 `isNoise`면 버린다(`exclude`와 같게). 묶음마다 `relevance = ruleRelevance(대표)`, `relevanceBy = 'rule'`. 대기열: 게시일 최근 30일 묶음은 먼저 `relevance` 작업(전부), 그다음 `summary` 작업(관련도 low가 아닌 묶음과 gov·assoc 묶음만).
- `src/cli/build.ts`
  - news: topic≠industry, kind insurer·press, relevance high·medium. 정렬: high 먼저, 그다음 게시일 최신순.
  - official: kind gov·assoc, topic≠industry, relevance≠low.
  - industry: (topic=industry 또는 relevance=low) 중 `important`이거나 출처 3곳 이상인 것. 정렬: important 먼저, 출처 수, 게시일. **개수 상한 = max(1, floor((news 수 + official 수) / 9))**, 최대 5. 이렇게 하면 업계 소식이 전체의 10% 이내다.
  - relevance가 null인 옛 데이터는 build에서 `ruleRelevance`로 채워 판단한다(대표 글 본문은 없으므로 body null).
- **Tests**
  - relevance: `isNoise('[9월 GA 생보사 실적 M/S] 한화라이프랩, 신한라이프 39% \'선두\'')` true; `isNoise('손해사정사회, 임시총회·회원 단합대회 개최')` true; `isNoise('보험사, 할인 특약 내세워 정보만 수집')` false; `ruleRelevance` — '연금저축보험, 가입 때 안내받은 연금액 보장 안돼…중도해지 땐 세금 부담'(press, life) → high; '9월 車보험 손해율 85.0%…전년 동월보다 8.8%p 하락'(press, auto) → medium 또는 high가 아니라 low가 아니어야 함; '보험산업 성장률 내년 3.5%'(press, industry) → low; 금감원 소비자경보(gov) → high.
  - analyze: 단합대회 글은 daily에 없다; 묶음에 relevance·relevanceBy가 채워진다; relevance 대기가 summary 대기보다 앞이다.
  - build: news에 low가 없다; industry는 important가 먼저이고 상한 공식대로 잘린다(news 18 + official 0 → 2개); news 정렬이 high 먼저.

### Task R2: AI 관련도 판정과 하루 AI 사용량 (클로드2)

**Files:** `src/summarize/relevance.ts` `test/relevance-ai.test.ts` `src/cli/summarize.ts` `src/store.ts` `test/ai-usage.test.ts`

**Interfaces**
- `src/summarize/relevance.ts`: `export async function rateRelevance(groups: { group: NewsGroup; source: string }[], chat: ChatFn): Promise<Map<string, { relevance: 'high' | 'medium' | 'low'; important: boolean }>>` — 묶음 25개씩 한 호출. 위 "관련도 정의"를 프롬프트에 그대로 넣는다. 응답 JSON `{"items":[{"id","relevance","important"}]}`. 값이 이상하면 그 항목은 결과에서 뺀다(규칙 값 유지). 호출이 실패하면 빈 Map.
- `src/store.ts`: `export const AI_USAGE_PATH = 'data/ai-usage.json'`, `export function readAiUsage(today: string): { date: string; calls: number }`(날짜가 다르면 0부터), `export function writeAiUsage(u)`. 하루 여러 번(09·15·21시) 실행돼도 `config.limits.aiCallsPerDay`·`summariesPerDay`를 넘지 않게 한다.
- `src/cli/summarize.ts`: 순서 ① relevance 작업(daily 묶음의 relevance·important·relevanceBy='ai'를 고침) ② judge ③ summary. summary는 relevance가 low인 묶음이면 처리하지 않고 대기열에서 뺀다(gov·assoc 묶음은 예외로 요약). 예산을 다 쓰면 남은 작업은 다음 실행으로.
- **Tests**: 가짜 chat으로 rateRelevance가 Map을 채움·잘못된 값은 제외·예외면 빈 Map; ai-usage가 날짜가 바뀌면 0으로 초기화·같은 날은 누적; summarize CLI 함수(파일 I/O 없는 부분을 export해서)가 low 묶음 summary를 건너뛰는지.

### Task R3: 일반 언론 4곳 수집기 (GPT)

**Files:** `src/collectors/media.ts` `test/collectors-media.test.ts` `src/collectors/index.ts`

**Interfaces**
- `export const yna, chosun, donga, joongang: Collector`(id 같은 이름). `index.ts`의 COLLECTORS에 config 순서대로 넣는다.
- 공통: **제목에 `config.keywords.insurance` 단어가 하나도 없으면 버린다**(경제면 기사 대부분은 보험과 무관하다). 처음 보는 글만 본문을 `putBody`.
- `yna`: RSS `https://www.yna.co.kr/rss/economy.xml`(120건 ≈ 11시간치) + 금융 목록 `https://www.yna.co.kr/economy/finance`(채우기면 `?page=N` backfillPages까지). id `yna:{기사코드 AKR…}`, 본문은 기사 페이지. robots: `/view/AEN*` 등 외국어판 경로와 `/search/`는 금지이므로 쓰지 않는다.
- `chosun`: RSS `https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml`(100건 ≈ 11시간치, `content:encoded`에 본문). id는 URL 마지막 조각.
- `donga`: RSS `https://rss.donga.com/economy.xml`(50건 ≈ 10시간치). 본문은 description 또는 기사 페이지(`/news/View`는 robots 금지이므로 RSS 링크의 기사 주소만 쓴다).
- `joongang`: RSS 없음. 목록 `https://www.joongang.co.kr/money/finance`(한 쪽 ≈ 8일치, 채우기면 `?page=N`). id `joongang:{숫자}`, 본문은 기사 페이지. `/search`는 robots 금지.
- 파싱 함수는 export해서 fixture로 테스트한다: `parseYnaRss`, `parseYnaList`, `parseChosunRss`, `parseDongaRss`, `parseJoongangList`, `articleBody(html, source)`.
- **Tests**: 각 parse가 fixture에서 항목을 뽑고(published YYYY-MM-DD, 절대 URL), 보험 단어 필터 뒤 `yna-economy.xml`에서 "손해율" 기사가 남고 무관 기사는 빠진다; `articleBody(yna-article.html,'yna')`·`articleBody(joongang-article.html,'joongang')`가 200자 이상.

## 오케스트레이터가 할 것
- 워크플로 실행을 하루 3번(00·06·12 UTC = 09·15·21 KST)으로 바꾼다. RSS가 10~11시간치라 하루 한 번이면 절반을 놓친다.
- 통합 뒤 배포 화면에서 개인 관련 비율과 업계 비율을 다시 잰다.
