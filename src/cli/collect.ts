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
  const backfill = Object.keys(seen).length === 0;
  // 첫 실행 채우기는 목록 여러 쪽과 상세를 받으므로 출처별 제한 시간을 넉넉히 준다.
  const result = await runCollectors(COLLECTORS, {
    fetch, now, date, config, backfill, seen: new Set(Object.keys(seen)),
  }, { timeoutMs: backfill ? 600_000 : 120_000 });
  const raw = RawSnapshot.parse({ date, generatedAt: now.toISOString(), items: result.items, rates: result.rates, status: result.status });
  const bodies = { ...readJson<Record<string, string>>(bodiesPath(date), {}), ...result.bodies };
  writeJson(rawPath(date), raw);
  writeJson(bodiesPath(date), bodies);
  console.log(`수집 완료: ${raw.items.length}건, 공시 ${raw.rates.length}행, 실패 ${raw.status.filter(s => !s.ok && !s.disabled).length}곳`);
}
