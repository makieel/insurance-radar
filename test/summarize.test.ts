import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT, VERIFY_PROMPT, summarizeGroups } from '../src/summarize/summarize.ts';
import type { ChatFn, ChatMessage } from '../src/summarize/models.ts';
import type { NewsGroup } from '../src/schema.ts';

// 제목·발췌는 test/fixtures/insjournal.xml(idxno=33625), fins.xml(idxno=110267)에서 옮겼다
const lossRatio: NewsGroup = {
  id: 'g:insjournal:33625',
  topic: 'auto',
  kind: 'press',
  title: '9월 車보험 손해율 85.0%…전년 동월보다 8.8%p 하락',
  url: 'https://www.insjournal.co.kr/news/articleView.html?idxno=33625',
  published: '2026-10-23',
  firstSeen: '2026-10-23',
  sources: [
    { name: '보험저널', url: 'https://www.insjournal.co.kr/news/articleView.html?idxno=33625' },
    { name: '보험매일', url: 'http://www.fins.co.kr/news/articleView.html?idxno=110306' },
  ],
  itemIds: ['insjournal:33625', 'fins:110306'],
  summary: null,
};
const lossRatioSource = '삼성화재·현대해상·DB손해보험·KB손해보험 등 대형 손보사 4곳의 9월 자동차보험 손해율이 평균 85.0%로 집계됐다. 지난해 같은 달 94.2%보다 8.8%포인트 낮아진 수치다. 1~9월 누적 손해율은 84.7%로, 전년 동기보다 0.8%포인트 하락했다. 누적 수치는 4개사 손해율의 단순 평균이다.';

const seniors: NewsGroup = {
  id: 'g:fins:110267',
  topic: 'life',
  kind: 'press',
  title: '돌봄 노인에 낙상치료비·치매배상보험 150억원 규모 지원',
  url: 'http://www.fins.co.kr/news/articleView.html?idxno=110267',
  published: '2026-10-20',
  firstSeen: '2026-10-20',
  sources: [{ name: '보험매일', url: 'http://www.fins.co.kr/news/articleView.html?idxno=110267' }],
  itemIds: ['fins:110267'],
  summary: null,
};
const seniorsSource = "돌봄이 필요한 취약계층 노인들은 낙상사고 치료비를 지원받거나 치매배상책임보험에 무료로 가입할 수 있게 된다.19일 금융위원회는 보험업권 및 복지부 산하 노인지원기관(한국취약노인지원재단·독거노인종합지원센터)이 총 105억원 규모의 '시니어 취약계층 통합지원사업'을 위한 업무협약을 체결했다고 밝혔다.협약에 따라 보험업권은 자체 조성한 상생 기금 96억원을 사업 재원으로 지원한다.";

const GOOD = {
  [lossRatio.id]: '대형 손보사 4곳의 9월 자동차보험 손해율이 평균 85.0%로 집계됐어요. 지난해 같은 달 94.2%보다 8.8%포인트 낮아졌어요.',
  [seniors.id]: '돌봄이 필요한 취약계층 노인은 낙상사고 치료비를 지원받거나 치매배상책임보험에 무료로 가입할 수 있어요. 보험업권은 상생 기금 96억원을 사업 재원으로 지원해요.',
};

const groups = [
  { group: lossRatio, source: lossRatioSource },
  { group: seniors, source: seniorsSource },
];

/** 시스템 메시지로 요약 호출과 검증 호출을 구분하는 가짜 chat */
function fakeChat(summaries: Record<string, string>, verify: (ids: string[]) => string) {
  const verified: string[][] = [];
  const chat: ChatFn = async (messages: ChatMessage[]) => {
    if (messages[0].content === SYSTEM_PROMPT) {
      return JSON.stringify({ items: Object.entries(summaries).map(([id, summary]) => ({ id, summary })) });
    }
    if (messages[0].content === VERIFY_PROMPT) {
      const ids = (JSON.parse(messages[1].content) as { id: string }[]).map((x) => x.id);
      verified.push(ids);
      return verify(ids);
    }
    throw new Error('알 수 없는 호출');
  };
  return { chat, verified };
}

test('summarizeGroups: 정상이면 id → 요약', async () => {
  const { chat, verified } = fakeChat(GOOD, () => '{"unsupported":[]}');
  const out = await summarizeGroups(groups, chat);
  assert.equal(out.size, 2);
  assert.equal(out.get(lossRatio.id), GOOD[lossRatio.id]);
  assert.equal(out.get(seniors.id), GOOD[seniors.id]);
  assert.deepEqual(verified, [[lossRatio.id, seniors.id]]);
});

test('summarizeGroups: 원문에 없는 숫자가 든 요약은 검증에도 가지 않고 빠진다', async () => {
  const { chat, verified } = fakeChat(
    { ...GOOD, [lossRatio.id]: '대형 손보사 4곳의 9월 자동차보험 손해율이 평균 90.0%로 집계됐어요.' },
    () => '{"unsupported":[]}',
  );
  const out = await summarizeGroups(groups, chat);
  assert.equal(out.has(lossRatio.id), false);
  assert.equal(out.get(seniors.id), GOOD[seniors.id]);
  assert.deepEqual(verified, [[seniors.id]]);
});

test('summarizeGroups: 검증 호출이 예외면 빈 Map', async () => {
  const { chat } = fakeChat(GOOD, () => {
    throw new Error('HTTP 429');
  });
  const out = await summarizeGroups(groups, chat);
  assert.equal(out.size, 0);
});

test('summarizeGroups: 검증 응답을 읽을 수 없으면 빈 Map', async () => {
  const { chat } = fakeChat(GOOD, () => '모두 괜찮습니다');
  assert.equal((await summarizeGroups(groups, chat)).size, 0);
});

test('summarizeGroups: 검증이 고른 묶음은 빠진다', async () => {
  const { chat } = fakeChat(GOOD, () => JSON.stringify({ unsupported: [seniors.id] }));
  const out = await summarizeGroups(groups, chat);
  assert.deepEqual([...out.keys()], [lossRatio.id]);
});

test('summarizeGroups: 발췌가 없는 묶음은 한 문장만 허용', async () => {
  const { chat } = fakeChat({ [lossRatio.id]: GOOD[lossRatio.id] }, () => '{"unsupported":[]}');
  const out = await summarizeGroups([{ group: lossRatio, source: '' }], chat);
  assert.equal(out.size, 0);
});

test('summarizeGroups: 묶음 목록에 없는 id는 무시', async () => {
  const { chat } = fakeChat({ ...GOOD, 'g:insnews:93466': '교보생명은 보험금 지급까지 2시간이 걸려요.' }, () => '{"unsupported":[]}');
  const out = await summarizeGroups(groups, chat);
  assert.deepEqual([...out.keys()].sort(), [seniors.id, lossRatio.id].sort());
});

test('summarizeGroups: 첫 호출이 실패하면 예외', async () => {
  const chat: ChatFn = async () => {
    throw new Error('HTTP 503');
  };
  await assert.rejects(summarizeGroups(groups, chat), /503/);
});
