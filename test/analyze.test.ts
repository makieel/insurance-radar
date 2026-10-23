import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { analyze } from '../src/cli/analyze.ts';
import type { RateRow, RawItem, RawSnapshot } from '../src/schema.ts';

const today = '2026-10-23';
const config = loadConfig();
const item: RawItem = {
  id: 'knia-press:88765', source: 'knia-press',
  title: '손해보험협회, 「자동차보험 경상환자 보상처리 피해 신고센터」 운영',
  url: 'https://www.knia.or.kr/data/news/content?index=88765', published: '2026-10-08', hints: [], attachments: [],
};
const body = "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.";
const rate: RateRow = { company: '메리츠화재', kind: '업무용', total: -1, effective: '2026-09-26', reason: '예정사업비 변경에 따른 보험료 조정' };

function input(items = [item]): Parameters<typeof analyze>[0] {
  const raw: RawSnapshot = { date: today, generatedAt: `${today}T00:00:00Z`, items, rates: [], status: [] };
  return { raw, bodies: {}, seen: {}, changes: [], prevRates: [], pending: [], config, today };
}

test('이미 본 글은 새 묶음이나 AI 대기가 되지 않는다', () => {
  const result = analyze({ ...input(), seen: { [item.id]: '2026-10-22' } });
  assert.deepEqual(result.daily.groups, []);
  assert.deepEqual(result.pending, []);
  assert.equal(result.seen[item.id], '2026-10-22');
});

test('같은 글이 이틀 연속 와도 첫날에만 소식으로 묶는다', () => {
  const firstInput = input([item, { ...item }]);
  const first = analyze(firstInput);
  const second = analyze({ ...firstInput, ...first, today: '2026-10-24', raw: { ...firstInput.raw, date: '2026-10-24' } });
  assert.equal(first.daily.groups.length, 1);
  assert.equal(second.daily.groups.length, 0);
  assert.equal(second.seen[item.id], today);
  assert.equal(firstInput.seen[item.id], undefined);
  assert.deepEqual(second.pending, first.pending);
});

test('공시표의 새 행만 보험료 변경이 되고 최신표를 보관한다', () => {
  const data = input([]);
  data.raw.rates = [rate];
  const first = analyze(data);
  assert.equal(first.changes.length, 1);
  assert.equal(first.changes[0]?.origin, 'rates');
  assert.equal(first.changes[0]?.date, '2026-09-26');
  assert.deepEqual(first.rates, [rate]);
  const second = analyze({ ...data, changes: first.changes, prevRates: first.rates });
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0]?.firstSeen, today);
});

test('공시 수집 실패 때 이전 공시표를 보존한다', () => {
  const result = analyze({ ...input([]), prevRates: [rate] });
  assert.deepEqual(result.rates, [rate]);
  assert.deepEqual(result.changes, []);
});

test('보험에 무관한 전문지 글은 버리고 본 기록만 남긴다', () => {
  const excluded: RawItem = {
    id: 'insnews:93477', source: 'insnews', title: '하나금융, 3분기 누적 순익 3조6243억원… 전년比 5.6% 증가',
    url: 'https://www.insnews.co.kr/news/articleView.html?idxno=93477', published: today, hints: [], attachments: [],
  };
  const result = analyze(input([excluded]));
  assert.deepEqual(result.daily.groups, []);
  assert.deepEqual(result.pending, []);
  assert.equal(result.seen[excluded.id], today);
});

test('처음 보는 묶음은 대표 출처의 관련도·요약 대기에 들어간다', () => {
  const result = analyze(input());
  const group = result.daily.groups[0];
  assert.ok(group);
  assert.deepEqual(result.pending, [
    { type: 'relevance', id: group.id, url: item.url, source: item.source, date: today },
    { type: 'summary', id: group.id, url: item.url, source: item.source, date: today },
  ]);
});

test('단합대회 같은 잡음 글은 소식이 되지 않고 본 기록만 남긴다', () => {
  const noise: RawItem = {
    id: 'insweek:72799', source: 'insweek', title: '손해사정사회, 임시총회·회원 단합대회 개최',
    url: 'https://www.insweek.co.kr/news/articleView.html?idxno=72799', published: today, hints: [], attachments: [],
  };
  const result = analyze(input([noise]));
  assert.deepEqual(result.daily.groups, []);
  assert.deepEqual(result.pending, []);
  assert.equal(result.seen[noise.id], today);
});

test('묶음마다 규칙 관련도를 채우고 관련도 대기를 요약 대기보다 앞에 둔다', () => {
  const pension: RawItem = {
    id: 'fins:110290', source: 'fins', title: '연금저축보험, 가입 때 안내받은 연금액 보장 안돼…중도해지 땐 세금 부담',
    url: 'http://www.fins.co.kr/news/articleView.html?idxno=110290', published: today, hints: [], attachments: [],
  };
  const result = analyze(input([item, pension]));
  const byId = new Map(result.daily.groups.map(group => [group.id, group]));
  assert.equal(byId.get(`g:${item.id}`)?.relevance, 'medium');
  assert.equal(byId.get(`g:${pension.id}`)?.relevance, 'high');
  assert.ok(result.daily.groups.every(group => group.relevanceBy === 'rule'));
  const types = result.pending.map(job => job.type);
  assert.deepEqual(types, ['relevance', 'relevance', 'summary', 'summary']);
});

test('공식 발표의 정확한 시행일은 규칙으로 추출하고 판정 대기에서 뺀다', () => {
  const result = analyze({ ...input(), bodies: { [item.id]: body } });
  assert.equal(result.changes[0]?.origin, 'rule');
  assert.equal(result.changes[0]?.date, '2026-10-12');
  assert.ok(body.includes(result.changes[0]?.quote ?? ''));
  assert.equal(result.pending.filter(job => job.type === 'judge').length, 0);
});

test('규칙으로 뽑을 수 없는 시행 표현은 판정 대기에 넣는다', () => {
  const result = analyze({ ...input(), bodies: { [item.id]: '제도개선 사항이 7.1일부터 시행됩니다' } });
  assert.deepEqual(result.changes, []);
  assert.ok(result.pending.some(job => job.type === 'judge' && job.id === item.id));
});

test('기존 대기를 보존하고 같은 대기는 다시 추가하지 않는다', () => {
  const first = analyze(input());
  const repeated = analyze({ ...input(), pending: first.pending });
  assert.deepEqual(repeated.pending, first.pending);
});

test('규정변경예고는 본문에 정확한 날짜가 있어도 예고로 남긴다', () => {
  const notice: RawItem = {
    id: 'fsc-rule:4171', source: 'fsc-rule', title: '「보험업감독규정」 일부개정고시안 규정변경예고',
    url: 'https://www.fsc.go.kr/po040301/view?noticeId=4171', published: '2026-09-11',
    hints: ['구분 : 규정변경예고', '예고기간 : 2026-09-11 ~ 2026-09-21'], attachments: [],
  };
  const result = analyze({ ...input([notice]), bodies: { [notice.id]: body } });
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.status, 'proposed');
  assert.equal(result.changes[0]?.when, 'phrase');
  assert.equal(result.changes[0]?.date, null);
});

test('요약은 공식 출처를 우선하고 같은 종류에서는 여러 출처 묶음을 먼저 두며 업계 동향은 관련도만 맡긴다', () => {
  const press: RawItem[] = [
    { id: 'insnews:93476', source: 'insnews', title: '‘크루즈’로 변한 한화손보 한남사옥, 도심에서 체험하는 ‘웰니스 여정’', url: 'https://www.insnews.co.kr/news/articleView.html?idxno=93476', published: today, hints: [], attachments: [] },
    { id: 'insnews:93466', source: 'insnews', title: '교보생명, 보험금 지급까지 2시간… 생명보험업계 최단기간', url: 'https://www.insnews.co.kr/news/articleView.html?idxno=93466', published: today, hints: [], attachments: [] },
    { id: 'insweek:72796', source: 'insweek', title: '교보생명, 보험금 지급 평균 2시간···생보업계 1위', url: 'https://www.insweek.co.kr/news/articleView.html?idxno=72796', published: today, hints: [], attachments: [] },
  ];
  const result = analyze(input([...press, item]));
  const summaries = result.pending.filter(job => job.type === 'summary');
  assert.equal(summaries[0]?.source, 'knia-press');
  const second = result.daily.groups.find(group => group.id === summaries[1]?.id);
  assert.equal(second?.sources.length, 2);
  // 사옥 체험 기사는 업계 동향(관련도 low)이라 요약하지 않는다.
  assert.equal(summaries.length, 2);
  assert.ok(!summaries.some(job => job.id === 'g:insnews:93476'));
  assert.ok(result.pending.some(job => job.type === 'relevance' && job.id === 'g:insnews:93476'));
  assert.equal(result.pending.filter(job => job.type === 'relevance').length, 3);
});
