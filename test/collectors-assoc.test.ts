import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import type { CollectCtx } from '../src/collectors/types.ts';
import { kniaPress, kniaRates, parseKniaList, parseKniaDetail, parseKpubRates } from '../src/collectors/knia.ts';
import { kliaPress, parseKliaList, parseKliaDetail } from '../src/collectors/klia.ts';
import { parseKiriList } from '../src/collectors/kiri.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const pdfBytes = readFileSync(new URL('./fixtures/knia-news-88765.pdf', import.meta.url));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function makeCtx(fetch: typeof globalThis.fetch, seen: string[] = []) {
  const bodies: Record<string, string> = {};
  const ctx: CollectCtx = {
    fetch,
    now: new Date('2026-10-23T00:00:00+09:00'),
    date: '2026-10-23',
    config: loadConfig(),
    backfill: false,
    seen: new Set(seen),
    putBody: (id, text) => {
      bodies[id] = text;
    },
    pdfBudget: { left: 5, maxBytes: 5e6 },
  };
  return { ctx, bodies };
}

test('parseKniaList finds the 경상환자 press release with ISO dates', () => {
  const items = parseKniaList(fx('knia-news.html'));
  assert.ok(items.length >= 5);
  const item = items.find(i => i.id === 'knia-press:88765');
  assert.match(item?.title ?? '', /경상환자/);
  assert.equal(item?.url, 'https://www.knia.or.kr/data/news/content?index=88765');
  for (const i of items) assert.match(i.published, ISO);
});

test('parseKniaDetail returns one pdf and one hwp attachment', () => {
  const { attachments } = parseKniaDetail(fx('knia-news-88765.html'));
  assert.equal(attachments.filter(a => a.type === 'pdf').length, 1);
  assert.equal(attachments.filter(a => a.type === 'hwp').length, 1);
  for (const a of attachments) assert.ok(a.url.startsWith('https://www.knia.or.kr/file/download/'));
});

test('parseKpubRates reads the real rows and skips the empty template', () => {
  const rows = parseKpubRates(fx('kpub-car-rates.html'));
  assert.ok(rows.length >= 10);
  const row = rows.find(r => r.company === '메리츠화재' && r.kind === '업무용' && r.effective === '2026-09-26');
  assert.equal(row?.total, -1);
  for (const r of rows) {
    assert.match(r.effective, ISO);
    assert.ok(r.company.length > 0 && r.kind.length > 0);
    assert.ok(Number.isFinite(r.total));
  }
});

test('parseKliaList returns press ids and absolute urls', () => {
  const items = parseKliaList(fx('klia-list.html'));
  assert.ok(items.length >= 5);
  for (const i of items) {
    assert.match(i.id, /^klia-press:\d+$/);
    assert.match(i.published, ISO);
  }
  const item = items.find(i => i.id === 'klia-press:123789');
  assert.equal(item?.url,'https://www.klia.or.kr/board/2/view.do?boardNo=123789&boardMngNo=2&seq=1');
});

test('parseKliaDetail builds FileDown urls from the attachment links', () => {
  const { attachments } = parseKliaDetail(fx('klia-detail-123789.html'));
  assert.deepEqual(
    attachments.map(a => [a.type, a.url]),
    [
      ['pdf', 'https://www.klia.or.kr/FileDown.do?fileNo=21625&seq=1'],
      ['hwp', 'https://www.klia.or.kr/FileDown.do?fileNo=21625&seq=2'],
    ],
  );
});

test('parseKiriList returns materialView items with absolute urls', () => {
  const items = parseKiriList(fx('kiri-list.html'));
  assert.ok(items.length >= 5);
  for (const i of items) {
    assert.match(i.id, /^kiri:\d+$/);
    assert.equal(i.url, `https://kiri.or.kr/community/materialView.do?bid=${i.id.slice('kiri:'.length)}`);
    assert.match(i.published, ISO);
  }
  assert.ok(items.some(i => i.id === 'kiri:224294'));
});

test('kniaPress.run fetches detail and pdf only for unseen items', async () => {
  const listItems = parseKniaList(fx('knia-news.html'));
  const seen = listItems.map(i => i.id).filter(id => id !== 'knia-press:88765');
  const requested: string[] = [];
  const f = (async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    if (url === 'https://www.knia.or.kr/data/news')return new Response(fx('knia-news.html'));
    if (url === 'https://www.knia.or.kr/data/news/content?index=88765') return new Response(fx('knia-news-88765.html'));
    if (url.endsWith('/file/download/hWHkgy0lTuJrxotl4EdYww==')) return new Response(pdfBytes);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  const { ctx, bodies } = makeCtx(f, seen);
  const res = await kniaPress.run(ctx);

  assert.equal(res.items.length, listItems.length);
  assert.deepEqual(Object.keys(bodies), ['knia-press:88765']);
  assert.match(bodies['knia-press:88765'], /'26\.10\.12\./);
  assert.equal(requested.filter(u => u.includes('/data/news/content')).length, 1);
  assert.equal(ctx.pdfBudget.left, 4);
  const item = res.items.find(i => i.id === 'knia-press:88765');
  assert.equal(item?.attachments.length, 2);
});

test('kniaPress.run throws when the response is the 보안정책 위배 block page', async () => {
  const f = (async () => new Response('<html><body>보안정책 위배로 접근이 차단되었습니다.</body></html>')) as unknown as typeof fetch;
  const { ctx } = makeCtx(f);
  await assert.rejects(kniaPress.run(ctx), /보안정책 위배/);
});

test('kniaRates.run returns rates and no items', async () => {
  const f = (async (input: string | URL) => {
    const url = String(input);
    assert.equal(url,'https://kpub.knia.or.kr/carInsuranceDisc/adjustment/carAdjustmentCompare.do');
    return new Response(fx('kpub-car-rates.html'));
  }) as unknown as typeof fetch;
  const { ctx } = makeCtx(f);
  const res = await kniaRates.run(ctx);
  assert.deepEqual(res.items, []);
  assert.ok((res.rates?.length ?? 0) >= 10);
});

test('kliaPress.run reads detail and pdf for the unseen item', async () => {
  const listItems = parseKliaList(fx('klia-list.html'));
  const seen = listItems.map(i => i.id).filter(id => id !== 'klia-press:123789');
  const requested: string[] = [];
  const f = (async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    if (url === 'https://www.klia.or.kr/board/2/list.do') return new Response(fx('klia-list.html'));
    if (url.includes('boardNo=123789')) return new Response(fx('klia-detail-123789.html'));
    // 연동 확인용: 생보협회 PDF 대신 손보협회 PDF 바이트를 돌려준다.
    if (url === 'https://www.klia.or.kr/FileDown.do?fileNo=21625&seq=1') return new Response(pdfBytes);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  const { ctx, bodies } = makeCtx(f, seen);
  const res = await kliaPress.run(ctx);

  assert.equal(res.items.length, listItems.length);
  assert.deepEqual(Object.keys(bodies), ['klia-press:123789']);
  assert.match(bodies['klia-press:123789'], /첨부파일을 참조/);
  assert.match(bodies['klia-press:123789'], /경상환자/);
  assert.ok(requested.includes('https://www.klia.or.kr/FileDown.do?fileNo=21625&seq=1'));
});
