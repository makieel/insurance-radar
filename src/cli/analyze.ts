import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { classify } from '../analyze/classify.ts';
import { groupItems } from '../analyze/group.ts';
import type { GroupInput } from '../analyze/group.ts';
import { changeSentences } from '../analyze/dates-ko.ts';
import { ruleChanges, noticeChange, rateChange, mergeChanges } from '../analyze/changes.ts';
import { newRates } from '../analyze/rates.ts';
import { DailyReport, RawSnapshot, SOURCE_KINDS } from '../schema.ts';
import type { Category, Change, RateRow } from '../schema.ts';
import {
  CHANGES_PATH, RATES_PATH, SEEN_PATH, PENDING_PATH,
  bodiesPath, dailyPath, rawPath, pipelineDate, readJson, writeJson,
} from '../store.ts';
import type { PendingAi } from '../store.ts';

export function analyze(input: {
  raw: RawSnapshot; bodies: Record<string, string>; seen: Record<string, string>;
  changes: Change[]; prevRates: RateRow[]; pending: PendingAi[]; config: Config; today: string;
}): { daily: DailyReport; changes: Change[]; rates: RateRow[]; seen: Record<string, string>; pending: PendingAi[] } {
  const { raw, bodies, config, today } = input;
  const seen = { ...input.seen };
  const inputs: GroupInput[] = [];
  const incoming: Change[] = [];
  const judges: PendingAi[] = [];
  const sources = new Map(config.sources.map(source => [source.id, source]));

  for (const item of raw.items) {
    if (Object.hasOwn(seen, item.id)) continue;
    seen[item.id] = today;
    const source = sources.get(item.source);
    if (!source) throw new Error(`설정에 출처가 없습니다: ${item.source}`);
    const body = bodies[item.id] ?? '';
    const topic = classify({ title: item.title, hints: item.hints, body: body || null, kind: source.kind }, config.keywords);
    if (topic === 'exclude') continue;
    inputs.push({ item, topic, kind: source.kind, sourceName: source.name });
    const changeTopic: Category = topic === 'industry' ? 'general' : topic;
    const found: Change[] = [];
    if (item.source === 'fsc-rule') {
      const notice = noticeChange({ item, topic: changeTopic, sourceName: source.name, today });
      if (notice) found.push(notice);
    } else if (topic !== 'industry' && item.source !== 'kiri' && (source.kind === 'gov' || source.kind === 'assoc')) {
      // 업계 동향과 연구원 행사 글의 날짜는 시행일이 아니므로 규칙 추출에서 뺀다.
      found.push(...ruleChanges({ item, body, topic: changeTopic, sourceName: source.name, today }));
    }
    incoming.push(...found);
    if (found.length === 0 && topic !== 'industry' && changeSentences(body).length > 0) {
      judges.push({ type: 'judge', id: item.id, url: item.url, date: today, source: item.source });
    }
  }

  const groups = groupItems(inputs, today);
  const summaries: PendingAi[] = [...groups]
    .sort((a, b) => SOURCE_KINDS.indexOf(a.kind) - SOURCE_KINDS.indexOf(b.kind) || b.sources.length - a.sources.length)
    .map(group => {
      const representative = inputs.find(({ item }) => `g:${item.id}` === group.id)
        ?? inputs.find(({ item }) => item.url === group.url);
      if (!representative) throw new Error('묶음의 대표 출처를 찾을 수 없습니다.');
      return { type: 'summary', id: group.id, url: group.url, date: today, source: representative.item.source };
    });
  const jobs = new Map<string, PendingAi>();
  for (const job of [...input.pending, ...summaries, ...judges]) {
    const key = `${job.type}:${job.id}`;
    if (!jobs.has(key)) jobs.set(key, job);
  }
  const pending = [...jobs.values()];
  const rates = raw.rates.length > 0 ? [...raw.rates] : [...input.prevRates];
  incoming.push(...newRates(input.prevRates, raw.rates, today).map((row: RateRow) => rateChange(row, today)));
  return {
    daily: { date: today, generatedAt: raw.generatedAt, groups, status: raw.status },
    changes: mergeChanges(input.changes, incoming, today), rates, seen, pending,
  };
}

if (import.meta.main) {
  const today = pipelineDate();
  const raw = RawSnapshot.parse(readJson<unknown>(rawPath(today), null));
  const result = analyze({
    raw, today, config: loadConfig(),
    bodies: readJson<Record<string, string>>(bodiesPath(today), {}),
    seen: readJson<Record<string, string>>(SEEN_PATH, {}),
    changes: readJson<Change[]>(CHANGES_PATH, []),
    prevRates: readJson<RateRow[]>(RATES_PATH, []),
    pending: readJson<PendingAi[]>(PENDING_PATH, []),
  });
  const previous = DailyReport.parse(readJson(dailyPath(today), { ...result.daily, groups: [] }));
  const groups = new Map(previous.groups.map(group => [group.id, group]));
  for (const group of result.daily.groups) if (!groups.has(group.id)) groups.set(group.id, group);
  const daily = DailyReport.parse({ ...result.daily, groups: [...groups.values()] });
  writeJson(dailyPath(today), daily);
  writeJson(CHANGES_PATH, result.changes);
  writeJson(RATES_PATH, result.rates);
  writeJson(PENDING_PATH, result.pending);
  writeJson(SEEN_PATH, result.seen);
  console.log(`가공 완료: 새 묶음 ${result.daily.groups.length}개, 누적 변경 ${result.changes.length}개`);
}
