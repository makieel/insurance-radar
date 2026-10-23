import { parse, type HTMLElement } from 'node-html-parser';
import { isIsoDate } from '../lib/dates.ts';
import { fetchText } from '../lib/http.ts';
import { fetchPdfText } from '../lib/pdf.ts';
import type { Attachment, RawItem } from '../schema.ts';
import type { Collector, CollectCtx } from './types.ts';

const ORIGIN = 'https://www.fss.or.kr';
type FssSource = 'fss-press' | 'fss-alert';

function clean(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

function boardPath(source: FssSource): string {
  return source === 'fss-press' ? '/fss/bbs/B0000188' : '/fss/bbs/B0000175';
}

function menuNo(source: FssSource): string {
  return source === 'fss-press' ? '200218' : '200204';
}

function attachmentsIn(root: HTMLElement): Attachment[] {
  const attachments = new Map<string, Attachment>();
  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('/fss/cmmn/file/fileDown.do?')) continue;
    const url = new URL(href, ORIGIN).href;
    if (attachments.has(url)) continue;
    const namedLink = link.closest('.attach-box')?.querySelector('.btn-attach-download') ?? link;
    const name = clean(namedLink.querySelector('.name')?.text ?? namedLink.text)
      .replace(/\s*\(파일크기\s*:[^)]*\)\s*$/, '').trim();
    const type = /\.pdf$/i.test(name) ? 'pdf' : /\.hwpx?$/i.test(name) ? 'hwp' : 'other';
    attachments.set(url, { name, url, type });
  }
  return [...attachments.values()];
}

export function parseFssList(html: string, source: FssSource): RawItem[] {
  const items: RawItem[] = [];
  for (const row of parse(html).querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td');
    const titleIndex = cells.findIndex(cell => cell.classList.contains('title'));
    if (titleIndex < 0) continue;
    const link = cells[titleIndex]!.querySelector('a[href]');
    const id = link?.getAttribute('href')?.match(/[?&]nttId=(\d+)/)?.[1];
    const title = clean(link?.text ?? '');
    const published = cells.slice(titleIndex + 1).map(cell => clean(cell.text)).find(isIsoDate);
    if (!id || !title || !published) continue;
    const department = clean(cells[titleIndex + 1]?.text ?? '');
    items.push({ id: `${source}:${id}`, source, title,
      url: `${ORIGIN}${boardPath(source)}/view.do?nttId=${id}&menuNo=${menuNo(source)}`,
      published, hints: department ? [department] : [], attachments: attachmentsIn(row) });
  }
  return items;
}

export function parseFssDetail(html: string): { text: string; attachments: Attachment[] } {
  const root = parse(html).querySelector('.krds-bd-view');
  if (!root) return { text: '', attachments: [] };
  return { text: clean(root.querySelector('.n-dbdata')?.structuredText ?? ''), attachments: attachmentsIn(root) };
}

async function collect(source: FssSource, ctx: CollectCtx): Promise<{ items: RawItem[] }> {
  const found: RawItem[] = [];
  const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
  for (let page = 1; page <= pages; page++) {
    const url = `${ORIGIN}${boardPath(source)}/list.do?menuNo=${menuNo(source)}&searchCnd=9&searchWrd=${encodeURIComponent('보험')}&pageIndex=${page}`;
    found.push(...parseFssList(await fetchText(url, { fetch: ctx.fetch }), source));
  }
  if (found.length === 0) throw new Error('금감원 목록에서 글을 찾지 못했습니다');
  const items = [...new Map(found.map(item => [item.id, item])).values()]
    .filter(item => source !== 'fss-alert' || ctx.config.keywords.insurance.some(word => item.title.includes(word)));
  for (const item of items) {
    if (ctx.seen.has(item.id)) continue;
    const detail = parseFssDetail(await fetchText(item.url, { fetch: ctx.fetch }));
    if (!detail.text && detail.attachments.length === 0) throw new Error('금감원 상세 본문을 찾지 못했습니다');
    item.attachments = [...new Map([...item.attachments, ...detail.attachments].map(file => [file.url, file])).values()];
    const pdf = detail.attachments.find(file => file.type === 'pdf') ?? item.attachments.find(file => file.type === 'pdf');
    const pdfText = pdf ? await fetchPdfText(pdf.url, ctx.pdfBudget, { fetch: ctx.fetch }) : null;
    ctx.putBody(item.id, [detail.text, pdfText].filter(Boolean).join('\n\n'));
  }
  return { items };
}

export const fssPress: Collector = { id: 'fss-press', run: ctx => collect('fss-press', ctx) };
export const fssAlert: Collector = { id: 'fss-alert', run: ctx => collect('fss-alert', ctx) };
