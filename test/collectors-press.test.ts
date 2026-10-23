import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import type { CollectCtx } from '../src/collectors/types.ts';
import { RawItem } from '../src/schema.ts';
import { USER_AGENT } from '../src/lib/http.ts';
import { articleText, fins, insjournal, insnews, insweek, parseNdsoftRss } from '../src/collectors/press.ts';
import { naver } from '../src/collectors/naver.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function context(fetch: typeof globalThis.fetch, seen = new Set<string>()) {
  const bodies: Record<string, string> = {};
  const ctx: CollectCtx = {
    fetch, now: new Date('2026-10-23T00:00:00Z'), date: '2026-10-23',
    config: loadConfig(), backfill: false, seen,
    putBody: (id, text) => { bodies[id] = text; }, pdfBudget: { left: 5, maxBytes: 5e6 },
  };
  return { ctx, bodies };
}

test('한국보험신문 RSS 50건의 ID와 게시일, 본문을 추출한다', () => {
  const { items, bodies } = parseNdsoftRss(fixture('insnews.xml'), 'insnews');
  assert.equal(items.length, 50);
  assert.deepEqual(Object.keys(bodies), items.map(item => item.id));
  assert.ok(Object.values(bodies).filter(text => text.length >= 100).length > 25);
  for (const item of items) {
    RawItem.parse(item);
    assert.match(item.id, /^insnews:\d+$/);
    assert.match(item.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotMatch(bodies[item.id], /<[^>]+>/);
  }
  assert.equal(items[0].published, '2026-10-23');
  assert.ok(items[0].hints.includes('보도자료'));
});

test('보험신보와 보험저널 RSS도 같은 파서로 읽는다', () => {
  for (const source of ['insweek', 'insjournal'] as const) {
    const { items, bodies } = parseNdsoftRss(fixture(`${source}.xml`), source);
    assert.equal(items.length, 50);
    for (const item of items) {
      RawItem.parse(item);
      assert.ok(item.id.startsWith(`${source}:`));
      assert.ok(bodies[item.id].length > 0);
    }
  }
});

test('보험매일 RSS의 한국 시각과 기사 본문을 읽는다', () => {
  const { items, bodies } = parseNdsoftRss(fixture('fins.xml'), 'fins');
  assert.ok(items.length >= 20);
  assert.equal(items[0].published, '2026-10-23');
  items.forEach(item => RawItem.parse(item));
  assert.ok(bodies[items[0].id].length > 100);
  const text = articleText(fixture('fins-article.html'));
  assert.ok(text.length >= 200);
  assert.doesNotMatch(text, /<[^>]+>/);
  assert.ok(text.includes('우리금융'));
});

test('전문지 RSS 수집기는 지정된 주소와 공통 UA를 쓰며 새 본문만 저장한다', async () => {
  for (const collector of [insnews, insweek, insjournal]) {
    const parsed = parseNdsoftRss(fixture(`${collector.id}.xml`), collector.id);
    const { ctx, bodies } = context(async (input, init) => {
      assert.equal(String(input), `https://cdn.${collector.id}.co.kr/rss/gn_rss_allArticle.xml`);
      assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
      return new Response(fixture(`${collector.id}.xml`));
    }, new Set(parsed.items.slice(1).map(item => item.id)));
    assert.deepEqual((await collector.run(ctx)).items, parsed.items);
    assert.deepEqual(bodies, { [parsed.items[0].id]: parsed.bodies[parsed.items[0].id] });
  }
});

test('보험매일은 새 기사만 상세 요청하고 RSS 요약 대신 전체 본문을 저장한다', async () => {
  const parsed = parseNdsoftRss(fixture('fins.xml'), 'fins');
  const requests: string[] = [];
  const { ctx, bodies } = context(async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    if (url === 'http://www.fins.co.kr/rss/allArticle.xml') return new Response(fixture('fins.xml'));
    assert.equal(url, parsed.items[0].url);
    return new Response(fixture('fins-article.html'));
  }, new Set(parsed.items.slice(1).map(item => item.id)));
  assert.deepEqual((await fins.run(ctx)).items, parsed.items);
  assert.equal(requests.length, 2);
  assert.deepEqual(bodies, { [parsed.items[0].id]: articleText(fixture('fins-article.html')) });
});

test('전문지 수집기는 HTTP 실패를 호출자에게 전달한다', async () => {
  for (const collector of [insnews, insweek, insjournal, fins]) {
    const { ctx } = context(async () => new Response('', { status: 503 }));
    await assert.rejects(collector.run(ctx), /503/);
  }
});

test('네이버는 인증 키 하나라도 없으면 요청 전에 키 없음 오류를 낸다', async t => {
  const savedId = process.env.NAVER_CLIENT_ID;
  const savedSecret = process.env.NAVER_CLIENT_SECRET;
  t.after(() => {
    if (savedId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = savedId;
    if (savedSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = savedSecret;
  });
  for (const missing of ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET']) {
    process.env.NAVER_CLIENT_ID = USER_AGENT;
    process.env.NAVER_CLIENT_SECRET = USER_AGENT;
    delete process.env[missing];
    const { ctx } = context(async () => { assert.fail('인증 키 없이 요청하면 안 됩니다'); });
    await assert.rejects(naver.run(ctx), { message: '키 없음' });
  }
});

test('네이버는 검색어와 인증 헤더를 보내고 원문 URL로 중복을 제거한다', async t => {
  const savedId = process.env.NAVER_CLIENT_ID;
  const savedSecret = process.env.NAVER_CLIENT_SECRET;
  t.after(() => {
    if (savedId === undefined) delete process.env.NAVER_CLIENT_ID;
    else process.env.NAVER_CLIENT_ID = savedId;
    if (savedSecret === undefined) delete process.env.NAVER_CLIENT_SECRET;
    else process.env.NAVER_CLIENT_SECRET = savedSecret;
  });
  process.env.NAVER_CLIENT_ID = USER_AGENT;
  process.env.NAVER_CLIENT_SECRET = USER_AGENT;
  const xml = fixture('insnews.xml');
  const parsed = parseNdsoftRss(xml, 'insnews');
  const article = parsed.items[0];
  const row = {
    title: article.title, originallink: article.url,
    description: parsed.bodies[article.id], pubDate: xml.match(/<pubDate>([^<]+)<\/pubDate>/)![1],
  };
  const { ctx, bodies } = context(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://openapi.naver.com/v1/search/news.json');
    assert.equal(url.searchParams.get('display'), '100');
    assert.equal(url.searchParams.get('sort'), 'date');
    for (const category of ['auto', 'medical', 'life'] as const) {
      assert.ok(url.searchParams.get('query')!.includes(ctx.config.keywords[category][0]));
    }
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Naver-Client-Id'), USER_AGENT);
    assert.equal(headers.get('X-Naver-Client-Secret'), USER_AGENT);
    assert.equal(headers.get('User-Agent'), USER_AGENT);
    return new Response(JSON.stringify({ items: [row, row] }));
  });
  const result = await naver.run(ctx);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  RawItem.parse(item);
  assert.equal(item.url, article.url);
  assert.equal(item.published, article.published);
  assert.deepEqual(bodies, { [item.id]: row.description });
  ctx.seen.add(item.id);
  delete bodies[item.id];
  assert.deepEqual(await naver.run(ctx), result);
  assert.deepEqual(bodies, {});
});
