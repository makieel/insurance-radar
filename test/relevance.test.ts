import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { isNoise, ruleRelevance } from '../src/analyze/relevance.ts';

const kw = loadConfig().keywords;

test('실적 점유율·단합대회 글은 잡음이고 개인 관련 단어가 있으면 살린다', () => {
  assert.equal(isNoise('[9월 GA 생보사 실적 M/S] 한화라이프랩, 신한라이프 39% \'선두\'', kw), true);
  assert.equal(isNoise('손해사정사회, 임시총회·회원 단합대회 개최', kw), true);
  assert.equal(isNoise('보험사, 할인 특약 내세워 정보만 수집', kw), false);
});

test('보장·해지가 제목에 함께 있으면 high', () => {
  const title = '연금저축보험, 가입 때 안내받은 연금액 보장 안돼…중도해지 땐 세금 부담';
  assert.equal(ruleRelevance({ title, hints: [], body: null, kind: 'press', topic: 'life' }, kw), 'high');
});

test('손해율 기사는 low가 아니다', () => {
  const title = '9월 車보험 손해율 85.0%…전년 동월보다 8.8%p 하락';
  assert.notEqual(ruleRelevance({ title, hints: [], body: null, kind: 'press', topic: 'auto' }, kw), 'low');
});

test('업계 동향은 low', () => {
  assert.equal(ruleRelevance({ title: '보험산업 성장률 내년 3.5%', hints: [], body: null, kind: 'press', topic: 'industry' }, kw), 'low');
});

test('정부 발표(소비자경보 포함)는 high', () => {
  const title = '(소비자경보 2026-20호) 「보험점검센터」는 공공기관이 아닙니다! 개인정보 제공 동의 요청에 유의하세요.';
  assert.equal(ruleRelevance({ title, hints: [], body: null, kind: 'gov', topic: 'general' }, kw), 'high');
});

test('제목에 개인 단어가 없으면 본문 앞 300자에 2개 이상일 때만 medium', () => {
  const body = '내년 보험산업 성장률이 3.5%에 그칠 것으로 전망됐다. 올해 예상 성장률의 절반에도 못 미치는 수준으로, 2025년 이후 2년 연속 하락세다. 생명보험은 보장성보험을 중심으로 성장세를 이어가겠지만 저축성·변액보험과 퇴직연금의 부진이 전체 성장률을 끌어내릴 것으로 예상된다. 손해보험 역시 장기인보험이 성장을 주도하는 가운데 자동차보험의 보험료 인상 효과가 약해지면서 증가세가 둔화할 전망이다.';
  const noPersonal = '보험산업 성장률 내년 3.5%';
  assert.equal(ruleRelevance({ title: noPersonal, hints: [], body: null, kind: 'press', topic: 'general' }, kw), 'low');
  assert.equal(ruleRelevance({ title: noPersonal, hints: [], body, kind: 'press', topic: 'general' }, kw), 'medium');
});
