import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RANGES, bandWindow, placeExact, placePeriods, outOfRange, clusterPoints, lanes } from './layout.js';
import { loadLatest } from '../../core/data.js';
import { Latest } from '../../../src/schema.ts';

const sample = JSON.parse(readFileSync(new URL('../../../test/fixtures/latest-sample.json', import.meta.url), 'utf8'));
const TODAY = '2026-10-23';
const find = (fn) => {
  const c = sample.changes.find(fn);
  assert.ok(c, 'fixture에 항목이 있어야 한다');
  return c;
};
const rate0926 = find((c) => c.date === '2026-09-26');
const knia1012 = find((c) => c.date === '2026-10-12');
const fss0910 = find((c) => c.date === '2026-09-10');
const q1 = find((c) => c.when === 'period' && c.period.start === '2027-01-01' && c.period.end === '2027-03-31');
const soon21 = find((c) => c.when === 'phrase' && c.past === true);

test('RANGES: ±개월 → 일수', () => {
  assert.deepEqual(RANGES, { 1: 31, 3: 92, 6: 183 });
});

test('bandWindow: 오늘을 가운데 두고 ±일수', () => {
  assert.deepEqual(bandWindow(TODAY, 3), { start: '2026-07-23', end: '2027-01-23' });
  assert.deepEqual(bandWindow(TODAY, 1), { start: '2026-09-22', end: '2026-11-23' });
});

test('placeExact: 범위 안 exact만, x는 0~1', () => {
  const win = bandWindow(TODAY, 1);
  const old = { ...rate0926, id: 'old', date: '2026-03-01' };
  const placed = placeExact([rate0926, old, q1, soon21], win);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].change, rate0926);
  assert.ok(Math.abs(placed[0].x - 4 / 62) < 1e-9);
});

test('placePeriods: 범위와 겹치는 period만, 끝이 잘리면 clippedEnd', () => {
  assert.deepEqual(placePeriods([q1], bandWindow(TODAY, 1)), []);
  const p3 = placePeriods([q1, knia1012], bandWindow(TODAY, 3));
  assert.equal(p3.length, 1);
  assert.equal(p3[0].change, q1);
  assert.equal(p3[0].clippedEnd, true);
  assert.ok(p3[0].x0 > 0.5 && p3[0].x0 < 1);
  assert.equal(p3[0].x1, 1);
});

test('outOfRange: ±1개월에서 9.10 항목은 before', () => {
  const win = bandWindow(TODAY, 1);
  assert.deepEqual(outOfRange([fss0910], win), { before: 1, after: 0 });
  // 9.10·9.21은 앞, '27.1분기·'27.1월은 뒤
  assert.deepEqual(outOfRange(sample.changes, win), { before: 2, after: 2 });
});

test('clusterPoints: 가까운 점은 하나로', () => {
  const g = clusterPoints([{ x: 0.1 }, { x: 0.11 }, { x: 0.5 }], 0.05);
  assert.equal(g.length, 2);
  assert.equal(g[0].items.length, 2);
  assert.ok(Math.abs(g[0].x - 0.105) < 1e-9);
});

test('lanes: 지난 phrase는 최근, 미래 phrase·미래 exact는 예정', () => {
  const futurePhrase = { ...soon21, id: 'p2', phrase: '다음 달부터', past: false };
  const futureExact = { ...knia1012, id: 'e2', date: '2027-01-01' };
  const L = lanes([soon21, futurePhrase, futureExact, knia1012, q1], TODAY);
  assert.deepEqual(Object.keys(L), ['auto', 'medical', 'life', 'general']);
  assert.ok(L.life.recent.includes(soon21));
  assert.ok(L.life.upcoming.includes(futurePhrase));
  assert.ok(L.life.upcoming.includes(q1));
  assert.ok(L.auto.upcoming.includes(futureExact));
  assert.ok(L.auto.recent.includes(knia1012));
});

test('빈 데이터에서도 깨지지 않는다', () => {
  const win = bandWindow(TODAY, 3);
  assert.deepEqual(placeExact([], win), []);
  assert.deepEqual(placePeriods([], win), []);
  assert.deepEqual(outOfRange([], win), { before: 0, after: 0 });
  assert.deepEqual(clusterPoints([], 44), []);
  const L = lanes([], TODAY);
  for (const k of ['auto', 'medical', 'life', 'general']) assert.deepEqual(L[k], { recent: [], upcoming: [] });
});

test('latest-sample.json: Latest 형식이고 요약은 모두 null', () => {
  for (const k of ['changes', 'news', 'official', 'industry', 'rates', 'status', 'counts']) assert.ok(k in sample, k);
  Latest.parse(sample);
  for (const g of [...sample.news, ...sample.official, ...sample.industry]) assert.equal(g.summary, null);
  const up = sample.changes.filter((c) => (c.when === 'exact' && c.date > TODAY) || (c.when === 'period' && c.period.end > TODAY) || (c.when === 'phrase' && !c.past));
  const recent = sample.changes.filter((c) => (c.when === 'exact' && c.date <= TODAY) || (c.when === 'phrase' && c.past));
  assert.equal(sample.counts.upcoming, up.length);
  assert.equal(sample.counts.recent, recent.length);
});

test('loadLatest: 캐시 무시 쿼리로 부르고, 실패 응답은 오류', async () => {
  let called = '';
  const ok = async (url) => {
    called = url;
    return { ok: true, status: 200, json: async () => sample };
  };
  assert.equal(await loadLatest(ok), sample);
  assert.match(called, /^\.\/data\/latest\.json\?v=\d+$/);
  const bad = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(loadLatest(bad));
});
