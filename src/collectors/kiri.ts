import { parse } from 'node-html-parser';
import { fetchText } from '../lib/http.ts';
import { fetchPdfText } from '../lib/pdf.ts';
import type { Attachment, RawItem } from '../schema.ts';
import type { Collector } from './types.ts';
import { attachmentType, cleanText } from './knia.ts';

const KIRI_BASE = 'https://kiri.or.kr/community/';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseKiriList(html: string): RawItem[] {
  const items: RawItem[] = [];
  const ids = new Set<string>();
  for (const a of parse(html).querySelectorAll('table.list_tb td a')) {
    const n = /materialView\.do\?bid=(\d+)/.exec(a.getAttribute('href') ?? '')?.[1];
    if (!n || ids.has(n)) continue;
    const published = a.closest('tr')?.querySelectorAll('td').map(td => cleanText(td.text)).find(t => ISO_DATE.test(t));
    if (!published) continue;
    ids.add(n);
    items.push({
      id: `kiri:${n}`,
      source: 'kiri',
      title: cleanText(a.text),
      url: `${KIRI_BASE}materialView.do?bid=${n}`,
      published,
      hints: [],
      attachments: [],
    });
  }
  return items;
}

/** 상세 fixture가 없어 구조를 확인하지 못했다. 목록 페이지와 같은 본문 영역(.sub_cont)에서 글자와 첨부 링크를 뽑는다. */
export function parseKiriDetail(html: string): { text: string; attachments: Attachment[] } {
  const root = parse(html);
  const area = root.querySelector('.sub_cont') ?? root;
  const attachments: Attachment[] = [];
  const urls = new Set<string>();
  for (const a of area.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (!href.includes('boardDownloadFile.do')) continue;
    const url = new URL(href, KIRI_BASE).href;
    if (urls.has(url)) continue;
    urls.add(url);
    const img = a.querySelector('img');
    const name = cleanText(a.text) || cleanText(a.getAttribute('title') ?? '') || cleanText(img?.getAttribute('alt') ?? '');
    let type = attachmentType(name);
    if (type === 'other') {
      const icon = img?.getAttribute('src') ?? '';
      type = /icon_pdf/i.test(icon) ? 'pdf' : /icon_hwp/i.test(icon) ? 'hwp' : 'other';
    }
    attachments.push({ name, url, type });
  }
  for (const el of area.querySelectorAll('script, style, .breadcrumb, form')) el.remove();
  return { text: cleanText(area.text), attachments };
}

export const kiri: Collector = {
  id: 'kiri',
  async run(ctx) {
    const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
    const ids = new Set<string>();
    const items: RawItem[] = [];
    for (let page = 1; page <= pages; page++) {
      const url = page === 1 ? `${KIRI_BASE}materialList.do` : `${KIRI_BASE}materialList.do?tpcd=P01&page=${page}`;
      for (const item of parseKiriList(await fetchText(url, { fetch: ctx.fetch }))) {
        if (ids.has(item.id)) continue;
        ids.add(item.id);
        items.push(item);
      }
    }

    const out: RawItem[] = [];
    for (const item of items) {
      if (ctx.seen.has(item.id)) {
        out.push(item);
        continue;
      }
      try {
        const detail = parseKiriDetail(await fetchText(item.url, { fetch: ctx.fetch }));
        const pdf = detail.attachments.find(a => a.type === 'pdf');
        const pdfText = pdf ? await fetchPdfText(pdf.url, ctx.pdfBudget, { fetch: ctx.fetch }) : null;
        const body = [detail.text, pdfText].filter(Boolean).join('\n\n');
        if (body) ctx.putBody(item.id, body);
        out.push({ ...item, attachments: detail.attachments });
      } catch {
        out.push(item);
      }
    }
    return { items: out };
  },
};
