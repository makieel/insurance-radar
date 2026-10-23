import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsoDate, kstDate } from './lib/dates.ts';
import type { SourceId } from './schema.ts';

export interface PendingAi {
  type: 'summary' | 'judge' | 'relevance';
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
