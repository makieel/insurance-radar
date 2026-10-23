import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbersIn, ungrounded } from '../src/summarize/grounding.ts';

// 원문은 test/fixtures/insjournal.xml(idxno=33625)과 계획에 적힌 문구에서 옮겼다
const TITLE = '9월 車보험 손해율 85.0%…전년 동월보다 8.8%p 하락';

test('numbersIn: 쉼표·소수점을 값으로 맞추고 날짜 표기는 마디로 나눈다', () => {
  assert.deepEqual(numbersIn('9월 고속도로 통행량은 2억6502만9000대'), ['9', '2', '6502', '9000']);
  assert.deepEqual(numbersIn('손해율 85.0%…8.8%p'), ['85', '8.8']);
  assert.deepEqual(numbersIn("'26.10.12.(월)부터"), ['26', '10', '12']);
});

test('ungrounded: 원문에 있는 숫자면 통과', () => {
  assert.equal(ungrounded('손해율이 85.0%예요', '손해율이 85.0%로', true), null);
});

test('ungrounded: 원문에 없는 숫자면 이유', () => {
  const reason = ungrounded('손해율이 90%예요', '손해율이 85.0%로', true);
  assert.ok(reason);
  assert.match(reason, /90/);
});

test('ungrounded: 발췌 없이 두 문장이면 이유, 한 문장은 통과', () => {
  const two = '9월 자동차보험 손해율이 85.0%예요. 전년 동월보다 8.8%p 낮아졌어요.';
  assert.ok(ungrounded(two, TITLE, false));
  assert.equal(ungrounded(two, TITLE, true), null);
  assert.equal(ungrounded('9월 자동차보험 손해율이 85.0%로 전년 동월보다 8.8%p 낮아졌어요.', TITLE, false), null);
});

test('ungrounded: 원문 날짜 표기를 풀어 쓴 날짜는 통과', () => {
  const source = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.";
  assert.equal(ungrounded('2026년 10월 12일부터 피해 신고센터를 운영해요.', source, true), null);
  assert.equal(ungrounded('7월 1일부터 시행돼요.', '제도개선 사항이 7.1일부터 시행됩니다', true), null);
  assert.ok(ungrounded('10월 13일부터 운영해요.', source, true));
});

test('ungrounded: 빈 문장은 이유', () => {
  assert.ok(ungrounded('  ', TITLE, true));
});
