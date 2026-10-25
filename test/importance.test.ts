import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORTANCE_FORMAT, IMPORTANCE_PROMPT, rateImportance } from '../src/summarize/importance.ts';
import { RELEVANCE_FORMAT, RELEVANCE_PROMPT } from '../src/summarize/relevance.ts';
import { FORMAT_HINT, SYSTEM_PROMPT } from '../src/summarize/summarize.ts';
import { loadConfig } from '../src/config.ts';
import { runAiJobs } from '../src/cli/summarize.ts';
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
    relevanceBy: 'rule',
    importance: null,
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
    relevance: 'low',
    important: false,
    relevanceBy: 'rule',
    importance: null,
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
    relevance: 'high',
    important: false,
    relevanceBy: 'rule',
    importance: null,
  };
}

const idsOf = (message: ChatMessage, format: string): string[] =>
  (JSON.parse(message.content.slice(format.length + 2)) as { id: string }[]).map((x) => x.id);

/** 중요도 호출에 들어온 묶음 id를 기록하고, scores에 있는 값으로 답하는 가짜 chat */
function importanceChat(scores: Record<string, unknown>) {
  const calls: string[][] = [];
  const chat: ChatFn = async (messages) => {
    assert.equal(messages[0].content, IMPORTANCE_PROMPT);
    const ids = idsOf(messages[1], IMPORTANCE_FORMAT);
    calls.push(ids);
    return JSON.stringify({ items: ids.filter((id) => id in scores).map((id) => ({ id, importance: scores[id] })) });
  };
  return { chat, calls };
}

test('rateImportance: 응답대로 id → 중요도', async () => {
  const { chat, calls } = importanceChat({ [pension().id]: 3, [seniors().id]: 5 });
  const out = await rateImportance([{ group: pension(), source: '' }, { group: seniors(), source: '' }], chat);
  assert.deepEqual(calls, [[pension().id, seniors().id]]);
  assert.equal(out.get(pension().id), 3);
  assert.equal(out.get(seniors().id), 5);
});

test('rateImportance: 프롬프트에 중요도 정의가 그대로 들어 있다', () => {
  assert.match(IMPORTANCE_PROMPT, /9개월 뒤에도 개인 가입자·가족이 알아 둘 가치가 있는가\./);
  assert.match(IMPORTANCE_PROMPT, /- 5: 제도·보험료가 바뀌어 거의 모든 가입자에게 영향\. 예: 5세대 실손의료보험 출시, 자동차보험료 일제 인상·인하, 실손24 청구 전산화 확대\./);
  assert.match(IMPORTANCE_PROMPT, /- 4: 많은 가입자에게 영향이 있는 변경·주의\. 예: 특정 보험 표준약관 개정, 판매수수료 개편 시행, 대형 소비자경보\./);
  assert.match(IMPORTANCE_PROMPT, /- 3: 일부 가입자에게 실질적인 정보\. 예: 보험금 분쟁 판결로 보상 기준이 바뀜, 특정 보험사의 보험료 조정\./);
  assert.match(IMPORTANCE_PROMPT, /- 2: 알아 두면 좋은 정도\. 1: 거의 없음\./);
  assert.match(IMPORTANCE_FORMAT, /\{"items":\[\{"id":"묶음 id","importance":3\}\]\}/);
});

test('rateImportance: 1~5 정수가 아닌 값과 모르는 id는 빠진다', async () => {
  const chat: ChatFn = async () => JSON.stringify({
    items: [
      { id: pension().id, importance: 6 },
      { id: growth().id, importance: 3.5 },
      { id: seniors().id, importance: 4 },
      { id: seniors().id, importance: 1 },
      { id: 'g:fins:110293', importance: 5 },
    ],
  });
  const out = await rateImportance(
    [{ group: pension(), source: '' }, { group: growth(), source: '' }, { group: seniors(), source: '' }],
    chat,
  );
  assert.deepEqual([...out.entries()], [[seniors().id, 4]]);

  const zeroOrText: ChatFn = async () => JSON.stringify({
    items: [{ id: pension().id, importance: 0 }, { id: seniors().id, importance: '4' }],
  });
  const none = await rateImportance([{ group: pension(), source: '' }, { group: seniors(), source: '' }], zeroOrText);
  assert.equal(none.size, 0);
});

test('rateImportance: 호출이 예외면 빈 Map', async () => {
  const chat: ChatFn = async () => {
    throw new Error('HTTP 429');
  };
  const out = await rateImportance([{ group: pension(), source: '' }], chat);
  assert.equal(out.size, 0);
});

test('rateImportance: 묶음 30개씩 한 호출', async () => {
  // 개수만 보는 시험이라 같은 글의 id만 바꿔 31개를 만든다
  const groups = Array.from({ length: 31 }, (_, n) => ({ group: { ...pension(), id: `${pension().id}#${n}` }, source: '' }));
  const { chat, calls } = importanceChat({});
  await rateImportance(groups, chat);
  assert.deepEqual(calls.map((ids) => ids.length), [30, 1]);
});

function setup(groups: NewsGroup[], answers: { relevance?: Record<string, unknown>; importance?: Record<string, unknown> }) {
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
      const ratings = answers.relevance ?? {};
      const ids = idsOf(messages[1], RELEVANCE_FORMAT);
      return JSON.stringify({ items: ids.filter((id) => id in ratings).map((id) => ({ id, ...(ratings[id] as object) })) });
    }
    if (messages[0].content === IMPORTANCE_PROMPT) {
      order.push('importance');
      const scores = answers.importance ?? {};
      const ids = idsOf(messages[1], IMPORTANCE_FORMAT);
      return JSON.stringify({ items: ids.filter((id) => id in scores).map((id) => ({ id, importance: scores[id] })) });
    }
    if (messages[0].content === SYSTEM_PROMPT) {
      order.push('summary');
      summarized.push(idsOf(messages[1], FORMAT_HINT));
      // 요약을 내지 않으면 검증 호출도 없다
      return '{"items":[]}';
    }
    throw new Error('알 수 없는 호출');
  };
  return { daily, store, chat, order, summarized };
}

const job = (type: PendingAi['type'], group: NewsGroup, source: PendingAi['source']): PendingAi =>
  ({ type, id: group.id, url: group.url, date: today, source });

test('runAiJobs: 중요도를 daily에 기록하고 4 이상이면 요약 대기를 더한다', async () => {
  const config = loadConfig();
  const pending = [job('importance', pension(), 'fins'), job('importance', seniors(), 'fsc-press')];
  const { daily, store, chat, order, summarized } = setup([pension(), seniors()], {
    importance: { [pension().id]: 5, [seniors().id]: 2 },
  });
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });

  assert.deepEqual(order, ['importance', 'summary']);
  assert.deepEqual(summarized, [[pension().id]]);
  const byId = new Map(daily.groups.map((g) => [g.id, g]));
  assert.equal(byId.get(pension().id)?.importance, 5);
  assert.equal(byId.get(seniors().id)?.importance, 2);
  assert.equal(out.scored, 2);
  assert.deepEqual(out.remaining, []);
  assert.deepEqual([...out.dirty], [today]);
  assert.deepEqual(usage, { date: today, calls: 3, summaries: 1 });
});

test('runAiJobs: 이미 요약이 있거나 요약 대기가 있으면 요약 대기를 또 더하지 않는다', async () => {
  const config = loadConfig();
  const summarizedSeniors = { ...seniors(), summary: '이미 요약됨' };
  const pending = [
    job('importance', pension(), 'fins'),
    job('importance', summarizedSeniors, 'fsc-press'),
    job('summary', pension(), 'fins'),
  ];
  const { store, chat, order, summarized } = setup([pension(), summarizedSeniors], {
    importance: { [pension().id]: 4, [summarizedSeniors.id]: 5 },
  });
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(order, ['importance', 'summary']);
  assert.deepEqual(summarized, [[pension().id]]);
  assert.deepEqual(out.remaining, []);
});

test('runAiJobs: AI가 관련도를 low로 바꾼 묶음은 중요도 작업을 건너뛴다', async () => {
  const config = loadConfig();
  const pending = [job('relevance', pension(), 'fins'), job('importance', pension(), 'fins')];
  const { daily, store, chat, order } = setup([pension()], {
    relevance: { [pension().id]: { relevance: 'low', important: false } },
    importance: { [pension().id]: 3 },
  });
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(order, ['relevance']);
  assert.equal(daily.groups[0].importance, null);
  assert.equal(out.scored, 0);
  assert.equal(out.dropped, 1);
  assert.deepEqual(out.remaining, []);
  assert.equal(usage.calls, 1);
});

test('runAiJobs: 규칙 low에서 올라온 묶음은 중요도 대기에 더해 매긴다', async () => {
  const config = loadConfig();
  const lowPension = { ...pension(), relevance: 'low' as const };
  const pending = [job('relevance', lowPension, 'fins')];
  const { daily, store, chat, order } = setup([lowPension], {
    relevance: { [lowPension.id]: { relevance: 'high', important: false } },
    importance: { [lowPension.id]: 3 },
  });
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(order, ['relevance', 'importance', 'summary']);
  assert.equal(daily.groups[0].importance, 3);
  assert.deepEqual(out.remaining, []);
});

test('runAiJobs: 중요도 호출이 실패하면 중요도 대기는 남기고 요약은 계속한다', async () => {
  const config = loadConfig();
  const pending = [job('importance', pension(), 'fins'), job('summary', pension(), 'fins')];
  const { daily, store, summarized } = setup([pension()], {});
  const chat: ChatFn = async (messages) => {
    if (messages[0].content === IMPORTANCE_PROMPT) throw new Error('HTTP 503');
    summarized.push(idsOf(messages[1], FORMAT_HINT));
    return '{"items":[]}';
  };
  const usage: AiUsage = { date: today, calls: 0, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(summarized, [[pension().id]]);
  assert.equal(daily.groups[0].importance, null);
  assert.deepEqual(out.remaining, [job('importance', pension(), 'fins')]);
});

test('runAiJobs: 오늘 쓴 호출이 상한에 닿으면 중요도 대기는 다음 실행으로', async () => {
  const base = loadConfig();
  const config = { ...base, limits: { ...base.limits, aiCallsPerDay: 10 } };
  const pending = [job('importance', pension(), 'fins')];
  const { store, chat, order } = setup([pension()], { importance: { [pension().id]: 5 } });
  const usage: AiUsage = { date: today, calls: 10, summaries: 0 };
  const out = await runAiJobs({ config, chat, today, pending, usage, store });
  assert.deepEqual(order, []);
  assert.deepEqual(out.remaining, pending);
  assert.equal(usage.calls, 10);
});

test('backfillImportanceJobs: 중요도가 없는 기존 묶음을 공식 발표부터 대기열에 붙이고 중복·기간 밖은 뺀다', async () => {
  const { backfillImportanceJobs } = await import('../src/cli/summarize.ts');
  const base = { topic: 'medical' as const, title: '5월 6일부터 치료비 부담이 큰 중증질환의 보장을 강화하고, 보험료는 낮춘 5세대 실손의료보험이 새롭게 출시·판매됩니다.', url: 'https://www.fsc.go.kr/no010101/86831', firstSeen: '2026-10-23', summary: null, important: false, relevanceBy: 'rule' as const, importance: null };
  const gov = { ...base, id: 'g:fsc-press:86831', kind: 'gov' as const, published: '2026-05-06', relevance: 'high' as const, sources: [{ name: '금융위원회', url: base.url }], itemIds: ['fsc-press:86831'] };
  const press = { ...base, id: 'g:insnews:1', kind: 'press' as const, published: '2026-10-20', relevance: 'medium' as const, sources: [{ name: '한국보험신문', url: base.url }], itemIds: ['insnews:1'] };
  const old = { ...gov, id: 'g:fsc-press:1', published: '2025-12-01', itemIds: ['fsc-press:1'] };
  const scored = { ...gov, id: 'g:fsc-press:2', importance: 5, itemIds: ['fsc-press:2'] };
  const report = { date: '2026-10-23', generatedAt: '2026-10-23T00:00:00Z', groups: [press, gov, old, scored], status: [] };
  const jobs = backfillImportanceJobs([], [report], '2026-01-25');
  assert.deepEqual(jobs.map((j) => j.id), ['g:fsc-press:86831', 'g:insnews:1']);
  assert.equal(backfillImportanceJobs(jobs, [report], '2026-01-25').length, 2);
});
