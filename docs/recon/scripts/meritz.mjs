// Meritz Fire press list via json.smart, no cookies
const now = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
const header = { encryDivCd: '0', globId: '', rcvmsgSrvId: 'f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsLst', resultRcvmsgSrvId: '', esbIntfId: '', exsIntfId: '', ipv6Addr1: '', ipv6Addr2: '', teleMsgMacAdr: '', envirInfoDivCd: '', firstTranssLcatgBizafairCd: '', transsLcatgBizafairCd: '', reqRespnsDivCd: 'Q', syncDivCd: 'S', teleMsgReqDttm: now, prcesResultDivCd: '', teleMsgRespnsDttm: '', clienTrespnsDttm: '', handcapLcatgBizafairCd: '', teleMsgVerDivCd: '', langDivCd: 'KR', belongGrpCd: '', empNo: '', empId: '', dptCd: '', hgrkDptCd: '', nxupDptCd: '', transGrpCd: 'F', screenId: '/company/media/media-report.do', lowrnkScreenId: '/', resveLet: '' };
const body = process.env.SEQ ? { pageNo: 1, pageSize: 10, chnDivCd: 'W', bbsType: '415', seq: +process.env.SEQ } : { pageNo: 1, pageSize: 10, chnDivCd: 'W', bbsType: '415', subCd: '', srhKeyword: '' };
if (process.env.SEQ) header.rcvmsgSrvId = 'f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsRead';
const r = await fetch('https://www.meritzfire.com/json.smart?v=' + Date.now(), {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=UTF-8', accept: 'application/json, text/plain, */*', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', referer: 'https://www.meritzfire.com/company/media/media-report.do' },
  body: JSON.stringify({ header, body }),
});
const t = await r.text();
console.log('status', r.status, r.headers.get('content-type'), t.length);
try {
  const j = JSON.parse(t);
  if (process.env.SEQ) { const m = j.body.model || {}; console.log('READ', m.regDt, m.tnm, (m.dtl || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').length, (m.dtl || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 150)); process.exit(0); }
  console.log('total', j.body.totalCount, 'msg', JSON.stringify(j.msg).slice(0, 200));
  for (const x of j.body.list.slice(0, 5)) console.log(' ', x.seq, x.regDt, (x.vdeoDscCon || '').length, x.tnm.slice(0, 50));
} catch (e) { console.log(t.slice(0, 500)); }
