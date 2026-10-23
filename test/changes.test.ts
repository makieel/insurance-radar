import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChanges, noticeChange, rateChange, ruleChanges } from '../src/analyze/changes.ts';
import { Change } from '../src/schema.ts';
import type { RawItem } from '../src/schema.ts';

// 글 정보는 test/fixtures/의 실제 응답에서 옮겼다
const kniaItem: RawItem = {
  id: 'knia-press:88765',
  source: 'knia-press',
  title: '손해보험협회, 「자동차보험 경상환자 보상처리 피해 신고센터」 운영',
  url: 'https://www.knia.or.kr/data/news/content?index=88765',
  published: '2026-10-08',
  hints: [],
  attachments: [],
};
const fscItem: RawItem = {
  id: 'fsc-press:87217',
  source: 'fsc-press',
  title: '보험업권의 과도한 판매수수료 경쟁을 방지하고, 수수료에 대한 소비자의 알권리를 제고하기 위한 보험 판매수수료 제도개선 사항이 7.1일부터 시행됩니다. ',
  url: 'https://www.fsc.go.kr/no010101/87217',
  published: '2026-06-30',
  hints: ['담당부서 : 보험과'],
  attachments: [],
};
const ruleItem: RawItem = {
  id: 'fsc-rule:4171',
  source: 'fsc-rule',
  title: ' 「보험업감독규정」 일부개정고시안 규정변경예고',
  url: 'https://www.fsc.go.kr/po040301/view?noticeId=4171',
  published: '2026-09-11',
  hints: ['규정변경예고', '예고기간 : 2026-09-11 ~ 2026-09-21'],
  attachments: [],
};
const meritzRow = { company: '메리츠화재', kind: '업무용', total: -1, effective: '2026-09-26', reason: '예정사업비 변경에 따른 보험료 조정' };

test('ruleChanges: 연·월·일이 있는 시행 문장은 exact', () => {
  const body = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.";
  const out = ruleChanges({ item: kniaItem, body, topic: 'auto', sourceName: '손해보험협회', today: '2026-10-23' });
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.when, 'exact');
  assert.equal(c.date, '2026-10-12');
  assert.equal(c.phrase, "'26.10.12.");
  assert.ok(body.includes(c.quote));
  assert.equal(c.status, 'confirmed');
  assert.equal(c.origin, 'rule');
  assert.equal(c.announced, '2026-10-08');
  assert.equal(c.id, 'c:knia-press:88765:2026-10-12');
  assert.deepEqual(c.sources, [{ name: '손해보험협회', url: kniaItem.url }]);
  Change.parse(c);
});

test('ruleChanges: 연도 없는 날짜는 만들지 않는다', () => {
  const out = ruleChanges({ item: fscItem, body: '제도개선 사항이 7.1일부터 시행됩니다', topic: 'general', sourceName: '금융위원회', today: '2026-10-23' });
  assert.deepEqual(out, []);
});

test('ruleChanges: 같은 글에서 같은 날짜는 하나만', () => {
  const sentence = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.";
  const out = ruleChanges({ item: kniaItem, body: `${sentence}\n${sentence}`, topic: 'auto', sourceName: '손해보험협회', today: '2026-10-23' });
  assert.equal(out.length, 1);
});

test('noticeChange: 예고기간은 phrase·proposed', () => {
  const c = noticeChange({ item: ruleItem, topic: 'general', sourceName: '금융위원회 입법·규정변경예고', today: '2026-10-23' });
  assert.ok(c);
  assert.equal(c.when, 'phrase');
  assert.equal(c.date, null);
  assert.equal(c.status, 'proposed');
  assert.equal(c.origin, 'rule');
  assert.equal(c.phrase, '예고기간 ~9.21');
  assert.equal(c.quote, '예고기간 : 2026-09-11 ~ 2026-09-21');
  assert.equal(c.title, '「보험업감독규정」 일부개정고시안 규정변경예고');
  Change.parse(c);
});

test('noticeChange: 예고기간이 없으면 null', () => {
  assert.equal(noticeChange({ item: kniaItem, topic: 'auto', sourceName: '손해보험협회', today: '2026-10-23' }), null);
});

test('rateChange: 공시표 행 → exact 변경', () => {
  const c = rateChange(meritzRow, '2026-10-23');
  assert.equal(c.title, '메리츠화재 업무용 자동차보험료 -1%');
  assert.equal(c.phrase, '시행시기 20260926');
  assert.equal(c.quote, '메리츠화재 업무용 -1% 20260926 예정사업비 변경에 따른 보험료 조정');
  assert.equal(c.when, 'exact');
  assert.equal(c.date, '2026-09-26');
  assert.equal(c.category, 'auto');
  assert.equal(c.origin, 'rates');
  assert.equal(c.id, 'r:메리츠화재:업무용:2026-09-26');
  assert.deepEqual(c.rate, { company: '메리츠화재', kind: '업무용', total: -1 });
  assert.equal(c.sources[0].name, '손보협회 공시실');
  Change.parse(c);
});

test('rateChange: 인상은 + 부호', () => {
  const c = rateChange(
    { company: '메리츠화재', kind: '개인용', total: 1.3, effective: '2026-02-21', reason: '손해율실적 반영에 따른 조정 (대물가입금액확대 특약 포함)' },
    '2026-10-23',
  );
  assert.equal(c.title, '메리츠화재 개인용 자동차보험료 +1.3%');
});

test('mergeChanges: 같은 id는 하나로, sources 합치고 firstSeen 유지', () => {
  const body = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.";
  const [first] = ruleChanges({ item: kniaItem, body, topic: 'auto', sourceName: '손해보험협회', today: '2026-10-08' });
  const again: Change = {
    ...first,
    sources: [{ name: '손해보험협회', url: 'https://www.knia.or.kr/file/download/hWHkgy0lTuJrxotl4EdYww==' }],
    firstSeen: '2026-10-23',
  };
  const out = mergeChanges([first], [again], '2026-10-23');
  assert.equal(out.length, 1);
  assert.equal(out[0].sources.length, 2);
  assert.equal(out[0].firstSeen, '2026-10-08');
});

test('mergeChanges: 공시표 행은 제목이 비슷해도 회사·종목이 다르면 따로', () => {
  const a = rateChange(meritzRow, '2026-10-23');
  const b = rateChange({ ...meritzRow, kind: '영업용' }, '2026-10-23');
  assert.equal(mergeChanges([a], [b], '2026-10-23').length, 2);
});

test('mergeChanges: 보관 기간이 지난 항목은 빼고 날짜 내림차순', () => {
  const body = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.";
  const [knia] = ruleChanges({ item: kniaItem, body, topic: 'auto', sourceName: '손해보험협회', today: '2026-10-08' });
  // 계획의 예(2026-03-01 + 183일 = 2026-08-31 < today)와 같은 규칙: 2026-02-21 + 183일 = 2026-08-23 < 2026-10-23 → 빠짐
  const old = rateChange(
    { company: '메리츠화재', kind: '개인용', total: 1.3, effective: '2026-02-21', reason: '손해율실적 반영에 따른 조정 (대물가입금액확대 특약 포함)' },
    '2026-03-01',
  );
  const period: Change = {
    id: 'c:fsc-press:87952:ai',
    category: 'life',
    title: '보험업권과 복지부 산하 노인지원기관이 손잡고 65만명의 취약어르신에게 낙상사고 치료비, 치매배상책임보험을 무료로 제공하겠습니다.',
    when: 'period',
    date: null,
    period: { start: '2027-01-01', end: '2027-03-31' },
    phrase: "'27.1분기 중",
    quote: "치매배상책임보험 무상가입을 지원… '27.1분기 중 사업을 시행하며",
    status: 'confirmed',
    past: false,
    announced: '2026-10-19',
    sources: [{ name: '금융위원회', url: 'https://www.fsc.go.kr/no010101/87952' }],
    origin: 'ai',
    rate: null,
    firstSeen: '2026-10-19',
  };
  const rate = rateChange(meritzRow, '2026-10-23');
  const out = mergeChanges([old, rate], [period, knia], '2026-10-23');
  assert.deepEqual(
    out.map((c) => c.id),
    ['c:fsc-press:87952:ai', 'c:knia-press:88765:2026-10-12', 'r:메리츠화재:업무용:2026-09-26'],
  );
});
