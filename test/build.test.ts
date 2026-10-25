import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoise } from '../src/analyze/relevance.ts';
import { readFileSync } from 'node:fs';
import { buildLatest, ruleImportance } from '../src/cli/build.ts';
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
    // 빌드가 잡음·제외 규칙을 다시 적용하므로, 그 규칙에 걸리지 않는 첫 기사를 쓴다.
    const block = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]!).find(b => {
      const t = b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)![1]!;
      return !isNoise(t, config.keywords) && !config.keywords.exclude.some(w => t.includes(w));
    })!;
    title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)![1]!;
    url = block.match(/<link>(.*?)<\/link>/)![1]!;
    id = `${source}:${new URL(url).searchParams.get('idxno')}`;
    const date = block.match(/<pubDate>(.*?)<\/pubDate>/)![1]!;
    published = source === 'fins' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
  }
  return {
    id: `g:${id}`, kind: configured.kind, topic: 'general', title,
    // 기간 판정은 게시일 기준이므로, 테스트 묶음의 게시일은 기본으로 오늘로 둔다(fixture의 실제 게시일은 published 덮어쓰기로 확인).
    url, published: overrides.published ?? (published >= today ? published : today), firstSeen: today,
    sources: [{ name: configured.name, url }],
    // 기존 분류 테스트는 화면에 보이는 관련도(medium)를 기본으로 둔다. 관련도 판단은 아래 테스트에서 따로 확인한다.
    itemIds: [id], summary: null, relevance: 'medium', important: false, relevanceBy: 'rule', importance: null, ...overrides,
  };
}

/** 같은 출처의 서로 다른 묶음(번호만 다르게) */
function numbered(source: SourceId, n: number, overrides: Partial<NewsGroup> = {}): NewsGroup {
  const entry = group(source, overrides);
  const id = `${entry.itemIds[0]}-${n}`;
  return { ...entry, id: `g:${id}`, itemIds: [id] };
}

function threeSources(entry: NewsGroup): NewsGroup['sources'] {
  return ['insnews', 'insweek', 'insjournal'].map(source => ({ name: config.sources.find(s => s.id === source)!.name, url: entry.url }));
}

function daily(date: string, groups: NewsGroup[]): DailyReport {
  return { date, generatedAt, groups, status: [] };
}

function input(): Parameters<typeof buildLatest>[0] {
  return { today, generatedAt, changes: [], dailies: [], rates: [], status: [], sourceKinds, keywords: config.keywords, limits: config.limits };
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
  const groups = [group('fsc-press'), group('knia-press'), group('hanwha'), group('insnews'), group('insweek', { topic: 'industry', important: true })];
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
  const newsIn = group('hanwha', { firstSeen: addDays(today, -2), published: addDays(today, -2) });
  const newsOut = group('insnews', { firstSeen: addDays(today, -3), published: addDays(today, -3) });
  const officialIn = group('knia-press', { firstSeen: addDays(today, -29), published: addDays(today, -29) });
  const officialOut = group('fsc-press', { firstSeen: addDays(today, -30), published: addDays(today, -30) });
  const industryIn = group('insweek', { topic: 'industry', important: true, firstSeen: addDays(today, -13), published: addDays(today, -13) });
  const industryOut = group('fins', { topic: 'industry', important: true, firstSeen: addDays(today, -14), published: addDays(today, -14) });
  const future = group('hanwha', { firstSeen: addDays(today, 1), published: addDays(today, 1) });
  const entries = [newsIn, newsOut, officialIn, officialOut, industryIn, industryOut, future];
  const result = buildLatest({ ...input(), dailies: entries.map(entry => daily(entry.firstSeen, [entry])) });
  assert.deepEqual(result.news.map(entry => entry.id), [newsIn.id]);
  assert.deepEqual(result.official.map(entry => entry.id), [officialIn.id]);
  assert.deepEqual(result.industry.map(entry => entry.id), [industryIn.id]);
});

test('첫 실행 채우기로 처음 본 옛 글은 최근 소식에 넣지 않는다', () => {
  const old = group('insnews', { published: '2026-05-01' });
  const result = buildLatest({ ...input(), dailies: [daily(today, [old])] });
  assert.equal(result.news.length, 0);
  assert.equal(result.counts.newToday, 0);
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

test('소식에는 관련도 low가 없고 관련도가 없는 옛 데이터는 규칙으로 채운다', () => {
  const high = numbered('insnews', 1, { relevance: 'high' });
  const low = numbered('insweek', 2, { relevance: 'low' });
  const legacyHigh = numbered('fins', 3, { relevance: null, relevanceBy: null, title: '연금저축보험, 가입 때 안내받은 연금액 보장 안돼…중도해지 땐 세금 부담' });
  const legacyLow = numbered('fins', 4, { relevance: null, relevanceBy: null, title: '보험산업 성장률 내년 3.5%' });
  const result = buildLatest({ ...input(), dailies: [daily(today, [high, low, legacyHigh, legacyLow])] });
  assert.ok(result.news.every(entry => entry.relevance === 'high' || entry.relevance === 'medium'));
  assert.deepEqual(result.news.map(entry => entry.id).sort(), [high.id, legacyHigh.id].sort());
  const filled = result.news.find(entry => entry.id === legacyHigh.id);
  assert.equal(filled?.relevance, 'high');
  assert.equal(filled?.relevanceBy, 'rule');
  // low지만 중요하지도, 여러 출처도 아니면 업계 동향에도 넣지 않는다.
  assert.deepEqual(result.industry, []);
});

test('소식은 관련도 high를 먼저, 그다음 게시일 최신순으로 둔다', () => {
  const mediumToday = numbered('insnews', 1, { relevance: 'medium', published: today });
  const highYesterday = numbered('insnews', 2, { relevance: 'high', published: addDays(today, -1) });
  const highToday = numbered('insweek', 3, { relevance: 'high', published: today });
  const result = buildLatest({ ...input(), dailies: [daily(today, [mediumToday, highYesterday, highToday])] });
  assert.deepEqual(result.news.map(entry => entry.id), [highToday.id, highYesterday.id, mediumToday.id]);
});

test('업계 동향은 중요한 것을 먼저 두고 (소식+공식 발표)/9개로 자른다', () => {
  const news = [
    ...Array.from({ length: 15 }, (_, n) => numbered('insnews', n)),
    ...Array.from({ length: 3 }, (_, n) => numbered('knia-press', n)),
  ];
  const importantMany = numbered('insweek', 1, { topic: 'industry', important: true });
  importantMany.sources = threeSources(importantMany);
  const importantOne = numbered('insweek', 2, { topic: 'industry', important: true });
  const many = numbered('insweek', 3, { topic: 'industry' });
  many.sources = threeSources(many);
  const lowMany = numbered('insweek', 4, { relevance: 'low' });
  lowMany.sources = threeSources(lowMany);
  const plain = numbered('insweek', 5, { topic: 'industry' });
  const industry = [plain, lowMany, many, importantOne, importantMany];

  const result = buildLatest({ ...input(), dailies: [daily(today, [...news, ...industry])] });
  assert.equal(result.news.length, 15);
  assert.equal(result.official.length, 3);
  assert.deepEqual(result.industry.map(entry => entry.id), [importantMany.id, importantOne.id]);

  const alone = buildLatest({ ...input(), dailies: [daily(today, industry)] });
  assert.deepEqual(alone.industry.map(entry => entry.id), [importantMany.id]);
});

test('칸별 상한: 소식 15개, 공식 발표 8개', () => {
  const news = Array.from({ length: 20 }, (_, n) => numbered('insnews', n));
  const official = Array.from({ length: 10 }, (_, n) => numbered('knia-press', n));
  const result = buildLatest({ ...input(), dailies: [daily(today, [...news, ...official])] });
  assert.equal(result.news.length, 15);
  assert.equal(result.official.length, 8);
});

test('ruleImportance: gov·high 3, 출처 3곳 이상·high 3, high 2, medium 1', () => {
  assert.equal(ruleImportance(group('fsc-press', { relevance: 'high' })), 3);
  const many = group('insnews', { relevance: 'high' });
  many.sources = threeSources(many);
  assert.equal(ruleImportance(many), 3);
  assert.equal(ruleImportance(group('insnews', { relevance: 'high' })), 2);
  assert.equal(ruleImportance(group('insnews', { relevance: 'medium' })), 1);
});

test('주요 소식은 점수 내림차순 → 게시일 최신순이고 소식·공식 발표와 겹치지 않는다', () => {
  const govOld5 = numbered('fsc-press', 1, { relevance: 'high', importance: 5, published: addDays(today, -100) });
  const govRule = numbered('fsc-press', 2, { relevance: 'high', published: addDays(today, -40) });
  const pressRule = numbered('insnews', 3, { relevance: 'high', published: addDays(today, -50) });
  const pressNew5 = numbered('insnews', 4, { relevance: 'high', importance: 5, published: addDays(today, -10) });
  const medium4 = numbered('insnews', 5, { relevance: 'medium', importance: 4, published: addDays(today, -60) });
  const inNews = group('hanwha', { relevance: 'high', importance: 5 });
  const inOfficial = numbered('fsc-press', 9, { relevance: 'high', importance: 5, published: addDays(today, -5) });
  const all = [govOld5, govRule, pressRule, pressNew5, medium4, inNews, inOfficial];
  const result = buildLatest({ ...input(), dailies: [daily(today, all)] });
  assert.deepEqual(result.news.map(entry => entry.id), [inNews.id]);
  assert.deepEqual(result.official.map(entry => entry.id), [inOfficial.id]);
  assert.deepEqual(result.highlights.map(entry => entry.id), [pressNew5.id, govOld5.id, medium4.id, govRule.id, pressRule.id]);
  // 화면 별점용으로 규칙 점수가 채워진다
  assert.deepEqual(result.highlights.map(entry => entry.importance), [5, 5, 4, 3, 2]);
  assert.ok(Latest.safeParse(result).success);
});

test('기간 밖·업계 동향·관련도 low·중요도 4 미만 medium은 주요 소식에서 뺀다', () => {
  const edge = numbered('fsc-press', 1, { relevance: 'high', published: addDays(today, 1 - config.limits.highlightsDays) });
  const outside = numbered('fsc-press', 2, { relevance: 'high', importance: 5, published: addDays(today, -config.limits.highlightsDays) });
  const industry = numbered('insweek', 3, { topic: 'industry', relevance: 'high', importance: 5, published: addDays(today, -40) });
  const low = numbered('insnews', 4, { relevance: 'low', importance: 5, published: addDays(today, -40) });
  const medium3 = numbered('insnews', 5, { relevance: 'medium', importance: 3, published: addDays(today, -45) });
  const mediumNone = numbered('insnews', 6, { relevance: 'medium', published: addDays(today, -50) });
  const result = buildLatest({ ...input(), dailies: [daily(today, [edge, outside, industry, low, medium3, mediumNone])] });
  assert.deepEqual(result.highlights.map(entry => entry.id), [edge.id]);
});

test('업계 동향 상한 = min(industryMax, max(1, floor((소식 + 공식 발표 + 주요 소식) / 9)))', () => {
  const news = Array.from({ length: 9 }, (_, n) => numbered('insnews', n));
  const highlights = Array.from({ length: 9 }, (_, n) => numbered('fins', n, { relevance: 'high', published: addDays(today, -40) }));
  const industry = Array.from({ length: 3 }, (_, n) => numbered('insweek', n, { topic: 'industry', important: true }));
  const dailies = [daily(today, [...news, ...highlights, ...industry])];
  const result = buildLatest({ ...input(), dailies });
  assert.equal(result.news.length, 9);
  assert.equal(result.highlights.length, 9);
  assert.equal(result.industry.length, 2);
  const capped = buildLatest({ ...input(), dailies, limits: { ...config.limits, industryMax: 1 } });
  assert.equal(capped.industry.length, 1);
});

test('데이터가 없어도 스키마에 맞는 빈 화면 데이터를 만든다', () => {
  const result = buildLatest(input());
  assert.deepEqual(result.counts, { newToday: 0, upcoming: 0, recent: 0 });
  assert.deepEqual(result.news, []);
  assert.deepEqual(result.highlights, []);
  assert.deepEqual(result.status, []);
  assert.ok(Latest.safeParse(result).success);
});

test('하루 여러 번 실행으로 따로 생긴 같은 소식 묶음은 화면에서 하나로 합친다', () => {
  const a = group('insjournal', { title: '9월 車보험 손해율 85.0%…전년 동월보다 8.8%p 하락', topic: 'auto', relevance: 'medium' });
  const b = group('insnews', { title: '9월 자동차보험 손해율 85%… 1년 전보다 9.2%p 하락', topic: 'auto', relevance: 'medium' });
  const result = buildLatest({ ...input(), dailies: [daily(today, [a]), daily(today, [b])] });
  assert.equal(result.news.length, 1);
  assert.equal(result.news[0]?.sources.length, 2);
});

test('저장된 묶음에도 지금의 제외·잡음 규칙을 다시 적용한다', () => {
  // 2026-09 중앙일보 실제 제목(공적 연금 기사)과 업계 행사 기사
  const pension = group('insnews', { title: '한 달 보험료 내고 노령연금 수급권…국민연금 ‘추납 꼼수’ 막는다', relevance: 'high' });
  const meeting = group('insweek', { title: '손해사정사회, 임시총회·회원 단합대회 개최', relevance: 'medium' });
  const result = buildLatest({ ...input(), dailies: [daily(today, [pension, meeting])] });
  assert.equal(result.news.length, 0);
  assert.equal(result.highlights.length, 0);
});
