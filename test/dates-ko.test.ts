import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactDateIn, periodOf, whenPhraseIn, phraseIsPast, changeSentences } from '../src/analyze/dates-ko.ts';

test('exactDateIn: 연·월·일이 모두 있는 표기', () => {
  assert.equal(exactDateIn("'26.10.12.(월)부터 운영")?.iso, '2026-10-12');
  assert.equal(exactDateIn("('26.9.10. 이후 사고부터 시행)")?.iso, '2026-09-10');
  assert.equal(exactDateIn('2027년 1월 1일부터')?.iso, '2027-01-01');
  assert.equal(exactDateIn('시행시기 20260926')?.iso, '2026-09-26');
  assert.equal(exactDateIn('‘26.7.1일 체결되는 계약부터')?.iso, '2026-07-01');
  assert.equal(exactDateIn('｢보험업법｣ 개정안 국회 본회의 통과(‘26.8.20)')?.iso, '2026-08-20');
});

test('exactDateIn: raw는 원문 표기 그대로', () => {
  assert.deepEqual(exactDateIn("'26.10.12.(월)부터 운영"), { iso: '2026-10-12', raw: "'26.10.12." });
  assert.deepEqual(exactDateIn('‘26.7.1일 체결되는 계약부터'), { iso: '2026-07-01', raw: '‘26.7.1일' });
  assert.deepEqual(exactDateIn('시행시기 20260926'), { iso: '2026-09-26', raw: '20260926' });
});

test('exactDateIn: 연도 없는 날짜·상대 표현·기간은 null', () => {
  assert.equal(exactDateIn('7.1일부터 시행'), null);
  assert.equal(exactDateIn('오는 25일부터'), null);
  assert.equal(exactDateIn('다음 달부터'), null);
  assert.equal(exactDateIn('5월 6일부터 치료비 부담이 큰 중증질환의 보장을 강화'), null);
  assert.equal(exactDateIn('’27.1월 시행사항'), null);
  assert.equal(exactDateIn("'27.1분기 중 사업을 시행"), null);
  assert.equal(exactDateIn('IFRS17(‘23년 시행) 체계하'), null);
});

test('exactDateIn: 존재하지 않는 날짜는 null', () => {
  assert.equal(exactDateIn('2026.2.30'), null);
});

test('periodOf: 원문이 명시한 기간', () => {
  assert.deepEqual(periodOf("'27.1분기 중", '2026-10-19'), { start: '2027-01-01', end: '2027-03-31' });
  assert.deepEqual(periodOf('‘27.1분기 중', '2026-10-19'), { start: '2027-01-01', end: '2027-03-31' });
  assert.deepEqual(periodOf("'27.1월", '2026-06-30'), { start: '2027-01-01', end: '2027-01-31' });
  assert.deepEqual(periodOf('’27.1월 시행사항', '2026-06-30'), { start: '2027-01-01', end: '2027-01-31' });
  assert.deepEqual(periodOf('연말까지', '2026-09-30'), { start: '2026-09-30', end: '2026-12-31' });
  assert.deepEqual(periodOf("'26 하반기", '2026-05-01'), { start: '2026-07-01', end: '2026-12-31' });
});

test('periodOf: 연도 없는 표현은 null', () => {
  assert.equal(periodOf('하반기', '2026-05-01'), null);
  assert.equal(periodOf('다음 달부터', '2026-10-20'), null);
  assert.equal(periodOf('7.1일부터', '2026-06-30'), null);
});

test('whenPhraseIn: 시행 시점 표현을 원문 그대로', () => {
  const p = whenPhraseIn("치매배상책임보험 무상가입을 지원… '27.1분기 중 사업을 시행하며");
  assert.ok(p?.includes("'27.1분기 중"), String(p));
  assert.equal(whenPhraseIn('보험 판매수수료 제도개선 사항이 7.1일부터 시행됩니다. '), '7.1일부터');
  assert.equal(whenPhraseIn("손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다."), "'26.10.12.(월)부터");
  assert.equal(whenPhraseIn('오는 25일부터'), '오는 25일부터');
  assert.equal(whenPhraseIn('다음 달부터'), '다음 달부터');
  assert.equal(whenPhraseIn('연말까지'), '연말까지');
  assert.equal(whenPhraseIn('하반기'), '하반기');
  assert.equal(whenPhraseIn('정부, 전국 요양시설 종신보험 가입실태 전수조사 실시 및 관리 강화'), null);
});

test('phraseIsPast', () => {
  assert.equal(phraseIsPast('오는 21일', '2026-10-20', '2026-10-23'), true);
  assert.equal(phraseIsPast('오는 25일부터', '2026-10-20', '2026-10-23'), false);
  assert.equal(phraseIsPast('21일부터', '2026-10-20', '2026-10-23'), true);
  // 발표일보다 앞선 날은 다음 달일 수 있어 판단하지 않는다
  assert.equal(phraseIsPast('오는 5일', '2026-10-20', '2026-12-01'), false);
  assert.equal(phraseIsPast('다음 달부터', '2026-10-20', '2026-12-01'), false);
  assert.equal(phraseIsPast('7.1일부터', '2026-06-30', '2026-10-23'), false);
});

test('changeSentences: 변경 단어가 있는 문장만, 날짜의 마침표에서 자르지 않는다', () => {
  const body = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다. 지난해 같은 달 94.2%보다 8.8%포인트 낮아진 수치다.";
  const out = changeSentences(body);
  assert.deepEqual(out, ["손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다."]);
  assert.deepEqual(changeSentences("('26.9.10. 이후 사고부터 시행)"), ["('26.9.10. 이후 사고부터 시행)"]);
});

test('changeSentences: 줄바꿈으로 나누고 200자 이내, 원문 일부 그대로', () => {
  const long = '가'.repeat(300) + ' 7.1일부터 시행됩니다';
  const out = changeSentences(`첫 줄\n${long}`);
  assert.equal(out.length, 1);
  assert.ok(out[0].length <= 200);
  assert.ok(long.includes(out[0]));
  assert.ok(out[0].includes('부터'));
});
