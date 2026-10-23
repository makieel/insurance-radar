import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { ruleRelevance } from '../analyze/relevance.ts';
import { addDays } from '../lib/dates.ts';
import { DailyReport, Latest } from '../schema.ts';
import type { Change, NewsGroup, RateRow, SourceId, SourceKind, SourceStatus } from '../schema.ts';
import {
  CHANGES_PATH, RATES_PATH, LATEST_PATH,
  dailyPath, pipelineDate, rawPath, readJson, writeJson,
} from '../store.ts';
import { RawSnapshot } from '../schema.ts';

export function buildLatest(input: {
  today: string; generatedAt: string; changes: Change[]; dailies: DailyReport[];
  rates: RateRow[]; status: SourceStatus[]; sourceKinds: Record<SourceId, SourceKind>;
  keywords: Config['keywords'];
}): Latest {
  const { today, generatedAt, sourceKinds, keywords } = input;
  const start = addDays(today, -183);
  const end = addDays(today, 183);
  const changes = input.changes.filter(change => {
    if (change.when === 'exact') return change.date !== null && change.date >= start && change.date <= end;
    if (change.when === 'period') return change.period !== null && change.period.start <= end && change.period.end >= start;
    return true;
  });
  const groupsWithin = (days: number): NewsGroup[] => {
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
        groups.set(group.id, { ...group, kind, relevance, relevanceBy });
      }
    }
    return [...groups.values()].sort((a, b) => b.published.localeCompare(a.published) || b.firstSeen.localeCompare(a.firstSeen));
  };
  const news = groupsWithin(3)
    .filter(group => group.topic !== 'industry' && (group.kind === 'insurer' || group.kind === 'press')
      && (group.relevance === 'high' || group.relevance === 'medium'))
    // 정렬이 안정적이므로 같은 관련도 안에서는 게시일 최신순이 유지된다.
    .sort((a, b) => Number(b.relevance === 'high') - Number(a.relevance === 'high'));
  const official = groupsWithin(30)
    .filter(group => group.topic !== 'industry' && (group.kind === 'gov' || group.kind === 'assoc') && group.relevance !== 'low');
  // 업계 소식은 화면 전체의 10% 이내로, 개인에게도 중요한 것과 여러 곳이 다룬 것만 보여 준다.
  const industryLimit = Math.min(5, Math.max(1, Math.floor((news.length + official.length) / 9)));
  const industry = groupsWithin(14)
    .filter(group => (group.topic === 'industry' || group.relevance === 'low') && (group.important || group.sources.length >= 3))
    .sort((a, b) => Number(b.important) - Number(a.important) || b.sources.length - a.sources.length)
    .slice(0, industryLimit);
  return Latest.parse({
    date: today, generatedAt, changes, news, official, industry,
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
  for (let offset = 0; offset < 30; offset++) {
    const daily = readJson<unknown>(dailyPath(addDays(today, -offset)), null);
    if (daily !== null) dailies.push(DailyReport.parse(daily));
  }
  const snapshot = readJson<unknown>(rawPath(today), null);
  const status = snapshot === null ? (dailies[0]?.status ?? []) : RawSnapshot.parse(snapshot).status;
  const latest = buildLatest({
    today, generatedAt: new Date().toISOString(), dailies, status, keywords: config.keywords,
    changes: readJson<Change[]>(CHANGES_PATH, []),
    rates: readJson<RateRow[]>(RATES_PATH, []),
    sourceKinds: Object.fromEntries(config.sources.map(source => [source.id, source.kind])) as Record<SourceId, SourceKind>,
  });
  writeJson(LATEST_PATH, latest);
  console.log(`빌드 완료: 변경 ${latest.changes.length}개, 새 소식 ${latest.news.length}개`);
}
