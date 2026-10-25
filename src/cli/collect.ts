import { loadConfig } from '../config.ts';
import { COLLECTORS } from '../collectors/index.ts';
import { runCollectors } from '../collectors/run.ts';
import { runArchive } from '../collectors/archive.ts';
import { RawSnapshot } from '../schema.ts';
import { SEEN_PATH, bodiesPath, pipelineDate, rawPath, readArchiveState, readJson, writeArchiveState, writeJson } from '../store.ts';

if (import.meta.main) {
  const now = new Date();
  const date = pipelineDate(now);
  const config = loadConfig();
  const seen = readJson<Record<string, string>>(SEEN_PATH, {});
  const backfill = Object.keys(seen).length === 0;
  let pdfBudget = { left: config.limits.pdfPerDay, maxBytes: config.limits.pdfMaxBytes };
  const collectors = COLLECTORS.map(collector => ({
    ...collector,
    async run(ctx: Parameters<typeof collector.run>[0]) {
      pdfBudget = ctx.pdfBudget;
      return collector.run(ctx);
    },
  }));
  // 첫 실행 채우기는 목록 여러 쪽과 상세를 받으므로 출처별 제한 시간을 넉넉히 준다.
  const result = await runCollectors(collectors, {
    fetch, now, date, config, backfill, seen: new Set(Object.keys(seen)),
  }, { timeoutMs: backfill ? 600_000 : 120_000 });
  const archive = await runArchive({
    fetch, now, date, config, backfill: false,
    seen: new Set([...Object.keys(seen), ...result.items.map(item => item.id)]),
    putBody(id, text) { result.bodies[id] = text; },
    pdfBudget,
  }, readArchiveState(), { deadline: Date.now() + 8 * 60_000 });
  const previousItems = readJson<RawSnapshot | null>(rawPath(date), null)?.items ?? [];
  const items = new Map([...previousItems, ...result.items].map(item => [item.id, item]));
  for (const item of archive.items) if (!items.has(item.id)) items.set(item.id, item);
  const currentIds = new Set(result.items.map(item => item.id));
  for (const status of result.status) {
    if (archive.notes[status.source]) status.note = [status.note, archive.notes[status.source]].filter(Boolean).join(' / ');
    status.count += [...items.values()].filter(item => item.source === status.source && !currentIds.has(item.id)).length;
  }
  const raw = RawSnapshot.parse({ date, generatedAt: now.toISOString(), items: [...items.values()], rates: result.rates, status: result.status });
  const bodies = { ...readJson<Record<string, string>>(bodiesPath(date), {}), ...result.bodies };
  writeJson(rawPath(date), raw);
  writeJson(bodiesPath(date), bodies);
  writeArchiveState(archive.state);
  console.log(`수집 완료: ${raw.items.length}건, 공시 ${raw.rates.length}행, 실패 ${raw.status.filter(s => !s.ok && !s.disabled).length}곳`);
}
