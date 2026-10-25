# 지난 9개월 주요 소식 고정 칸 계획

> **For agentic workers:** 오케스트레이터가 과제(H1~H3)를 claw-pool 작업자에게 나눠 맡긴다. 작업자는 자기 과제와 아래 공통 부분, 원래 계획 `docs/superpowers/plans/2026-10-23-insurance-radar.md`의 "Global Constraints", 그리고 `docs/superpowers/plans/2026-10-23-relevance-and-media.md`의 "관련도 정의"를 따른다.

**Goal:** 새 소식이 적은 날에도 화면이 비지 않도록, 지난 9개월 동안 개인 가입자에게 가장 중요했던 소식 30건을 고정으로 보여 준다. 새 소식이 상위 30건에 들면 들어가고, 점수가 낮거나 9개월이 지난 것은 빠진다.

**사용자 결정 (2026-10-25):** "지난 9개월 주요 소식 30건 고정, 최근 소식 15, 공식 발표 8, 업계 5." 과거 소식은 일반 뉴스에서 가져오는 것이 좋겠다고 했다. 매일 운영에 Claude가 쓰이면 안 된다(GitHub Actions + Gemini만).

**확인한 사실 (2026-10-25, 한국 IP):**
- 중앙일보: 날짜별 사이트맵 `https://www.joongang.co.kr/sitemap/articles/{YYYY}/{YYYYMMDD}`에 `news:title`이 있다(하루 약 120건). 연도 목록 `.../sitemap/articles/{YYYY}/`. robots가 `/sitemap/`을 허용한다.
- 동아일보: 사이트맵 목록 `https://image.donga.com/sitemap/donga-sitemap.xml` → 두 달 단위 `.xml.gz`(예: `donga-sitemap-202603-202604.xml.gz`, 약 2.4만 개 주소, 그중 경제 `/news/Economy/article/all/{YYYYMMDD}/{번호}/1` 약 5,400개). **제목이 없어** 기사 페이지를 열어 제목을 얻어야 한다.
- 연합뉴스·조선일보: 과거 사이트맵이 2~3일치뿐이고 검색은 robots 금지라 9개월치를 얻을 수 없다. 이 둘은 지금처럼 최근 기사만 쓴다.
- 보험 전문지 과거 목록은 쪽 넘김이 막혀 있어 쓰지 않는다.

## 이미 바꾼 것 (기준 커밋)
- `src/schema.ts`: `NewsGroup.importance: 1~5 | null`(기본 null), `Latest.highlights: NewsGroup[]`(기본 []).
- `src/store.ts`: `PendingAi.type`에 `'importance'`.
- `config.json`/`src/config.ts` `limits`: `newsMax 15`, `officialMax 8`, `industryMax 5`, `highlightsMax 30`, `highlightsDays 274`, `archiveJoongangDaysPerRun 40`, `archiveDongaArticlesPerRun 600`, `archiveOfficialPages 14`.
- fixture: `joongang-sitemap-2026.xml`, `joongang-sitemap-20260315.xml`, `donga-sitemap-index.xml`, `donga-sitemap-202603-head.xml`(원본 앞 300개), `donga-article.html`.

## 중요도 정의 (H2·H3 공통)
"9개월 뒤에도 개인 가입자·가족이 알아 둘 가치가 있는가."
- 5: 제도·보험료가 바뀌어 거의 모든 가입자에게 영향. 예: 5세대 실손의료보험 출시, 자동차보험료 일제 인상·인하, 실손24 청구 전산화 확대.
- 4: 많은 가입자에게 영향이 있는 변경·주의. 예: 특정 보험 표준약관 개정, 판매수수료 개편 시행, 대형 소비자경보.
- 3: 일부 가입자에게 실질적인 정보. 예: 보험금 분쟁 판결로 보상 기준이 바뀜, 특정 보험사의 보험료 조정.
- 2: 알아 두면 좋은 정도. 1: 거의 없음.

---

### Task H1: 과거 기사 채우기 (GPT)

**Files:** `src/collectors/archive.ts` `test/collectors-archive.test.ts` `src/cli/collect.ts` `src/store.ts`

**Interfaces**
- `src/store.ts`: `export const ARCHIVE_STATE_PATH`(data/archive-state.json), `export interface ArchiveState { joongangOldest: string | null; dongaCursor: { file: string; index: number } | null; dongaDone: boolean; officialDone: boolean }`, `readArchiveState()`, `writeArchiveState(s)`.
- `src/collectors/archive.ts`
  - `export function parseJoongangDaySitemap(xml: string): RawItem[]` — `news:title`, `loc`(`/article/{번호}`), `news:publication_date`. id `joongang:{번호}`, source `joongang`.
  - `export function parseDongaSitemapIndex(xml: string): string[]` — 두 달 단위 gz 주소 목록.
  - `export function dongaEconomyUrls(xml: string, since: string): string[]` — 경제 기사 주소만, URL 날짜가 since 이후.
  - `export function parseDongaArticle(html: string, url: string): { item: RawItem; body: string } | null` — 제목(og:title 등), 게시일(URL의 YYYYMMDD), 본문. id `donga:{번호}`.
  - `export async function runArchive(ctx: CollectCtx, state: ArchiveState, opts: { deadline: number }): Promise<{ items: RawItem[]; state: ArchiveState; notes: Record<string, string> }>`:
    - 중앙: `state.joongangOldest`(없으면 어제)부터 과거로 하루씩 `archiveJoongangDaysPerRun`일까지, `today − highlightsDays`보다 앞이면 멈춘다. 제목에 `keywords.insurance` 단어가 있는 것만, 처음 보는 글은 기사 페이지 본문을 `putBody`.
    - 동아: 사이트맵 목록에서 `today − highlightsDays` 이후 파일만, 최신 파일부터 경제 주소를 차례로 열어 제목 확인. 한 번 실행에 `archiveDongaArticlesPerRun`개까지, 동시 요청 4개 이하. 보험 제목만 남긴다. 다 보면 `dongaDone`.
    - 정부·협회: `officialDone`이 false면 fscPress·fscRule·fssPress·fssAlert·kniaPress·kliaPress를 `backfill: true`, `backfillPages = archiveOfficialPages`인 설정 복사본으로 한 번 돌리고, 게시일이 `today − highlightsDays` 이후인 것만 남긴 뒤 `officialDone = true`.
    - `deadline`(밀리초 시각)을 넘으면 그 자리에서 멈추고 커서를 저장한다(다음 실행에서 이어감). 예외는 출처별로 잡아 notes에 적는다.
- `src/cli/collect.ts`: 기존 수집 뒤 `runArchive`(제한 8분)를 돌려 raw items에 id 중복 없이 더한다. 진행 상황을 해당 출처 status의 note에 덧붙인다(예: "과거 기사 채우는 중: 중앙 2026-06-01까지"). 상태 파일 저장.
- **Tests**: 중앙 날짜 사이트맵 fixture에서 121개 파싱·보험 필터, 동아 목록·경제 주소 필터, 동아 기사 fixture 파싱, runArchive가 가짜 fetch로 하루치씩 진행하고 deadline에 멈추며 커서를 남기는지, officialDone 처리.

### Task H2: AI 중요도와 대기열 (클로드2)

**Files:** `src/summarize/importance.ts` `test/importance.test.ts` `src/cli/summarize.ts` `src/cli/analyze.ts` `test/analyze.test.ts`

**Interfaces**
- `export async function rateImportance(groups: { group: NewsGroup; source: string }[], chat: ChatFn): Promise<Map<string, number>>` — 30개씩 한 호출, 위 "중요도 정의"를 프롬프트에 그대로. 응답 `{"items":[{"id","importance"}]}`, 1~5 정수가 아니면 뺀다. 실패하면 빈 Map.
- `src/cli/analyze.ts`: 게시일이 `today − highlightsDays` 이후이고 topic≠industry이며 relevance가 high·medium인 새 묶음마다 `importance` 작업을 넣는다(대기열 순서: relevance → importance → judge → summary).
- `src/cli/summarize.ts`: relevance 다음에 importance 작업을 처리해 daily 묶음의 `importance`를 채운다. AI가 relevance를 low로 바꾼 묶음은 importance 작업을 건너뛴다. importance가 4 이상인데 요약이 없고 summary 작업도 없으면 summary 작업을 넣는다. 하루 AI 예산(`data/ai-usage.json`)을 그대로 쓴다.
- **Tests**: 가짜 chat으로 Map 채움·잘못된 값 제외·예외면 빈 Map; analyze가 9개월 안 high·medium 묶음에 importance 작업을 넣고 industry·low에는 넣지 않음; summarize가 importance를 daily에 기록하고 4 이상이면 summary 작업을 추가.

### Task H3: 화면 칸 개수와 주요 소식 칸 (클로드3)

**Files:** `src/cli/build.ts` `test/build.test.ts` `web/themes/band/render.js` `web/themes/band/theme.css` `test/fixtures/latest-sample.json`

**Interfaces**
- `src/cli/build.ts`
  - 실행부는 `highlightsDays` 기간의 daily 파일을 모두 읽는다(지금은 30일).
  - news 최대 `newsMax`, official 최대 `officialMax`.
  - `export function ruleImportance(g: NewsGroup): number` — importance가 없을 때: gov이고 relevance high → 3, 출처 3곳 이상이고 high → 3, high → 2, medium → 1.
  - highlights: 기간 안의 묶음 중 topic≠industry, relevance high(또는 importance가 4 이상인 medium), news·official에 이미 보이는 id 제외, `mergeSimilar` 적용. 점수 = importance ?? ruleImportance, 점수 내림차순 → 게시일 최신순, 최대 `highlightsMax`.
  - industry 상한 = `min(industryMax, max(1, floor((news + official + highlights) / 9)))`.
- `web/themes/band/render.js`·`theme.css`: "오늘 소식" 다음, "공식 발표" 앞에 **"지난 9개월 주요 소식"** 칸. 월별 머리(예: "2026년 9월")로 묶고, 각 항목에 중요도 표시(★ 점수만큼, 1~5), 종류 점, 출처, 게시일, 요약(있으면). 데스크톱은 2열, 모바일은 1열. 모바일 하단 탭에 "주요" 추가. 비면 "지난 주요 소식을 모으는 중입니다". 기존 칸 순서와 동작은 유지.
- `test/fixtures/latest-sample.json`: `highlights` 키를 더한다(기존 항목 중 실제 데이터로 몇 개, 지어낸 항목 금지).
- **Tests**: 칸별 상한(news 15·official 8), highlights가 점수·게시일 순이고 news·official과 겹치지 않음, 기간 밖·industry·low 제외, industry 상한 공식.

## 오케스트레이터가 할 것
- 통합 뒤 로컬에서 수집(과거 채우기 포함)·가공·빌드를 돌려 확인하고 배포한다.
- 배포 화면에서 칸별 개수와 업계 비율을 잰다.
