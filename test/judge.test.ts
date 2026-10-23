import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGE_PROMPT, judgeChanges } from '../src/summarize/judge.ts';
import type { JudgeInput } from '../src/summarize/judge.ts';
import type { ChatFn, ChatMessage } from '../src/summarize/models.ts';
import { Change } from '../src/schema.ts';

// 글 정보와 본문은 test/fixtures/(fins.xml, insweek.xml, latest-sample.json)과 계획에 적힌 문구에서 옮겼다
const TODAY = '2026-10-23';

const knia: JudgeInput = {
  item: {
    id: 'knia-press:88765',
    source: 'knia-press',
    title: '손해보험협회, 「자동차보험 경상환자 보상처리 피해 신고센터」 운영',
    url: 'https://www.knia.or.kr/data/news/content?index=88765',
    published: '2026-10-08',
    hints: [],
    attachments: [],
  },
  body: "손해보험협회는 '26.10.12.(월)부터 「자동차보험 경상환자 보상처리 피해 신고센터」를 운영합니다.",
  sourceName: '손해보험협회',
  topic: 'auto',
};

const seniors: JudgeInput = {
  item: {
    id: 'fsc-press:87952',
    source: 'fsc-press',
    title: '보험업권과 복지부 산하 노인지원기관이 손잡고 65만명의 취약어르신에게 낙상사고 치료비, 치매배상책임보험을 무료로 제공하겠습니다.',
    url: 'https://www.fsc.go.kr/no010101/87952',
    published: '2026-10-19',
    hints: [],
    attachments: [],
  },
  body: '올해 4분기 세부 사업계획 수립 및 서비스 수행업체 선정을 거쳐 ‘27.1분기 중 사업을 시행하며, ‘27~28년 2년에 걸쳐 운영할 예정',
  sourceName: '금융위원회',
  topic: 'life',
};

const rebuy: JudgeInput = {
  item: {
    id: 'fins:110266',
    source: 'fins',
    title: '실손 계약재매입 시행 임박…손보사 준비 분주',
    url: 'http://www.fins.co.kr/news/articleView.html?idxno=110266',
    published: '2026-10-20',
    hints: [],
    attachments: [],
  },
  body: '다음 달부터 실손의료보험 계약재매입 제도 시행을 앞둔 가운데, 주요 손해보험사들이 관련 상품 개발과 전산 구축 등 준비 작업에 속도를 내고 있다.기존 1·2세대 실손보험 가입자의 5세대 전환을 유도하기 위한 제도인 만큼 보험사별 상품 운영 방식과 기존 계약자에 대한 안내 체계 마련이 주요 과제로 떠오르고 있다.',
  sourceName: '보험매일',
  topic: 'medical',
};

const launch: JudgeInput = {
  item: {
    id: 'insweek:72754',
    source: 'insweek',
    title: '삼성생명, ‘삼성 시니어대표건강보험’ 개정 출시',
    url: 'https://www.insweek.co.kr/news/articleView.html?idxno=72754',
    published: '2026-10-20',
    hints: [],
    attachments: [],
  },
  body: '[보험신보 오윤환 기자] 삼성생명은 오는 21일 폐렴과 로봇 인공관절수술 보장을 강화한 ‘삼성 시니어대표건강보험 종합보장형’과 장기요양(LTC) 판정 이후 치료 과정을 통합 보장하는 ‘삼성 시니어대표건강보험 LTC통합치료형’을 출시한다고 20일 밝혔다.',
  sourceName: '보험신보',
  topic: 'life',
};

/** 판정 호출인지 확인하고 보낸 글 id를 기록한 뒤 정해진 답을 돌려주는 가짜 chat */
function fakeChat(answers: Record<string, unknown>[]) {
  const sent: string[][] = [];
  const chat: ChatFn = async (messages: ChatMessage[]) => {
    if (messages[0].content !== JUDGE_PROMPT) throw new Error('알 수 없는 호출');
    sent.push((JSON.parse(messages[1].content) as { id: string }[]).map((x) => x.id));
    return JSON.stringify({ items: answers });
  };
  return { chat, sent };
}

test('판정 프롬프트: 상품 출시·국감·검토/추진 제외와 원문 그대로의 quote를 명시', () => {
  assert.ok(JUDGE_PROMPT.includes('상품 출시, 국정감사 지적, 검토·추진 단계는 변경이 아니다'));
  assert.ok(JUDGE_PROMPT.includes('quote는 원문에서 글자 그대로 복사한 한 문장'));
});

test('judgeChanges: 연·월·일이 있는 quote는 exact', async () => {
  const { chat } = fakeChat([
    { id: knia.item.id, isChange: true, title: '자동차보험 경상환자 보상처리 피해 신고센터 운영', quote: knia.body, category: 'auto' },
  ]);
  const [c, ...rest] = await judgeChanges([knia], chat, TODAY);
  assert.equal(rest.length, 0);
  assert.equal(c.when, 'exact');
  assert.equal(c.date, '2026-10-12');
  assert.equal(c.period, null);
  assert.equal(c.id, 'c:knia-press:88765:ai');
  assert.equal(c.origin, 'ai');
  assert.equal(c.status, 'confirmed');
  assert.equal(c.announced, '2026-10-08');
  assert.equal(c.firstSeen, TODAY);
  assert.deepEqual(c.sources, [{ name: '손해보험협회', url: knia.item.url }]);
  Change.parse(c);
});

test("judgeChanges: '27.1분기 중이면 period 2027-01-01~03-31", async () => {
  const { chat } = fakeChat([
    { id: seniors.item.id, isChange: true, title: '취약어르신 낙상사고 치료비·치매배상책임보험 무료 제공', quote: seniors.body, category: 'life' },
  ]);
  const [c] = await judgeChanges([seniors], chat, TODAY);
  assert.equal(c.when, 'period');
  assert.equal(c.date, null);
  assert.deepEqual(c.period, { start: '2027-01-01', end: '2027-03-31' });
  assert.equal(c.phrase, '‘27.1분기 중');
  Change.parse(c);
});

test('judgeChanges: 다음 달부터는 phrase로 두고 날짜를 계산하지 않는다', async () => {
  const quote = '다음 달부터 실손의료보험 계약재매입 제도 시행을 앞둔 가운데, 주요 손해보험사들이 관련 상품 개발과 전산 구축 등 준비 작업에 속도를 내고 있다.';
  const { chat } = fakeChat([{ id: rebuy.item.id, isChange: true, title: '실손의료보험 계약재매입 제도 시행', quote, category: 'medical' }]);
  const [c] = await judgeChanges([rebuy], chat, TODAY);
  assert.equal(c.when, 'phrase');
  assert.equal(c.phrase, '다음 달부터');
  assert.equal(c.date, null);
  assert.equal(c.period, null);
  assert.equal(c.past, false);
  assert.equal(c.category, 'medical');
  Change.parse(c);
});

test('judgeChanges: quote가 본문에 글자 그대로 없으면 버린다', async () => {
  const { chat } = fakeChat([
    { id: rebuy.item.id, isChange: true, title: '실손의료보험 계약재매입 제도 시행', quote: '다음 달부터 실손의료보험 계약재매입 제도가 시행된다.', category: 'medical' },
  ]);
  assert.deepEqual(await judgeChanges([rebuy], chat, TODAY), []);
});

test('judgeChanges: isChange false(상품 출시)면 결과 없음', async () => {
  const { chat } = fakeChat([{ id: launch.item.id, isChange: false }]);
  assert.deepEqual(await judgeChanges([launch], chat, TODAY), []);
});

test('judgeChanges: 여러 글을 한 번에 판정하고, 모르는 id·잘못된 category는 걸러낸다', async () => {
  const { chat, sent } = fakeChat([
    { id: knia.item.id, isChange: true, title: '자동차보험 경상환자 보상처리 피해 신고센터 운영', quote: knia.body, category: '자동차' },
    { id: launch.item.id, isChange: false },
    { id: 'fsc-press:87217', isChange: true, title: '판매수수료 개편', quote: knia.body, category: 'general' },
  ]);
  const out = await judgeChanges([knia, launch], chat, TODAY);
  assert.deepEqual(sent, [[knia.item.id, launch.item.id]]);
  assert.deepEqual(out.map((c) => c.id), ['c:knia-press:88765:ai']);
  assert.equal(out[0].category, 'auto');
});

test('judgeChanges: 제목에 원문에 없는 숫자가 있으면 원래 글 제목을 쓴다', async () => {
  const { chat } = fakeChat([
    { id: knia.item.id, isChange: true, title: '경상환자 피해 신고센터 10월 13일 운영', quote: knia.body, category: 'auto' },
  ]);
  const [c] = await judgeChanges([knia], chat, TODAY);
  assert.equal(c.title, knia.item.title);
});

test('judgeChanges: 호출이 실패하면 예외', async () => {
  const chat: ChatFn = async () => {
    throw new Error('HTTP 429');
  };
  await assert.rejects(judgeChanges([knia], chat, TODAY), /429/);
});

test('judgeChanges: 근거 문장의 날짜가 시행 시점이 아니면(게시일 등) exact로 쓰지 않는다', async () => {
  const body = "금융위원회는 '26.10.20. 보도자료에서 해당 특약 할인이 다음 달부터 적용된다고 밝혔다.";
  const input = { ...knia, item: { ...knia.item, id: 'knia-press:1' }, body };
  const { chat } = fakeChat([{ id: input.item.id, isChange: true, title: '특약 할인 적용', quote: body, category: 'auto' }]);
  const [c] = await judgeChanges([input], chat, TODAY);
  assert.equal(c.when, 'phrase');
  assert.equal(c.date, null);
  assert.match(c.phrase, /다음 달부터/);
});
