import { parse } from 'node-html-parser';
import { fetchText } from '../lib/http.ts';
import { fetchPdfText } from '../lib/pdf.ts';
import type { Attachment, RawItem } from '../schema.ts';
import type { Collector } from './types.ts';
import { attachmentType, cleanText } from './knia.ts';

const KLIA_ORIGIN = 'https://www.klia.or.kr';
const LIST_URL = `${KLIA_ORIGIN}/board/2/list.do`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseKliaList(html: string): RawItem[] {
  const items: RawItem[] = [];
  const ids = new Set<string>();
  for (const tr of parse(html).querySelectorAll('table.board_list_table tr')) {
    const tds = tr.querySelectorAll('td');
    // 고정글은 번호 칸에 숫자 대신 "공지" 같은 표시가 온다.
    if (!tds.length || !/^\d+$/.test(cleanText(tds[0].text))) continue;
    const a = tr.querySelector('td.title a');
    const n = /fn_goView\(\s*'(\d+)'/.exec(a?.getAttribute('onclick') ?? '')?.[1];
    const published = tds.map(td => cleanText(td.text)).find(t => ISO_DATE.test(t));
    if (!a || !n || !published || ids.has(n)) continue;
    ids.add(n);
    items.push({
      id: `klia-press:${n}`,
      source: 'klia-press',
      title: cleanText(a.text).replace(/^\[보도자료\]\s*/, ''),
      url: `${KLIA_ORIGIN}/board/2/view.do?boardNo=${n}&boardMngNo=2&seq=1`,
      published,
      hints: [],
      attachments: [],
    });
  }
  return items;
}

export function parseKliaDetail(html: string): { text: string; attachments: Attachment[] } {
  const root = parse(html);
  const text = cleanText(root.querySelector('.board_view_contents')?.text ?? '');
  const attachments: Attachment[] = [];
  for (const a of root.querySelectorAll('.attach_file a')) {
    const href = a.getAttribute('href') ?? '';
    // 첨부 링크는 href 대신 onclick="gfn_fileDown('파일번호','순번')"으로 걸려 있다.
    const m = /gfn_fileDown\(\s*'(\d+)'\s*,\s*'(\d+)'/.exec(a.getAttribute('onclick') ?? '');
    const path = href.includes('FileDown.do') ? href : m ? `/FileDown.do?fileNo=${m[1]}&seq=${m[2]}` : null;
    if (!path) continue;
    const name = cleanText(a.text);
    attachments.push({ name, url: new URL(path, KLIA_ORIGIN).href, type: attachmentType(name) });
  }
  return { text, attachments };
}

export const kliaPress: Collector = {
  id: 'klia-press',
  async run(ctx) {
    const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
    const ids = new Set<string>();
    const items: RawItem[] = [];
    for (let page = 1; page <= pages; page++) {
      const url = page === 1 ? LIST_URL : `${LIST_URL}?pageIndex=${page}`;
      for (const item of parseKliaList(await fetchText(url, { fetch: ctx.fetch }))) {
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
        const detail = parseKliaDetail(await fetchText(item.url, { fetch: ctx.fetch }));
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
