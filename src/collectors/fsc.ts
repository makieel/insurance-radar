import { parse, type HTMLElement } from 'node-html-parser';
import { XMLParser } from 'fast-xml-parser';
import { kstDate, isIsoDate } from '../lib/dates.ts';
import { fetchText, HttpError } from '../lib/http.ts';
import { fetchPdfText } from '../lib/pdf.ts';
import { textOf } from '../lib/xml.ts';
import type { Attachment, RawItem } from '../schema.ts';
import type { Collector, CollectCtx } from './types.ts';

const ORIGIN = 'https://www.fsc.go.kr';
const RSS_URL = 'http://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111';

function clean(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

function attachmentsIn(root: HTMLElement): Attachment[] {
  const attachments = new Map<string, Attachment>();
  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('/comm/getFile?')) continue;
    const url = new URL(href, ORIGIN).href;
    if (attachments.has(url)) continue;
    const name = clean(link.closest('.file-list')?.querySelector('.name')?.text
      ?? link.getAttribute('title') ?? link.text).replace(/\s*\([\d.,]+\s*(?:KB|MB|B)\)\s*$/i, '').trim();
    const type = /\.pdf$/i.test(name) ? 'pdf' : /\.hwpx?$/i.test(name) ? 'hwp' : 'other';
    attachments.set(url, { name, url, type });
  }
  return [...attachments.values()];
}

export function parseFscList(html: string): RawItem[] {
  const items: RawItem[] = [];
  for (const row of parse(html).querySelectorAll('.board-list-wrap li')) {
    const link = row.querySelector('.subject a');
    const id = link?.getAttribute('href')?.match(/\/no010101\/(\d+)/)?.[1];
    const title = clean(link?.getAttribute('title') ?? link?.text ?? '');
    const published = clean(row.querySelector('.day')?.text ?? '');
    if (!id || !title || !isIsoDate(published)) continue;
    const hints = row.querySelectorAll('.info span').map(node => clean(node.text))
      .filter(text => /^담당부서\s*:/.test(text)).map(text => text.replace(/^담당부서\s*:\s*/, ''));
    items.push({ id: `fsc-press:${id}`, source: 'fsc-press', title,
      url: `${ORIGIN}/no010101/${id}`, published, hints, attachments: attachmentsIn(row) });
  }
  return items;
}

export function parseFscDetail(html: string): { text: string; attachments: Attachment[] } {
  const root = parse(html).querySelector('.board-view-wrap');
  if (!root) return { text: '', attachments: [] };
  return { text: clean(root.querySelector('.body .cont')?.structuredText ?? ''), attachments: attachmentsIn(root) };
}

export function parseFscRuleList(html: string): RawItem[] {
  const items: RawItem[] = [];
  for (const row of parse(html).querySelectorAll('.board-list-wrap li')) {
    const link = row.querySelector('.subject a');
    const id = link?.getAttribute('href')?.match(/[?&]noticeId=(\d+)/)?.[1];
    const title = clean(link?.getAttribute('title') ?? link?.text ?? '');
    const info = row.querySelectorAll('.info span').map(node => clean(node.text));
    const period = info.find(text => /^예고기간\s*:/.test(text));
    const published = period?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
    if (!id || !title || !isIsoDate(published)) continue;
    const hints = info.map(text => text.replace(/^구분\s*:\s*/, ''));
    items.push({ id: `fsc-rule:${id}`, source: 'fsc-rule', title,
      url: `${ORIGIN}/po040301/view?noticeId=${id}`, published, hints, attachments: attachmentsIn(row) });
  }
  return items;
}

function parseRss(xml: string): RawItem[] {
  const feed = new XMLParser({ ignoreAttributes: false, isArray: name => name === 'item' }).parse(xml);
  const items: RawItem[] = [];
  for (const entry of feed?.rss?.channel?.item ?? []) {
    const link = textOf(entry.link);
    const id = link.match(/\/no010101\/(\d+)/)?.[1];
    const title = clean(parse(textOf(entry.title)).text);
    const rawDate = textOf(entry.pubDate ?? entry['dc:date']);
    const date = new Date(rawDate);
    const published = isIsoDate(rawDate) ? rawDate : Number.isNaN(date.getTime()) ? '' : kstDate(date);
    if (!id || !title || !isIsoDate(published)) continue;
    const categories = Array.isArray(entry.category) ? entry.category : [entry.category];
    items.push({ id: `fsc-press:${id}`, source: 'fsc-press', title,
      url: `${ORIGIN}/no010101/${id}`, published,
      hints: categories.map(textOf).filter(Boolean), attachments: [] });
  }
  if (items.length === 0) throw new Error('금융위 RSS에서 글을 찾지 못했습니다');
  return items;
}

async function collectLists(ctx: CollectCtx, rule: boolean): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
  const searches = rule ? [['sj', '보험']] : [['dept', '보험과'], ['sj', '보험']];
  for (let page = 1; page <= pages; page++) {
    for (const [key, word] of searches) {
      const path = rule ? '/po040301' : '/no010101';
      const url = `${ORIGIN}${path}?srchKey=${key}&srchText=${encodeURIComponent(word!)}&cntPerPage=50&curPage=${page}`;
      const html = await fetchText(url, { fetch: ctx.fetch });
      items.push(...(rule ? parseFscRuleList(html) : parseFscList(html)));
    }
  }
  if (items.length === 0) throw new Error('금융위 목록에서 글을 찾지 못했습니다');
  return items;
}

async function collectDetails(items: RawItem[], ctx: CollectCtx): Promise<RawItem[]> {
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  for (const item of unique) {
    if (ctx.seen.has(item.id)) continue;
    const detail = parseFscDetail(await fetchText(item.url, { fetch: ctx.fetch }));
    // 구조가 다른 상세 페이지 하나 때문에 출처 전체가 멈추지 않도록 그 글만 본문 없이 둔다.
    if (!detail.text && detail.attachments.length === 0) {
      console.warn(`금융위 상세 본문을 찾지 못해 건너뜀: ${item.url}`);
      continue;
    }
    item.attachments = [...new Map([...item.attachments, ...detail.attachments].map(file => [file.url, file])).values()];
    const pdf = item.attachments.find(file => file.type === 'pdf');
    const pdfText = pdf ? await fetchPdfText(pdf.url, ctx.pdfBudget, { fetch: ctx.fetch }) : null;
    ctx.putBody(item.id, [detail.text, pdfText].filter(Boolean).join('\n\n'));
  }
  return unique;
}

export const fscPress: Collector = {
  id: 'fsc-press',
  async run(ctx) {
    let items: RawItem[] = [];
    let note: string | null = null;
    try {
      items = parseRss(await fetchText(RSS_URL, { fetch: ctx.fetch }));
    } catch (error) {
      note = error instanceof HttpError
        ? `RSS 점검 중(${error.status}) → 목록 페이지로 수집`
        : 'RSS 수집 실패 → 목록 페이지로 수집';
    }
    if (note || ctx.backfill) items.push(...await collectLists(ctx, false));
    return { items: await collectDetails(items, ctx), note };
  },
};

export const fscRule: Collector = {
  id: 'fsc-rule',
  async run(ctx) {
    return { items: await collectDetails(await collectLists(ctx, true), ctx) };
  },
};
