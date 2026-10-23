import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { loadConfig } from '../src/config.ts';
import type { CollectCtx, Collector } from '../src/collectors/types.ts';
import type { RawItem, RateRow } from '../src/schema.ts';
import { runCollectors } from '../src/collectors/run.ts';
import { USER_AGENT } from '../src/lib/http.ts';

function context(): Omit<CollectCtx, 'putBody' | 'pdfBudget'> {
  return {
    config: loadConfig(),
    date: '2026-10-23', now: new Date('2026-10-23T00:00:00Z'), backfill: false, seen: new Set(),
    fetch: async () => { throw new Error('테스트에서 네트워크를 호출할 수 없습니다.'); },
  };
}

const item: RawItem = {
  id: 'knia-press:88765', source: 'knia-press',
  title: '손해보험협회, 「자동차보험 경상환자 보상처리 피해 신고센터」 운영',
  url: 'https://www.knia.or.kr/data/news/content?index=88765', published: '2026-10-08', hints: [], attachments: [],
};
const rate: RateRow = { company: '메리츠화재', kind: '업무용', total: -1, effective: '2026-09-26', reason: '예정사업비 변경에 따른 보험료 조정' };

test('출처 예외와 0건 실패가 다음 수집기를 막지 않는다', async () => {
  const collectors: Collector[] = [
    { id: 'knia-press', async run(ctx) { ctx.putBody(item.id, '손해보험협회'); return { items: [item], note: '목록 페이지로 수집' }; } },
    { id: 'fsc-press', async run() { throw new Error('출처 응답 실패'); } },
    { id: 'fss-press', async run() { return { items: [] }; } },
    { id: 'knia-rates', async run() { return { items: [], rates: [rate] }; } },
  ];
  const result = await runCollectors(collectors, context());
  assert.deepEqual(result.status.map(s => s.ok), [true, false, false, true]);
  assert.deepEqual(result.items, [item]);
  assert.deepEqual(result.rates, [rate]);
  assert.equal(result.bodies[item.id], '손해보험협회');
  assert.equal(result.status[0]?.note, '목록 페이지로 수집');
  assert.equal(result.status[1]?.error, '출처 응답 실패');
  assert.match(result.status[2]?.error ?? '', /0건/);
});

test('설정에서 꺼졌거나 필요한 키가 없는 출처는 호출하지 않는다', async () => {
  const ctx = context();
  const missingKey = 'IR_TASK6_TEST_MISSING_KEY';
  assert.equal(process.env[missingKey], undefined);
  ctx.config.sources = ctx.config.sources.map(source => ({
    ...source,
    ...(source.id === 'knia-press' ? { enabled: false } : {}),
    ...(source.id === 'naver' ? { enabled: true, keyEnv: [missingKey] } : {}),
  }));
  const fail = async () => { assert.fail('꺼진 출처가 호출되었습니다.'); };
  const result = await runCollectors([{ id: 'knia-press', run: fail }, { id: 'naver', run: fail }], ctx);
  assert.ok(result.status.every(s => s.disabled && !s.ok && s.error === null && s.note));
});

test('같은 글 ID는 한 번만 반환하고 건수도 중복 없이 센다', async () => {
  const result = await runCollectors([{ id: 'knia-press', async run() { return { items: [item, { ...item }] }; } }], context());
  assert.deepEqual(result.items, [item]);
  assert.equal(result.status[0]?.count, 1);
});

test('모든 수집기가 같은 PDF 예산을 공유한다', async () => {
  const ctx = context();
  let budget: CollectCtx['pdfBudget'] | undefined;
  await runCollectors([
    { id: 'knia-press', async run(current) {
      budget = current.pdfBudget;
      assert.equal(budget.left, ctx.config.limits.pdfPerDay);
      assert.equal(budget.maxBytes, ctx.config.limits.pdfMaxBytes);
      budget.left--;
      return { items: [item] };
    } },
    { id: 'knia-rates', async run(current) {
      assert.equal(current.pdfBudget, budget);
      assert.equal(current.pdfBudget.left, ctx.config.limits.pdfPerDay - 1);
      return { items: [], rates: [rate] };
    } },
  ], ctx);
});

test('시간 초과 시 요청을 중단하고 다음 출처는 계속 수집한다', async () => {
  const ctx = context();
  let signal: AbortSignal | undefined;
  ctx.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('User-Agent'), USER_AGENT);
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('요청 중단')), { once: true }));
  };
  const result = await runCollectors([
    { id: 'fsc-press', async run(current) { await current.fetch('https://www.fsc.go.kr/'); return { items: [] }; } },
    { id: 'knia-press', async run() { return { items: [item] }; } },
  ], ctx, { timeoutMs: 10 });
  assert.equal(signal?.aborted, true);
  assert.deepEqual(result.status.map(s => s.ok), [false, true]);
  assert.match(result.status[0]?.error ?? '', /제한 시간/);
  assert.deepEqual(result.items, [item]);
});

test('시간 초과 후 늦게 반환된 본문은 결과를 바꾸지 않는다', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const result = await runCollectors([{ id: 'knia-press', async run(ctx) {
    await gate;
    ctx.putBody(item.id, '늦은 본문');
    return { items: [item] };
  } }], context(), { timeoutMs: 10 });
  release();
  await setImmediate();
  assert.deepEqual(result.bodies, {});
  assert.deepEqual(result.items, []);
});

test('실패한 수집기의 부분 본문은 반환하지 않는다', async () => {
  const result = await runCollectors([{ id: 'knia-press', async run(ctx) {
    ctx.putBody(item.id, '손해보험협회');
    throw new Error('상세 페이지 실패');
  } }], context());
  assert.deepEqual(result.bodies, {});
});

test('보험 기사가 없는 날의 일반 언론처럼 읽은 글은 있고 거른 뒤 0건이면 성공으로 본다', async () => {
  const collectors: Collector[] = [{ id: 'donga', async run() { return { items: [], scanned: 50 }; } }];
  const [status] = (await runCollectors(collectors, context())).status;
  assert.equal(status?.ok, true);
  assert.equal(status?.count, 0);
  assert.match(status?.note ?? '', /보험 기사 없음/);
});
