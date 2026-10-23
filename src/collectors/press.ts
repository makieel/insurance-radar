import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';
import { isIsoDate, kstDate } from '../lib/dates.ts';
import { fetchText } from '../lib/http.ts';
import { textOf } from '../lib/xml.ts';
import type { RawItem, SourceId } from '../schema.ts';
import type { Collector } from './types.ts';

const parser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false,
  isArray: name => name === 'item' || name === 'category',
});

function plain(html: string): string {
  return parse(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|tr|td)>/gi, ' '))
    .text.replace(/\s+/g, ' ').trim();
}

function publishedDate(value: unknown): string {
  const raw = textOf(value);
  if (/^\d{4}-\d{2}-\d{2}(?:$|\s)/.test(raw)) {
    const date = raw.slice(0, 10);
    if (isIsoDate(date)) return date;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('RSS 게시일을 확인할 수 없습니다');
  return kstDate(date);
}

export function parseNdsoftRss(xml: string, source: SourceId): { items: RawItem[]; bodies: Record<string, string> } {
  const entries = parser.parse(xml)?.rss?.channel?.item ?? [];
  const items: RawItem[] = [];
  const bodies: Record<string, string> = {};
  for (const row of entries) {
    const url = new URL(plain(textOf(row.link)));
    const number = url.searchParams.get('idxno');
    const title = plain(textOf(row.title));
    if (!number || !/^\d+$/.test(number) || !title) throw new Error('RSS 글 번호 또는 제목이 없습니다');
    const id = `${source}:${number}`;
    if (Object.hasOwn(bodies, id)) continue;
    const categories: unknown[] = row.category ?? [];
    items.push({
      id, source, title, url: url.href, published: publishedDate(row.pubDate),
      hints: categories.map(value => plain(textOf(value))).filter(Boolean), attachments: [],
    });
    bodies[id] = plain(textOf(row['content:encoded']) || textOf(row.description));
  }
  return { items, bodies };
}

export function articleText(html: string): string {
  const content = parse(html).querySelector('#article-view-content-div');
  if (!content) throw new Error('기사 본문을 찾을 수 없습니다');
  return plain(content.innerHTML);
}

function rssCollector(id: SourceId, url: string): Collector {
  return {
    id,
    async run(ctx) {
      const parsed = parseNdsoftRss(await fetchText(url, { fetch: ctx.fetch }), id);
      for (const item of parsed.items) {
        if (ctx.seen.has(item.id)) continue;
        const text = id === 'fins'
          ? articleText(await fetchText(item.url, { fetch: ctx.fetch })) : parsed.bodies[item.id];
        ctx.putBody(item.id, text);
      }
      return { items: parsed.items };
    },
  };
}

export const insnews = rssCollector('insnews', 'https://cdn.insnews.co.kr/rss/gn_rss_allArticle.xml');
export const insweek = rssCollector('insweek', 'https://cdn.insweek.co.kr/rss/gn_rss_allArticle.xml');
export const insjournal = rssCollector('insjournal', 'https://cdn.insjournal.co.kr/rss/gn_rss_allArticle.xml');
export const fins = rssCollector('fins', 'http://www.fins.co.kr/rss/allArticle.xml');
