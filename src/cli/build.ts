import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { ruleRelevance } from '../analyze/relevance.ts';
import { similar } from '../analyze/group.ts';
import { addDays } from '../lib/dates.ts';
import { decodeEntities } from '../lib/text.ts';
import { DailyReport, Latest } from '../schema.ts';
import type { Change, NewsGroup, RateRow, SourceId, SourceKind, SourceStatus } from '../schema.ts';
import {
  CHANGES_PATH, RATES_PATH, LATEST_PATH,
  dailyPath, pipelineDate, rawPath, readJson, writeJson,
} from '../store.ts';
import { RawSnapshot } from '../schema.ts';

/**
 * 여러 번의 실행(하루 세 번)에 걸쳐 따로 생긴 같은 소식 묶음을 화면에서 하나로 합친다.
 * 앞쪽(더 공식적이거나 먼저 정렬된) 묶음을 대표로 두고 출처와 글 목록을 더한다.
 */
export function mergeSimilar(groups: NewsGroup[]): NewsGroup[] {
  const KIND_ORDER = ['gov', 'assoc', 'insurer', 'press'];
  const ordered = [...groups].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.sources.length - a.sources.length);
  const out: NewsGroup[] = [];
  for (const g of ordered) {
    // 같은 매체끼리는 분석 단계에서 이미 묶였으므로, 서로 다른 매체의 묶음만 합친다.
    const near = out.find(o => o.topic === g.topic
      && !o.sources.some(x => g.sources.some(y => y.name === x.name))
      && Math.abs(Date.parse(o.published) - Date.parse(g.published)) <= 2 * 86_400_000
      && similar(o.title, g.title));
    if (!near) { out.push({ ...g, sources: [...g.sources], itemIds: [...g.itemIds] }); continue; }
    for (const src of g.sources) if (!near.sources.some(x => x.url === src.url)) near.sources.push(src);
    for (const id of g.itemIds) if (!near.itemIds.includes(id)) near.itemIds.push(id);
    near.summary ??= g.summary;
    near.important ||= g.important;
    if (g.importance !== null && (near.importance === null || g.importance > near.importance)) near.importance = g.importance;
  }
  return out;
}

/** AI 중요도가 아직 없을 때 쓰는 규칙 점수(1~3) */
export function ruleImportance(g: NewsGroup): number {
  if (g.relevance === 'high') return g.kind === 'gov' || g.sources.length >= 3 ? 3 : 2;
  return 1;
}

export function buildLatest(input: {
  today: string; generatedAt: string; changes: Change[]; dailies: DailyReport[];
  rates: RateRow[]; status: SourceStatus[]; sourceKinds: Record<SourceId, SourceKind>;
  keywords: Config['keywords']; limits: Config['limits'];
}): Latest {
  const { today, generatedAt, sourceKinds, keywords, limits } = input;
  const start = addDays(today, -183);
  const end = addDays(today, 183);
  const changes = input.changes.filter(change => {
    if (change.when === 'exact') return change.date !== null && change.date >= start && change.date <= end;
    if (change.when === 'period') return change.period !== null && change.period.start <= end && change.period.end >= start;
    return true;
  });
  const groupsWithin = (days: number, keep: (group: NewsGroup) => boolean = () => true): NewsGroup[] => {
    const since = addDays(today, 1 - days);
    const groups = new Map<string, NewsGroup>();
    for (const daily of [...input.dailies].sort((a, b) => b.date.localeCompare(a.date))) {
      if (daily.date < since || daily.date > today) continue;
      for (const group of daily.groups) {
        // 게시일 기준으로 자른다. 첫 실행 채우기로 처음 본 옛 글이 "최근 소식"이 되지 않게 한다.
        if (group.published < since || group.published > today || groups.has(group.id)) continue;
        const source = group.id.slice(2).split(':')[0] as SourceId;
        const kind = sourceKinds[source] ?? group.kind;
        // 관련도가 없는 옛 데이터는 규칙으로 채운다(대표 글 본문은 보관하지 않는다).
        const relevance = group.relevance ?? ruleRelevance({ title: group.title, hints: [], body: null, kind, topic: group.topic }, keywords);
        const relevanceBy = group.relevance === null ? 'rule' : group.relevanceBy;
        const filled = { ...group, kind, relevance, relevanceBy };
        if (keep(filled)) groups.set(group.id, filled);
      }
    }
    return mergeSimilar([...groups.values()]).sort((a, b) => b.published.localeCompare(a.published) || b.firstSeen.localeCompare(a.firstSeen));
  };
  const news = groupsWithin(3)
    .filter(group => group.topic !== 'industry' && (group.kind === 'insurer' || group.kind === 'press')
      && (group.relevance === 'high' || group.relevance === 'medium'))
    // 정렬이 안정적이므로 같은 관련도 안에서는 게시일 최신순이 유지된다.
    .sort((a, b) => Number(b.relevance === 'high') - Number(a.relevance === 'high'))
    .slice(0, limits.newsMax);
  const official = groupsWithin(30)
    .filter(group => group.topic !== 'industry' && (group.kind === 'gov' || group.kind === 'assoc') && group.relevance !== 'low')
    .slice(0, limits.officialMax);
  // 지난 주요 소식: 위 두 칸에 이미 보이는 글(합쳐진 글 포함)은 뺀다.
  const shown = new Set([...news, ...official].flatMap(group => [group.id, ...group.itemIds]));
  const highlights = groupsWithin(limits.highlightsDays, group => group.topic !== 'industry'
    && (group.relevance === 'high' || (group.relevance === 'medium' && (group.importance ?? 0) >= 4)))
    .filter(group => !shown.has(group.id) && !group.itemIds.some(id => shown.has(id)))
    // 화면이 별점을 그릴 수 있게 순위에 쓴 점수를 importance에 담는다.
    .map(group => ({ ...group, importance: group.importance ?? ruleImportance(group) }))
    // 정렬이 안정적이므로 같은 점수 안에서는 게시일 최신순이 유지된다.
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limits.highlightsMax);
  // 업계 소식은 화면 전체의 10% 이내로, 개인에게도 중요한 것과 여러 곳이 다룬 것만 보여 준다.
  const industryLimit = Math.min(limits.industryMax, Math.max(1, Math.floor((news.length + official.length + highlights.length) / 9)));
  const industry = groupsWithin(14)
    .filter(group => (group.topic === 'industry' || group.relevance === 'low') && (group.important || group.sources.length >= 3))
    .sort((a, b) => Number(b.important) - Number(a.important) || b.sources.length - a.sources.length)
    .slice(0, industryLimit);
  // 저장된 제목에 남은 HTML 엔티티를 화면에 내기 전에 글자로 바꾼다.
  const clean = (list: NewsGroup[]): NewsGroup[] => list.map(g => ({ ...g, title: decodeEntities(g.title), summary: g.summary === null ? null : decodeEntities(g.summary) }));
  return Latest.parse({
    date: today, generatedAt, changes, news: clean(news), official: clean(official), industry: clean(industry), highlights: clean(highlights),
    rates: [...input.rates].sort((a, b) => b.effective.localeCompare(a.effective)).slice(0, 30),
    status: input.status,
    counts: {
      newToday: new Set(input.dailies.filter(daily => daily.date === today)
        .flatMap(daily => daily.groups.filter(group => group.published >= addDays(today, -2)).map(group => group.id))).size,
      upcoming: changes.filter(change =>
        (change.when === 'exact' && change.date !== null && change.date > today)
        || (change.when === 'period' && change.period !== null && change.period.end > today)
        || (change.when === 'phrase' && !change.past)).length,
      recent: changes.filter(change =>
        (change.when === 'exact' && change.date !== null && change.date <= today)
        || (change.when === 'phrase' && change.past)).length,
    },
  });
}

if (import.meta.main) {
  const today = pipelineDate();
  const config = loadConfig();
  const dailies: DailyReport[] = [];
  for (let offset = 0; offset < config.limits.highlightsDays; offset++) {
    const daily = readJson<unknown>(dailyPath(addDays(today, -offset)), null);
    if (daily !== null) dailies.push(DailyReport.parse(daily));
  }
  const snapshot = readJson<unknown>(rawPath(today), null);
  const status = snapshot === null ? (dailies[0]?.status ?? []) : RawSnapshot.parse(snapshot).status;
  const latest = buildLatest({
    today, generatedAt: new Date().toISOString(), dailies, status, keywords: config.keywords, limits: config.limits,
    changes: readJson<Change[]>(CHANGES_PATH, []),
    rates: readJson<RateRow[]>(RATES_PATH, []),
    sourceKinds: Object.fromEntries(config.sources.map(source => [source.id, source.kind])) as Record<SourceId, SourceKind>,
  });
  writeJson(LATEST_PATH, latest);
  console.log(`빌드 완료: 변경 ${latest.changes.length}개, 새 소식 ${latest.news.length}개, 공식 발표 ${latest.official.length}개, 주요 소식 ${latest.highlights.length}개, 업계 ${latest.industry.length}개`);
}
