import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse } from 'node-html-parser';
import { addDays, isIsoDate, kstDate } from '../lib/dates.ts';
import { fetchText, HttpError, USER_AGENT } from '../lib/http.ts';
import { textOf } from '../lib/xml.ts';
import type { RawItem, SourceId } from '../schema.ts';
import type { ArchiveState } from '../store.ts';
import { fscPress, fscRule } from './fsc.ts';
import { fssPress, fssAlert } from './fss.ts';
import { kniaPress } from './knia.ts';
import { kliaPress } from './klia.ts';
import { articleBody } from './media.ts';
import type { CollectCtx } from './types.ts';

const DONGA_INDEX = 'https://image.donga.com/sitemap/donga-sitemap.xml';
const officials = [fscPress, fscRule, fssPress, fssAlert, kniaPress, kliaPress];
const parser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true,
  isArray: name => name === 'url' || name === 'sitemap',
});

function sitemap(xml: string, root: 'urlset' | 'sitemapindex') {
  if (XMLValidator.validate(xml) !== true) throw new Error('사이트맵 XML 형식을 확인할 수 없습니다.');
  const doc = parser.parse(xml);
  if (!Object.hasOwn(doc, root)) throw new Error('사이트맵 목록 구조를 찾을 수 없습니다.');
  return doc[root];
}

function clean(text: string): string {
  return parse(text).text.replace(/\s+/g, ' ').trim();
}

export function parseJoongangDaySitemap(xml: string): RawItem[] {
  const items = new Map<string, RawItem>();
  for (const row of sitemap(xml, 'urlset').url ?? []) {
    const url = textOf(row.loc);
    const id = url.match(/^https:\/\/www\.joongang\.co\.kr\/article\/(\d+)\/?$/)?.[1];
    if (!id) continue;
    const title = clean(textOf(row.news?.title));
    const timestamp = textOf(row.news?.publication_date);
    const date = new Date(timestamp);
    if (!title || Number.isNaN(date.getTime())) throw new Error('중앙일보 제목이나 게시일을 찾을 수 없습니다.');
    items.set(id, { id: `joongang:${id}`, source: 'joongang', title, url,
      published: kstDate(date), hints: [], attachments: [] });
  }
  return [...items.values()];
}

export function parseDongaSitemapIndex(xml: string): string[] {
  return [...new Set<string>((sitemap(xml, 'sitemapindex').sitemap ?? [])
    .map((row: { loc?: unknown }) => textOf(row.loc))
    .filter((url: string) => /^https:\/\/image\.donga\.com\/sitemap\/donga\/donga-sitemap-\d{6}-\d{6}\.xml\.gz$/.test(url)))];
}

function dongaLink(url: string): { id: string; published: string } | null {
  const match = url.match(/^https:\/\/www\.donga\.com\/news\/Economy\/article\/all\/(\d{4})(\d{2})(\d{2})\/(\d+)\/1\/?$/);
  if (!match) return null;
  const published = `${match[1]}-${match[2]}-${match[3]}`;
  return isIsoDate(published) ? { id: `donga:${match[4]}`, published } : null;
}

export function dongaEconomyUrls(xml: string, since: string): string[] {
  return [...new Set<string>((sitemap(xml, 'urlset').url ?? [])
    .map((row: { loc?: unknown }) => textOf(row.loc))
    .filter((url: string) => {
      const link = dongaLink(url);
      return link && link.published >= since;
    }))];
}

export function parseDongaArticle(html: string, url: string): { item: RawItem; body: string } | null {
  const link = dongaLink(url);
  if (!link) return null;
  const root = parse(html);
  const title = clean(root.querySelector('meta[property="og:title"]')?.getAttribute('content')
    ?? root.querySelector('h1, .title')?.text ?? '');
  const content = root.querySelector('section.news_view, #newsct_article, .article_txt, .article_view');
  if (!title || !content) return null;
  for (const node of content.querySelectorAll('script, style, iframe, figure, aside, .ad, [class*="view_ad"], .article_relation, .article_recommend')) node.remove();
  const body = clean(content.innerHTML.replace(/<br\b[^>]*>|<\/(?:p|div|li)>/gi, ' '));
  if (!body) return null;
  return { item: { ...link, source: 'donga', title, url, hints: [], attachments: [] }, body };
}

export async function runArchive(
  ctx: CollectCtx, initial: ArchiveState, opts: { deadline: number },
): Promise<{ items: RawItem[]; state: ArchiveState; notes: Record<string, string> }> {
  const state: ArchiveState = { ...initial, dongaCursor: initial.dongaCursor ? { ...initial.dongaCursor } : null };
  const items = new Map<string, RawItem>();
  const notes: Record<string, string> = {};
  const since = addDays(ctx.date, -ctx.config.limits.highlightsDays);
  const enabled = (id: SourceId) => ctx.config.sources.some(source => source.id === id && source.enabled
    && source.keyEnv.every(key => process.env[key]?.trim()));
  const hasTime = () => Date.now() < opts.deadline;
  if (!hasTime()) return { items: [], state, notes };

  const controller = new AbortController();
  const timeout = new Error('과거 기사 수집 제한 시간에 도달했습니다.');
  let active = true;
  let rejectDeadline: (reason: Error) => void;
  const expired = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    controller.abort(timeout);
    rejectDeadline(timeout);
  }, Math.min(opts.deadline - Date.now(), 2_147_483_647));
  const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, expired]);
  const archiveCtx: CollectCtx = {
    ...ctx, seen: new Set(ctx.seen),
    putBody(id, text) { if (active && hasTime()) ctx.putBody(id, text); },
    fetch: async (input, init) => {
      if (!active || !hasTime()) throw timeout;
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set('User-Agent', USER_AGENT);
      const signals = [controller.signal];
      if (input instanceof Request) signals.push(input.signal);
      if (init?.signal) signals.push(init.signal);
      return bounded(ctx.fetch(input, { ...init, headers, signal: AbortSignal.any(signals) }));
    },
  };
  const text = (url: string) => bounded(fetchText(url, { fetch: archiveCtx.fetch }));
  const keep = (item: RawItem) => {
    items.set(item.id, item);
    archiveCtx.seen.add(item.id);
  };
  const insured = (title: string) => ctx.config.keywords.insurance.some(word => title.toLowerCase().includes(word.toLowerCase()));
  const failure = (id: string, error: unknown) => { notes[id] = `과거 기사 수집 중단: ${error instanceof Error ? error.message : String(error)}`; };

  try {
    if (enabled('joongang')) {
      let day = state.joongangOldest ?? addDays(ctx.date, -1);
      state.joongangOldest = day;
      try {
        for (let count = 0; day >= since && count < ctx.config.limits.archiveJoongangDaysPerRun && hasTime(); count++) {
          const url = `https://www.joongang.co.kr/sitemap/articles/${day.slice(0, 4)}/${day.replaceAll('-', '')}`;
          const found = parseJoongangDaySitemap(await text(url)).filter(item => item.published >= since && item.published <= ctx.date && insured(item.title));
          for (const item of found) {
            if (!hasTime()) throw timeout;
            if (!archiveCtx.seen.has(item.id)) {
              const body = articleBody(await text(item.url), 'joongang');
              if (!hasTime()) throw timeout;
              archiveCtx.putBody(item.id, body);
            }
            keep(item);
          }
          day = addDays(day, -1);
          state.joongangOldest = day;
        }
        notes.joongang = day < since ? '과거 기사 채우기 완료: 중앙일보' : `과거 기사 채우는 중: 중앙 ${day}부터 재개`;
      } catch (error) { failure('joongang', error); }
    }

    if (enabled('donga') && !state.dongaDone && hasTime() && ctx.config.limits.archiveDongaArticlesPerRun > 0) {
      try {
        const files = parseDongaSitemapIndex(await text(DONGA_INDEX)).filter(file => {
          const range = file.match(/(\d{6})-(\d{6})\.xml\.gz$/)!;
          return range[2] >= since.replaceAll('-', '').slice(0, 6) && range[1] <= ctx.date.replaceAll('-', '').slice(0, 6);
        }).sort().reverse();
        const start = state.dongaCursor ? files.indexOf(state.dongaCursor.file) : 0;
        if (start < 0) throw new Error('저장된 동아일보 사이트맵을 목록에서 찾을 수 없습니다.');
        let scanned = 0;
        for (let fileIndex = start; fileIndex < files.length && hasTime(); fileIndex++) {
          const file = files[fileIndex];
          let index = state.dongaCursor?.file === file ? state.dongaCursor.index : 0;
          state.dongaCursor = { file, index };
          const response = await archiveCtx.fetch(file, { signal: AbortSignal.timeout(20_000) });
          if (!response.ok) throw new HttpError(response.status, file);
          const bytes = Buffer.from(await bounded(response.arrayBuffer()));
          const xml = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
          // 날짜 경계가 매일 바뀌어도 저장된 인덱스가 같은 주소를 가리키게 한다.
          const urls = dongaEconomyUrls(xml, '0001-01-01');
          for (; index < urls.length && scanned < ctx.config.limits.archiveDongaArticlesPerRun && hasTime(); index++) {
            const url = urls[index];
            const link = dongaLink(url)!;
            if (link.published >= since && link.published <= ctx.date && !archiveCtx.seen.has(link.id)) {
              scanned++;
              const html = await text(url);
              if (!hasTime()) throw timeout;
              const parsed = parseDongaArticle(html, url);
              if (!parsed) throw new Error('동아일보 기사 제목이나 본문을 찾을 수 없습니다.');
              if (insured(parsed.item.title)) {
                archiveCtx.putBody(parsed.item.id, parsed.body);
                keep(parsed.item);
              }
            }
            state.dongaCursor = { file, index: index + 1 };
          }
          if (index < urls.length) break;
          state.dongaCursor = files[fileIndex + 1] ? { file: files[fileIndex + 1], index: 0 } : null;
          if (!state.dongaCursor) state.dongaDone = true;
          if (scanned >= ctx.config.limits.archiveDongaArticlesPerRun) break;
        }
        if (files.length === 0) state.dongaDone = true;
        notes.donga = state.dongaDone ? '과거 기사 채우기 완료: 동아일보'
          : `과거 기사 채우는 중: 동아 ${state.dongaCursor?.file.split('/').at(-1)} ${state.dongaCursor?.index}번째부터 재개`;
      } catch (error) { failure('donga', error); }
    }

    if (!state.officialDone && hasTime()) {
      let complete = true;
      const config = { ...ctx.config, limits: { ...ctx.config.limits, backfillPages: ctx.config.limits.archiveOfficialPages } };
      for (const collector of officials) {
        if (!enabled(collector.id)) continue;
        if (!hasTime()) { complete = false; break; }
        try {
          const bodies: Record<string, string> = {};
          let collecting = true;
          try {
            const result = await bounded(collector.run({
              ...archiveCtx, config, backfill: true,
              putBody(id, body) { if (collecting && active && hasTime()) bodies[id] = body; },
            }));
            if (!hasTime()) throw timeout;
            for (const item of result.items.filter(item => item.published >= since && item.published <= ctx.date)) {
              if (Object.hasOwn(bodies, item.id)) archiveCtx.putBody(item.id, bodies[item.id]);
              keep(item);
            }
            notes[collector.id] = ['과거 기사 채우기 완료: 정부·협회', result.note].filter(Boolean).join(' / ');
          } finally { collecting = false; }
        } catch (error) { complete = false; failure(collector.id, error); }
      }
      state.officialDone = complete;
    }
  } finally {
    active = false;
    clearTimeout(timer);
    controller.abort();
  }
  return { items: [...items.values()], state, notes };
}
