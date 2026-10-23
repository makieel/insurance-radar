import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRates, rateKey } from '../src/analyze/rates.ts';
import type { RateRow } from '../src/schema.ts';

// test/fixtures/kpub-car-rates.html의 실제 행
const rows: RateRow[] = [
  { company: '메리츠화재', kind: '개인용', total: 1.3, effective: '2026-02-21', reason: '손해율실적 반영에 따른 조정 (대물가입금액확대 특약 포함)' },
  { company: '메리츠화재', kind: '업무용', total: -1, effective: '2026-09-26', reason: '예정사업비 변경에 따른 보험료 조정' },
  { company: '메리츠화재', kind: '영업용', total: -1, effective: '2026-09-26', reason: '예정사업비 변경에 따른 보험료 조정' },
  { company: '한화손보', kind: '개인용', total: 0, effective: '2025-12-31', reason: '손해율실적 반영에 따른 조정 (대물확장특약, 차량단독특약, 자동차상해특약 포함)' },
];

test('rateKey', () => {
  assert.equal(rateKey(rows[1]), '메리츠화재|업무용|2026-09-26|-1');
});

test('newRates: 첫 실행은 시행일이 2026-04-23 이후인 행만', () => {
  const out = newRates([], rows, '2026-10-23');
  assert.deepEqual(out, [rows[1], rows[2]]);
  assert.ok(out.every((r) => r.effective >= '2026-04-23'));
});

test('newRates: 같은 표면 빈 배열', () => {
  assert.deepEqual(newRates(rows, rows, '2026-10-23'), []);
});

test('newRates: 새 행 하나만', () => {
  const prev = [rows[0], rows[1], rows[3]];
  assert.deepEqual(newRates(prev, rows, '2026-10-23'), [rows[2]]);
});

test('newRates: 이전 표가 있으면 오래된 시행일의 새 행도 올린다', () => {
  const prev = [rows[1], rows[2], rows[3]];
  assert.deepEqual(newRates(prev, rows, '2026-10-23'), [rows[0]]);
});
