// 시안용 실제 데이터 추출 (일회성). 사용: node extract.mjs <scratchpad 경로> > out.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2];
const read = (p) => readFileSync(join(base, p), 'utf8');
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

const out = {};

// 금융위 보도자료 (담당부서 보험과 검색)
out.fsc = read('recon-gov/fsc_dept3.html').split('<div class="subject">').slice(1).map((b) => {
  const a = b.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  const title = a ? strip(a[2]) : '';
  const dept = (b.match(/담당부서\s*:\s*([^<]+)/) || [])[1]?.trim();
  const day = (b.match(/class="day">\s*([\d-]+)/) || [])[1];
  return { title, href: a?.[1], dept, day };
}).filter((x) => x.title).slice(0, 15);

// 금융위 규정변경예고 (보험)
out.fscRule = read('recon-gov/fsc_rule_ins.html').split('<div class="subject">').slice(1).map((b) => {
  const a = b.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  const info = strip((b.match(/<div class="info">([\s\S]*?)<\/div>/) || [])[1] || '');
  return { title: a ? strip(a[2]) : '', href: a?.[1], info };
}).filter((x) => x.title).slice(0, 8);

// 금감원 보도자료 (보험 부서)
out.fss = [...read('recon-gov/fss_dept.html').matchAll(/<td class="title"><a href="([^"]+)">([\s\S]*?)<\/a><\/td>\s*([\s\S]*?)<td>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/g)]
  .map((m) => ({ title: strip(m[2]), href: m[1], dept: strip(m[3]), day: m[4] })).slice(0, 12);

// 손보 공시실 자동차보험료 조정내역
out.carRate = [...read('recon-assoc/kpub_carAdjustmentCompare.html').matchAll(/<tr>\s*<th scope="row">([^<]+)<\/th>([\s\S]*?)<\/tr>/g)]
  .map((m) => {
    const tds = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) => strip(t[1]));
    return { company: m[1].trim(), kind: tds[0], total: tds[7], date: tds[8], reason: tds[9] };
  }).filter((r) => /^\d{8}$/.test(r.date || '')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

// 손보협회 보도자료
out.knia = [...read('recon-assoc/knia_news.html').matchAll(/href="(\/data\/news\/content\?index=\d+)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map((m) => ({ title: strip(m[2]), href: m[1] })).filter((x) => x.title).slice(0, 10);

// 보험연구원 보도자료
out.kiri = [...read('recon-assoc/kiri_community_materialList_do.html').matchAll(/materialView\.do\?bid=(\d+)[^>]*>([\s\S]*?)<\/a>/g)]
  .map((m) => ({ title: strip(m[2]), bid: m[1] })).filter((x) => x.title).slice(0, 8);

console.log(JSON.stringify(out, null, 1));
