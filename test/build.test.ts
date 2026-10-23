import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLatest } from '../src/cli/build.ts';
import { loadConfig } from '../src/config.ts';
import { addDays } from '../src/lib/dates.ts';
import { Latest } from '../src/schema.ts';
import type { Change, DailyReport, NewsGroup, SourceId, SourceKind } from '../src/schema.ts';

const today = '2026-10-23';
const generatedAt = '2026-10-23T00:00:00Z';
const config = loadConfig();
const sourceKinds = Object.fromEntries(config.sources.map(source => [source.id, source.kind])) as Record<SourceId, SourceKind>;
const base: Change = {
  id: 'c:knia-press:88765:2026-10-12', category: 'auto',
  title: '손해보험협회, 「자동차보험 경상환자 보상처리 피해 신고센터」 운영',
  when: 'exact', date: '2026-10-12', period: null, phrase: "'26.10.12.",
  quote: "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.",
  status: 'confirmed', past: false, announced: '2026-10-08',
  sources: [{ name: '손해보험협회', url: 'https://www.knia.or.kr/data/news/content?index=88765' }],
  origin: 'rule', rate: null, firstSeen: today,
};

function group(source: SourceId, overrides: Partial<NewsGroup> = {}): NewsGroup {
  const configured = config.sources.find(entry => entry.id === source)!;
  let id = 'knia-press:88765';
  let title = base.title;
  let url = base.sources[0]!.url;
  let published = '2026-10-08';
  if (source === 'hanwha') {
    const fixture = JSON.parse(readFileSync(new URL('fixtures/hanwha-list.json', import.meta.url), 'utf8'));
    const item = fixture.items[1];
    id = `hanwha:${item.seq}`;
    title = item.title;
    url = `https://company.hanwhalife.com/ko/about/company-overview/newsroom/press/${item.seq}`;
    published = item.broadcastDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  } else if (source === 'fsc-press') {
    const html = readFileSync(new URL('fixtures/fsc-list.html', import.meta.url), 'utf8');
    const block = html.split('<li>').find(block => block.includes('/no010101/87217?'))!;
    id = 'fsc-press:87217';
    title = block.match(/<a[^>]+title="([^"]+)"/)![1]!.trim();
    url = 'https://www.fsc.go.kr/no010101/87217';
    published = block.match(/class="day">(\d{4}-\d{2}-\d{2})/)![1]!;
  } else if (source !== 'knia-press') {
    const xml = readFileSync(new URL(`fixtures/${source}.xml`, import.meta.url), 'utf8');
    const block = xml.match(/<item>([\s\S]*?)<\/item>/)![1]!;
    title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)![1]!;
    url = block.match(/<link>(.*?)<\/link>/)![1]!;
    id = `${source}:${new URL(url).searchParams.get('idxno')}`;
    const date = block.match(/<pubDate>(.*?)<\/pubDate>/)![1]!;
    published = source === 'fins' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
  }
  return {
    id: `g:${id}`, kind: configured.kind, topic: 'general', title,
    url, published, firstSeen: today,
    sources: [{ name: configured.name, url }],
    itemIds: [id], summary: null, ...overrides,
  };
}

function daily(date: string, groups: NewsGroup[]): DailyReport {
  return { date, generatedAt, groups, status: [] };
}

function input(): Parameters<typeof buildLatest>[0] {
  return { today, generatedAt, changes: [], dailies: [], rates: [], status: [], sourceKinds };
}

test('오래된 정확한 날짜를 제외하고 겹치는 기간과 원문 표현을 보존한다', () => {
  const old: Change = { ...base, id: 'old', date: '2026-03-01' };
  const quarter: Change = { ...base, id: 'quarter', when: 'period', date: null, period: { start: '2027-01-01', end: '2027-03-31' }, phrase: "'27.1분기 중" };
  const phrase: Change = { ...base, id: 'phrase', when: 'phrase', date: null, phrase: '다음 달부터' };
  const result = buildLatest({ ...input(), changes: [old, quarter, phrase] });
  assert.deepEqual(result.changes.map(change => change.id), ['quarter', 'phrase']);
  assert.deepEqual(Latest.parse(result), result);
});

test('소식·공식 발표·업계 동향을 출처와 주제로 나눈다', () => {
  const groups = [group('fsc-press'), group('knia-press'), group('hanwha'), group('insnews'), group('insweek', { topic: 'industry' })];
  const result = buildLatest({ ...input(), dailies: [daily(today, groups)] });
  assert.deepEqual(result.news.map(entry => entry.kind).sort(), ['insurer', 'press']);
  assert.deepEqual(result.official.map(entry => entry.kind).sort(), ['assoc', 'gov']);
  assert.equal(result.industry.length, 1);
  assert.equal(result.counts.newToday, 5);
});

test('예정과 최근 건수는 날짜·기간 끝·원문 과거 여부로 센다', () => {
  const changes: Change[] = [
    { ...base },
    { ...base, id: 'future', date: '2027-01-01' },
    { ...base, id: 'today', date: today },
    { ...base, id: 'quarter', when: 'period', date: null, period: { start: '2027-01-01', end: '2027-03-31' } },
    { ...base, id: 'phrase', when: 'phrase', date: null, phrase: '다음 달부터', past: false },
    { ...base, id: 'past', when: 'phrase', date: null, phrase: '지난 21일', past: true },
  ];
  const result = buildLatest({ ...input(), changes });
  assert.deepEqual(result.counts, { newToday: 0, upcoming: 3, recent: 3 });
});

test('최근 3일·30일·14일은 오늘을 포함하고 미래 보고서는 제외한다', () => {
  const newsIn = group('hanwha', { firstSeen: addDays(today, -2) });
  const newsOut = group('insnews', { firstSeen: addDays(today, -3) });
  const officialIn = group('knia-press', { firstSeen: addDays(today, -29) });
  const officialOut = group('fsc-press', { firstSeen: addDays(today, -30) });
  const industryIn = group('insweek', { topic: 'industry', firstSeen: addDays(today, -13) });
  const industryOut = group('fins', { topic: 'industry', firstSeen: addDays(today, -14) });
  const future = group('hanwha', { firstSeen: addDays(today, 1) });
  const entries = [newsIn, newsOut, officialIn, officialOut, industryIn, industryOut, future];
  const result = buildLatest({ ...input(), dailies: entries.map(entry => daily(entry.firstSeen, [entry])) });
  assert.deepEqual(result.news.map(entry => entry.id), [newsIn.id]);
  assert.deepEqual(result.official.map(entry => entry.id), [officialIn.id]);
  assert.deepEqual(result.industry.map(entry => entry.id), [industryIn.id]);
});

test('여러 보고서에 같은 묶음이 있어도 한 번만 보여 준다', () => {
  const entry = group('hanwha');
  const result = buildLatest({ ...input(), dailies: [daily(today, [entry, entry]), daily(today, [entry])] });
  assert.equal(result.news.length, 1);
  assert.equal(result.counts.newToday, 1);
});

test('공시표는 시행일 내림차순으로 최대 30행을 반환한다', () => {
  const row = { company: '메리츠화재', kind: '업무용', total: -1, effective: '2026-09-26', reason: '예정사업비 변경에 따른 보험료 조정' };
  const older = { company: '메리츠화재', kind: '개인용', total: 1.3, effective: '2026-02-21', reason: '손해율실적 반영에 따른 조정 (대물가입금액확대 특약 포함)' };
  const rates = [older, ...Array.from({ length: 30 }, () => ({ ...row }))];
  const result = buildLatest({ ...input(), rates });
  assert.equal(result.rates.length, 30);
  assert.equal(result.rates[0]?.effective, row.effective);
  assert.equal(rates.length, 31);
});

test('데이터가 없어도 스키마에 맞는 빈 화면 데이터를 만든다', () => {
  const result = buildLatest(input());
  assert.deepEqual(result.counts, { newToday: 0, upcoming: 0, recent: 0 });
  assert.deepEqual(result.news, []);
  assert.deepEqual(result.status, []);
  assert.ok(Latest.safeParse(result).success);
});
