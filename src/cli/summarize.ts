// AI 단계: 대기 목록의 요약·판정을 하루 상한 안에서 처리한다. 어떤 실패도 파이프라인을 멈추지 않는다(종료 코드 0).
import { loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { classify } from '../analyze/classify.ts';
import { mergeChanges } from '../analyze/changes.ts';
import { DailyReport, RawSnapshot } from '../schema.ts';
import type { Change, NewsGroup, RawItem } from '../schema.ts';
import {
  CHANGES_PATH, PENDING_PATH,
  bodiesPath, dailyPath, rawPath, pipelineDate, readJson, writeJson,
} from '../store.ts';
import type { PendingAi } from '../store.ts';
import { EXCERPT_MAX, fetchExcerpt } from '../summarize/excerpt.ts';
import { judgeChanges } from '../summarize/judge.ts';
import type { JudgeInput } from '../summarize/judge.ts';
import { makeChatFn } from '../summarize/models.ts';
import type { ChatFn } from '../summarize/models.ts';
import { summarizeGroups } from '../summarize/summarize.ts';

/** 요약은 묶음 10개를 한 호출(+검증 한 호출), 판정은 글 5개를 한 호출 */
const SUMMARY_BATCH = 10;
const JUDGE_BATCH = 5;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const jobKey = (job: PendingAi): string => `${job.type}:${job.id}`;

export async function summarizePending(input: { config: Config; chat: ChatFn; today: string }): Promise<{
  summarized: number; judged: number; dropped: number; remaining: number;
}> {
  const { config, chat, today } = input;
  const pending = readJson<PendingAi[]>(PENDING_PATH, []);

  const dailies = new Map<string, DailyReport | null>();
  const dirty = new Set<string>();
  const raws = new Map<string, Map<string, RawItem>>();
  const bodyFiles = new Map<string, Record<string, string>>();

  const dailyOf = (date: string): DailyReport | null => {
    if (!dailies.has(date)) {
      const raw = readJson<unknown>(dailyPath(date), null);
      dailies.set(date, raw === null ? null : DailyReport.parse(raw));
    }
    return dailies.get(date) ?? null;
  };
  const rawItemsOf = (date: string): Map<string, RawItem> => {
    let items = raws.get(date);
    if (!items) {
      const raw = readJson<unknown>(rawPath(date), null);
      items = new Map<string, RawItem>(raw === null ? [] : RawSnapshot.parse(raw).items.map((item) => [item.id, item]));
      raws.set(date, items);
    }
    return items;
  };
  const bodiesOf = (date: string): Record<string, string> => {
    let bodies = bodyFiles.get(date);
    if (!bodies) {
      bodies = readJson<Record<string, string>>(bodiesPath(date), {});
      bodyFiles.set(date, bodies);
    }
    return bodies;
  };
  // 저장해 둔 본문이 있으면 쓰고, 없으면 페이지에서 발췌
  const textOf = async (itemId: string, url: string, date: string): Promise<string> => {
    const body = bodiesOf(date)[itemId];
    if (body?.trim()) return body;
    return (await fetchExcerpt(url)) ?? '';
  };

  const done = new Set<string>();
  let calls = config.limits.aiCallsPerDay;
  let summariesLeft = config.limits.summariesPerDay;
  let stopped = false;
  let summarized = 0;
  let dropped = 0;
  const judged: Change[] = [];

  const prepareSummary = async (job: PendingAi): Promise<{ job: PendingAi; group: NewsGroup; source: string } | null> => {
    try {
      const group = dailyOf(job.date)?.groups.find((g) => g.id === job.id);
      if (!group || group.summary) return null;
      const itemId = group.itemIds.find((id) => `g:${id}` === group.id) ?? group.itemIds[0];
      const text = await textOf(itemId, group.url, job.date);
      return { job, group, source: text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX) };
    } catch (e) {
      console.warn(`요약 대상 준비 실패 ${job.id}: ${message(e)}`);
      return null;
    }
  };

  const prepareJudge = async (job: PendingAi): Promise<{ job: PendingAi; input: JudgeInput } | null> => {
    try {
      const item = rawItemsOf(job.date).get(job.id);
      const source = item && config.sources.find((s) => s.id === item.source);
      if (!item || !source) return null;
      const body = await textOf(item.id, item.url, job.date);
      if (!body.trim()) return null;
      const group = dailyOf(job.date)?.groups.find((g) => g.itemIds.includes(item.id));
      const topic = group?.topic
        ?? classify({ title: item.title, hints: item.hints, body, kind: source.kind }, config.keywords);
      if (topic === 'exclude') return null;
      return { job, input: { item, body, sourceName: source.name, topic: topic === 'industry' ? 'general' : topic } };
    } catch (e) {
      console.warn(`판정 대상 준비 실패 ${job.id}: ${message(e)}`);
      return null;
    }
  };

  const summaryJobs = pending.filter((job) => job.type === 'summary');
  let i = 0;
  while (!stopped && i < summaryJobs.length && summariesLeft > 0 && calls >= 2) {
    const batch: { job: PendingAi; group: NewsGroup; source: string }[] = [];
    while (i < summaryJobs.length && batch.length < Math.min(SUMMARY_BATCH, summariesLeft)) {
      const job = summaryJobs[i++];
      const prepared = await prepareSummary(job);
      if (prepared) batch.push(prepared);
      else {
        done.add(jobKey(job));
        dropped++;
      }
    }
    if (!batch.length) break;
    calls -= 2;
    summariesLeft -= batch.length;
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
      // 첫 호출 실패(한도·네트워크)면 이 묶음과 남은 것은 다음 날로
      console.warn(`요약 호출 실패, 남은 대기는 다음 날로: ${message(e)}`);
      stopped = true;
    }
  }

  const judgeJobs = pending.filter((job) => job.type === 'judge');
  let j = 0;
  while (!stopped && j < judgeJobs.length && calls >= 1) {
    const batch: { job: PendingAi; input: JudgeInput }[] = [];
    while (j < judgeJobs.length && batch.length < JUDGE_BATCH) {
      const job = judgeJobs[j++];
      const prepared = await prepareJudge(job);
      if (prepared) batch.push(prepared);
      else {
        done.add(jobKey(job));
        dropped++;
      }
    }
    if (!batch.length) break;
    calls -= 1;
    try {
      judged.push(...await judgeChanges(batch.map((b) => b.input), chat, today));
      for (const { job } of batch) done.add(jobKey(job));
    } catch (e) {
      console.warn(`판정 호출 실패, 남은 대기는 다음 날로: ${message(e)}`);
      stopped = true;
    }
  }

  for (const date of dirty) {
    const daily = dailyOf(date);
    if (daily) writeJson(dailyPath(date), DailyReport.parse(daily));
  }
  if (judged.length) {
    writeJson(CHANGES_PATH, mergeChanges(readJson<Change[]>(CHANGES_PATH, []), judged, today));
  }
  const remaining = pending.filter((job) => !done.has(jobKey(job)));
  writeJson(PENDING_PATH, remaining);
  return { summarized, judged: judged.length, dropped, remaining: remaining.length };
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
    `요약 완료(${ai.model() ?? '모델 미사용'}): 요약 ${stats.summarized}개, 판정 변경 ${stats.judged}개, ` +
    `건너뜀 ${stats.dropped}개, 남은 대기 ${stats.remaining}개`,
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
