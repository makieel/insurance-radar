import { loadConfig } from '../config.ts';
import { COLLECTORS } from '../collectors/index.ts';
import { runCollectors } from '../collectors/run.ts';
import { RawSnapshot } from '../schema.ts';
import { SEEN_PATH, bodiesPath, pipelineDate, rawPath, readJson, writeJson } from '../store.ts';

if (import.meta.main) {
  const now = new Date();
  const date = pipelineDate(now);
  const config = loadConfig();
  const seen = readJson<Record<string, string>>(SEEN_PATH, {});
  const result = await runCollectors(COLLECTORS, {
    fetch, now, date, config, backfill: Object.keys(seen).length === 0, seen: new Set(Object.keys(seen)),
  });
  const raw = RawSnapshot.parse({ date, generatedAt: now.toISOString(), items: result.items, rates: result.rates, status: result.status });
  const bodies = { ...readJson<Record<string, string>>(bodiesPath(date), {}), ...result.bodies };
  writeJson(rawPath(date), raw);
  writeJson(bodiesPath(date), bodies);
  console.log(`수집 완료: ${raw.items.length}건, 공시 ${raw.rates.length}행, 실패 ${raw.status.filter(s => !s.ok && !s.disabled).length}곳`);
}
