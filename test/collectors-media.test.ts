import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { COLLECTORS } from '../src/collectors/index.ts';
import {
  articleBody, chosun, donga, joongang, yna,
  parseChosunRss, parseDongaRss, parseJoongangList, parseYnaList, parseYnaRss,
} from '../src/collectors/media.ts';
import type { CollectCtx } from '../src/collectors/types.ts';
import { USER_AGENT } from '../src/lib/http.ts';
import { RawItem } from '../src/schema.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const hasInsurance = (item: RawItem) => loadConfig().keywords.insurance
  .some(word => item.title.toLowerCase().includes(word.toLowerCase()));

function context(fetch: typeof globalThis.fetch, seen = new Set<string>()) {
  const bodies: Record<string, string> = {};
  const writes: string[] = [];
  const ctx: CollectCtx = {
    fetch, now: new Date('2026-10-23T00:00:00Z'), date: '2026-10-23',
    config: loadConfig(), backfill: false, seen,
    putBody: (id, body) => { writes.push(id); bodies[id] = body; },
    pdfBudget: { left: 5, maxBytes: 5e6 },
  };
  return { ctx, bodies, writes };
}

test('일반 언론 RSS 3곳의 실제 기사와 KST 게시일, 절대 URL을 읽는다', () => {
  for (const [source, parseFeed] of [
    ['yna', parseYnaRss], ['chosun', parseChosunRss], ['donga', parseDongaRss],
  ] as const) {
    const { items, bodies } = parseFeed(fixture(`${source}-economy.xml`));
    assert.ok(items.length > 0);
    assert.deepEqual(Object.keys(bodies), items.map(item => item.id));
    for (const item of items) {
      RawItem.parse(item);
      assert.equal(item.source, source);
      assert.ok(item.id.startsWith(`${source}:`));
      assert.match(item.published, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new URL(item.url).protocol, 'https:');
      assert.doesNotMatch(bodies[item.id], /<[^>]+>/);
    }
    assert.equal(items[0].published, '2026-10-23');
  }
  const ynaItems = parseYnaRss(fixture('yna-economy.xml')).items;
  assert.ok(ynaItems.every(item => /^yna:AKR\d+$/.test(item.id)));
  const chosunItem = parseChosunRss(fixture('chosun-economy.xml')).items[0];
  assert.equal(chosunItem.id, `chosun:${new URL(chosunItem.url).pathname.split('/').filter(Boolean).at(-1)}`);
  assert.ok(parseDongaRss(fixture('donga-economy.xml')).items.every(item => /^donga:\d+$/.test(item.id)));
});

test('연합뉴스와 중앙일보 금융 목록에서 기사만 중복 없이 읽는다', () => {
  for (const [source, items] of [
    ['yna', parseYnaList(fixture('yna-finance.html'))],
    ['joongang', parseJoongangList(fixture('joongang-finance.html'))],
  ] as const) {
    assert.ok(items.length > 0);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    for (const item of items) {
      RawItem.parse(item);
      assert.equal(item.source, source);
      assert.equal(new URL(item.url).protocol, 'https:');
      assert.match(item.published, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.equal(items[0].published, '2026-10-23');
  }
  assert.ok(parseYnaList(fixture('yna-finance.html')).some(item => item.id === 'yna:AKR20261023069100002'));
  assert.ok(parseJoongangList(fixture('joongang-finance.html')).every(item => /^joongang:\d+$/.test(item.id)));
});

test('연합뉴스와 중앙일보 실제 기사 본문을 200자 이상 추출한다', () => {
  for (const source of ['yna', 'joongang'] as const) {
    const body = articleBody(fixture(`${source}-article.html`), source);
    assert.ok(body.length >= 200);
    assert.doesNotMatch(body, /<[^>]+>/);
  }
});

test('연합뉴스는 보험 제목만 남기고 RSS와 목록의 같은 기사를 한 번 반환한다', async () => {
  const requests: string[] = [];
  const expected = parseYnaRss(fixture('yna-economy.xml')).items.filter(hasInsurance);
  assert.ok(expected.some(item => item.title.includes('손해율')));
  const { ctx, bodies, writes } = context(async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    if (url === 'https://www.yna.co.kr/rss/economy.xml') return new Response(fixture('yna-economy.xml'));
    if (url === 'https://www.yna.co.kr/economy/finance') return new Response(fixture('yna-finance.html'));
    assert.fail(`이미 본 기사를 요청했습니다: ${url}`);
  }, new Set(expected.map(item => item.id)));
  const result = await yna.run(ctx);
  assert.deepEqual(result.items, expected);
  assert.ok(result.items.every(hasInsurance));
  assert.equal(requests.length, 2);
  assert.deepEqual(writes, []);
  assert.deepEqual(bodies, {});
});

test('연합뉴스는 새 기사의 실제 원문을 저장하고 이미 본 글은 상세 요청하지 않는다', async () => {
  const html = fixture('yna-article.html');
  const articleUrl = html.match(/<meta property="og:url" content="([^"]+)"/)![1];
  const item = parseYnaRss(fixture('yna-economy.xml')).items.find(item => item.url === articleUrl)!;
  assert.ok(item);
  const requests: string[] = [];
  const { ctx, bodies, writes } = context(async input => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://www.yna.co.kr/rss/economy.xml') return new Response(fixture('yna-economy.xml'));
    if (url === 'https://www.yna.co.kr/economy/finance') return new Response(fixture('yna-finance.html'));
    assert.equal(url, articleUrl);
    return new Response(html);
  });
  ctx.config.keywords.insurance = [item.title];
  assert.deepEqual((await yna.run(ctx)).items, [item]);
  assert.deepEqual(writes, [item.id]);
  assert.deepEqual(bodies, { [item.id]: articleBody(html, 'yna') });
  assert.equal(requests.length, 3);
  ctx.seen.add(item.id);
  requests.length = 0;
  writes.length = 0;
  await yna.run(ctx);
  assert.equal(requests.length, 2);
  assert.deepEqual(writes, []);
});

test('조선일보는 보험 기사만 남겨 RSS 본문을 저장하고 이미 본 글은 건너뛴다', async () => {
  const parsed = parseChosunRss(fixture('chosun-economy.xml'));
  const expected = parsed.items.filter(hasInsurance);
  assert.ok(expected.length > 0);
  const { ctx, bodies, writes } = context(async (input, init) => {
    assert.equal(String(input), 'https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml');
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    return new Response(fixture('chosun-economy.xml'));
  });
  assert.deepEqual((await chosun.run(ctx)).items, expected);
  assert.deepEqual(bodies, Object.fromEntries(expected.map(item => [item.id, parsed.bodies[item.id]])));
  expected.forEach(item => ctx.seen.add(item.id));
  writes.length = 0;
  await chosun.run(ctx);
  assert.deepEqual(writes, []);
});

test('동아일보는 보험 제목이 없는 실제 RSS에서 본문 요청 없이 빈 목록을 돌려준다', async () => {
  const { ctx, bodies } = context(async (input, init) => {
    assert.equal(String(input), 'https://rss.donga.com/economy.xml');
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    return new Response(fixture('donga-economy.xml'));
  });
  assert.deepEqual(await donga.run(ctx), { items: [], scanned: 50 });
  assert.deepEqual(bodies, {});
});

test('동아일보는 설정 키워드에 해당하는 새 글의 RSS description을 저장한다', async () => {
  const parsed = parseDongaRss(fixture('donga-economy.xml'));
  const { ctx, bodies, writes } = context(async input => {
    assert.equal(String(input), 'https://rss.donga.com/economy.xml');
    return new Response(fixture('donga-economy.xml'));
  }, new Set(parsed.items.slice(1).map(item => item.id)));
  ctx.config.keywords.insurance = [parsed.items[0].title];
  assert.deepEqual((await donga.run(ctx)).items, [parsed.items[0]]);
  assert.deepEqual(bodies, { [parsed.items[0].id]: parsed.bodies[parsed.items[0].id] });
  ctx.seen.add(parsed.items[0].id);
  writes.length = 0;
  await donga.run(ctx);
  assert.deepEqual(writes, []);
});

test('중앙일보는 보험 제목만 남기고 이미 본 글은 상세 요청하지 않는다', async () => {
  const expected = parseJoongangList(fixture('joongang-finance.html')).filter(hasInsurance);
  assert.ok(expected.length > 0);
  const requests: string[] = [];
  const { ctx, bodies, writes } = context(async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    assert.equal(url, 'https://www.joongang.co.kr/money/finance');
    return new Response(fixture('joongang-finance.html'));
  }, new Set(expected.map(item => item.id)));
  assert.deepEqual((await joongang.run(ctx)).items, expected);
  assert.deepEqual(writes, []);
  assert.deepEqual(bodies, {});
  assert.equal(requests.length, 1);
});

test('중앙일보는 설정 키워드에 해당하는 새 기사의 실제 원문을 저장한다', async () => {
  const html = fixture('joongang-article.html');
  const articleUrl = html.match(/<meta property="og:url" content="([^"]+)"/)![1];
  const item = parseJoongangList(fixture('joongang-finance.html')).find(item => item.url === articleUrl)!;
  assert.ok(item);
  const requests: string[] = [];
  const { ctx, bodies, writes } = context(async input => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://www.joongang.co.kr/money/finance') return new Response(fixture('joongang-finance.html'));
    assert.equal(url, articleUrl);
    return new Response(html);
  });
  ctx.config.keywords.insurance = [item.title];
  assert.deepEqual((await joongang.run(ctx)).items, [item]);
  assert.deepEqual(writes, [item.id]);
  assert.deepEqual(bodies, { [item.id]: articleBody(html, 'joongang') });
  assert.equal(requests.length, 2);
});

test('연합뉴스와 중앙일보 채우기는 지정된 페이지까지만 읽고 페이지 간 중복을 제거한다', async () => {
  for (const collector of [yna, joongang]) {
    const source = collector.id === 'yna' ? 'yna' : 'joongang';
    const requests: string[] = [];
    const { ctx, writes } = context(async input => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://www.yna.co.kr/rss/economy.xml') return new Response(fixture('yna-economy.xml'));
      const base = source === 'yna' ? 'https://www.yna.co.kr/economy/finance' : 'https://www.joongang.co.kr/money/finance';
      assert.ok(url.startsWith(`${base}?page=`));
      return new Response(fixture(`${source}-finance.html`));
    });
    ctx.backfill = true;
    ctx.config.limits.backfillPages = 2;
    const items = source === 'yna'
      ? [...parseYnaRss(fixture('yna-economy.xml')).items, ...parseYnaList(fixture('yna-finance.html'))]
      : parseJoongangList(fixture('joongang-finance.html'));
    items.forEach(item => ctx.seen.add(item.id));
    const result = await collector.run(ctx);
    assert.equal(new Set(result.items.map(item => item.id)).size, result.items.length);
    assert.ok(result.items.every(hasInsurance));
    assert.equal(requests.filter(url => url.includes('?page=')).length, 2);
    assert.ok(requests.some(url => url.endsWith('?page=1')));
    assert.ok(requests.some(url => url.endsWith('?page=2')));
    assert.deepEqual(writes, []);
  }
});

test('일반 언론 수집기는 HTTP 실패를 전달하고 파서는 구조 유실을 감지한다', async () => {
  for (const collector of [yna, chosun, donga, joongang]) {
    const { ctx } = context(async () => new Response('', { status: 503 }));
    await assert.rejects(collector.run(ctx), /503/);
  }
  for (const parseFeed of [parseYnaRss, parseChosunRss, parseDongaRss]) assert.throws(() => parseFeed(''));
  for (const parseList of [parseYnaList, parseJoongangList]) assert.throws(() => parseList(''));
  for (const source of ['yna', 'joongang'] as const) assert.throws(() => articleBody('', source));
});

test('일반 언론 4곳은 설정과 같은 순서로 수집기 목록에 등록된다', () => {
  assert.deepEqual(COLLECTORS.map(collector => collector.id), loadConfig().sources.map(source => source.id));
});
