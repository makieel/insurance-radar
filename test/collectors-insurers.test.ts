import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { RawItem } from '../src/schema.ts';
import type { CollectCtx, Collector } from '../src/collectors/types.ts';
import { USER_AGENT } from '../src/lib/http.ts';
import {
  hanwha, kyobo, samsungfire, meritz, parseHanwhaList, parseKyoboFeed,
  parseSamsungfireList, parseMeritzList, parseMeritzDetail,
} from '../src/collectors/insurers.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

function context(fetch: typeof globalThis.fetch, seen = new Set<string>()) {
  const bodies: Record<string, string> = {};
  const ctx: CollectCtx = {
    fetch, now: new Date('2026-10-23T00:00:00Z'), date: '2026-10-23',
    config: loadConfig(), backfill: false, seen,
    putBody: (id, text) => { bodies[id] = text; }, pdfBudget: { left: 5, maxBytes: 5e6 },
  };
  return { ctx, bodies };
}

test('한화 목록의 고유 번호와 게시일, 원문 주소를 보존한다', () => {
  const data = json('hanwha-list.json');
  const items = parseHanwhaList(data);
  assert.ok(items.length >= 1);
  for (const [index, item] of items.entries()) {
    RawItem.parse(item);
    assert.equal(item.id, `hanwha:${data.items[index].seq}`);
    assert.equal(item.url, `https://company.hanwhalife.com/ko/about/company-overview/newsroom/press/${data.items[index].seq}`);
  }
  assert.equal(items[0].published, '2026-10-20');
});

test('교보 RSS에서 보도자료만 추출하고 본문 키를 항목과 맞춘다', () => {
  const { items, bodies } = parseKyoboFeed(fixture('kyobo-feed.xml'));
  assert.ok(items.length > 0);
  assert.deepEqual(Object.keys(bodies), items.map(item => item.id));
  for (const item of items) {
    RawItem.parse(item);
    assert.match(item.id, /^kyobo:\d+$/);
    assert.ok(item.hints.includes('보도자료'));
    assert.ok(bodies[item.id].length > 100);
    assert.doesNotMatch(bodies[item.id], /<[^>]+>/);
    assert.ok(!item.url.includes('utm_'));
  }
});

test('삼성화재 목록에 실린 본문에서 HTML을 제거하고 게시일을 읽는다', () => {
  const { items, bodies } = parseSamsungfireList(json('samsungfire-list.json'));
  assert.ok(items.length >= 10);
  assert.equal(items[0].published, '2026-10-19');
  assert.deepEqual(Object.keys(bodies), items.map(item => item.id));
  for (const item of items) {
    RawItem.parse(item);
    assert.match(item.id, /^samsungfire:\d+$/);
    assert.ok(bodies[item.id].length > 100);
    assert.doesNotMatch(bodies[item.id], /<[^>]+>/);
  }
});

test('메리츠 목록과 상세 JSON에서 항목과 본문을 읽는다', () => {
  const items = parseMeritzList(json('meritz-list.json'));
  assert.ok(items.length >= 1);
  items.forEach(item => RawItem.parse(item));
  assert.equal(items[0].id, 'meritz:23505');
  assert.equal(items[0].published, '2026-08-12');
  const text = parseMeritzDetail(json('meritz-detail.json'));
  assert.ok(text.length >= 100);
  assert.doesNotMatch(text, /<[^>]+>/);
});

test('한화 수집기는 POST 목록 뒤 처음 보는 글만 상세 요청한다', async () => {
  const items = parseHanwhaList(json('hanwha-list.json'));
  const requests: string[] = [];
  const { ctx, bodies } = context(async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    if (url.endsWith('/press-releases')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { page: 1, size: 9, category: 'PRESS_RELEASE' });
      return new Response(fixture('hanwha-list.json'));
    }
    assert.ok(url.endsWith('/press-releases/3567'));
    return new Response(fixture('hanwha-detail.json'));
  }, new Set(items.slice(1).map(item => item.id)));
  assert.deepEqual((await hanwha.run(ctx)).items, items);
  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(bodies), [items[0].id]);
  assert.ok(bodies[items[0].id].length > 100);
});

test('삼성화재 수집기는 실제 form 형식을 보내고 새 본문만 저장한다', async () => {
  const parsed = parseSamsungfireList(json('samsungfire-list.json'));
  const { ctx, bodies } = context(async (input, init) => {
    assert.equal(String(input), 'https://www.samsungfire.com/vh/data/VH.HDBS0101.do');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    const form = new URLSearchParams(String(init?.body));
    assert.equal(JSON.parse(form.get('header')!).tranId, 'VH.HDBS0101');
    assert.deepEqual(JSON.parse(form.get('body')!), { BBS_ID: '00000015', CUR_PAGE: '1', SEARCH_CD: '02', SEARCH_WORD: '' });
    return new Response(fixture('samsungfire-list.json'));
  }, new Set(parsed.items.slice(1).map(item => item.id)));
  assert.deepEqual((await samsungfire.run(ctx)).items, parsed.items);
  assert.deepEqual(bodies, { [parsed.items[0].id]: parsed.bodies[parsed.items[0].id] });
});

test('메리츠 수집기는 목록과 새 글 상세에 맞는 서비스를 호출한다', async () => {
  const items = parseMeritzList(json('meritz-list.json'));
  const services: string[] = [];
  const { ctx, bodies } = context(async (input, init) => {
    assert.equal(String(input), 'https://www.meritzfire.com/json.smart');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    const { header, body } = JSON.parse(String(init?.body));
    services.push(header.rcvmsgSrvId);
    assert.equal(body.bbsType, '415');
    assert.equal(body.chnDivCd, 'W');
    assert.equal(body.pageNo, 1);
    assert.equal(body.pageSize, 10);
    if (header.rcvmsgSrvId.endsWith('retrieveNewsLst')) return new Response(fixture('meritz-list.json'));
    assert.equal(body.seq, 23505);
    return new Response(fixture('meritz-detail.json'));
  }, new Set(items.slice(1).map(item => item.id)));
  assert.deepEqual((await meritz.run(ctx)).items, items);
  assert.deepEqual(services, ['f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsLst', 'f.cg.he.cm.mi.o.bc.NewsBc.retrieveNewsRead']);
  assert.deepEqual(bodies, { [items[0].id]: parseMeritzDetail(json('meritz-detail.json')) });
});

test('교보 수집기는 RSS 본문 중 새 글만 저장한다', async () => {
  const parsed = parseKyoboFeed(fixture('kyobo-feed.xml'));
  const { ctx, bodies } = context(async input => {
    assert.equal(String(input), 'https://news.kyobo.com/feed/');
    return new Response(fixture('kyobo-feed.xml'));
  }, new Set(parsed.items.slice(1).map(item => item.id)));
  assert.deepEqual((await kyobo.run(ctx)).items, parsed.items);
  assert.deepEqual(bodies, { [parsed.items[0].id]: parsed.bodies[parsed.items[0].id] });
});

test('채우기에서 보험사 페이지를 순회하고 반복 항목의 상세를 중복 요청하지 않는다', async () => {
  for (const [collector, file, parse] of [
    [hanwha, 'hanwha-list.json', parseHanwhaList],
    [samsungfire, 'samsungfire-list.json', (data: unknown) => parseSamsungfireList(data).items],
    [meritz, 'meritz-list.json', parseMeritzList],
  ] as const) {
    const items = parse(json(file));
    const pages: number[] = [];
    let details = 0;
    const { ctx } = context(async (input, init) => {
      if (String(input).endsWith('/press-releases/3567')) {
        details++;
        return new Response(fixture('hanwha-detail.json'));
      }
      const raw = String(init?.body);
      const body = collector.id === 'samsungfire'
        ? JSON.parse(new URLSearchParams(raw).get('body')!) : JSON.parse(raw);
      if (body.header?.rcvmsgSrvId.endsWith('retrieveNewsRead')) {
        details++;
        return new Response(fixture('meritz-detail.json'));
      }
      pages.push(Number(body.page ?? body.CUR_PAGE ?? body.body.pageNo));
      return new Response(fixture(file));
    }, new Set(items.slice(1).map(item => item.id)));
    const stored: string[] = [];
    ctx.putBody = id => { stored.push(id); };
    ctx.backfill = true;
    ctx.config.limits.backfillPages = 2;
    assert.deepEqual((await collector.run(ctx)).items, items);
    assert.deepEqual(pages, [1, 2]);
    assert.deepEqual(stored, [items[0].id]);
    assert.equal(details, collector.id === 'samsungfire' ? 0 : 1);
  }
});

test('보험사 수집기는 HTTP 실패를 호출자에게 전달한다', async () => {
  for (const collector of [hanwha, kyobo, samsungfire, meritz] satisfies Collector[]) {
    const { ctx } = context(async () => new Response('', { status: 503 }));
    await assert.rejects(collector.run(ctx), /503/);
  }
});
