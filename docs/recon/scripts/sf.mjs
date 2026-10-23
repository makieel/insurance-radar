// Samsung Fire press list via VH.HDBS0101.do, without browser cookies
const header = { tranId: 'VH.HDBS0101', pageId: 'VH.HPMK0602', panelId: '', longTran: '', deviceInfo: { modelNumber: 'PC', osName: '', osVersion: '', appName: '', appVersion: '', browserVersion: '', telecomAgency: '', networkType: 'LAN' } };
const body = { BBS_ID: '00000015', CUR_PAGE: '1', SEARCH_CD: '02', SEARCH_WORD: '' };
for (const ua of [process.env.UA ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36']) {
  const r = await fetch('https://www.samsungfire.com/vh/data/VH.HDBS0101.do', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(ua ? { 'user-agent': ua } : {}), referer: 'https://www.samsungfire.com/vh/page/VH.HPMK0602.do', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ header: JSON.stringify(header), body: JSON.stringify(body) }),
  });
  const t = await r.text();
  console.log('status', r.status, r.headers.get('content-type'), 'len', t.length);
  try {
    const j = JSON.parse(t);
    const d = j.responseMessage.body.data;
    console.log('totalCnt', d.totalCnt, 'items', d.AMList.length, 'keys', Object.keys(d.AMList[0]).join(','));
    for (const a of d.AMList.slice(0, 10)) {
      const c = (a.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
      console.log(' ', a.articleId, a.regDate || a.rgDay || a.path.slice(-8), c.length, a.subject.slice(0, 50));
    }
    if (process.env.EFF) for (const a of d.AMList) { const c = (a.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); const m = c.match(/[^.]{0,60}(부터|시행)[^.]{0,40}/g); if (m) console.log('EFF', a.subject.slice(0, 30), '|', m.slice(0, 2).join(' / ')); }
  } catch (e) { console.log(t.slice(0, 400)); }
}
