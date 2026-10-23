import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_USAGE_PATH, readAiUsage, writeAiUsage } from '../src/store.ts';

// 저장소의 data/를 건드리지 않도록 임시 폴더에 쓴다
function tempPath(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'ir-ai-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'ai-usage.json');
}

test('AI_USAGE_PATH는 data/ai-usage.json', () => {
  assert.match(AI_USAGE_PATH.replace(/\\/g, '/'), /\/data\/ai-usage\.json$/);
});

test('readAiUsage: 파일이 없으면 0부터', (t) => {
  const path = tempPath(t);
  assert.deepEqual(readAiUsage('2026-10-23', path), { date: '2026-10-23', calls: 0, summaries: 0 });
});

test('readAiUsage: 같은 날은 누적', (t) => {
  const path = tempPath(t);
  writeAiUsage({ date: '2026-10-23', calls: 7, summaries: 10 }, path);
  const usage = readAiUsage('2026-10-23', path);
  assert.deepEqual(usage, { date: '2026-10-23', calls: 7, summaries: 10 });
  usage.calls += 3;
  usage.summaries += 5;
  writeAiUsage(usage, path);
  assert.deepEqual(readAiUsage('2026-10-23', path), { date: '2026-10-23', calls: 10, summaries: 15 });
});

test('readAiUsage: 날짜가 바뀌면 0으로 초기화', (t) => {
  const path = tempPath(t);
  writeAiUsage({ date: '2026-10-23', calls: 120, summaries: 30 }, path);
  assert.deepEqual(readAiUsage('2026-10-24', path), { date: '2026-10-24', calls: 0, summaries: 0 });
});

test('readAiUsage: summaries가 없거나 이상한 값이면 0', (t) => {
  const path = tempPath(t);
  writeFileSync(path, JSON.stringify({ date: '2026-10-23', calls: 4 }), 'utf8');
  assert.deepEqual(readAiUsage('2026-10-23', path), { date: '2026-10-23', calls: 4, summaries: 0 });
  writeFileSync(path, JSON.stringify({ date: '2026-10-23', calls: '4', summaries: -1 }), 'utf8');
  assert.deepEqual(readAiUsage('2026-10-23', path), { date: '2026-10-23', calls: 0, summaries: 0 });
});
