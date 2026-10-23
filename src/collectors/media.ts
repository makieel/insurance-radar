import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';
import { isIsoDate, kstDate } from '../lib/dates.ts';
import { fetchText } from '../lib/http.ts';
import { textOf } from '../lib/xml.ts';
import type { RawItem } from '../schema.ts';
import type { CollectCtx, Collector } from './types.ts';

type MediaSource = 'yna' | 'chosun' | 'donga' | 'joongang';
type ParsedFeed = { items: RawItem[]; bodies: Record<string, string> };

const origins: Record<MediaSource, string> = {
  yna: 'https://www.yna.co.kr', chosun: 'https://www.chosun.com',
  donga: 'https://www.donga.com', joongang: 'https://www.joongang.co.kr',
};
const feeds = {
  yna: 'https://www.yna.co.kr/rss/economy.xml',
  chosun: 'https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml',
  donga: 'https://rss.donga.com/economy.xml',
};
const parser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false,
  isArray: name => name === 'item' || name === 'category',
});

function plain(html: string): string {
  return parse(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|tr|td)>/gi, ' '))
    .text.replace(/\s+/g, ' ').trim();
}

function publishedDate(value: string): string {
  const local = value.match(/^(\d{4})[.-](\d{2})[.-](\d{2})(?:$|\s)/);
  if (local) {
    const date = `${local[1]}-${local[2]}-${local[3]}`;
    if (isIsoDate(date)) return date;
  } else {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return kstDate(date);
  }
  throw new Error('기사 게시일을 확인할 수 없습니다');
}

function articleLink(value: string, source: MediaSource): { id: string; url: string } | null {
  let url: URL;
  try { url = new URL(value, origins[source]); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.hostname.replace(/^www\./, '') !== new URL(origins[source]).hostname.slice(4)) return null;
  const patterns: Record<MediaSource, RegExp> = {
    yna: /^\/view\/(AKR\d+)\/?$/,
    chosun: /^\/economy\/(?:[^/]+\/)*([A-Z0-9]+)\/?$/,
    donga: /^\/news\/(?:[^/]+\/)?article\/all\/\d{8}\/(\d+)\/\d+\/?$/,
    joongang: /^\/article\/(\d+)\/?$/,
  };
  const code = url.pathname.match(patterns[source])?.[1];
  if (!code) return null;
  return { id: `${source}:${code}`, url: origins[source] + url.pathname };
}

function parseRss(xml: string, source: 'yna' | 'chosun' | 'donga'): ParsedFeed {
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel) throw new Error('RSS 기사 목록을 찾을 수 없습니다');
  const items: RawItem[] = [];
  const bodies: Record<string, string> = {};
  for (const row of channel.item ?? []) {
    const link = articleLink(textOf(row.link), source);
    if (!link || Object.hasOwn(bodies, link.id)) continue;
    const title = plain(textOf(row.title));
    if (!title) throw new Error('기사 제목을 찾을 수 없습니다');
    items.push({
      ...link, source, title, published: publishedDate(textOf(row.pubDate)),
      hints: (row.category ?? []).map((value: unknown) => plain(textOf(value))).filter(Boolean),
      attachments: [],
    });
    bodies[link.id] = plain(textOf(row['content:encoded'])) || plain(textOf(row.description));
  }
  return { items, bodies };
}

export function parseYnaRss(xml: string): ParsedFeed { return parseRss(xml, 'yna'); }
export function parseChosunRss(xml: string): ParsedFeed { return parseRss(xml, 'chosun'); }
export function parseDongaRss(xml: string): ParsedFeed { return parseRss(xml, 'donga'); }

export function parseYnaList(html: string): RawItem[] {
  const list = parse(html).querySelector('.list-type212');
  if (!list) throw new Error('연합뉴스 금융 기사 목록을 찾을 수 없습니다');
  const items = new Map<string, RawItem>();
  for (const row of list.querySelectorAll('li[data-cid]')) {
    const anchor = row.querySelector('a.tit-news');
    const link = articleLink(anchor?.getAttribute('href') ?? '', 'yna');
    if (!link) continue;
    const title = plain(anchor!.innerHTML);
    if (!title) throw new Error('기사 제목을 찾을 수 없습니다');
    // 목록 시각에는 연도가 없어 원문 기사 코드에 포함된 발행일을 쓴다.
    const date = link.id.match(/AKR(\d{4})(\d{2})(\d{2})/);
    if (!date) throw new Error('기사 게시일을 확인할 수 없습니다');
    items.set(link.id, {
      ...link, source: 'yna', title, published: publishedDate(`${date[1]}-${date[2]}-${date[3]}`),
      hints: [], attachments: [],
    });
  }
  return [...items.values()];
}

export function parseJoongangList(html: string): RawItem[] {
  const list = parse(html).querySelector('#story_list');
  if (!list) throw new Error('중앙일보 금융 기사 목록을 찾을 수 없습니다');
  const items = new Map<string, RawItem>();
  for (const row of list.querySelectorAll('li.card')) {
    const anchor = row.querySelector('.headline a');
    if (!anchor) continue;
    const link = articleLink(anchor.getAttribute('href') ?? '', 'joongang');
    if (!link) continue;
    const title = plain(anchor.innerHTML);
    if (!title) throw new Error('기사 제목을 찾을 수 없습니다');
    items.set(link.id, {
      ...link, source: 'joongang', title, published: publishedDate(row.querySelector('.date')?.text.trim() ?? ''),
      hints: [], attachments: [],
    });
  }
  return [...items.values()];
}

export function articleBody(html: string, source: MediaSource): string {
  const selectors: Record<MediaSource, string> = {
    yna: '.story-news.article', joongang: '#article_body',
    chosun: '.article-body, [itemprop="articleBody"]',
    donga: '#newsct_article, .article_txt, .article_view',
  };
  const content = parse(html).querySelector(selectors[source]);
  if (!content) throw new Error('기사 본문을 찾을 수 없습니다');
  for (const node of content.querySelectorAll('script, style, iframe, figure, aside, .ad_wrap, .ads-article01, yna-ad-script, .writer-zone01, .txt-copyright, .ab_byline')) {
    node.remove();
  }
  const text = plain(content.innerHTML);
  if (!text) throw new Error('기사 본문이 비어 있습니다');
  return text;
}

function insuranceItems(items: RawItem[], ctx: CollectCtx): RawItem[] {
  return [...new Map(items.filter(item => ctx.config.keywords.insurance
    .some(word => item.title.toLowerCase().includes(word.toLowerCase())))
    .map(item => [item.id, item])).values()];
}

async function listItems(ctx: CollectCtx, source: 'yna' | 'joongang'): Promise<RawItem[]> {
  const base = origins[source] + (source === 'yna' ? '/economy/finance' : '/money/finance');
  const items: RawItem[] = [];
  const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
  for (let page = 1; page <= pages; page++) {
    const html = await fetchText(base + (ctx.backfill ? `?page=${page}` : ''), { fetch: ctx.fetch });
    items.push(...(source === 'yna' ? parseYnaList(html) : parseJoongangList(html)));
  }
  return items;
}

function rssCollector(id: 'chosun' | 'donga'): Collector {
  return {
    id,
    async run(ctx) {
      const parsed = parseRss(await fetchText(feeds[id], { fetch: ctx.fetch }), id);
      const items = insuranceItems(parsed.items, ctx);
      const scanned = parsed.items.length;
      for (const item of items) {
        if (ctx.seen.has(item.id)) continue;
        const body = parsed.bodies[item.id]
          || articleBody(await fetchText(item.url, { fetch: ctx.fetch }), id);
        ctx.putBody(item.id, body);
      }
      return { items, scanned };
    },
  };
}

export const yna: Collector = {
  id: 'yna',
  async run(ctx) {
    const parsed = parseYnaRss(await fetchText(feeds.yna, { fetch: ctx.fetch }));
    const all = [...parsed.items, ...await listItems(ctx, 'yna')];
    const items = insuranceItems(all, ctx);
    for (const item of items) {
      if (ctx.seen.has(item.id)) continue;
      ctx.putBody(item.id, articleBody(await fetchText(item.url, { fetch: ctx.fetch }), 'yna'));
    }
    return { items, scanned: all.length };
  },
};

export const chosun = rssCollector('chosun');
export const donga = rssCollector('donga');

export const joongang: Collector = {
  id: 'joongang',
  async run(ctx) {
    const all = await listItems(ctx, 'joongang');
    const items = insuranceItems(all, ctx);
    for (const item of items) {
      if (ctx.seen.has(item.id)) continue;
      ctx.putBody(item.id, articleBody(await fetchText(item.url, { fetch: ctx.fetch }), 'joongang'));
    }
    return { items, scanned: all.length };
  },
};
