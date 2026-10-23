// usage: node rss.mjs <outdir> <url> [<url>...]
// env UA=default|node|bot
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2];
const urls = process.argv.slice(3);
const UAS = {
  browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  node: null,
  bot: 'insurance-radar-bot/0.1 (+https://github.com/)',
};
const uaKey = process.env.UA || 'browser';
for (const url of urls) {
  const headers = {};
  if (UAS[uaKey]) headers['user-agent'] = UAS[uaKey];
  let res, buf;
  const t0 = Date.now();
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) { console.log(`== ${url}\n  ERROR ${e.cause?.code || ''} ${e.message}`); continue; }
  const ct = res.headers.get('content-type');
  const head = buf.subarray(0, 300).toString('latin1');
  const decl = (head.match(/encoding="([^"]+)"/i) || [])[1];
  let enc = /euc-kr|ks_c/i.test((ct || '') + (decl || '')) ? 'euc-kr' : 'utf-8';
  const text = new TextDecoder(enc).decode(buf);
  const name = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.]+/g, '_').slice(0, 120) + '.xml';
  writeFileSync(join(out, uaKey + '__' + name), text);
  const items = text.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/g) || [];
  const dates = items.map(i => (i.match(/<(pubDate|dc:date|published|updated)>([^<]+)</) || [])[2]).filter(Boolean);
  const parsed = dates.map(d => new Date(d)).filter(d => !isNaN(d));
  parsed.sort((a, b) => a - b);
  const descLens = items.map(i => {
    const m = i.match(/<description>([\s\S]*?)<\/description>/) || i.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>|&lt;[^&]*&gt;/g, '').length : 0;
  });
  const hasContent = items.some(i => i.includes('<content:encoded>'));
  const avg = descLens.length ? Math.round(descLens.reduce((a, b) => a + b, 0) / descLens.length) : 0;
  const first = items[0] ? (items[0].match(/<title>([\s\S]*?)<\/title>/) || [])[1] : '';
  const firstLink = items[0] ? (items[0].match(/<link>([\s\S]*?)<\/link>/) || [])[1] : '';
  const cats = [...new Set(items.map(i => (i.match(/<category>([\s\S]*?)<\/category>/) || [])[1]).filter(Boolean))].slice(0, 12);
  const span = parsed.length ? (parsed.at(-1) - parsed[0]) / 86400000 : 0;
  console.log(`== ${url}\n  ${res.status} ${ct} final=${res.url} bytes=${buf.length} ${Date.now() - t0}ms declEnc=${decl} items=${items.length}`);
  console.log(`  dates ${parsed[0]?.toISOString()} ~ ${parsed.at(-1)?.toISOString()} span=${span.toFixed(1)}d perDay~${span > 0 ? (items.length / span).toFixed(1) : '-'}`);
  console.log(`  descAvgChars=${avg} max=${Math.max(0, ...descLens)} content:encoded=${hasContent} cats=${cats.join('|')}`);
  console.log(`  first: ${first?.replace(/<!\[CDATA\[|\]\]>/g, '').slice(0, 80)} | ${firstLink?.replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 140)}`);
  if (!items.length) console.log('  HEAD: ' + text.slice(0, 300).replace(/\s+/g, ' '));
}
