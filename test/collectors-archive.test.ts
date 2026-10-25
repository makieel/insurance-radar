import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { loadConfig } from '../src/config.ts';
import {
  dongaEconomyUrls, parseDongaArticle, parseDongaSitemapIndex, parseJoongangDaySitemap, runArchive,
} from '../src/collectors/archive.ts';
import { parseFscList, parseFscRuleList } from '../src/collectors/fsc.ts';
import { parseFssList } from '../src/collectors/fss.ts';
import { parseKniaList } from '../src/collectors/knia.ts';
import { parseKliaList } from '../src/collectors/klia.ts';
import type { CollectCtx } from '../src/collectors/types.ts';
import { USER_AGENT } from '../src/lib/http.ts';
import { RawItem } from '../src/schema.ts';
import type { SourceId } from '../src/schema.ts';
import { ARCHIVE_STATE_PATH, DATA_DIR, readArchiveState } from '../src/store.ts';
import type { ArchiveState } from '../src/store.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const joongangXml = fixture('joongang-sitemap-20260315.xml');
const indexXml = fixture('donga-sitemap-index.xml');
const dongaXml = fixture('donga-sitemap-202603-head.xml');
const dongaHtml = fixture('donga-article.html');
const dongaFile = parseDongaSitemapIndex(indexXml).find(url => url.endsWith('202603-202604.xml.gz'))!;
const dongaUrls = dongaEconomyUrls(dongaXml, '2026-03-01');
const dongaUrl = dongaUrls[0];
const dongaArticle = parseDongaArticle(dongaHtml, dongaUrl)!;
const oneFileIndex = indexXml.replace(/<sitemap>[\s\S]*?<\/sitemap>/g, row => row.includes(dongaFile) ? row : '');

function state(overrides: Partial<ArchiveState> = {}): ArchiveState {
  return { joongangOldest: null, dongaCursor: null, dongaDone: true, officialDone: true, ...overrides };
}

function context(enabled: SourceId[], fetch: typeof globalThis.fetch) {
  const config = loadConfig();
  config.sources.forEach(source => { source.enabled = enabled.includes(source.id); });
  config.limits.archiveJoongangDaysPerRun = 1;
  const bodies: Record<string, string> = {};
  const ctx: CollectCtx = {
    fetch, now: new Date('2026-03-16T00:00:00Z'), date: '2026-03-16', config,
    backfill: false, seen: new Set(), putBody(id, text) { bodies[id] = text; },
    pdfBudget: { left: 0, maxBytes: config.limits.pdfMaxBytes },
  };
  return { ctx, bodies };
}

const run = (ctx: CollectCtx, initial = state()) => runArchive(ctx, initial, { deadline: Date.now() + 10_000 });

test('중앙일보 실제 날짜 사이트맵 121건과 게시일·고유 번호를 읽고 보험 제목을 거른다', async () => {
  const items = parseJoongangDaySitemap(joongangXml);
  assert.equal(items.length, 121);
  assert.equal(items[0].id, 'joongang:25411933');
  assert.equal(items[0].title, '패럴림픽 은퇴 무대에서 58㎞ 역주… 떠나는 철인 신의현');
  for (const item of items) {
    RawItem.parse(item);
    assert.equal(item.published, '2026-03-15');
    assert.equal(item.source, 'joongang');
  }
  assert.ok(items[1].title.includes("'팥붕'"));
  const { ctx, bodies } = context(['joongang'], async (input, init) => {
    assert.equal(String(input), 'https://www.joongang.co.kr/sitemap/articles/2026/20260315');
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    return new Response(joongangXml);
  });
  const expected = items.filter(item => ctx.config.keywords.insurance.some(word => item.title.toLowerCase().includes(word.toLowerCase())));
  assert.equal(expected.length, 0);
  assert.deepEqual((await run(ctx)).items, expected);
  assert.deepEqual(bodies, {});
});

test('중앙일보는 하루씩 커서를 전진시키고 이미 본 글의 본문과 입력 상태를 건드리지 않는다', async () => {
  const item = parseJoongangDaySitemap(joongangXml)[0];
  const requests: string[] = [];
  const { ctx, bodies } = context(['joongang'], async input => {
    requests.push(String(input));
    return new Response(joongangXml);
  });
  ctx.config.keywords.insurance = [item.title];
  ctx.seen.add(item.id);
  const initial = state();
  const result = await run(ctx, initial);
  assert.deepEqual(result.items, [item]);
  assert.equal(result.state.joongangOldest, '2026-03-14');
  assert.equal(initial.joongangOldest, null);
  assert.equal(requests.length, 1);
  assert.deepEqual(bodies, {});
  ctx.fetch = async input => {
    assert.equal(String(input), 'https://www.joongang.co.kr/sitemap/articles/2026/20260314');
    return new Response('', { status: 503 });
  };
  const retry = await run(ctx, result.state);
  assert.equal(retry.state.joongangOldest, '2026-03-14');
  assert.match(retry.notes.joongang, /503/);
});

test('중앙일보는 기간 경계 날짜까지 읽고 그 이전에는 요청하지 않는다', async () => {
  let requests = 0;
  const { ctx } = context(['joongang'], async () => { requests++; return new Response(joongangXml); });
  ctx.config.limits.highlightsDays = 1;
  const first = await run(ctx);
  assert.equal(first.state.joongangOldest, '2026-03-14');
  assert.match(first.notes.joongang, /완료/);
  await run(ctx, first.state);
  assert.equal(requests, 1);
});

test('이미 만료된 deadline은 요청과 상태 변경 없이 반환한다', async () => {
  const { ctx } = context(['joongang', 'donga'], async () => { assert.fail('제한 시간 뒤 요청'); });
  const initial = state({ dongaDone: false, officialDone: false });
  const result = await runArchive(ctx, initial, { deadline: Date.now() - 1 });
  assert.deepEqual(result, { items: [], state: initial, notes: {} });
});

test('중앙일보는 날짜를 읽던 중 deadline에 도달하면 그 날짜에서 재개한다', async t => {
  let time = Date.now();
  const deadline = time + 10_000;
  t.mock.method(Date, 'now', () => time);
  const { ctx, bodies } = context(['joongang'], async () => {
    time = deadline;
    return new Response(joongangXml);
  });
  ctx.config.keywords.insurance = [parseJoongangDaySitemap(joongangXml)[0].title];
  const result = await runArchive(ctx, state(), { deadline });
  assert.equal(result.state.joongangOldest, '2026-03-15');
  assert.deepEqual(result.items, []);
  assert.deepEqual(bodies, {});
  assert.match(result.notes.joongang, /제한 시간/);
});

test('동아일보 실제 목록 181개와 경제 기사 주소를 중복 없이 기간으로 거른다', () => {
  const files = parseDongaSitemapIndex(indexXml);
  assert.equal(files.length, 181);
  assert.ok(files.includes(dongaFile));
  assert.ok(files.every(url => url.startsWith('https://image.donga.com/sitemap/donga/') && url.endsWith('.xml.gz')));
  assert.equal(dongaUrls.length, 40);
  assert.equal(dongaUrl, 'https://www.donga.com/news/Economy/article/all/20260301/133441487/1');
  assert.equal(new Set(dongaUrls).size, dongaUrls.length);
  assert.ok(dongaUrls.every(url => url.includes('/Economy/article/all/202603')));
  const later = dongaEconomyUrls(dongaXml, '2026-03-02');
  assert.ok(later.length > 0 && later.length < dongaUrls.length);
  assert.ok(later.every(url => url.includes('/20260302/')));
  assert.deepEqual(dongaEconomyUrls(dongaXml, '2026-03-03'), []);
});

test('동아일보 실제 기사에서 제목·URL 날짜·본문을 읽는다', () => {
  RawItem.parse(dongaArticle.item);
  assert.equal(dongaArticle.item.id, 'donga:133441487');
  assert.equal(dongaArticle.item.published, '2026-03-01');
  assert.equal(dongaArticle.item.title, '“투자 문의에 밥 먹을 시간도 없어”…은행 ‘큰손’ 뭉칫돈도 증시로 몰린다');
  assert.ok(dongaArticle.body.length > 200);
  assert.match(dongaArticle.body, /고액 자산가/);
  assert.doesNotMatch(dongaArticle.body, /<[^>]+>|adstream_jx/);
  assert.equal(parseDongaArticle('', dongaUrl), null);
  assert.equal(parseDongaArticle(dongaHtml, 'https://www.donga.com/news/View'), null);
});

test('동아일보는 gzip을 풀고 실행당 기사 제한과 재개 커서를 지킨다', async () => {
  const requests: string[] = [];
  let concurrent = 0;
  let maximum = 0;
  const { ctx, bodies } = context(['donga'], async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    await Promise.resolve();
    concurrent--;
    if (url.endsWith('donga-sitemap.xml')) return new Response(oneFileIndex);
    if (url === dongaFile) return new Response(new Uint8Array(gzipSync(dongaXml)));
    assert.equal(url, dongaUrl);
    return new Response(dongaHtml);
  });
  ctx.config.limits.archiveDongaArticlesPerRun = 1;
  ctx.config.keywords.insurance = [dongaArticle.item.title];
  const initial = state({ dongaDone: false });
  const first = await run(ctx, initial);
  assert.deepEqual(first.items, [dongaArticle.item]);
  assert.deepEqual(first.state.dongaCursor, { file: dongaFile, index: 1 });
  assert.equal(first.state.dongaDone, false);
  assert.equal(initial.dongaCursor, null);
  assert.equal(requests.length, 3);
  assert.ok(maximum <= 4);
  assert.deepEqual(bodies, { [dongaArticle.item.id]: dongaArticle.body });
  dongaUrls.forEach(url => ctx.seen.add(`donga:${url.split('/').at(-2)}`));
  const second = await run(ctx, first.state);
  assert.equal(second.state.dongaDone, true);
  assert.equal(second.state.dongaCursor, null);
  assert.deepEqual(second.items, []);
  assert.equal(requests.length, 5);
});

test('동아일보는 기본 보험 키워드가 없는 기사를 버리고 일반 XML 응답도 읽는다', async () => {
  const { ctx, bodies } = context(['donga'], async input => {
    const url = String(input);
    if (url.endsWith('donga-sitemap.xml')) return new Response(oneFileIndex);
    if (url === dongaFile) return new Response(dongaXml);
    assert.equal(url, dongaUrl);
    return new Response(dongaHtml);
  });
  ctx.config.limits.archiveDongaArticlesPerRun = 1;
  const result = await run(ctx, state({ dongaDone: false }));
  assert.deepEqual(result.items, []);
  assert.deepEqual(bodies, {});
  assert.deepEqual(result.state.dongaCursor, { file: dongaFile, index: 1 });
});

test('동아일보는 기사 요청 실패와 deadline에 실패한 주소를 건너뛰지 않는다', async t => {
  let time = Date.now();
  const deadline = time + 10_000;
  t.mock.method(Date, 'now', () => time);
  let expire = false;
  const { ctx, bodies } = context(['donga'], async input => {
    const url = String(input);
    if (url.endsWith('donga-sitemap.xml')) return new Response(oneFileIndex);
    if (url === dongaFile) return new Response(dongaXml);
    assert.equal(url, dongaUrl);
    if (!expire) return new Response('', { status: 503 });
    time = deadline;
    return new Response(dongaHtml);
  });
  const first = await runArchive(ctx, state({ dongaDone: false }), { deadline });
  assert.deepEqual(first.state.dongaCursor, { file: dongaFile, index: 0 });
  assert.match(first.notes.donga, /503/);
  expire = true;
  const second = await runArchive(ctx, first.state, { deadline });
  assert.deepEqual(second.state.dongaCursor, first.state.dongaCursor);
  assert.equal(second.state.dongaDone, false);
  assert.deepEqual(second.items, []);
  assert.deepEqual(bodies, {});
  assert.match(second.notes.donga, /제한 시간/);
});

test('동아일보는 최신 파일부터 읽고 기간 밖 파일은 요청하지 않는다', async () => {
  const files: string[] = [];
  const { ctx } = context(['donga'], async input => {
    const url = String(input);
    if (url.endsWith('donga-sitemap.xml')) return new Response(indexXml);
    files.push(url);
    return new Response(dongaXml);
  });
  ctx.date = '2026-10-25';
  ctx.config.limits.highlightsDays = 1;
  const result = await run(ctx, state({ dongaDone: false }));
  assert.deepEqual(files, [parseDongaSitemapIndex(indexXml).at(-1)]);
  assert.equal(result.state.dongaDone, true);
});

test('응답이 멈춰도 deadline에 중단하고 요청 신호를 취소한다', async () => {
  let signal: AbortSignal | undefined;
  const { ctx } = context(['joongang'], async (_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  const result = await runArchive(ctx, state(), { deadline: Date.now() + 30 });
  assert.equal(signal?.aborted, true);
  assert.equal(result.state.joongangOldest, '2026-03-15');
  assert.match(result.notes.joongang, /제한 시간/);
});

const officialItems = [
  ...parseFscList(fixture('fsc-list.html')), ...parseFscRuleList(fixture('fsc-rule-list.html')),
  ...parseFssList(fixture('fss-list.html'), 'fss-press'),
  ...parseFssList(fixture('fss-alert-list.html'), 'fss-alert'),
  ...parseKniaList(fixture('knia-news.html')), ...parseKliaList(fixture('klia-list.html')),
];
const officialIds: SourceId[] = ['fsc-press', 'fsc-rule', 'fss-press', 'fss-alert', 'knia-press', 'klia-press'];

function officialFetch(requests: string[]): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.href);
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    if (url.pathname.includes('fsc_bbs_rss')) return new Response('', { status: 503 });
    const files: Record<string, string> = {
      '/no010101': 'fsc-list.html', '/po040301': 'fsc-rule-list.html',
      '/fss/bbs/B0000188/list.do': 'fss-list.html', '/fss/bbs/B0000175/list.do': 'fss-alert-list.html',
      '/data/news': 'knia-news.html', '/board/2/list.do': 'klia-list.html',
    };
    assert.ok(files[url.pathname], `예상하지 않은 상세 요청: ${url}`);
    return new Response(fixture(files[url.pathname]));
  };
}

test('정부·협회 6곳을 지정 쪽수로 한 번 채우고 기간 필터와 officialDone을 기록한다', async () => {
  const requests: string[] = [];
  const { ctx, bodies } = context(officialIds, officialFetch(requests));
  ctx.date = '2026-10-23';
  ctx.config.limits.highlightsDays = 1;
  ctx.config.limits.archiveOfficialPages = 2;
  officialItems.forEach(item => ctx.seen.add(item.id));
  const originalConfig = structuredClone(ctx.config);
  const result = await run(ctx, state({ officialDone: false }));
  const expected = officialItems.filter(item => item.published >= '2026-10-22' && item.published <= ctx.date)
    .filter(item => item.source !== 'fss-alert' || ctx.config.keywords.insurance.some(word => item.title.includes(word)));
  assert.deepEqual(result.items.map(item => item.id).sort(), expected.map(item => item.id).sort());
  assert.ok(result.items.length < officialItems.length);
  assert.equal(result.state.officialDone, true);
  assert.equal(requests.length, 15);
  for (const parameter of ['curPage=2', 'pageIndex=2', 'page=2']) assert.ok(requests.some(url => url.includes(parameter)));
  assert.deepEqual(ctx.config, originalConfig);
  assert.deepEqual(bodies, {});
  for (const id of officialIds) assert.match(result.notes[id], /완료/);
  await run(ctx, result.state);
  assert.equal(requests.length, 15);
});

test('한 출처의 실패가 다른 정부·협회 출처를 막지 않고 officialDone은 재시도를 허용한다', async () => {
  const requests: string[] = [];
  const fetchOfficial = officialFetch(requests);
  const { ctx } = context(['joongang', ...officialIds], async (input, init) => {
    const url = String(input);
    if (url.includes('joongang.co.kr') || url.includes('/po040301')) return new Response('', { status: 503 });
    return fetchOfficial(input, init);
  });
  ctx.date = '2026-10-23';
  ctx.config.limits.archiveOfficialPages = 1;
  officialItems.forEach(item => ctx.seen.add(item.id));
  const result = await run(ctx, state({ officialDone: false }));
  assert.match(result.notes.joongang, /503/);
  assert.match(result.notes['fsc-rule'], /503/);
  assert.match(result.notes['klia-press'], /완료/);
  assert.equal(result.state.officialDone, false);
  assert.ok(result.items.some(item => item.source === 'klia-press'));
});

test('정부·협회가 deadline으로 중단되면 완료 표시를 하지 않는다', async () => {
  const { ctx, bodies } = context(officialIds, async () => new Promise<Response>(() => {}));
  const result = await runArchive(ctx, state({ officialDone: false }), { deadline: Date.now() + 30 });
  assert.equal(result.state.officialDone, false);
  assert.match(result.notes['fsc-press'], /제한 시간/);
  assert.deepEqual(result.items, []);
  assert.deepEqual(bodies, {});
});

test('구조가 유실된 사이트맵을 정상적인 빈 결과로 처리하지 않는다', () => {
  for (const parser of [parseJoongangDaySitemap, parseDongaSitemapIndex]) assert.throws(() => parser(''), /사이트맵/);
  assert.throws(() => dongaEconomyUrls('', '2026-03-01'), /사이트맵/);
});

test('과거 수집 상태는 data 아래 별도 파일과 초기값을 사용한다', { skip: existsSync(ARCHIVE_STATE_PATH) }, () => {
  assert.equal(ARCHIVE_STATE_PATH, `${DATA_DIR}archive-state.json`);
  assert.deepEqual(readArchiveState(), state({ dongaDone: false, officialDone: false }));
});
