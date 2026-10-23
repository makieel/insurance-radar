// 테스트용 실제 응답 저장: 출처마다 목록과 상세 하나씩 test/fixtures/에 저장한다.
// 출처 형식이 바뀌었을 때 다시 돌려 fixture를 새로 받는다. 사용: node scripts/capture-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; insurance-radar/1.0; +https://github.com/marsaeel/insurance-radar)';
const DIR = 'test/fixtures';
mkdirSync(DIR, { recursive: true });
const enc = encodeURIComponent;

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}
async function save(name, url, init) {
  try {
    const res = await get(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(`${DIR}/${name}`, buf);
    console.log('ok  ', name, buf.length);
    return buf.toString('utf8');
  } catch (e) {
    console.log('FAIL', name, e.message);
    return '';
  }
}

const samsungHeader = { tranId: 'VH.HDBS0101', pageId: 'VH.HPMK0602', panelId: '', longTran: '', deviceInfo: { modelNumber: 'PC', osName: '', osVersion: '', appName: '', appVersion: '', browserVersion: '', telecomAgency: '', networkType: 'LAN' } };
const meritzHeader = (svc) => ({ encryDivCd: '0', rcvmsgSrvId: svc, reqRespnsDivCd: 'Q', syncDivCd: 'S', langDivCd: 'KR', transGrpCd: 'F', screenId: '/company/media/media-report.do', lowrnkScreenId: '/' });
const meritz = (svc, body) => ({ method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', referer: 'https://www.meritzfire.com/company/media/media-report.do' }, body: JSON.stringify({ header: meritzHeader(svc), body }) });

// 정부·감독기관
await save('fsc-list.html', `https://www.fsc.go.kr/no010101?srchKey=dept&srchText=${enc('보험과')}&cntPerPage=50`);
await save('fsc-detail-87217.html', 'https://www.fsc.go.kr/no010101/87217');
await save('fsc-detail-87952.html', 'https://www.fsc.go.kr/no010101/87952');
await save('fsc-rule-list.html', `https://www.fsc.go.kr/po040301?srchKey=sj&srchText=${enc('보험')}`);
await save('fsc-rule-detail-4171.html', 'https://www.fsc.go.kr/po040301/view?noticeId=4171');
await save('fss-list.html', `https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218&searchCnd=9&searchWrd=${enc('보험')}`);
await save('fss-detail-226318.html', 'https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=226318&menuNo=200218');
await save('fss-alert-list.html', 'https://www.fss.or.kr/fss/bbs/B0000175/list.do?menuNo=200204');

// 협회·연구원
await save('knia-news.html', 'https://www.knia.or.kr/data/news');
await save('knia-news-88765.html', 'https://www.knia.or.kr/data/news/content?index=88765');
await save('knia-news-88765.pdf', 'https://www.knia.or.kr/file/download/hWHkgy0lTuJrxotl4EdYww==');
await save('kpub-car-rates.html', 'https://kpub.knia.or.kr/carInsuranceDisc/adjustment/carAdjustmentCompare.do');
await save('klia-list.html', 'https://www.klia.or.kr/board/2/list.do');
await save('klia-detail-123789.html', 'https://www.klia.or.kr/board/2/view.do?boardNo=123789&boardMngNo=2&seq=1');
await save('kiri-list.html', 'https://kiri.or.kr/community/materialList.do');

// 보험사
const hanwha = await save('hanwha-list.json', 'https://company.hanwhalife.com/api/comp/v1/get/press-releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: 1, size: 9, category: 'PRESS_RELEASE' }) });
try {
  const seq = JSON.stringify(JSON.parse(hanwha)).match(/"seq":\s*"?(\d+)/)?.[1];
  if (seq) await save('hanwha-detail.json', `https://company.hanwhalife.com/api/comp/v1/get/press-releases/${seq}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
} catch (e) { console.log('FAIL hanwha-detail', e.message); }
await save('kyobo-feed.xml', 'https://news.kyobo.com/feed/');
await save('samsungfire-list.json', 'https://www.samsungfire.com/vh/data/VH.HDBS0101.do', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', referer: 'https://www.samsungfire.com/vh/page/VH.HPMK0602.do', 'x-requested-with': 'XMLHttpRequest' }, body: new URLSearchParams({ header: JSON.stringify(samsungHeader), body: JSON.stringify({ BBS_ID: '00000015', CUR_PAGE: '1', SEARCH_CD: '02', SEARCH_WORD: '' }) }).toString() });
const mlist = await save('meritz-list.json', 'https://www.meritzfire.com/json.smart', meritz('f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsLst', { pageNo: 1, pageSize: 10, chnDivCd: 'W', bbsType: '415', subCd: '', srhKeyword: '' }));
try {
  const seq = JSON.parse(mlist).body.list[0].seq;
  await save('meritz-detail.json', 'https://www.meritzfire.com/json.smart', meritz('f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsRead', { pageNo: 1, pageSize: 10, chnDivCd: 'W', bbsType: '415', seq: +seq }));
} catch (e) { console.log('FAIL meritz-detail', e.message); }

// 보험 전문지
await save('insnews.xml', 'https://cdn.insnews.co.kr/rss/gn_rss_allArticle.xml');
await save('insweek.xml', 'https://cdn.insweek.co.kr/rss/gn_rss_allArticle.xml');
await save('insjournal.xml', 'https://cdn.insjournal.co.kr/rss/gn_rss_allArticle.xml');
const fins = await save('fins.xml', 'http://www.fins.co.kr/rss/allArticle.xml');
const finsLink = fins.match(/<link>(?:<!\[CDATA\[)?(http[^<\]]+articleView[^<\]]+)/)?.[1];
if (finsLink) await save('fins-article.html', finsLink.replace(/&amp;/g, '&'));
