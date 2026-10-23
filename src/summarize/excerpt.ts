// 요약 근거로 쓸 원문 발췌. 본문을 저장해 두지 못한 글은 페이지를 받아 앞부분을 잘라 쓴다.
import { parse } from 'node-html-parser';
import { fetchText, type FetchLike } from '../lib/http.ts';

export const EXCERPT_MAX = 1200;
/** 이보다 짧으면 메뉴·저작권 문구 정도로 보고 발췌로 쓰지 않는다 */
const MIN_EXCERPT = 40;

/** 본문 후보. 앞에 있는 것이 우선(전문지 → 금융위 → 일반 기사 구조) */
const CONTENT_SELECTORS = [
  '#article-view-content-div',
  '.board-view-wrap .body .cont',
  'article',
  'main',
  '#content',
  'body',
];

function squeeze(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** HTML에서 본문 앞부분을 max자까지 뽑는다. 쓸 만한 글이 없으면 null. */
export function extractExcerpt(html: string, max = EXCERPT_MAX): string | null {
  const root = parse(html.replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|tr|td)>/gi, ' '));
  for (const el of root.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe')) el.remove();
  for (const selector of CONTENT_SELECTORS) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const text = squeeze(el.text);
    if (text.length >= MIN_EXCERPT) return text.slice(0, max);
  }
  const meta = root.querySelector('meta[property="og:description"]') ?? root.querySelector('meta[name="description"]');
  const desc = squeeze(meta?.getAttribute('content') ?? '');
  return desc.length >= MIN_EXCERPT ? desc.slice(0, max) : null;
}

/** 페이지를 받아 발췌를 만든다. 실패하면 null(요약은 발췌 없이 진행). */
export async function fetchExcerpt(
  url: string,
  opts: { fetch?: FetchLike; timeoutMs?: number; max?: number } = {},
): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const html = await fetchText(url, { fetch: opts.fetch, timeoutMs: opts.timeoutMs });
    return extractExcerpt(html, opts.max ?? EXCERPT_MAX);
  } catch (e) {
    console.warn(`발췌 실패: ${url} (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}
