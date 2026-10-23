// usage: node effdate.mjs file...  -> sentences mentioning effective dates in items about premium/terms
import { readFileSync } from 'node:fs';
const re = /[^.。\n]{0,80}(시행|적용|부터|개정|변경)[^.。\n]{0,60}/g;
const dateRe = /(\d{4}년\s*\d{1,2}월|\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*(초|중|말|중순|하순|부터)|내년|다음\s*달|하반기|상반기|\d{4}\.\s*\d{1,2}\.)/;
const topic = /(보험료|약관|인상|인하|손해율|실손|자동차보험|갱신|예정이율|표준)/;
for (const f of process.argv.slice(2)) {
  const t = readFileSync(f, 'utf8');
  const items = t.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  for (const it of items) {
    const title = ((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '');
    const link = ((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const body = ((it.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '')
      .replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    if (!topic.test(title + body.slice(0, 400))) continue;
    const hits = [...body.matchAll(re)].map(m => m[0].trim()).filter(s => dateRe.test(s) && /(시행|적용|부터)/.test(s));
    if (hits.length) console.log(`* ${title.slice(0, 70)} | ${link}\n   - ${hits.slice(0, 3).join('\n   - ')}`);
  }
}
