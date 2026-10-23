// usage: node art.mjs <outdir> url...  -> status, charset, body length estimate, paywall hints, effective-date sentences
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const UA = process.env.NOUA ? undefined : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const out = process.argv[2];
for (const url of process.argv.slice(3)) {
  let r, buf;
  try {
    r = await fetch(url, { headers: UA ? { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' } : {}, signal: AbortSignal.timeout(25000) });
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) { console.log(`== ${url}\n  ERROR ${e.cause?.code || ''} ${e.message}`); continue; }
  const ct = r.headers.get('content-type') || '';
  const meta = (buf.subarray(0, 4000).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1] || '';
  const enc = /euc-kr|ks_c|cp949/i.test(ct + meta) ? 'euc-kr' : 'utf-8';
  const html = new TextDecoder(enc).decode(buf);
  writeFileSync(join(out, url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.]+/g, '_').slice(0, 100) + '.html'), html);
  const clean = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, '');
  const paras = [...clean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).filter(s => s.length > 40);
  const text = clean.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/[ \t]+/g, ' ');
  const hints = (text.match(/(유료\s*(회원|기사|구독)|로그인\s*후\s*(이용|열람)|구독자\s*전용|프리미엄\s*기사|captcha|Access Denied|cloudflare|Just a moment)/gi) || []).slice(0, 3);
  const eff = [...new Set([...text.matchAll(/[^.\n]{0,70}(\d{1,2}월\s*\d{1,2}일|\d{1,2}일|\d{1,2}월|내년|\d{4}년\s*\d{1,2}월)[^.\n]{0,10}(부터|시행|적용)[^.\n]{0,50}/g)].map(m => m[0].trim()))].slice(0, 4);
  console.log(`== ${url}\n  ${r.status} ${ct} metaCharset=${meta} final=${r.url} bytes=${buf.length} paras>40=${paras.length} paraChars=${paras.join(' ').length} hints=${hints.join('|')}`);
  for (const e of eff) console.log('   eff: ' + e.slice(0, 200));
}
