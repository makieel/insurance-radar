// AI 단계: 대기 목록의 관련도·중요도·판정·요약을 하루 상한 안에서 처리한다. 어떤 실패도 파이프라인을 멈추지 않는다(종료 코드 0).
import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { classify } from '../analyze/classify.ts';
import { mergeChanges } from '../analyze/changes.ts';
import { addDays } from '../lib/dates.ts';
import { DailyReport, RawSnapshot } from '../schema.ts';
import type { Change, NewsGroup, RawItem } from '../schema.ts';
import {
  CHANGES_PATH, PENDING_PATH,
  bodiesPath, dailyPath, rawPath, pipelineDate, readAiUsage, readJson, writeAiUsage, writeJson,
} from '../store.ts';
import type { AiUsage, PendingAi } from '../store.ts';
import { EXCERPT_MAX, fetchExcerpt } from '../summarize/excerpt.ts';
import { judgeChanges } from '../summarize/judge.ts';
import type { JudgeInput } from '../summarize/judge.ts';
import { IMPORTANCE_BATCH, rateImportance } from '../summarize/importance.ts';
import { makeChatFn } from '../summarize/models.ts';
import type { ChatFn } from '../summarize/models.ts';
import { RELEVANCE_BATCH, rateRelevance } from '../summarize/relevance.ts';
import { summarizeGroups } from '../summarize/summarize.ts';

/** 요약은 묶음 10개를 한 호출(+검증 한 호출), 판정은 글 5개를 한 호출, 관련도는 묶음 25개, 중요도는 30개를 한 호출 */
const SUMMARY_BATCH = 10;
const JUDGE_BATCH = 5;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const jobKey = (job: PendingAi): string => `${job.type}:${job.id}`;

const representativeId = (group: NewsGroup): string =>
  group.itemIds.find((id) => `g:${id}` === group.id) ?? group.itemIds[0];

/** 파일 읽기를 감춘 접근자. 돌려준 daily 객체를 고치면 그대로 저장된다. */
export interface AiStore {
  daily(date: string): DailyReport | null;
  rawItems(date: string): Map<string, RawItem>;
  /** 저장해 둔 본문. 없으면 '' */
  body(itemId: string, date: string): string;
  /** 페이지 발췌. 없으면 '' */
  excerpt(url: string): Promise<string>;
}

/** 요약할 묶음인가. 관련도 low는 건너뛰되 gov·assoc 발표는 요약한다. */
export function needsSummary(group: NewsGroup): boolean {
  if (group.summary) return false;
  return group.relevance !== 'low' || group.kind === 'gov' || group.kind === 'assoc';
}

/** 중요도를 매길 묶음인가. 업계 동향·관련도 low·이미 매긴 묶음은 뺀다. */
function needsImportance(group: NewsGroup): boolean {
  return group.importance === null && group.topic !== 'industry'
    && (group.relevance === 'high' || group.relevance === 'medium');
}

/**
 * ① 관련도 ② 중요도 ③ 판정 ④ 요약 순서로 대기 작업을 처리한다. usage는 호출할 때마다 늘린다.
 * 예산을 다 쓰거나 호출이 실패하면 남은 작업은 remaining으로 다음 실행에 넘긴다.
 */
export async function runAiJobs(input: {
  config: Config; chat: ChatFn; today: string; pending: PendingAi[]; usage: AiUsage; store: AiStore;
}): Promise<{
  remaining: PendingAi[]; dirty: Set<string>; judged: Change[]; rated: number; scored: number; summarized: number; dropped: number;
}> {
  const { config, chat, today, usage, store } = input;
  const queue = [...input.pending];
  const done = new Set<string>();
  const dirty = new Set<string>();
  const judged: Change[] = [];
  // build.ts의 지난 주요 소식 기간과 같은 경계
  const highlightSince = addDays(today, 1 - config.limits.highlightsDays);
  let stopped = false;
  let rated = 0;
  let scored = 0;
  let summarized = 0;
  let dropped = 0;

  const callsLeft = (): number => config.limits.aiCallsPerDay - usage.calls;
  const summariesLeft = (): number => config.limits.summariesPerDay - usage.summaries;
  const drop = (job: PendingAi): void => {
    done.add(jobKey(job));
    dropped++;
  };
  const groupOf = (job: PendingAi): NewsGroup | undefined =>
    store.daily(job.date)?.groups.find((g) => g.id === job.id);
  // 저장해 둔 본문이 있으면 쓰고, 없으면 페이지에서 발췌
  const textOf = async (itemId: string, url: string, date: string): Promise<string> => {
    const body = store.body(itemId, date);
    if (body.trim()) return body;
    return store.excerpt(url);
  };

  const prepareRelevance = (job: PendingAi): { job: PendingAi; group: NewsGroup; source: string } | null => {
    try {
      const group = groupOf(job);
      if (!group || group.relevanceBy === 'ai') return null;
      // 관련도는 제목이 중심이라 페이지를 새로 받지 않고 저장된 본문만 쓴다
      return { job, group, source: store.body(representativeId(group), job.date) };
    } catch (e) {
      console.warn(`관련도 대상 준비 실패 ${job.id}: ${message(e)}`);
      return null;
    }
  };

  const prepareImportance = (job: PendingAi): { job: PendingAi; group: NewsGroup; source: string } | null => {
    try {
      const group = groupOf(job);
      // AI가 관련도를 low로 바꾼 묶음은 여기서 빠진다
      if (!group || !needsImportance(group)) return null;
      return { job, group, source: store.body(representativeId(group), job.date) };
    } catch (e) {
      console.warn(`중요도 대상 준비 실패 ${job.id}: ${message(e)}`);
      return null;
    }
  };

  const prepareJudge = async (job: PendingAi): Promise<{ job: PendingAi; input: JudgeInput } | null> => {
    try {
      const item = store.rawItems(job.date).get(job.id);
      const source = item && config.sources.find((s) => s.id === item.source);
      if (!item || !source) return null;
      const body = await textOf(item.id, item.url, job.date);
      if (!body.trim()) return null;
      const group = store.daily(job.date)?.groups.find((g) => g.itemIds.includes(item.id));
      const topic = group?.topic
        ?? classify({ title: item.title, hints: item.hints, body, kind: source.kind }, config.keywords);
      if (topic === 'exclude') return null;
      return { job, input: { item, body, sourceName: source.name, topic: topic === 'industry' ? 'general' : topic } };
    } catch (e) {
      console.warn(`판정 대상 준비 실패 ${job.id}: ${message(e)}`);
      return null;
    }
  };

  const prepareSummary = async (job: PendingAi): Promise<{ job: PendingAi; group: NewsGroup; source: string } | null> => {
    try {
      const group = groupOf(job);
      if (!group || !needsSummary(group)) return null;
      const text = await textOf(representativeId(group), group.url, job.date);
      return { job, group, source: text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX) };
    } catch (e) {
      console.warn(`요약 대상 준비 실패 ${job.id}: ${message(e)}`);
      return null;
    }
  };

  // ① 관련도: 결과가 없으면(호출 실패·읽을 수 없는 응답) 남은 관련도만 다음 실행으로 미루고 판정·요약은 계속한다
  const relevanceJobs = queue.filter((job) => job.type === 'relevance');
  let r = 0;
  while (r < relevanceJobs.length && callsLeft() >= 1) {
    const batch: { job: PendingAi; group: NewsGroup; source: string }[] = [];
    while (r < relevanceJobs.length && batch.length < RELEVANCE_BATCH) {
      const job = relevanceJobs[r++];
      const prepared = prepareRelevance(job);
      if (prepared) batch.push(prepared);
      else drop(job);
    }
    if (!batch.length) break;
    usage.calls += 1;
    const result = await rateRelevance(batch.map(({ group, source }) => ({ group, source })), chat);
    if (!result.size) {
      console.warn('관련도 결과 없음, 남은 관련도 대기는 다음 실행으로');
      break;
    }
    for (const { job, group } of batch) {
      done.add(jobKey(job));
      const rating = result.get(group.id);
      if (!rating) continue;
      const before = group.relevance;
      group.relevance = rating.relevance;
      group.important = rating.important;
      group.relevanceBy = 'ai';
      dirty.add(job.date);
      rated++;
      // 규칙으로 low였다가 올라온 묶음은 요약 대기에 없을 수 있다
      if (needsSummary(group) && !queue.some((q) => q.type === 'summary' && q.id === group.id)) {
        queue.push({ type: 'summary', id: group.id, url: group.url, date: job.date, source: job.source });
      }
      // 중요도 대기도 마찬가지다(가공 단계는 high·medium에만 넣는다)
      if (before === 'low' && needsImportance(group) && group.published >= highlightSince
        && !queue.some((q) => q.type === 'importance' && q.id === group.id)) {
        queue.push({ type: 'importance', id: group.id, url: group.url, date: job.date, source: job.source });
      }
    }
  }

  // ② 중요도: 관련도처럼 결과가 없으면 남은 중요도만 다음 실행으로 미룬다
  const importanceJobs = queue.filter((job) => job.type === 'importance');
  let m = 0;
  while (m < importanceJobs.length && callsLeft() >= 1) {
    const batch: { job: PendingAi; group: NewsGroup; source: string }[] = [];
    while (m < importanceJobs.length && batch.length < IMPORTANCE_BATCH) {
      const job = importanceJobs[m++];
      const prepared = prepareImportance(job);
      if (prepared) batch.push(prepared);
      else drop(job);
    }
    if (!batch.length) break;
    usage.calls += 1;
    const result = await rateImportance(batch.map(({ group, source }) => ({ group, source })), chat);
    if (!result.size) {
      console.warn('중요도 결과 없음, 남은 중요도 대기는 다음 실행으로');
      break;
    }
    for (const { job, group } of batch) {
      done.add(jobKey(job));
      const importance = result.get(group.id);
      if (importance === undefined) continue;
      group.importance = importance;
      dirty.add(job.date);
      scored++;
      // 주요 소식 칸에 오를 만한 묶음은 요약이 있어야 한다
      if (importance >= 4 && !group.summary && !queue.some((q) => q.type === 'summary' && q.id === group.id)) {
        queue.push({ type: 'summary', id: group.id, url: group.url, date: job.date, source: job.source });
      }
    }
  }

  // ③ 판정
  const judgeJobs = queue.filter((job) => job.type === 'judge');
  let j = 0;
  while (!stopped && j < judgeJobs.length && callsLeft() >= 1) {
    const batch: { job: PendingAi; input: JudgeInput }[] = [];
    while (j < judgeJobs.length && batch.length < JUDGE_BATCH) {
      const job = judgeJobs[j++];
      const prepared = await prepareJudge(job);
      if (prepared) batch.push(prepared);
      else drop(job);
    }
    if (!batch.length) break;
    usage.calls += 1;
    try {
      judged.push(...await judgeChanges(batch.map((b) => b.input), chat, today));
      for (const { job } of batch) done.add(jobKey(job));
    } catch (e) {
      console.warn(`판정 호출 실패, 남은 대기는 다음 실행으로: ${message(e)}`);
      stopped = true;
    }
  }

  // ④ 요약
  const summaryJobs = queue.filter((job) => job.type === 'summary');
  let i = 0;
  while (!stopped && i < summaryJobs.length && summariesLeft() > 0 && callsLeft() >= 2) {
    const batch: { job: PendingAi; group: NewsGroup; source: string }[] = [];
    while (i < summaryJobs.length && batch.length < Math.min(SUMMARY_BATCH, summariesLeft())) {
      const job = summaryJobs[i++];
      const prepared = await prepareSummary(job);
      if (prepared) batch.push(prepared);
      else drop(job);
    }
    if (!batch.length) break;
    usage.calls += 2;
    usage.summaries += batch.length;
    try {
      const result = await summarizeGroups(batch.map(({ group, source }) => ({ group, source })), chat);
      for (const { job, group } of batch) {
        done.add(jobKey(job));
        const summary = result.get(group.id);
        if (!summary) continue;
        group.summary = summary;
        dirty.add(job.date);
        summarized++;
      }
    } catch (e) {
      // 첫 호출 실패(한도·네트워크)면 이 묶음과 남은 것은 다음 실행으로
      console.warn(`요약 호출 실패, 남은 대기는 다음 실행으로: ${message(e)}`);
      stopped = true;
    }
  }

  const remaining = queue.filter((job) => !done.has(jobKey(job)));
  return { remaining, dirty, judged, rated, scored, summarized, dropped };
}

export async function summarizePending(input: { config: Config; chat: ChatFn; today: string }): Promise<{
  rated: number; scored: number; summarized: number; judged: number; dropped: number; remaining: number;
}> {
  const { config, chat, today } = input;
  const pending = readJson<PendingAi[]>(PENDING_PATH, []);
  const usage = readAiUsage(today);

  const dailies = new Map<string, DailyReport | null>();
  const raws = new Map<string, Map<string, RawItem>>();
  const bodyFiles = new Map<string, Record<string, string>>();

  const daily = (date: string): DailyReport | null => {
    if (!dailies.has(date)) {
      const raw = readJson<unknown>(dailyPath(date), null);
      dailies.set(date, raw === null ? null : DailyReport.parse(raw));
    }
    return dailies.get(date) ?? null;
  };
  const rawItems = (date: string): Map<string, RawItem> => {
    let items = raws.get(date);
    if (!items) {
      const raw = readJson<unknown>(rawPath(date), null);
      items = new Map<string, RawItem>(raw === null ? [] : RawSnapshot.parse(raw).items.map((item) => [item.id, item]));
      raws.set(date, items);
    }
    return items;
  };
  const body = (itemId: string, date: string): string => {
    let bodies = bodyFiles.get(date);
    if (!bodies) {
      bodies = readJson<Record<string, string>>(bodiesPath(date), {});
      bodyFiles.set(date, bodies);
    }
    return bodies[itemId] ?? '';
  };
  const excerpt = async (url: string): Promise<string> => (await fetchExcerpt(url)) ?? '';

  const result = await runAiJobs({ config, chat, today, pending, usage, store: { daily, rawItems, body, excerpt } });

  writeAiUsage(usage);
  for (const date of result.dirty) {
    const report = daily(date);
    if (report) writeJson(dailyPath(date), DailyReport.parse(report));
  }
  if (result.judged.length) {
    writeJson(CHANGES_PATH, mergeChanges(readJson<Change[]>(CHANGES_PATH, []), result.judged, today));
  }
  writeJson(PENDING_PATH, result.remaining);
  return {
    rated: result.rated,
    scored: result.scored,
    summarized: result.summarized,
    judged: result.judged.length,
    dropped: result.dropped,
    remaining: result.remaining.length,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const apiKey = process.env[config.ai.keyEnv];
  if (!apiKey) {
    console.log(`요약 건너뜀: ${config.ai.keyEnv}가 없습니다`);
    return;
  }
  const ai = makeChatFn({ apiKey, baseUrl: config.ai.baseUrl, models: config.ai.models, timeoutMs: config.ai.timeoutMs });
  const stats = await summarizePending({ config, chat: ai.chat, today: pipelineDate() });
  console.log(
    `요약 완료(${ai.model() ?? '모델 미사용'}): 관련도 ${stats.rated}개, 중요도 ${stats.scored}개, 요약 ${stats.summarized}개, ` +
    `판정 변경 ${stats.judged}개, 건너뜀 ${stats.dropped}개, 남은 대기 ${stats.remaining}개`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(`요약 단계 오류(무시하고 계속): ${message(e)}`);
  }
  process.exitCode = 0;
}
