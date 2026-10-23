import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { USER_AGENT } from '../src/lib/http.ts';
import { RawItem } from '../src/schema.ts';
import type { CollectCtx } from '../src/collectors/types.ts';
import { fscPress, fscRule, parseFscList, parseFscDetail, parseFscRuleList } from '../src/collectors/fsc.ts';
import { fssPress, fssAlert, parseFssList, parseFssDetail } from '../src/collectors/fss.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function makeCtx(fetch: typeof globalThis.fetch): CollectCtx & { bodies: Map<string, string> } {
  const bodies = new Map<string, string>();
  return {
    fetch, now: new Date('2026-10-23T00:00:00+09:00'), date: '2026-10-23',
    config: loadConfig(), backfill: false, seen: new Set(), bodies,
    putBody: (id, text) => { bodies.set(id, text); },
    pdfBudget: { left: 5, maxBytes: 5e6 },
  };
}

function fakeFetch(handler: (url: URL) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    assert.ok(!init?.method || init.method === 'GET');
    return handler(new URL(input instanceof Request ? input.url : String(input)));
  };
}

test('금융위 목록은 제목 속성, 부서, 게시일과 고정 ID를 추출한다', () => {
  const items = parseFscList(fixture('fsc-list.html'));
  assert.ok(items.length >= 20);
  for (const item of items) {
    RawItem.parse(item);
    assert.match(item.id, /^fsc-press:\d+$/);
    assert.equal(item.url, `https://www.fsc.go.kr/no010101/${item.id.split(':')[1]}`);
  }
  assert.ok(items.some(item => item.hints.includes('보험과')));
  assert.match(items.find(item => item.id === 'fsc-press:87217')!.title, /판매수수료/);
});

test('금융위 상세는 연도 없는 시행 문구와 중복 없는 첨부를 보존한다', () => {
  const detail = parseFscDetail(fixture('fsc-detail-87217.html'));
  assert.ok(detail.text.includes('7.1일부터 시행'));
  assert.ok(detail.attachments.some(file => file.type === 'pdf'));
  assert.ok(detail.attachments.some(file => file.type === 'hwp'));
  assert.equal(new Set(detail.attachments.map(file => file.url)).size, detail.attachments.length);
  assert.ok(detail.attachments.every(file => file.url.startsWith('https://www.fsc.go.kr/comm/getFile?')));
  assert.ok(!detail.text.includes('주메뉴 바로가기'));
});

test('금융위 규정예고는 구분과 예고기간 원문 및 시작일을 추출한다', () => {
  const items = parseFscRuleList(fixture('fsc-rule-list.html'));
  items.forEach(item => RawItem.parse(item));
  const item = items.find(item => item.id === 'fsc-rule:4171')!;
  assert.equal(item.url, 'https://www.fsc.go.kr/po040301/view?noticeId=4171');
  assert.equal(item.published, '2026-09-11');
  assert.ok(item.hints.includes('규정변경예고'));
  assert.ok(item.hints.includes('예고기간 : 2026-09-11 ~ 2026-09-21'));
  const detail = parseFscDetail(fixture('fsc-rule-detail-4171.html'));
  assert.match(detail.text, /개정 이유/);
  assert.ok(detail.attachments.some(file => file.type === 'pdf'));
});

test('금감원 목록은 부서와 날짜를 추출하고 절대 주소를 만든다', () => {
  const items = parseFssList(fixture('fss-list.html'), 'fss-press');
  assert.ok(items.length >= 5);
  for (const item of items) {
    RawItem.parse(item);
    assert.match(item.id, /^fss-press:\d+$/);
    assert.equal(item.url, `https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=${item.id.split(':')[1]}&menuNo=200218`);
    assert.ok(item.hints.length > 0);
  }
  const item = items.find(item => item.id === 'fss-press:226318');
  if (item) assert.match(item.title, /자동차보험/);
});

test('금감원 상세는 시행일 요약과 확장자별 첨부를 추출한다', () => {
  const detail = parseFssDetail(fixture('fss-detail-226318.html'));
  assert.ok(detail.text.includes("'26.9.10."));
  assert.ok(detail.attachments.some(file => file.type === 'pdf'));
  assert.ok(detail.attachments.some(file => file.type === 'hwp'));
  assert.equal(new Set(detail.attachments.map(file => file.url)).size, detail.attachments.length);
  assert.ok(detail.attachments.every(file => !file.name.includes('파일크기')));
  assert.ok(!detail.text.includes('주메뉴 바로가기'));
});

test('금융위 RSS 503은 두 목록을 합치고 신규 글만 본문을 저장한다', async () => {
  const list = fixture('fsc-list.html');
  const items = parseFscList(list);
  const requests: URL[] = [];
  const ctx = makeCtx(fakeFetch(url => {
    requests.push(url);
    if (url.pathname.includes('fsc_bbs_rss')) return new Response(null, { status: 503 });
    if (url.pathname === '/no010101') return new Response(list);
    if (url.pathname === '/no010101/87217') return new Response(fixture('fsc-detail-87217.html'));
    if (url.pathname === '/no010101/87952') return new Response(fixture('fsc-detail-87952.html'));
    if (url.pathname === '/comm/getFile') return new Response(null, { status: 503 });
    assert.fail(`예상하지 못한 요청: ${url}`);
  }));
  ctx.seen = new Set(items.filter(item => !['fsc-press:87217', 'fsc-press:87952'].includes(item.id)).map(item => item.id));
  const result = await fscPress.run(ctx);
  assert.equal(result.note, 'RSS 점검 중(503) → 목록 페이지로 수집');
  assert.equal(result.items.length, items.length);
  assert.equal(new Set(result.items.map(item => item.id)).size, result.items.length);
  assert.deepEqual([...ctx.bodies.keys()].sort(), ['fsc-press:87217', 'fsc-press:87952']);
  assert.match(ctx.bodies.get('fsc-press:87217')!, /7\.1일부터 시행/);
  assert.equal(requests.filter(url => /^\/no010101\/\d+$/.test(url.pathname)).length, 2);
  const lists = requests.filter(url => url.pathname === '/no010101');
  assert.equal(lists.length, 2);
  assert.deepEqual(lists.map(url => url.searchParams.get('srchKey')).sort(), ['dept', 'sj']);
  assert.deepEqual(lists.map(url => url.searchParams.get('srchText')).sort(), ['보험', '보험과']);
  assert.ok(lists.every(url => url.searchParams.get('cntPerPage') === '50'));
});

test('금융위 채우기는 설정된 쪽까지 조회하고 중복 상세를 요청하지 않는다', async () => {
  const list = fixture('fsc-list.html');
  const pages: string[] = [];
  const ctx = makeCtx(fakeFetch(url => {
    if (url.pathname.includes('fsc_bbs_rss')) return new Response(null, { status: 503 });
    assert.equal(url.pathname, '/no010101');
    pages.push(url.searchParams.get('curPage')!);
    return new Response(list);
  }));
  ctx.backfill = true;
  ctx.config.limits.backfillPages = 2;
  ctx.seen = new Set(parseFscList(list).map(item => item.id));
  const result = await fscPress.run(ctx);
  assert.deepEqual(pages.sort(), ['1', '1', '2', '2']);
  assert.equal(result.items.length, ctx.seen.size);
  assert.equal(ctx.bodies.size, 0);
});

test('금융위 규정예고 수집기는 신규 예고의 상세 본문을 저장한다', async () => {
  const list = fixture('fsc-rule-list.html');
  const ctx = makeCtx(fakeFetch(url => {
    if (url.pathname === '/po040301') {
      assert.equal(url.searchParams.get('srchText'), '보험');
      return new Response(list);
    }
    if (url.pathname === '/po040301/view') {
      assert.equal(url.searchParams.get('noticeId'), '4171');
      return new Response(fixture('fsc-rule-detail-4171.html'));
    }
    if (url.pathname === '/comm/getFile') return new Response(null, { status: 503 });
    assert.fail(`예상하지 못한 요청: ${url}`);
  }));
  ctx.seen = new Set(parseFscRuleList(list).filter(item => item.id !== 'fsc-rule:4171').map(item => item.id));
  const result = await fscRule.run(ctx);
  assert.ok(result.items.find(item => item.id === 'fsc-rule:4171')!.attachments.some(file => file.type === 'pdf'));
  assert.deepEqual([...ctx.bodies.keys()], ['fsc-rule:4171']);
  assert.match(ctx.bodies.get('fsc-rule:4171')!, /개정 이유/);
});

test('금감원 수집기는 신규 글마다 PDF 하나를 받아 본문에 붙인다', async () => {
  const list = fixture('fss-list.html');
  const items = parseFssList(list, 'fss-press');
  const fresh = items[0]!;
  const pdf = readFileSync(new URL('./fixtures/knia-news-88765.pdf', import.meta.url));
  let detailRequests = 0;
  let pdfRequests = 0;
  const ctx = makeCtx(fakeFetch(url => {
    if (url.pathname.endsWith('/list.do')) {
      assert.equal(url.searchParams.get('searchCnd'), '9');
      assert.equal(url.searchParams.get('searchWrd'), '보험');
      return new Response(list);
    }
    if (url.pathname.endsWith('/view.do')) {
      detailRequests++;
      assert.equal(url.href, fresh.url);
      return new Response(fixture('fss-detail-226318.html'));
    }
    assert.equal(url.pathname, '/fss/cmmn/file/fileDown.do');
    assert.equal(url.searchParams.get('fileSn'), '2');
    pdfRequests++;
    return new Response(pdf);
  }));
  ctx.seen = new Set(items.slice(1).map(item => item.id));
  const result = await fssPress.run(ctx);
  assert.equal(detailRequests, 1);
  assert.equal(pdfRequests, 1);
  assert.equal(ctx.pdfBudget.left, 4);
  assert.equal(ctx.bodies.size, 1);
  assert.match(ctx.bodies.get(fresh.id)!, /'26\.9\.10\./);
  assert.match(ctx.bodies.get(fresh.id)!, /'26\.10\.12\./);
  assert.ok(result.items.find(item => item.id === fresh.id)!.attachments.some(file => file.type === 'pdf'));
});

test('금감원 소비자경보는 제목에 보험 키워드가 있는 항목만 남긴다', async () => {
  const list = fixture('fss-alert-list.html');
  const all = parseFssList(list, 'fss-alert');
  const ctx = makeCtx(fakeFetch(url => {
    assert.equal(url.pathname, '/fss/bbs/B0000175/list.do');
    assert.equal(url.searchParams.get('menuNo'), '200204');
    return new Response(list);
  }));
  ctx.seen = new Set(all.map(item => item.id));
  const expected = all.filter(item => ctx.config.keywords.insurance.some(word => item.title.includes(word)));
  assert.ok(all.length > expected.length);
  const result = await fssAlert.run(ctx);
  assert.deepEqual(result.items.map(item => item.id), expected.map(item => item.id));
  assert.ok(result.items.every(item => item.url.includes('B0000175/view.do?') && item.url.endsWith('menuNo=200204')));
});

test('금감원 채우기는 설정된 쪽까지 조회하고 ID를 중복 제거한다', async () => {
  const list = fixture('fss-list.html');
  const pages: string[] = [];
  const ctx = makeCtx(fakeFetch(url => {
    assert.equal(url.pathname, '/fss/bbs/B0000188/list.do');
    pages.push(url.searchParams.get('pageIndex')!);
    return new Response(list);
  }));
  ctx.backfill = true;
  ctx.config.limits.backfillPages = 2;
  ctx.seen = new Set(parseFssList(list, 'fss-press').map(item => item.id));
  const result = await fssPress.run(ctx);
  assert.deepEqual(pages, ['1', '2']);
  assert.equal(result.items.length, ctx.seen.size);
});

test('목록 구조를 찾지 못하면 빈 성공 대신 수집 실패를 알린다', async () => {
  const fscCtx = makeCtx(fakeFetch(url => url.pathname.includes('fsc_bbs_rss')
    ? new Response(null, { status: 503 })
    : new Response(fixture('fss-list.html'))));
  await assert.rejects(fscPress.run(fscCtx), /목록에서 글을 찾지 못했습니다/);
  await assert.rejects(fscRule.run(fscCtx), /목록에서 글을 찾지 못했습니다/);
  const fssCtx = makeCtx(fakeFetch(() => new Response(fixture('fsc-list.html'))));
  await assert.rejects(fssPress.run(fssCtx), /목록에서 글을 찾지 못했습니다/);
  await assert.rejects(fssAlert.run(fssCtx), /목록에서 글을 찾지 못했습니다/);
});

test('PDF 예산이 소진되어도 금감원 HTML 본문을 저장한다', async () => {
  const list = fixture('fss-list.html');
  const items = parseFssList(list, 'fss-press');
  const ctx = makeCtx(fakeFetch(url => {
    if (url.pathname.endsWith('/list.do')) return new Response(list);
    assert.equal(url.href, items[0]!.url);
    return new Response(fixture('fss-detail-226318.html'));
  }));
  ctx.seen = new Set(items.slice(1).map(item => item.id));
  ctx.pdfBudget.left = 0;
  await fssPress.run(ctx);
  assert.equal(ctx.pdfBudget.left, 0);
  assert.equal(ctx.bodies.get(items[0]!.id), parseFssDetail(fixture('fss-detail-226318.html')).text);
});
