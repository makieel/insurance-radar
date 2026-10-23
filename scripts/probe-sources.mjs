// 출처 접속 시험: 각 출처에 한 번씩 요청해 상태 코드, 크기, 차단 징후를 표로 출력한다.
// GitHub Actions(해외 IP)에서 국내 출처가 열리는지 확인하는 용도다. 사용: node scripts/probe-sources.mjs
const UA = 'Mozilla/5.0 (compatible; insurance-radar/1.0; +https://github.com/marsaeel/insurance-radar)';
const enc = encodeURIComponent;

const samsungHeader = { tranId: 'VH.HDBS0101', pageId: 'VH.HPMK0602', panelId: '', longTran: '', deviceInfo: { modelNumber: 'PC', osName: '', osVersion: '', appName: '', appVersion: '', browserVersion: '', telecomAgency: '', networkType: 'LAN' } };
const meritzHeader = { encryDivCd: '0', rcvmsgSrvId: 'f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsLst', reqRespnsDivCd: 'Q', syncDivCd: 'S', langDivCd: 'KR', transGrpCd: 'F', screenId: '/company/media/media-report.do', lowrnkScreenId: '/' };

const SOURCES = [
  ['금융위 RSS', 'http://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111'],
  ['금융위 보도자료', `https://www.fsc.go.kr/no010101?srchKey=dept&srchText=${enc('보험과')}&cntPerPage=50`],
  ['금융위 규정변경예고', `https://www.fsc.go.kr/po040301?srchKey=sj&srchText=${enc('보험')}`],
  ['금감원 보도자료', `https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218&searchCnd=9&searchWrd=${enc('보험')}`],
  ['금감원 소비자경보', 'https://www.fss.or.kr/fss/bbs/B0000175/list.do?menuNo=200204'],
  ['손보협회 보도자료', 'https://www.knia.or.kr/data/news'],
  ['손보협회 공시표', 'https://kpub.knia.or.kr/carInsuranceDisc/adjustment/carAdjustmentCompare.do'],
  ['생보협회 보도자료', 'https://www.klia.or.kr/board/2/list.do'],
  ['보험연구원', 'https://kiri.or.kr/community/materialList.do'],
  ['한화생명 API', 'https://company.hanwhalife.com/api/comp/v1/get/press-releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: 1, size: 9, category: 'PRESS_RELEASE' }) }],
  ['교보생명 RSS', 'https://news.kyobo.com/feed/'],
  ['삼성화재 API', 'https://www.samsungfire.com/vh/data/VH.HDBS0101.do', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', referer: 'https://www.samsungfire.com/vh/page/VH.HPMK0602.do', 'x-requested-with': 'XMLHttpRequest' }, body: new URLSearchParams({ header: JSON.stringify(samsungHeader), body: JSON.stringify({ BBS_ID: '00000015', CUR_PAGE: '1', SEARCH_CD: '02', SEARCH_WORD: '' }) }).toString() }],
  ['메리츠화재 API', 'https://www.meritzfire.com/json.smart', { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', referer: 'https://www.meritzfire.com/company/media/media-report.do' }, body: JSON.stringify({ header: meritzHeader, body: { pageNo: 1, pageSize: 10, chnDivCd: 'W', bbsType: '415', subCd: '', srhKeyword: '' } }) }],
  ['한국보험신문 RSS', 'https://cdn.insnews.co.kr/rss/gn_rss_allArticle.xml'],
  ['보험신보 RSS', 'https://cdn.insweek.co.kr/rss/gn_rss_allArticle.xml'],
  ['보험저널 RSS', 'https://cdn.insjournal.co.kr/rss/gn_rss_allArticle.xml'],
  ['보험매일 RSS', 'http://www.fins.co.kr/rss/allArticle.xml'],
];

const BLOCK = /보안정책 위배|Access Denied|Request Rejected|captcha|cf-chl|RSS 서비스 점검/i;

const rows = [];
for (const [name, url, opts = {}] of SOURCES) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    const flag = BLOCK.exec(text)?.[0] ?? '';
    rows.push([name, String(res.status), String(text.length), flag, `${Date.now() - started}ms`]);
  } catch (e) {
    rows.push([name, 'ERR', '0', e.cause?.code ?? e.name ?? String(e), `${Date.now() - started}ms`]);
  }
}

const table = ['| 출처 | 상태 | 크기 | 표시 | 시간 |', '|---|---|---|---|---|', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 출처 접속 시험\n\n${table}\n`);
}
