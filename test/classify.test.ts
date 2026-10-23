import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/analyze/classify.ts';
import { loadConfig } from '../src/config.ts';
import type { SourceKind } from '../src/schema.ts';

const kw = loadConfig().keywords;

function topicOf(title: string, kind: SourceKind, hints: string[] = [], body: string | null = null) {
  return classify({ title, hints, body, kind }, kw);
}

test('classify: 보험 단어가 없는 전문지 기사는 exclude', () => {
  assert.equal(topicOf('하나금융, 3분기 누적 순익 3조6243억원', 'press'), 'exclude');
});

test('classify: 업계 동향은 industry', () => {
  assert.equal(topicOf('ABL생명, 전속 설계사 3000명 돌파', 'press'), 'industry');
});

test('classify: 종류별 분류', () => {
  assert.equal(topicOf('9월 車보험 손해율 85.0%', 'press'), 'auto');
  assert.equal(topicOf('실손보험 청구 민간 배제', 'press'), 'medical');
  assert.equal(topicOf('연금저축보험, 가입 때 안내받은 연금액 보장 안돼', 'press'), 'life');
});

test('classify: 기업보험 소식은 exclude', () => {
  assert.equal(topicOf('DB손해보험, 중소기업 사이버위험 대응 강화', 'press'), 'exclude');
});

test('classify: 규정변경예고는 general', () => {
  assert.equal(
    topicOf('「보험업감독규정」 일부개정고시안 규정변경예고', 'gov', ['구분 : 규정변경예고', '예고기간 : 2026-09-11 ~ 2026-09-21']),
    'general',
  );
});
