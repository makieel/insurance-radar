# 출처 확인 기록 (2026-10-23)

모든 내용은 2026-10-23 한국 가정용 IP에서 Node 24 `fetch`와 curl로 직접 요청한 결과다. **GitHub Actions(해외 IP)에서도 같은지는 아직 확인하지 않았다.** 구현 첫 단계에서 Actions 접속 시험으로 확인한다.
요청을 재현하는 스크립트는 `docs/recon/scripts/`에 있다.

## 공통
- 모두 UTF-8이고, 서버에서 다 만든 HTML(SSR) 또는 JSON이다. 헤드리스 브라우저가 필요 없다(정책브리핑 상세 iframe만 예외인데, 쓰지 않는다).
- **User-Agent에 주의한다.**
  - 손보협회 계열(knia.or.kr, kpub.knia.or.kr, e-insmarket.or.kr)의 보안 장치는 `curl/*`, `python-requests`, `Wget`, `Googlebot`에 403과 "보안정책 위배" 페이지를 준다. Node 기본값, 빈 값, `Mozilla/5.0`, `insurance-radar-bot/1.0`은 200을 받는다.
  - 금감원(fss.or.kr)은 UA가 `curl/…`나 `Wget/…`이면 TLS 연결을 끊는다(curl 오류 56).
  - 대처: 고정 UA를 명시하고, 응답 본문에 "보안정책"이 있거나 403이면 그 출처만 실패로 기록한다.
- 한글 검색어는 UTF-8 퍼센트 인코딩(`encodeURIComponent`)으로 보낸다. Git Bash의 curl에서는 깨진다.

## 정부·감독기관

### 금융위원회 보도자료
- RSS: `http://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111`(보도자료), 0112(보도설명), 0114(공지). 세 개 모두 **503 "현재 RSS 서비스 점검 중입니다."**였다. 카드뉴스 RSS(`fsc_card_rss/?fid=0411`)만 정상이었다.
- 목록 HTML: `https://www.fsc.go.kr/no010101`
  - 항목: `.board-list-wrap li` 안에 `.subject a`(title 속성에 제목, href `/no010101/{id}`), `.info span`("담당부서 : 보험과"), `.day`(YYYY-MM-DD)
  - 쪽: `?curPage=N`, 한 쪽 개수: `cntPerPage=50`
  - **검색은 GET만 된다.** POST로 보내면 검색어가 무시된다.
  - `?srchKey=dept&srchText=보험과&cntPerPage=50` → 490건(공동 담당 포함). `?srchKey=sj&srchText=보험` → 1161건.
- 상세: `.board-view-wrap .body .cont`에 보도자료 전문이 HTML 텍스트로 있다. 첨부는 hwpx/pdf(`/comm/getFile?...`).
- 시행일 표기 예: "제도개선 사항이 7.1일부터 시행됩니다", "'26.7.1일 체결되는 계약부터 … 적용", "'27.1월 시행사항", "'27.1분기 중 사업을 시행", "'27년부터 '28년까지 2년간 사업을 시행"
- robots.txt: 막는 규칙 없음

### 금융위원회 입법·규정변경예고
- `https://www.fsc.go.kr/po040301?srchKey=sj&srchText=보험` → 142건
- 목록 `.info`: "구분 : 규정변경예고 / 법률구분 : 행정규칙 / 예고기간 : 2026-10-23 ~ 2026-12-02"
- 상세 `/po040301/view?noticeId=4171`: 담당부서, 개정 이유, 주요 내용 전문이 HTML 텍스트로 있다.

### 금융감독원
- RSS 없음.
- 보도자료: `https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218`(한 쪽 약 670KB)
  - 행: `td.title a`(href `view.do?nttId=…`), 다음 `<td>담당부서</td>`, 다음 날짜 td
  - 쪽 `pageIndex`, 기간 `sdate`/`edate`(YYYY-MM-DD), 모두 GET
  - **보험 거르기:** `&searchCnd=9&searchWrd=보험`(담당부서명 검색) → 보험감독국, 보험검사1·2국, 보험상품분쟁1·2국, 보험사기대응단, 계리리스크감독국 등
- 상세: HTML에는 개조식 요약 몇 줄만 있고 "※ 자세한 내용은 첨부파일을 참고하시기 바랍니다."로 끝난다. 전문은 HWP/PDF 첨부(`/fss/cmmn/file/fileDown.do?...`, PDF 약 1.2MB).
- 시행일 표기 예: "('26.9.10. 이후 사고부터 시행)", "청구전산화 시행('24.10.25일)". 요약에 시행일이 아예 없는 글도 많다.
- 소비자경보 `B0000175/list.do?menuNo=200204`(같은 구조, 제목 "(소비자경보 2026-27호) …"), 보험업무자료 `B0000114/list.do?menuNo=200142`, 보험상품자료 `B0000115/list.do?menuNo=200143`(표준약관, 평균공시이율). 금융꿀팁 `B0000173`은 2024-12 이후 멈췄다.
- robots.txt: `Yeti`에만 규칙이 있다.

### 쓰지 않는 곳
- 정책브리핑(korea.kr) RSS: 2026-07-01 "콘텐츠 저작권 등 권리 보호"를 이유로 폐지됐다. `/rss/dept_fsc.xml`은 404다.
- 법령 Open API(law.go.kr DRF): 키(OC)와 함께 서버 IP·도메인 등록이 필요해, IP가 바뀌는 Actions에서 쓸 수 없다. 입법예고 API는 없다.
- 국민참여입법센터 `opinion.lawmaking.go.kr/gcom/ogLmPp?cptOfiOrgCd=1160100`: 수집은 되지만 진행 중인 예고만 보여 주고, 감독규정 같은 행정규칙이 없다. 금융위 po040301로 충분하다.

## 협회·연구원

### 손해보험협회
- 보도자료 `https://www.knia.or.kr/data/news`, 쪽 `?page=2`, 상세 `/data/news/content?index=88765`, 첨부 `/file/download/{토큰}`
- 공지 `https://www.knia.or.kr/data/notice`
- 보도자료는 본문이 비어 있고 HWP·PDF 첨부만 있다. PDF는 텍스트가 정상 추출된다. 공지는 본문 HTML이 있다.
- 갱신: 보도자료 월 4~6건(10-08, 09-30, 09-22, 09-22, 09-21, 09-17)
- PDF 시행일 표기 예: "'26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」…를 운영합니다", "자동차손해배상보장법 시행령 개정‧시행('26.9.10)에 따라"
- robots.txt는 어떤 UA로도 403이라 읽을 수 없다.

### 손해보험협회 공시실: 자동차보험료 조정내역
- `https://kpub.knia.or.kr/carInsuranceDisc/adjustment/carAdjustmentCompare.do` (GET)
- 표 행 구조: `<tr><th scope="row">보험사</th><td>종목</td><td>담보별 조정률…(6칸)</td><td>전체</td><td>YYYYMMDD</td><td class="align-l">조정사유</td></tr>`
- 예: `메리츠화재 | 업무용 | -1.8 | -0.8 | … | -1 | 20260926 | 예정사업비 변경에 따른 보험료 조정`
- 같은 페이지 앞부분에 빈 템플릿(`data-name="OPT_YMD"`)이 있으니, 날짜 칸이 8자리 숫자인 행만 쓴다.
- 첫 요청 때 `location.href='/main.do'` 스크립트가 섞일 수 있다.
- 실손 보험료 인상률·손해율 `/productDisc/lostHealth/lostHealthIncreaseRate.do`: 연 단위 표이고, 회사·담보 선택은 같은 주소로 보내는 폼이다(기본 화면만 확인).

### 생명보험협회
- 보도자료 `https://www.klia.or.kr/board/2/list.do`, 공지 `/board/1/list.do`, 쪽 `pageIndex`
- 목록 링크는 `onclick="fn_goView('123789','2','1','')"` 형태다. 번호를 뽑아 `/board/2/view.do?boardNo={번호}&boardMngNo=2&seq=1`로 GET한다.
- 첨부 `/FileDown.do?fileNo=..&seq=..`. 본문은 "자세한 내용은 첨부파일 참조"뿐이다.
- 갱신: 월 0~3건. 공지에는 고정글과 입찰·채용이 섞인다. 목록 HTML이 약 430KB다.
- **공시실 `pub.insure.or.kr`은 robots.txt가 `User-agent:* / Disallow:/`라 수집하지 않는다.**

### 보험연구원
- 보도자료 `https://kiri.or.kr/community/materialList.do`, 상세 `materialView.do?bid=…`, 첨부 `boardDownloadFile.do?bid=…&seq=n`
- 이슈분석 `/publication/list.do?catId=29`(포커스 28, 글로벌이슈 30), 보고서 `/report/reportList.do?catId=4`
- 보도자료 본문은 HTML이다. 「」 대신 전각 `？`(U+FF1F)가 섞여 있다.
- 날짜 표기가 섞여 있다(목록 YYYY-MM-DD, 권호 2026-08, 발행월 2026-09).

## 보험사

| 회사 | 방법 | 비고 |
|---|---|---|
| 한화생명 | `POST https://company.hanwhalife.com/api/comp/v1/get/press-releases` 본문 `{"page":1,"size":9,"category":"PRESS_RELEASE"}` → JSON `seq`, `title`, `broadcastDate`(YYYYMMDD). 상세 `POST .../press-releases/{seq}`의 `content`(HTML). 원문 링크 `/ko/about/company-overview/newsroom/press/{seq}` | 쿠키·UA 없이 200. 월 약 6건 |
| 교보생명 | RSS `https://news.kyobo.com/feed/`(워드프레스, `content:encoded`에 본문). `<category>보도자료</category>`로 거른다. 피드가 10건뿐이라 보조로 목록 HTML `/category/press/%eb%b3%b4%eb%8f%84%ec%9e%90%eb%a3%8c/`(`post-date` 클래스)를 함께 쓴다 | 카테고리 피드와 wp-json은 안 된다. 주 2건 |
| 삼성화재 | `POST https://www.samsungfire.com/vh/data/VH.HDBS0101.do` form 본문 `header`, `body`(JSON 문자열). `scripts/sf.mjs` 참고. 응답 `responseMessage.body.data.AMList`(15건, `content`에 본문) | 쿠키·UA 없이 200. 월 4~5건 |
| 메리츠화재 | `POST https://www.meritzfire.com/json.smart` JSON 본문(header의 `rcvmsgSrvId: f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsLst`, body `{"pageNo":1,"pageSize":10,"chnDivCd":"W","bbsType":"415"}`). 상세는 `retrieveNewsRead` + `seq` → `body.model.dtl`. `scripts/meritz.mjs` 참고 | 연 10건 안팎. 최근 글 2026-08-12 |
| 빼는 곳 | 삼성생명·현대해상·KB손보(보도자료 메뉴 없음), DB손보(robots가 사실상 전부 차단) | 뉴스로 대신 잡는다 |

## 보험 전문지 RSS
네 곳 모두 같은 CMS(ndsoft)이고 유료벽이 없다. 본문은 `#article-view-content-div`에 있다. robots.txt는 /admin 정도만 막는다. 페이지에 "무단 전재·복사·배포 금지" 문구가 있다.

| 매체 | 피드 | 하루 건수(30일 기준) |
|---|---|---|
| 한국보험신문 insnews.co.kr | `https://cdn.insnews.co.kr/rss/gn_rss_allArticle.xml`(본문), `/rss/allArticle.xml`(요약 300자) | 약 11 |
| 보험신보 insweek.co.kr | `https://cdn.insweek.co.kr/rss/gn_rss_allArticle.xml` | 약 7 |
| 보험저널 insjournal.co.kr | `https://cdn.insjournal.co.kr/rss/gn_rss_allArticle.xml` | 약 12 |
| 보험매일 fins.co.kr | `http://www.fins.co.kr/rss/allArticle.xml`(요약만, 본문은 기사 페이지). 섹션 RSS S2N1 보험정책, S2N2 생명, S2N3 손해 | 약 7 |

- 피드는 50건씩이라 하루 한 번 수집해도 빠지지 않는다.
- 보험 종류별 피드는 없다. 키워드로 분류해야 한다.
- 은행·카드 등 보험과 무관한 기사가 섞인다(한국보험신문).

## 일반 뉴스 (나중에 붙일 것)
- 네이버 뉴스 검색 API: Client ID·Secret 헤더가 필요하다(키 없으면 401 "Not Exist Client ID"). 하루 25,000회, display 최대 100, start 최대 1000, `originallink`로 원문 URL을 준다. 공식 문서 developers.naver.com/docs/serviceapi/search/news/news.md
- 쓰지 않는 곳: Google 뉴스 RSS(원문 링크를 비공식 batchexecute로만 얻을 수 있고 12건 뒤 `google.com/sorry`로 차단됐다. 피드 이용 조건이 비상업이고 스팸 도메인이 섞인다), 연합뉴스 RSS(120건이 8시간치이고 비상업 조건), 한국경제(Cloudflare 403), 조선비즈(0건), 이데일리(TLS 오류)

## 시행일 표기 관찰 (기사)
- "오는 25일부터 자동차보험 경상환자에 대한 향후치료비(합의금) 지급이 원칙적으로 제한된다"(같은 기사에 "계약 개시일 기준"이라는 설명)
- "11월부터 6개월간 시행한 뒤 연장 여부를 검토", "오는 11월 시행 예정인 '선택형 할인 특약'"
- "2027년 1월 판매수수료 4년 분급까지 시행되면서"
- 제목: "자동차보험료 2월부터 1.0%대 인상", "다음 달부터 1.3~1.4% 인상"
- 기사 표현은 대부분 연도나 월이 빠진 상대 표현이다. 계약 개시일 기준인지 사고일 기준인지 같은 단서도 함께 나온다.
