import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEVANCE_FORMAT, RELEVANCE_PROMPT, rateRelevance } from '../src/summarize/relevance.ts';
import { FORMAT_HINT, SYSTEM_PROMPT } from '../src/summarize/summarize.ts';
import { loadConfig } from '../src/config.ts';
import { needsSummary, runAiJobs } from '../src/cli/summarize.ts';
import type { AiStore } from '../src/cli/summarize.ts';
import type { ChatFn, ChatMessage } from '../src/summarize/models.ts';
import type { DailyReport, NewsGroup } from '../src/schema.ts';
import type { AiUsage, PendingAi } from '../src/store.ts';

const today = '2026-10-23';

// 제목·주소는 test/fixtures/fins.xml(idxno=110290, 110294), latest-sample.json(fsc-press:87952)에서 옮겼다
function pension(): NewsGroup {
  return {
    id: 'g:fins:110290',
    topic: 'life',
    kind: 'press',
    title: '연금저축보험, 가입 때 안내받은 연금액 보장 안돼…중도해지 땐 세금 부담',
    url: 'http://www.fins.co.kr/news/articleView.html?idxno=110290',
    published: '2026-10-22',
    firstSeen: today,
    sources: [{ name: '보험매일', url: 'http://www.fins.co.kr/news/articleView.html?idxno=110290' }],
    itemIds: ['fins:110290'],
    summary: null,
    relevance: 'high',
    important: false,
    relevanceBy: 'rule', importance: null, importanceVersion: null,
  };
}

function growth(): NewsGroup {
  return {
    id: 'g:fins:110294',
    topic: 'industry',
    kind: 'press',
    title: '보험산업 성장률 내년 3.5%…보장성·장기인보험 쏠림 심화',
    url: 'http://www.fins.co.kr/news/articleView.html?idxno=110294',
    published: '2026-10-22',
    firstSeen: today,
    sources: [{ name: '보험매일', url: 'http://www.fins.co.kr/news/articleView.html?idxno=110294' }],
    itemIds: ['fins:110294'],
    summary: null,
    relevance: 'medium',
    important: false,
    relevanceBy: 'rule', importance: null, importanceVersion: null,
  };
}

function seniors(): NewsGroup {
  return {
    id: 'g:fsc-press:87952',
    topic: 'life',
    kind: 'gov',
    title: '보험업권과 복지부 산하 노인지원기관이 손잡고 65만명의 취약어르신에게 낙상사고 치료비, 치매배상책임보험을 무료로 제공하겠습니다.',
    url: 'https://www.fsc.go.kr/no010101/87952',
    published: '2026-10-19',
    firstSeen: today,
    sources: [{ name: '금융위원회', url: 'https://www.fsc.go.kr/no010101/87952' }],
    itemIds: ['fsc-press:87952'],
    summary: null,
    relevance: 'low',
    important: false,
    relevanceBy: 'rule', importance: null, importanceVersion: null,
  };
}

/** 관련도 호출에 들어온 묶음 id를 기록하고, ratings에 있는 값으로 답하는 가짜 chat */
function relevanceChat(ratings: Record<string, unknown>) {
  const calls: string[][] = [];
  const chat: ChatFn = async (messages: ChatMessage[]) => {
    assert.equal(messages[0].content, RELEVANCE_PROMPT);
    const ids = (JSON.parse(messages[1].content.slice(RELEVANCE_FORMAT.length + 2)) as { id: string }[]).map((x) => x.id);
    calls.push(ids);
    return JSON.stringify({ items: ids.filter((id) => id in ratings).map((id) => ({ id, ...(ratings[id] as object) })) });
  };
  return { chat, calls };
}

test('rateRelevance: 응답대로 id → 관련도·important', async () => {
  const { chat, calls } = relevanceChat({
    [pension().id]: { relevance: 'high', important: false },
    [growth().id]: { relevance: 'low', important: false },
  });
  const out = await rateRelevance([{ group: pension(), source: '' }, { group: growth(), source: '' }], chat);
  assert.deepEqual(calls, [[pension().id, growth().id]]);
  assert.deepEqual(out.get(pension().id), { relevance: 'high', important: false });
  assert.deepEqual(out.get(growth().id), { relevance: 'low', important: false });
});

test('rateRelevance: 프롬프트에 관련도 정의가 들어 있다', () => {
  assert.match(RELEVANCE_PROMPT, /내 보험료·보험금·약관·특약·청구·해지·가입 판단에 직접 영향/);
  assert.match(RELEVANCE_PROMPT, /보험사 통합·매각·정리\(계약자 보호와 관련\)/);
});

test('rateRelevance: 값이 이상한 항목은 빠진다', async () => {
  const chat: ChatFn = async () => JSON.stringify({
    items: [
      { id: pension().id, relevance: 'urgent', important: false },
      { id: growth().id, relevance: 'low', important: 'yes' },
      { id: 'g:fins:110293', relevance: 'low', important: false },
      { id: seniors().id, relevance: 'high', important: true },
    ],
  });
  const out = await rateRelevance(
    [{ group: pension(), source: '' }, { group: growth(), source: '' }, { group: seniors(), source: '' }],
    chat,
  );
  assert.deepEqual([...out.keys()], [seniors().id]);
  assert.deepEqual(out.get(seniors().id), { relevance: 'high', important: true });
});

test('rateRelevance: 호출이 예외면 빈 Map', async () => {
  const chat: ChatFn = async () => {
    throw new Error('HTTP 429');
  };
  const out = await rateRelevance([{ group: pension(), source: '' }], chat);
  assert.equal(out.size, 0);
});

test('rateRelevance: 묶음 25개씩 한 호출', async () => {
  // 개수만 보는 시험이라 같은 글의 id만 바꿔 30개를 만든다
  const groups = Array.from({ length: 30 }, (_, n) => ({ group: { ...pension(), id: `${pension().id}#${n}` }, source: '' }));
  const { chat, calls } = relevanceChat({});
  await rateRelevance(groups, chat);
  assert.deepEqual(calls.map((ids) => ids.length), [25, 5]);
});

test('needsSummary: low는 건너뛰고 gov·assoc는 요약한다', () => {
  assert.equal(needsSummary(pension()), true);
  assert.equal(needsSummary({ ...growth(), relevance: 'low' }), false);
  assert.equal(needsSummary(seniors()), true);
  assert.equal(needsSummary({ ...seniors(), kind: 'assoc' }), true);
  assert.equal(needsSummary({ ...pension(), summary: '이미 요약됨' }), false);
});

function setup(groups: NewsGroup[], ratings: Record<string, unknown>) {
  const daily: DailyReport = { date: today, generatedAt: `${today}T00:00:00.000Z`, groups, status: [] };
  const store: AiStore = {
    daily: (date) => (date === today ? daily : null),
    rawItems: () => new Map(),
    body: () => '',
    excerpt: async () => '',
  };
  const order: string[] = [];
  const summarized: string[][] = [];
  const chat: ChatFn = async (messages) => {
    if (messages[0].content === RELEVANCE_PROMPT) {
      order.push('relevance');
      const ids = (JSON.parse(messages[1].content.slice(RELEVANCE_FORMAT.length + 2)) as { id: string }[]).map((x) => x.id);
      return JSON.stringify({ items: ids.filter((id) => id in ratings).map((id) => ({ id, ...(ratings[id] as object) })) });
    }
    if (messages[0].content === SYSTEM_PROMPT) {
      order.push('summary');
      summarized.push((JSON.parse(messages[1].content.slice(FORMAT_HINT.length + 2)) as { id: string }[]).map((x) => x.id));
      // 요약을 내지 않으면 검증 호출도 없다
      return '{"items":[]}';
    }
    throw new Error('알 수 없는 호출');
  };
  return { daily, store, chat, order, summarized };
}

const job = (type: PendingAi['type'], group: NewsGroup, source: PendingAi['source']): PendingAi =>
  ({ type, id: group.id, url: group.url, date: today, source });

test('runAiJobs: 관련도를 먼저 고치고, low가 된 묶음은 요약하지 않고 대기에서 뺀다(gov는 요약)', async () => {
  const config = loadConfig();
  const pending = [
    job('summary', pension(), 'fins'),
    job('summary', growth(), 'fins'),
    job('summary', seniors(), 'fsc-press'),
    job('relevance', pension(), 'fins'),
    job('relevance', growth(), 'fins'),
  ];
  const { daily, store, chat, order, summarized } = setup([pension(), growth(), seniors()], {
    [pension().id]: { relevance: 'high', important: false },
    [growth().id]: { relevance: 'low', important: false },
  });
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });

  assert.deepEqual(order, ['relevance', 'summary']);
  assert.deepEqual(summarized, [[pension().id, seniors().id]]);
  const byId = new Map(daily.groups.map((g) => [g.id, g]));
  assert.equal(byId.get(growth().id)?.relevance, 'low');
  assert.equal(byId.get(growth().id)?.relevanceBy, 'ai');
  assert.equal(byId.get(pension().id)?.relevanceBy, 'ai');
  assert.equal(byId.get(seniors().id)?.relevanceBy, 'rule');
  assert.equal(out.rated, 2);
  assert.deepEqual(out.remaining, []);
  assert.deepEqual([...out.dirty], [today]);
  assert.deepEqual(usage, { date: today, calls: 3, summaries: 2 });
});

test('runAiJobs: 규칙 low에서 올라온 묶음은 요약 대기에 더해 요약한다', async () => {
  const config = loadConfig();
  const lowGrowth = { ...growth(), relevance: 'low' as const };
  const pending = [job('relevance', lowGrowth, 'fins')];
  const { store, chat, summarized } = setup([lowGrowth], {
    [lowGrowth.id]: { relevance: 'medium', important: false },
  });
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(summarized, [[lowGrowth.id]]);
  assert.deepEqual(out.remaining, []);
});

test('runAiJobs: 오늘 쓴 호출이 상한에 닿으면 남은 작업은 다음 실행으로', async () => {
  const base = loadConfig();
  const config = { ...base, limits: { ...base.limits, aiCallsPerDay: 10, summariesPerDay: 30 } };
  const pending = [job('relevance', pension(), 'fins'), job('summary', pension(), 'fins')];
  const { store, chat, order } = setup([pension()], {
    [pension().id]: { relevance: 'high', important: false },
  });
  // 앞선 실행에서 9번 썼으면 관련도 한 번만 하고 요약(2번)은 미룬다
  const usage: AiUsage = { date: today, calls: 9, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(order, ['relevance']);
  assert.deepEqual(out.remaining, [job('summary', pension(), 'fins')]);
  assert.equal(usage.calls, 10);
});

test('runAiJobs: 관련도 호출이 실패하면 관련도 대기는 남기고 요약은 계속한다', async () => {
  const config = loadConfig();
  const pending = [job('relevance', pension(), 'fins'), job('summary', pension(), 'fins')];
  const { store, summarized } = setup([pension()], {});
  const chat: ChatFn = async (messages) => {
    if (messages[0].content === RELEVANCE_PROMPT) throw new Error('HTTP 503');
    summarized.push([]);
    return '{"items":[]}';
  };
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.equal(summarized.length, 1);
  assert.deepEqual(out.remaining, [job('relevance', pension(), 'fins')]);
});
