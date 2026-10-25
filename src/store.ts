import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsoDate, kstDate } from './lib/dates.ts';
import type { SourceId } from './schema.ts';

export interface PendingAi {
  type: 'summary' | 'judge' | 'relevance' | 'importance';
  id: string;
  url: string;
  date: string;
  source: SourceId;
}

export const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
export const RAW_DIR = join(DATA_DIR, 'raw');
export const DAILY_DIR = join(DATA_DIR, 'daily');
export const CHANGES_PATH = join(DATA_DIR, 'changes.json');
export const RATES_PATH = join(DATA_DIR, 'rates.json');
export const SEEN_PATH = join(DATA_DIR, 'seen.json');
export const PENDING_PATH = join(DATA_DIR, 'pending-ai.json');
export const AI_USAGE_PATH = join(DATA_DIR, 'ai-usage.json');
export const BODIES_DIR = fileURLToPath(new URL('../tmp/bodies/', import.meta.url));
export const LATEST_PATH = fileURLToPath(new URL('../web/data/latest.json', import.meta.url));

function datedPath(dir: string, date: string): string {
  if (!isIsoDate(date)) throw new Error('날짜는 실제 날짜인 YYYY-MM-DD 형식이어야 합니다.');
  return join(dir, `${date}.json`);
}

export const rawPath = (date: string): string => datedPath(RAW_DIR, date);
export const dailyPath = (date: string): string => datedPath(DAILY_DIR, date);
export const bodiesPath = (date: string): string => datedPath(BODIES_DIR, date);

export function pipelineDate(now = new Date()): string {
  const date = process.env.IR_DATE ?? kstDate(now);
  if (!isIsoDate(date)) throw new Error('IR_DATE는 실제 날짜인 YYYY-MM-DD 형식이어야 합니다.');
  return date;
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

export function writeJson(path: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** 그날 쓴 AI 호출 수와 요약 수. 하루 여러 번 실행해도 상한을 함께 센다. */
export interface AiUsage {
  date: string;
  calls: number;
  summaries: number;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);

/** 저장된 날짜가 today와 다르거나 파일이 없으면 0부터 */
export function readAiUsage(today: string, path = AI_USAGE_PATH): AiUsage {
  const raw = readJson<unknown>(path, null);
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).date === today) {
    const { calls, summaries } = raw as Record<string, unknown>;
    return { date: today, calls: count(calls), summaries: count(summaries) };
  }
  return { date: today, calls: 0, summaries: 0 };
}

export function writeAiUsage(u: AiUsage, path = AI_USAGE_PATH): void {
  writeJson(path, u);
}
