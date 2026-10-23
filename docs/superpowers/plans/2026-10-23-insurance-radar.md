# 보험 레이더 구현 계획

> **For agentic workers:** 이 계획은 오케스트레이터가 claw-pool 작업자 계정에 과제 단위로 나눠 맡긴다. 작업자는 자기 과제(Task N)와 아래 공통 부분만 읽으면 된다. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 보험 소식과 "바뀌는 것"(약관·보험료·제도 변경과 시행일)을 매일 자동으로 모아 보여 주는 정적 사이트를 만든다.

**Architecture:** Node 24 + TypeScript(빌드 없이 실행) CLI가 `collect → analyze → summarize → build`를 돌리고 GitHub Actions가 매일 09:00 KST에 실행해 GitHub Pages로 배포한다. `src/schema.ts`(zod)가 데이터와 화면 사이의 유일한 약속이고, 화면은 `web/data/latest.json`만 읽는다. 화면은 시안 `design/v5/mobile.html`(데스크톱은 v4-2와 같음)을 옮긴다.

**Tech Stack:** Node 24(타입 스트리핑), TypeScript 7(`tsc --noEmit`만), zod 4, node-html-parser 9, fast-xml-parser 5, unpdf 1, node:test, 브라우저 ES 모듈(프레임워크 없음).

**Spec:** `docs/superpowers/specs/2026-10-23-insurance-radar-design.md` (출처 요청 형식: `docs/recon/2026-10-23-source-recon.md`)

## 이미 있는 것 (커밋 b13d562 이후)
- `src/schema.ts`: 모든 데이터 형식. **고치지 않는다.** 필요하면 보고서 Concerns에 적는다.
- `src/config.ts`, `config.json`: 설정 형식과 값(출처 목록, 분류 키워드, 상한, AI).
- `src/collectors/types.ts`: `Collector`, `CollectCtx`, `CollectResult`.
- `src/lib/http.ts`(`fetchText`, `fetchJson`, `USER_AGENT`, `HttpError`), `src/lib/dates.ts`(`kstDate`, `addDays`, `daysBetween`, `isIsoDate`), `src/lib/text.ts`(`normalizeUrl`, `domainOf`, `stripMarkdown`), `src/lib/xml.ts`(`textOf`, `atomEntries`, `linkHref`), `src/lib/pdf.ts`(`pdfText`, `fetchPdfText`, `PdfBudget`), `src/summarize/models.ts`(`ChatFn`, `makeChatFn`, `parseJsonObject`, `cleanText`), `web/core/format.js`(`esc`, `safeUrl` 등), `web/core/mode.js`(`createModeController`, 첫 방문 밝은 모드).
- `test/fixtures/`: 출처별 실제 응답(2026-10-23 수집). 파일 이름은 출처를 따른다(`fsc-list.html`, `fss-detail-226318.html`, `kpub-car-rates.html`, `hanwha-list.json`, `insnews.xml` 등).

## Global Constraints
- 지어낸 데이터 금지. 데이터가 없으면 빈 상태 문구를 보여 준다. 화면 코드와 `web/` 아래에 예시 데이터를 넣지 않는다(테스트 fixture는 `test/fixtures/`에만).
- 정확한 날짜(`when: 'exact'`)는 근거 문구에 연·월·일이 모두 있거나 공시표 값일 때만. 연도 없는 월·일(`7.1일부터`)과 상대 표현(`다음 달부터`, `오는 25일부터`)은 `phrase`로 두고 날짜를 계산하지 않는다.
- 기간 막대(`when: 'period'`)는 원문이 기간을 명시할 때만: `'YY.N월`/`YYYY년 N월` → 그 달, `'YY.N분기` → 그 분기, `'YY 상반기/하반기` → 그 반기, `연말까지` → 발표일부터 그해 12-31, `YYYY년 중`/`'YY년 중` → 그해. 연도 없는 표현은 null.
- 모든 요청은 `src/lib/http.ts`의 `USER_AGENT`를 쓴다(UA에 "bot" 금지: 금감원이 연결을 끊는다).
- 출처 하나의 실패가 다른 출처를 멈추면 안 된다. 수집기는 예외를 던져도 되고, 러너가 잡아 상태로 기록한다.
- 기사 본문은 커밋하지 않는다. 본문은 `ctx.putBody()`로만 넘기고, 러너가 `tmp/`(gitignore)에 쓴다.
- 화면 고지 문구(그대로): "이 사이트는 공개된 보도자료와 기사를 자동으로 모아 보여 주는 정보 제공용이며, 보험 가입이나 해지를 권유하지 않습니다. 요약은 AI가 만들었으므로 정확한 내용은 반드시 원문과 약관에서 확인하세요."
- 날짜는 모두 KST `YYYY-MM-DD` 문자열. 모든 링크는 `target="_blank" rel="noopener"`.
- 코드 주석·문구는 한국어, 식별자는 영어. 테스트는 `node:test` + `node:assert/strict`, 파일은 `test/<이름>.test.ts`(화면은 `web/**/<이름>.test.js`).
- 의존성 추가 금지(필요하면 Concerns에 적는다).

## Review Focus
1. 출처 HTML 구조가 조금 바뀌어 항목이 0건이 되는 경우 → 러너가 그 출처를 실패로 기록하고 화면에 보여야 한다(Task 6 테스트).
2. 같은 글이 RSS와 목록에서 두 번, 또는 여러 날에 걸쳐 다시 들어오는 경우 → 같은 `id`로 한 번만 소식이 된다(Task 5 group, Task 6 seen 테스트).
3. "7.1일부터", "오는 25일부터" 같은 표현이 정확한 날짜로 둔갑하는 경우 → `phrase`로 남아야 한다(Task 5 dates-ko 테스트).
4. AI 요약에 원문에 없는 금액·비율이 들어오는 경우 → 버려지고 요약 없이 나가야 한다(Task 7 테스트).
5. latest.json이 비었거나 일부 칸이 빈 날 → 화면이 깨지지 않고 빈 상태 문구를 보여야 한다(Task 4 테스트).

## 파일 구조
```
src/collectors/fsc.ts fss.ts            Task 1  정부·감독기관 수집기
src/collectors/knia.ts klia.ts kiri.ts  Task 2  협회·연구원 수집기(공시표 포함)
src/collectors/insurers.ts press.ts naver.ts   Task 3  보험사·전문지 수집기, 네이버 자리
web/index.html web/core/app.js web/core/data.js web/themes/band/*   Task 4  화면
src/analyze/dates-ko.ts classify.ts group.ts changes.ts rates.ts    Task 5  가공 규칙
src/collectors/index.ts run.ts, src/store.ts, src/cli/collect.ts analyze.ts build.ts serve.ts, .github/workflows/daily.yml, README.md   Task 6  파이프라인
src/summarize/excerpt.ts grounding.ts summarize.ts judge.ts, src/cli/summarize.ts   Task 7  AI 요약·변경 판정
```
Task 1~5는 서로 의존하지 않고 동시에 진행한다. Task 6·7은 1~5가 들어온 뒤 진행한다.

---

### Task 1: 정부·감독기관 수집기

**Files:** Create `src/collectors/fsc.ts`, `src/collectors/fss.ts`, `test/collectors-gov.test.ts`

**Interfaces:**
- Consumes: `Collector`, `CollectCtx`(types.ts), `fetchText`, `fetchPdfText`, `RawItem`, `Attachment`
- Produces:
  - `export const fscPress: Collector`(id `fsc-press`), `fscRule: Collector`(`fsc-rule`), `fssPress: Collector`(`fss-press`), `fssAlert: Collector`(`fss-alert`)
  - `export function parseFscList(html: string): RawItem[]` — `.board-list-wrap li`: 제목은 `.subject a`의 title 속성, url `https://www.fsc.go.kr/no010101/{id}`, id `fsc-press:{id}`, published `.day`, hints에 "담당부서 : …"의 부서명
  - `export function parseFscDetail(html: string): { text: string; attachments: Attachment[] }` — `.board-view-wrap .body .cont` 텍스트, 첨부 `/comm/getFile?...`
  - `export function parseFscRuleList(html: string): RawItem[]` — id `fsc-rule:{noticeId}`, url `https://www.fsc.go.kr/po040301/view?noticeId={id}`, hints에 구분("규정변경예고"/"입법예고")과 "예고기간 : A ~ B" 원문, published = 예고기간 시작일
  - `export function parseFssList(html: string, source: 'fss-press' | 'fss-alert'): RawItem[]` — `td.title a`(href `view.do?nttId=…`), 다음 td 담당부서(hints), 날짜 td. id `{source}:{nttId}`, url은 절대 주소 `https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId={id}&menuNo=200218`(alert는 B0000175/menuNo=200204)
  - `export function parseFssDetail(html: string): { text: string; attachments: Attachment[] }` — 본문 요약 텍스트, 첨부 `/fss/cmmn/file/fileDown.do?...`(이름 확장자로 type)

- [ ] **Step 1: 실패하는 테스트 작성** (`test/collectors-gov.test.ts`, fixture로만, 네트워크 없음)
  - `parseFscList(fsc-list.html)`: 길이 ≥ 20, 모든 id가 `/^fsc-press:\d+$/`, published가 YYYY-MM-DD, 어떤 항목은 hints에 "보험과" 포함, 87217 항목 제목에 "판매수수료" 포함
  - `parseFscDetail(fsc-detail-87217.html).text`에 "7.1일부터 시행" 포함
  - `parseFscRuleList(fsc-rule-list.html)`: noticeId 4171 항목의 hints 중 하나가 /예고기간/ 매치
  - `parseFssList(fss-list.html,'fss-press')`: 길이 ≥ 5, nttId 226318이 있으면 제목에 "자동차보험" 포함, 모든 url이 `https://www.fss.or.kr/`로 시작
  - `parseFssDetail(fss-detail-226318.html)`: text에 "'26.9.10." 포함, attachments 중 pdf 하나 이상
  - `fscPress.run(ctx)`: 가짜 fetch가 RSS 주소에 503을 주면 목록 HTML(fixture)로 넘어가고 `note`가 "RSS 점검 중(503) → 목록 페이지로 수집", seen에 없는 글만 상세를 요청하고 `putBody` 호출
  - `fssAlert.run(ctx)`: 제목에 `config.keywords.insurance` 단어가 없는 경보는 빠진다
- [ ] **Step 2: 테스트가 실패하는지 확인** — `node --test test/collectors-gov.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — 금융위 목록 주소 `https://www.fsc.go.kr/no010101?srchKey=dept&srchText=보험과&cntPerPage=50`과 `?srchKey=sj&srchText=보험&cntPerPage=50`을 합쳐 id로 중복 제거(GET만, `encodeURIComponent`). RSS `http://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111`이 200이면 RSS를 쓴다. 채우기(`ctx.backfill`)면 `curPage` 1..backfillPages, 아니면 1쪽. 금감원은 `searchCnd=9&searchWrd=보험`, 채우기면 `pageIndex` 1..backfillPages. 처음 보는 글만 상세를 받아 `putBody(id, text + PDF 텍스트)`(금감원은 PDF 첨부 하나를 `fetchPdfText(url, ctx.pdfBudget, {fetch: ctx.fetch})`로). 
- [ ] **Step 4: 통과 확인** — `node --test test/collectors-gov.test.ts` PASS, `npx tsc --noEmit` 오류 없음
- [ ] **Step 5: 커밋** — `feat: government collectors (FSC, FSS)`

### Task 2: 협회·연구원 수집기

**Files:** Create `src/collectors/knia.ts`, `src/collectors/klia.ts`, `src/collectors/kiri.ts`, `test/collectors-assoc.test.ts`

**Interfaces:**
- Produces:
  - `export const kniaPress: Collector`(`knia-press`), `kniaRates: Collector`(`knia-rates`, `items: []`, `rates`를 채움), `kliaPress: Collector`(`klia-press`), `kiri: Collector`(`kiri`)
  - `export function parseKniaList(html: string): RawItem[]` — 링크 `/data/news/content?index={n}`, id `knia-press:{n}`, url 절대 주소 `https://www.knia.or.kr/data/news/content?index={n}`, 날짜
  - `export function parseKniaDetail(html: string): { text: string; attachments: Attachment[] }` — 첨부 `a.attach-file`(href `/file/download/{토큰}`, 이름 끝 확장자로 type)
  - `export function parseKpubRates(html: string): RateRow[]` — `<tr><th scope="row">회사</th><td>종목</td>…<td>전체</td><td>YYYYMMDD</td><td class="align-l">사유</td></tr>`, 날짜 칸이 8자리 숫자인 행만, total은 Number
  - `export function parseKliaList(html: string): RawItem[]` — `fn_goView('번호','2','1','')`에서 번호, url `https://www.klia.or.kr/board/2/view.do?boardNo={번호}&boardMngNo=2&seq=1`, id `klia-press:{번호}`, 고정글(공지 표시) 제외
  - `export function parseKliaDetail(html: string): { text: string; attachments: Attachment[] }` — 첨부 `/FileDown.do?fileNo=..&seq=..`
  - `export function parseKiriList(html: string): RawItem[]` — `materialView.do?bid={n}`, id `kiri:{n}`, url 절대 주소 `https://kiri.or.kr/community/materialView.do?bid={n}`
- [ ] **Step 1: 실패하는 테스트 작성** (`test/collectors-assoc.test.ts`)
  - `parseKniaList(knia-news.html)`: index 88765 항목 제목에 "경상환자" 포함, 모든 published가 YYYY-MM-DD
  - `parseKniaDetail(knia-news-88765.html).attachments`에 type `pdf` 하나와 `hwp` 하나
  - `parseKpubRates(kpub-car-rates.html)`: 길이 ≥ 10, `{company:'메리츠화재', kind:'업무용', total:-1, effective:'2026-09-26'}` 행이 있고, 모든 effective가 YYYY-MM-DD, 빈 템플릿 행 없음
  - `parseKliaList(klia-list.html)`: 길이 ≥ 5, 모든 id `/^klia-press:\d+$/`
  - `parseKiriList(kiri-list.html)`: 길이 ≥ 5
  - `kniaPress.run(ctx)`: 처음 보는 88765 글은 상세와 PDF(가짜 fetch가 `knia-news-88765.pdf`를 줌)를 받아 `putBody` 텍스트에 "'26.10.12." 포함
  - 응답 본문에 "보안정책 위배"가 있으면 `run`이 오류를 던진다(차단 감지)
- [ ] **Step 2: 실패 확인** — `node --test test/collectors-assoc.test.ts` → FAIL
- [ ] **Step 3: 구현** — 주소는 recon 문서대로. 차단 감지 문자열 "보안정책 위배". 생보협회·보험연구원도 처음 보는 글만 상세(+PDF 하나)를 받는다. 채우기면 knia `?page=N`, klia `pageIndex=N`.
- [ ] **Step 4: 통과 확인** — 테스트 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: association collectors and KNIA rate table`

### Task 3: 보험사·전문지 수집기, 네이버 자리

**Files:** Create `src/collectors/insurers.ts`, `src/collectors/press.ts`, `src/collectors/naver.ts`, `test/collectors-insurers.test.ts`, `test/collectors-press.test.ts`

**Interfaces:**
- Produces:
  - `export const hanwha, kyobo, samsungfire, meritz: Collector`(id 같은 이름)
  - `export function parseHanwhaList(json: unknown): RawItem[]` — `seq`, `title`, `broadcastDate`(YYYYMMDD→YYYY-MM-DD), url `https://company.hanwhalife.com/ko/about/company-overview/newsroom/press/{seq}`
  - `export function parseKyoboFeed(xml: string): { items: RawItem[]; bodies: Record<string, string> }` — `<category>보도자료</category>` 항목만, 본문은 `content:encoded` 텍스트
  - `export function parseSamsungfireList(json: unknown): { items: RawItem[]; bodies: Record<string, string> }` — `responseMessage.body.data.AMList`
  - `export function parseMeritzList(json: unknown): RawItem[]`, `parseMeritzDetail(json: unknown): string`
  - `export const insnews, insweek, insjournal, fins: Collector`
  - `export function parseNdsoftRss(xml: string, source: SourceId): { items: RawItem[]; bodies: Record<string, string> }` — 네 매체 공통(ndsoft). pubDate `YYYY-MM-DD HH:mm:ss`(KST)에서 날짜, id `{source}:{idxno}`(링크의 `idxno=`), 본문은 `content:encoded` 또는 description 텍스트, hints에 category
  - `export function articleText(html: string): string` — `#article-view-content-div` 텍스트(보험매일 본문용)
  - `export const naver: Collector` — 키(`NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`)가 없으면 `throw new Error('키 없음')`. 있으면 `https://openapi.naver.com/v1/search/news.json?query=…&display=100&sort=date`를 헤더 `X-Naver-Client-Id`, `X-Naver-Client-Secret`로 부른다(검색어는 `config.keywords`의 auto·medical·life 앞 단어들). `originallink`를 url로. 설정에서 꺼져 있어 기본으로는 불리지 않는다.
- [ ] **Step 1: 실패하는 테스트 작성**
  - `parseHanwhaList(hanwha-list.json)`: 길이 ≥ 1, url이 `.../newsroom/press/{seq}`
  - `parseKyoboFeed(kyobo-feed.xml)`: 모든 항목이 보도자료 카테고리, bodies 키가 items id와 같다
  - `parseSamsungfireList(samsungfire-list.json)`: 길이 ≥ 10, bodies 텍스트에 HTML 태그 없음
  - `parseMeritzList(meritz-list.json)` 길이 ≥ 1, `parseMeritzDetail(meritz-detail.json)` 길이 ≥ 100
  - `parseNdsoftRss(insnews.xml,'insnews')`: 길이 = 50, id `/^insnews:\d+$/`, published YYYY-MM-DD, bodies 길이 ≥ 100인 항목 다수
  - `parseNdsoftRss(fins.xml,'fins')`: 길이 ≥ 20; `articleText(fins-article.html)` 길이 ≥ 200
  - `naver.run(ctx)`: 환경변수가 없으면 거부(reject)
- [ ] **Step 2: 실패 확인** — `node --test test/collectors-insurers.test.ts test/collectors-press.test.ts` → FAIL
- [ ] **Step 3: 구현** — 요청 형식은 recon 문서와 `docs/recon/scripts/sf.mjs`, `meritz.mjs`. RSS 주소: `https://cdn.insnews.co.kr/rss/gn_rss_allArticle.xml`, `https://cdn.insweek.co.kr/rss/gn_rss_allArticle.xml`, `https://cdn.insjournal.co.kr/rss/gn_rss_allArticle.xml`, `http://www.fins.co.kr/rss/allArticle.xml`(보험매일은 처음 보는 기사만 페이지를 받아 `articleText`). 처음 보는 글만 `putBody`.
- [ ] **Step 4: 통과 확인** — 테스트 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: insurer and trade-press collectors, naver slot`

### Task 4: 화면 (시안 v5 → 실제 화면)

**Files:** Create `web/index.html`, `web/core/app.js`, `web/core/data.js`, `web/themes/band/theme.css`, `web/themes/band/render.js`, `web/themes/band/layout.js`, `web/themes/band/layout.test.js`, `test/fixtures/latest-sample.json`

**Interfaces:**
- Consumes: `web/data/latest.json`(형식 `Latest`, `src/schema.ts`), `web/core/format.js`, `web/core/mode.js`
- Produces:
  - `web/core/data.js`: `export async function loadLatest(fetchFn = fetch): Promise<object>` (`./data/latest.json`, 캐시 무시 쿼리)
  - `web/themes/band/layout.js`(순수 함수, DOM 없음):
    - `export const RANGES = { 1: 31, 3: 92, 6: 183 }` (±개월 → 일수)
    - `export function bandWindow(today: string, months: 1|3|6): { start: string; end: string }`
    - `export function placeExact(changes, win): { change, x: number }[]` — exact만, x는 0~1, 범위 밖 제외
    - `export function placePeriods(changes, win): { change, x0: number; x1: number; clippedEnd: boolean }[]` — period만, 범위와 겹치는 것만
    - `export function outOfRange(changes, win): { before: number; after: number }`
    - `export function clusterPoints(points, minGap: number): { x: number; items: object[] }[]` — 모바일에서 가까운 점 묶기
    - `export function lanes(changes, today): Record<'auto'|'medical'|'life'|'general', { recent: object[]; upcoming: object[] }>` — recent = exact이고 date ≤ today, 또는 phrase이고 past; upcoming = 나머지
  - `web/themes/band/render.js`: `export function render(root: HTMLElement, data: Latest, ctx: { toggleMode(): string; mode: string }): void`
- 화면 구성과 CSS는 `design/v5/mobile.html`을 그대로 옮긴다(데스크톱 = v4-2, 767px 이하 = 모바일). 차이점:
  - 시안의 데이터 블록·시안 표시("시안 v5 …")·시안용 요약을 모두 지우고 `latest.json`으로 그린다. 종류 표기는 `CATEGORY_LABEL`과 같은 글자(자동차/실손/생명·건강·상해/제도·공통).
  - `status: 'proposed'` 변경에는 "예고 · 확정 아님" 딱지.
  - 요약이 null이면 요약 줄 없이 제목·출처·링크만.
  - 빈 상태: 변경 0건 "아직 모은 변경 항목이 없습니다", 띠 미래 쪽 exact 0건 "날짜가 확정된 예정 항목 없음", 소식 0건 "오늘 새 소식 없음", 각 칸 비면 "없습니다".
  - 수집 상태: `ok`/`disabled`/실패와 `note`를 그대로 보여 준다. 실패가 하나라도 있으면 머리의 신호를 주황으로.
  - 테마 토글은 `ctx.toggleMode()`. `web/index.html`은 그리기 전에 저장된 모드를 읽어 `<html data-mode>`를 정하는 짧은 인라인 스크립트를 둔다(번쩍임 방지, 키 `ir-mode`, 기본 light). CSS의 다크 선택자는 `[data-mode="dark"]`.
  - 갱신 시각은 `generatedAt`을 KST로.
  - `prefers-reduced-motion`이면 전환 애니메이션을 끈다.
- [ ] **Step 1: 실패하는 테스트 작성** (`web/themes/band/layout.test.js`)
  - `bandWindow('2026-10-23',3)` → `{start:'2026-07-23', end:'2027-01-23'}`(±92일)
  - `placeExact`: date 2026-09-26 항목은 ±1개월(31일)에서 x≈(2026-09-26 − 2026-09-22)/62 포함, 2026-03-01 항목은 제외
  - `placePeriods`: period 2027-01-01~2027-03-31은 ±1개월에서 제외, ±3개월에서 포함·`clippedEnd:true`
  - `outOfRange`: ±1개월에서 9.10 항목이 before에 셈
  - `clusterPoints([{x:.10},{x:.11},{x:.5}], .05)` → 길이 2
  - `lanes`: phrase+past 항목은 recent, phrase+미래는 upcoming, exact 미래는 upcoming
  - `test/fixtures/latest-sample.json`이 있고 `changes`, `news`, `official`, `industry`, `rates`, `status`, `counts` 키를 가진다. 이 파일은 시안의 실제 데이터(2026-10-23 수집 제목·날짜·출처·url)를 `Latest` 형식으로 옮긴 것이고 `summary`는 모두 null이다.
- [ ] **Step 2: 실패 확인** — `node --test web/themes/band/layout.test.js` → FAIL
- [ ] **Step 3: 구현** — 위 인터페이스대로. render는 layout.js 결과로 마크업을 만든다. app.js는 `loadLatest` → `createModeController({root: document.documentElement, storage: localStorage})` → `render`. 데이터 로드 실패면 "데이터를 불러오지 못했습니다" 한 줄.
- [ ] **Step 4: 통과 확인** — layout 테스트 PASS. (오케스트레이터가 `latest-sample.json`을 `web/data/latest.json`으로 복사해 브라우저에서 1280·390px, 라이트·다크를 확인한다.)
- [ ] **Step 5: 커밋** — `feat: web theme ported from the confirmed mockup`

### Task 5: 가공 규칙 (순수 함수)

**Files:** Create `src/analyze/dates-ko.ts`, `src/analyze/classify.ts`, `src/analyze/group.ts`, `src/analyze/changes.ts`, `src/analyze/rates.ts`, `test/dates-ko.test.ts`, `test/classify.test.ts`, `test/group.test.ts`, `test/changes.test.ts`, `test/rates.test.ts`

**Interfaces:**
- `dates-ko.ts`
  - `export function exactDateIn(text: string): { iso: string; raw: string } | null` — 첫 번째 완전한 날짜. 형식: `'26.10.12.`, `'26.9.10`, `‘26.7.1일`(곡선 따옴표 포함), `2027.1.1`, `2027년 1월 1일`, `'27년 1월 1일`, `20260926`(8자리, 앞뒤가 숫자가 아님). 존재하지 않는 날짜(2월 30일)는 null.
  - `export function periodOf(phrase: string, announced: string): { start: string; end: string } | null` — Global Constraints의 기간 규칙 그대로.
  - `export function whenPhraseIn(sentence: string): string | null` — 문장에서 시행 시점 표현을 원문 그대로 잘라냄(예: "'27.1분기 중", "연말까지", "다음 달부터", "7.1일부터", "오는 25일부터", "하반기").
  - `export function phraseIsPast(phrase: string, announced: string, today: string): boolean` — "오는 N일"(발표일과 같은 달, N ≥ 발표일)·"N일부터"(같은 조건)만 판단하고 그 날이 today보다 앞이면 true. 그 밖은 false.
  - `export function changeSentences(text: string): string[]` — "시행", "적용", "부터", "운영", "개정", "인상", "인하" 중 하나가 있는 문장(마침표·줄바꿈 기준, 200자 이내로 자름).
- `classify.ts`
  - `export function classify(input: { title: string; hints: string[]; body: string | null; kind: SourceKind }, kw: Config['keywords']): Topic` — 순서: ① exclude 단어가 제목·힌트에 있으면 `exclude` ② kind가 press이고 제목+본문 앞 300자에 insurance 단어가 없으면 `exclude` ③ industry 단어가 제목에 있고 auto/medical/life 단어가 제목에 없으면 `industry` ④ 제목(가중치 3)+힌트(2)+본문 앞 500자(1)에서 auto/medical/life/general 점수가 가장 높은 것, 동점이면 auto > medical > life > general, 모두 0이면 `general`.
- `group.ts`
  - `export interface GroupInput { item: RawItem; topic: Category | 'industry'; kind: SourceKind; sourceName: string }`
  - `export function titleKey(title: string): Set<string>` — 괄호·따옴표·기호 제거 후 한글 2글자 묶음(bigram)과 숫자·영단어 집합
  - `export function similar(a: string, b: string): boolean` — `titleKey` Jaccard ≥ 0.45
  - `export function groupItems(inputs: GroupInput[], today: string): NewsGroup[]` — published 차이 2일 이내이고 similar면 같은 묶음. 대표는 `SOURCE_KINDS` 순서가 가장 앞인 글, 같으면 먼저 게시된 글. `id = 'g:' + 대표 item.id`, topic은 대표의 topic, sources는 출처 이름·url(중복 제거), firstSeen = today, summary null.
- `changes.ts`
  - `export function ruleChanges(input: { item: RawItem; body: string; topic: Category; sourceName: string; today: string }): Change[]` — AI 없이 만드는 변경. `changeSentences(body)` 중 `exactDateIn`이 있고 "시행|적용|부터|운영"이 같은 문장에 있는 것만. when `exact`, date = iso, phrase = raw, quote = 문장(본문에 그대로 있음), status confirmed, origin `rule`, announced = item.published, id = `c:` + item.id + `:` + iso. 같은 글에서 같은 날짜는 하나만.
  - `export function noticeChange(input: { item: RawItem; topic: Category; sourceName: string; today: string }): Change | null` — fsc-rule 글. hints의 "예고기간 : A ~ B"를 quote와 phrase("예고기간 ~M.D")로, when `phrase`, status `proposed`, origin `rule`.
  - `export function rateChange(row: RateRow, today: string): Change` — category auto, title `{company} {kind} 자동차보험료 {+1.3|-1|0}%`, when exact, date = row.effective, phrase `시행시기 {YYYYMMDD}`, quote `{company} {kind} {total}% {YYYYMMDD} {reason}`, origin `rates`, rate 채움, sources `[{name:'손보협회 공시실', url: 공시표 주소}]`, id `r:{company}:{kind}:{effective}`.
  - `export function mergeChanges(existing: Change[], incoming: Change[], today: string): Change[]` — 같은 id는 sources를 합치고 firstSeen은 유지. id가 달라도 같은 category·같은 date(또는 같은 phrase)이고 `similar(title)`이면 합친다. 보관 규칙: exact는 date+183일, period는 end+183일, phrase는 announced+183일이 지나면 뺀다. 결과는 (date ?? period.start ?? announced) 내림차순.
- `rates.ts`
  - `export function rateKey(r: RateRow): string` — `company|kind|effective|total`
  - `export function newRates(prev: RateRow[], curr: RateRow[], today: string): RateRow[]` — prev에 없는 행. prev가 비었으면(첫 실행) curr 중 effective가 today−183일 이후인 행만
- [ ] **Step 1: 실패하는 테스트 작성** — 각 파일에 최소 다음을 넣는다.
  - dates-ko: `exactDateIn("'26.10.12.(월)부터 운영")?.iso === '2026-10-12'`; `exactDateIn("('26.9.10. 이후 사고부터 시행)")?.iso === '2026-09-10'`; `exactDateIn('2027년 1월 1일부터')?.iso === '2027-01-01'`; `exactDateIn('시행시기 20260926')?.iso === '2026-09-26'`; **`exactDateIn('7.1일부터 시행') === null`**; **`exactDateIn('오는 25일부터') === null`**; `exactDateIn('2026.2.30') === null`. `periodOf("'27.1분기 중",'2026-10-19')` → `{start:'2027-01-01',end:'2027-03-31'}`; `periodOf("'27.1월",'2026-06-30')` → 2027-01-01~2027-01-31; `periodOf('연말까지','2026-09-30')` → 2026-09-30~2026-12-31; `periodOf('하반기','2026-05-01') === null`; `periodOf("'26 하반기",'2026-05-01')` → 2026-07-01~2026-12-31. `phraseIsPast('오는 21일','2026-10-20','2026-10-23') === true`; `phraseIsPast('다음 달부터','2026-10-20','2026-12-01') === false`. `whenPhraseIn("치매배상책임보험 무상가입을 지원… '27.1분기 중 사업을 시행하며")` 결과에 "'27.1분기 중" 포함.
  - classify: config.json 키워드로 — 제목 "하나금융, 3분기 누적 순익 3조6243억원"(press) → `exclude`(보험 단어 없음); "ABL생명, 전속 설계사 3000명 돌파"(press) → `industry`; "9월 車보험 손해율 85.0%"(press) → `auto`; "실손보험 청구 민간 배제"(press) → `medical`; "연금저축보험, 가입 때 안내받은 연금액 보장 안돼"(press) → `life`; "DB손해보험, 중소기업 사이버위험 대응 강화"(press) → `exclude`; "「보험업감독규정」 일부개정고시안 규정변경예고"(gov) → `general`.
  - group: 같은 날 "교보생명, 보험금 지급까지 2시간… 생명보험업계 최단기간"(insnews)과 "교보생명, 보험금 지급 평균 2시간···생보업계 1위"(insweek)는 한 묶음(sources 2); "9월 車보험 손해율 85.0%…"와 "ABL생명, 전속 설계사 3000명 돌파"는 다른 묶음; gov 글과 press 글이 묶이면 대표가 gov.
  - changes: `ruleChanges` — body "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다." → exact 2026-10-12 하나, quote가 body에 포함; body "제도개선 사항이 7.1일부터 시행됩니다" → 빈 배열. `rateChange({company:'메리츠화재',kind:'업무용',total:-1,effective:'2026-09-26',reason:'예정사업비 변경에 따른 보험료 조정'},'2026-10-23')` → title `메리츠화재 업무용 자동차보험료 -1%`, phrase `시행시기 20260926`. `mergeChanges`: 같은 id 두 번 → 하나, sources 합쳐짐; date 2026-03-01 exact는 today 2026-10-23에서 유지(183일 이내 아님 → 2026-03-01+183=2026-08-31 < today 이므로 **빠짐**); period end 2027-03-31은 유지.
  - rates: `newRates([], rows, '2026-10-23')`은 2026-04-23 이후 행만; `newRates(rows, rows, …)`은 빈 배열; 행 하나 추가 시 그 행만.
- [ ] **Step 2: 실패 확인** — `node --test test/dates-ko.test.ts test/classify.test.ts test/group.test.ts test/changes.test.ts test/rates.test.ts` → FAIL
- [ ] **Step 3: 구현** — 위 시그니처대로.
- [ ] **Step 4: 통과 확인** — 위 테스트 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: analysis rules (dates, classify, group, changes, rates)`

### Task 6: 파이프라인 (수집 러너, 저장, CLI, 빌드, 워크플로)

**Files:** Create `src/collectors/index.ts`, `src/collectors/run.ts`, `src/store.ts`, `src/cli/collect.ts`, `src/cli/analyze.ts`, `src/cli/build.ts`, `src/cli/serve.ts`, `.github/workflows/daily.yml`, `README.md`, `test/run.test.ts`, `test/analyze.test.ts`, `test/build.test.ts`

**Interfaces:**
- Consumes: Task 1~3 수집기, Task 5 함수, `RawSnapshot`, `DailyReport`, `Change`, `Latest`
- Produces:
  - `src/collectors/index.ts`: `export const COLLECTORS: Collector[]` (config.sources 순서)
  - `src/collectors/run.ts`: `export async function runCollectors(collectors: Collector[], ctx: Omit<CollectCtx,'putBody'|'pdfBudget'>, opts?: { timeoutMs?: number }): Promise<{ items: RawItem[]; rates: RateRow[]; status: SourceStatus[]; bodies: Record<string,string> }>` — 출처마다 timeout(기본 60초), 예외·0건(items+rates)은 `ok:false`, 꺼진 출처·키 없는 출처는 `disabled:true` 상태로 건너뜀, 같은 id 중복 제거, PDF 예산은 config.limits로 하나 만들어 모두에 공유.
  - `src/store.ts`: 경로 상수와 읽기·쓰기. `readJson<T>(path, fallback: T)`, `writeJson(path, value)`(2칸 들여쓰기, 끝 줄바꿈). 파일: `data/raw/{date}.json`, `data/daily/{date}.json`, `data/changes.json`(Change[]), `data/rates.json`(RateRow[] 전체 최신표), `data/seen.json`(Record<id, firstSeenDate>), `data/pending-ai.json`(`PendingAi[]`), `tmp/bodies/{date}.json`(Record<id,text>, gitignore).
  - `export interface PendingAi { type: 'summary' | 'judge'; id: string; url: string; date: string; source: SourceId }` (summary의 id는 group id, judge의 id는 item id)
  - `src/cli/analyze.ts`: `export function analyze(input: { raw: RawSnapshot; bodies: Record<string,string>; seen: Record<string,string>; changes: Change[]; prevRates: RateRow[]; pending: PendingAi[]; config: Config; today: string }): { daily: DailyReport; changes: Change[]; rates: RateRow[]; seen: Record<string,string>; pending: PendingAi[] }` — 처음 보는 글만 분류(`exclude` 버림)·묶기, gov·assoc 글은 `ruleChanges`, fsc-rule 글은 `noticeChange`, `newRates` → `rateChange`, 모두 `mergeChanges`. 처음 보는 묶음은 summary 대기(우선순위: gov→assoc→insurer→press, 여러 출처 묶음 먼저), 처음 보는 글 중 `changeSentences(body)`가 있고 ruleChanges가 비었던 것은 judge 대기. 대기 목록은 같은 id 중복 없이 뒤에 붙인다. CLI는 store에서 읽고 쓴다.
  - `src/cli/collect.ts`: seen이 비어 있으면 `backfill: true`. raw·bodies 저장.
  - `src/cli/build.ts`: `export function buildLatest(input: { today: string; generatedAt: string; changes: Change[]; dailies: DailyReport[]; rates: RateRow[]; status: SourceStatus[]; sourceKinds: Record<SourceId, SourceKind> }): Latest` — changes: exact는 today±183일, period는 범위와 겹치는 것, phrase는 모두. news: 최근 3일 daily groups 중 topic≠industry이고 kind가 insurer 또는 press. official: 최근 30일 kind gov·assoc이고 topic≠industry. industry: 최근 14일 topic=industry. rates: 시행일 내림차순 30행. counts: newToday = 오늘 daily groups 수, upcoming = exact·date>today + period·end>today + phrase·!past, recent = exact·date≤today + phrase·past. `Latest.parse`로 검증 후 `web/data/latest.json` 저장.
  - `src/cli/serve.ts`: `web/`을 http://localhost:5173 으로 내보내는 작은 정적 서버(로컬 확인용).
  - `.github/workflows/daily.yml`: vibe-radar `daily.yml`과 같은 모양 — schedule `0 0 * * *`, workflow_dispatch, push(main, paths `web/**`, `src/**`) 시에는 build·배포만. 단계: checkout → setup-node 24 → `npm ci` → collect → analyze → summarize(`GEMINI_API_KEY` secret) → build → data 커밋(`git add data`, 작성자 github-actions[bot]) → upload-pages-artifact(`web`) → deploy-pages. permissions contents write, pages write, id-token write. concurrency group pages.
  - `README.md`: 무엇인지, 로컬 실행(`npm ci && npm run collect && npm run analyze && npm run build && npm run serve`), 출처 목록, 네이버 API 붙이는 법(설정 `enabled: true` + Secret 두 개), 데이터 원칙(지어낸 데이터 금지, 시행일 규칙), 고지 문구.
- [ ] **Step 1: 실패하는 테스트 작성**
  - run: 수집기 셋(성공 1, 예외 1, 0건 1) → status ok true/false/false, 성공 항목만 items; config에서 꺼진 출처는 `disabled:true`·호출 안 됨; 같은 id 두 번 → 하나.
  - analyze: seen에 있는 글은 새 묶음이 되지 않는다; 같은 글이 이틀 연속 와도 daily에는 첫날만; 공시표 새 행이 `origin:'rates'` 변경이 된다; press 글 "하나금융, 3분기 누적 순익"은 버려진다; pending에 summary 대기가 생긴다.
  - build: 2026-03-01 exact는 changes에서 빠지고 2027-01-01~03-31 period는 들어간다; news에 gov 글이 없다; `Latest.parse`를 통과한다; counts가 위 정의대로.
- [ ] **Step 2: 실패 확인** — `node --test test/run.test.ts test/analyze.test.ts test/build.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm test` 전체 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: pipeline, build, daily workflow`

### Task 7: AI 요약과 변경 판정 (Gemini + 근거 검증)

**Files:** Create `src/summarize/excerpt.ts`, `src/summarize/grounding.ts`, `src/summarize/summarize.ts`, `src/summarize/judge.ts`, `src/cli/summarize.ts`, `test/grounding.test.ts`, `test/summarize.test.ts`, `test/judge.test.ts`

**Interfaces:**
- Consumes: `ChatFn`, `makeChatFn`, `parseJsonObject`, `cleanText`(models.ts), `PendingAi`, store(Task 6), `exactDateIn`, `periodOf`, `whenPhraseIn`, `phraseIsPast`, `mergeChanges`(Task 5)
- Produces:
  - `excerpt.ts`: vibe-radar의 `extractExcerpt(html, max=1200)`, `fetchExcerpt(url, opts)`를 그대로(전문지 본문 `#article-view-content-div` 우선)
  - `grounding.ts`: `export function numbersIn(s: string): string[]`, `export function ungrounded(text: string, source: string, hasExcerpt: boolean): string | null` — 출처에 없는 숫자, 발췌 없이 2문장 이상이면 이유 문자열
  - `summarize.ts`: `export async function summarizeGroups(groups: { group: NewsGroup; source: string }[], chat: ChatFn): Promise<Map<string, string>>` — 한 번 호출로 여러 묶음 요약(JSON `{"items":[{"id","summary"}]}`), `ungrounded` 통과분만 후보, 두 번째 호출(검증)에서 `{"unsupported":[id]}` 받아 제외, 검증 호출이 실패하면 빈 Map. 프롬프트: vibe-radar `SYSTEM_PROMPT`/`FORMAT_HINT`/`VERIFY_PROMPT`를 보험용으로 바꿔 쓴다(대상: 본인·가족 보험을 점검하는 일반인, 해요체 1~3문장, 금액·비율·날짜·조건은 원문 그대로, 원문에 없는 원인·전망·조언 금지, 가입·해지 권유 금지).
  - `judge.ts`: `export async function judgeChanges(items: { item: RawItem; body: string; sourceName: string; topic: Category }[], chat: ChatFn, today: string): Promise<Change[]>` — AI에 묻는 것: 개인 보험의 제도·약관·보험료 변경 중 시행 시점이 있는지, 있으면 `{id, isChange, title, quote, category}`. **상품 출시·국감 지적·"검토/추진"은 isChange false.** 코드 확인: quote가 body에 글자 그대로 없으면 버림. when 결정: `exactDateIn(quote)` → exact, 아니면 `whenPhraseIn(quote)`로 phrase를 얻고 `periodOf(phrase, announced)`가 있으면 period, 없으면 phrase(`past = phraseIsPast(...)`). origin `ai`, status confirmed, id `c:{item.id}:ai`.
  - `src/cli/summarize.ts`: 키(`config.ai.keyEnv`)가 없으면 "요약 건너뜀" 출력 후 종료 코드 0. 대기 목록을 앞에서부터 `limits.aiCallsPerDay`·`limits.summariesPerDay` 안에서 처리(요약은 묶음 10개씩 한 호출 + 검증 한 호출, 판정은 글 5개씩 한 호출). 본문은 `tmp/bodies/{date}.json`에 있으면 쓰고, 없으면 `fetchExcerpt(url)`. 결과: 요약은 해당 daily 파일의 group.summary에, 판정 변경은 `mergeChanges`로 changes.json에. 처리한 항목은 대기 목록에서 빼고 남은 것은 다음 날로. 어떤 실패도 종료 코드 0(로그만).
- [ ] **Step 1: 실패하는 테스트 작성** (가짜 ChatFn)
  - grounding: 원문 "손해율이 85.0%로" 요약 "손해율이 85.0%예요" → null; 요약 "손해율이 90%예요" → 이유; 발췌 없이 두 문장 → 이유.
  - summarize: 가짜 chat이 요약에 원문 없는 숫자를 넣으면 그 묶음은 결과에 없다; 검증 호출이 예외면 빈 Map; 정상이면 Map에 id→요약.
  - judge: quote가 body에 없으면 버림; quote "'26.10.12.(월)부터 … 운영합니다"면 exact 2026-10-12; quote에 "'27.1분기 중"이면 period 2027-01-01~03-31; quote에 "다음 달부터"면 phrase; isChange false면 결과 없음.
- [ ] **Step 2: 실패 확인** — `node --test test/grounding.test.ts test/summarize.test.ts test/judge.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 테스트 PASS, `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: grounded AI summaries and change judging`

---

## 마무리 (오케스트레이터)
1. 로컬에서 키 없이 `npm run collect && npm run analyze && npm run build && npm run serve` → 실제 데이터로 화면 확인(1280·390px, 라이트·다크).
2. 출처 하나를 일부러 실패시켜(주소를 틀리게) 상태 표시 확인.
3. GitHub 저장소에 push → probe 워크플로로 해외 접속 확인 → daily 워크플로 수동 실행 → Pages 확인.
4. 설계 문서 7장 완료 기준을 하나씩 확인.
