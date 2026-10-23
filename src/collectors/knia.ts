import { parse } from 'node-html-parser';
import { fetchText } from '../lib/http.ts';
import { fetchPdfText } from '../lib/pdf.ts';
import type { Attachment, RateRow, RawItem } from '../schema.ts';
import type { CollectCtx, Collector } from './types.ts';

const KNIA_ORIGIN = 'https://www.knia.or.kr';
export const KPUB_RATES_URL = 'https://kpub.knia.or.kr/carInsuranceDisc/adjustment/carAdjustmentCompare.do';
const BLOCK_MARK = '보안정책 위배';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 보안 장치가 막은 응답. 글 하나의 상세 실패와 달리 출처 전체를 실패로 본다. */
export class BlockedError extends Error {}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 첨부 이름 끝 확장자로 종류를 정한다. */
export function attachmentType(name: string): Attachment['type'] {
  const ext = /\.([a-z0-9]+)\s*$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp';
  return 'other';
}

async function fetchPage(url: string, ctx: CollectCtx): Promise<string> {
  const html = await fetchText(url, { fetch: ctx.fetch });
  if (html.includes(BLOCK_MARK)) throw new BlockedError(`손보협회 접속 차단됨(${BLOCK_MARK}): ${url}`);
  return html;
}

export function parseKniaList(html: string): RawItem[] {
  const items: RawItem[] = [];
  const ids = new Set<string>();
  for (const a of parse(html).querySelectorAll('td.title a')) {
    const n = /\/data\/news\/content\?index=(\d+)/.exec(a.getAttribute('href') ?? '')?.[1];
    if (!n || ids.has(n)) continue;
    const published = a.closest('tr')?.querySelectorAll('td').map(td => cleanText(td.text)).find(t => ISO_DATE.test(t));
    if (!published) continue;
    ids.add(n);
    items.push({
      id: `knia-press:${n}`,
      source: 'knia-press',
      title: cleanText(a.text),
      url: `${KNIA_ORIGIN}/data/news/content?index=${n}`,
      published,
      hints: [],
      attachments: [],
    });
  }
  return items;
}

export function parseKniaDetail(html: string): { text: string; attachments: Attachment[] } {
  const root = parse(html);
  const text = cleanText(root.querySelector('td.cont')?.text ?? '');
  const attachments: Attachment[] = [];
  for (const a of root.querySelectorAll('a.attach-file')) {
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('/file/download/')) continue;
    const name = cleanText(a.text);
    attachments.push({ name, url: new URL(href, KNIA_ORIGIN).href, type: attachmentType(name) });
  }
  return { text, attachments };
}

/** 공시표 행: 회사(th) | 종목 | 담보 6칸 | 전체 | 시행시기 YYYYMMDD | 조정사유. 빈 템플릿 행은 날짜 칸이 8자리 숫자가 아니라 걸러진다. */
export function parseKpubRates(html: string): RateRow[] {
  const rows: RateRow[] = [];
  for (const tr of parse(html).querySelectorAll('tr')) {
    const company = cleanText(tr.querySelector('th[scope="row"]')?.text ?? '');
    const tds = tr.querySelectorAll('td').map(td => cleanText(td.text));
    if (!company || tds.length < 4) continue;
    const date = tds[tds.length - 2];
    const totalText = tds[tds.length - 3];
    if (!/^\d{8}$/.test(date) || totalText === '') continue;
    const total = Number(totalText);
    if (!Number.isFinite(total)) continue;
    rows.push({
      company,
      kind: tds[0],
      total,
      effective: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      reason: tds[tds.length - 1],
    });
  }
  return rows;
}

export const kniaPress: Collector = {
  id: 'knia-press',
  async run(ctx) {
    const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
    const ids = new Set<string>();
    const items: RawItem[] = [];
    for (let page = 1; page <= pages; page++) {
      const url = page === 1 ? `${KNIA_ORIGIN}/data/news` : `${KNIA_ORIGIN}/data/news?page=${page}`;
      for (const item of parseKniaList(await fetchPage(url, ctx))) {
        if (ids.has(item.id)) continue;
        ids.add(item.id);
        items.push(item);
      }
    }

    // 본문은 비어 있고 PDF에만 있어서, 처음 보는 글만 상세와 PDF 하나를 받는다.
    const out: RawItem[] = [];
    for (const item of items) {
      if (ctx.seen.has(item.id)) {
        out.push(item);
        continue;
      }
      try {
        const detail = parseKniaDetail(await fetchPage(item.url, ctx));
        const pdf = detail.attachments.find(a => a.type === 'pdf');
        const pdfText = pdf ? await fetchPdfText(pdf.url, ctx.pdfBudget, { fetch: ctx.fetch }) : null;
        const body = [detail.text, pdfText].filter(Boolean).join('\n\n');
        if (body) ctx.putBody(item.id, body);
        out.push({ ...item, attachments: detail.attachments });
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        out.push(item);
      }
    }
    return { items: out };
  },
};

export const kniaRates: Collector = {
  id: 'knia-rates',
  async run(ctx) {
    const rates = parseKpubRates(await fetchPage(KPUB_RATES_URL, ctx));
    return { items: [], rates };
  },
};
