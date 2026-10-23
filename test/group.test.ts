import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupItems, similar, titleKey } from '../src/analyze/group.ts';
import type { GroupInput } from '../src/analyze/group.ts';
import type { RawItem } from '../src/schema.ts';

// 제목·주소·날짜는 test/fixtures/의 실제 응답에서 옮겼다
function raw(item: Pick<RawItem, 'id' | 'source' | 'title' | 'url' | 'published'>): RawItem {
  return { ...item, hints: [], attachments: [] };
}

const insnewsKyobo: GroupInput = {
  item: raw({
    id: 'insnews:93466',
    source: 'insnews',
    title: '교보생명, ﻿보험금 지급까지 2시간… 생명보험업계 최단기간',
    url: 'https://www.insnews.co.kr/news/articleView.html?idxno=93466',
    published: '2026-10-23',
  }),
  topic: 'life',
  kind: 'press',
  sourceName: '한국보험신문',
};
const insweekKyobo: GroupInput = {
  item: raw({
    id: 'insweek:72796',
    source: 'insweek',
    title: '교보생명, 보험금 지급 평균 2시간···생보업계 1위',
    url: 'https://www.insweek.co.kr/news/articleView.html?idxno=72796',
    published: '2026-10-23',
  }),
  topic: 'life',
  kind: 'press',
  sourceName: '보험신보',
};
const kyoboPress: GroupInput = {
  item: raw({
    id: 'kyobo:17361',
    source: 'kyobo',
    title: '교보생명, 보험금 지급까지 2시간… 생보업계 지급속도 1위',
    url: 'https://news.kyobo.com/?p=17361',
    published: '2026-10-23',
  }),
  topic: 'life',
  kind: 'insurer',
  sourceName: '교보생명',
};
const lossRatio: GroupInput = {
  item: raw({
    id: 'insjournal:33625',
    source: 'insjournal',
    title: '9월 車보험 손해율 85.0%…전년 동월보다 8.8%p 하락',
    url: 'https://www.insjournal.co.kr/news/articleView.html?idxno=33625',
    published: '2026-10-23',
  }),
  topic: 'auto',
  kind: 'press',
  sourceName: '보험저널',
};
const ablAgents: GroupInput = {
  item: raw({
    id: 'insnews:93450',
    source: 'insnews',
    title: 'ABL생명, 전속 설계사 3000명 돌파… 2027년 4000명 목표',
    url: 'https://www.insnews.co.kr/news/articleView.html?idxno=93450',
    published: '2026-10-22',
  }),
  topic: 'industry',
  kind: 'press',
  sourceName: '한국보험신문',
};
const fscSilson: GroupInput = {
  item: raw({
    id: 'fsc-press:87818',
    source: 'fsc-press',
    title: '의료계·플랫폼 협력으로 “실손24” 연계율 제고 나선다.',
    url: 'https://www.fsc.go.kr/no010101/87818',
    published: '2026-09-30',
  }),
  topic: 'medical',
  kind: 'gov',
  sourceName: '금융위원회',
};
const fssSilson: GroupInput = {
  item: raw({
    id: 'fss-press:232597',
    source: 'fss-press',
    title: '의료계,플랫폼 협력으로 “실손24” 연계율 제고 나선다.',
    url: 'https://www.fss.or.kr/fss/bbs/B0000188/view.do?nttId=232597&menuNo=200218',
    published: '2026-09-30',
  }),
  topic: 'medical',
  kind: 'gov',
  sourceName: '금융감독원',
};

test('titleKey: 기호·띄어쓰기를 지운 한글 2글자 묶음과 숫자·영단어', () => {
  const key = titleKey('ABL생명, 전속 설계사 3000명 돌파');
  for (const t of ['abl', '생명', '전속', '3000', '명돌', '돌파']) assert.ok(key.has(t), t);
  assert.ok(!key.has(','));
});

test('similar: 같은 사건의 다른 매체 제목', () => {
  assert.ok(similar(insnewsKyobo.item.title, insweekKyobo.item.title));
  assert.ok(!similar(lossRatio.item.title, ablAgents.item.title));
});

test('groupItems: 같은 날 비슷한 제목은 한 묶음', () => {
  const groups = groupItems([insnewsKyobo, insweekKyobo], '2026-10-23');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sources.length, 2);
  assert.deepEqual(groups[0].itemIds.toSorted(), ['insnews:93466', 'insweek:72796']);
  assert.equal(groups[0].firstSeen, '2026-10-23');
  assert.equal(groups[0].summary, null);
});

test('groupItems: 다른 사건은 다른 묶음', () => {
  const groups = groupItems([lossRatio, ablAgents], '2026-10-23');
  assert.equal(groups.length, 2);
});

test('groupItems: 대표는 SOURCE_KINDS 순서가 앞인 글', () => {
  const groups = groupItems([insnewsKyobo, insweekKyobo, kyoboPress], '2026-10-23');
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.id, 'g:kyobo:17361');
  assert.equal(g.kind, 'insurer');
  assert.equal(g.title, kyoboPress.item.title);
  assert.equal(g.url, kyoboPress.item.url);
  assert.equal(g.sources[0].name, '교보생명');
  assert.equal(g.sources.length, 3);
});

// fixture에는 gov 글과 press 글이 같은 제목으로 묶이는 실제 쌍이 없어 금융위·금감원 공동 발표로 확인한다
test('groupItems: gov 글이 묶이면 대표는 gov', () => {
  const groups = groupItems([insnewsKyobo, fssSilson, fscSilson], '2026-10-23');
  assert.equal(groups.length, 2);
  const silson = groups.find((g) => g.itemIds.includes('fsc-press:87818'));
  assert.ok(silson);
  assert.equal(silson.kind, 'gov');
  assert.equal(silson.topic, 'medical');
  assert.equal(silson.sources.length, 2);
});

test('groupItems: 같은 id가 두 번 들어와도 한 묶음·한 itemId', () => {
  const groups = groupItems([insweekKyobo, insweekKyobo], '2026-10-23');
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].itemIds, ['insweek:72796']);
  assert.equal(groups[0].sources.length, 1);
});
