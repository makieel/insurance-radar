import { USER_AGENT } from '../lib/http.ts';
import type { PdfBudget } from '../lib/pdf.ts';
import type { RateRow, RawItem, SourceStatus } from '../schema.ts';
import type { CollectCtx, Collector, CollectResult } from './types.ts';

export async function runCollectors(
  collectors: Collector[],
  ctx: Omit<CollectCtx, 'putBody' | 'pdfBudget'>,
  opts: { timeoutMs?: number } = {},
): Promise<{ items: RawItem[]; rates: RateRow[]; status: SourceStatus[]; bodies: Record<string, string> }> {
  const items = new Map<string, RawItem>();
  const rates: RateRow[] = [];
  const status: SourceStatus[] = [];
  const bodies: Record<string, string> = {};
  const pdfBudget: PdfBudget = { left: ctx.config.limits.pdfPerDay, maxBytes: ctx.config.limits.pdfMaxBytes };
  const timeoutMs = opts.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('수집 제한 시간은 양수여야 합니다.');

  for (const collector of collectors) {
    const source = ctx.config.sources.find(source => source.id === collector.id);
    const state: SourceStatus = { source: collector.id, ok: false, count: 0, error: null, note: null, disabled: false };
    status.push(state);
    if (!source || !source.enabled || source.keyEnv.some(key => !process.env[key]?.trim())) {
      state.disabled = true;
      state.note = !source || !source.enabled ? '설정에서 꺼진 출처입니다.' : '필요한 API 키가 없어 건너뜁니다.';
      continue;
    }

    const controller = new AbortController();
    const sourceBodies: Record<string, string> = {};
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race<CollectResult>([
        Promise.resolve().then(() => collector.run({
          ...ctx,
          seen: new Set(ctx.seen),
          pdfBudget,
          putBody(id, text) { if (active) sourceBodies[id] = text; },
          fetch: (input, init) => {
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
            headers.set('User-Agent', USER_AGENT);
            const signals = [controller.signal];
            if (input instanceof Request) signals.push(input.signal);
            if (init?.signal) signals.push(init.signal);
            return ctx.fetch(input, { ...init, headers, signal: AbortSignal.any(signals) });
          },
        })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            active = false;
            controller.abort();
            reject(new Error('수집 제한 시간을 초과했습니다.'));
          }, timeoutMs);
        }),
      ]);
      state.count = new Set(result.items.map(item => item.id)).size + (result.rates?.length ?? 0);
      state.note = result.note ?? null;
      if (state.count === 0 && !(result.scanned && result.scanned > 0)) throw new Error('수집 결과가 0건입니다. 출처 응답과 페이지 구조를 확인하세요.');
      if (state.count === 0) state.note ??= `오늘 보험 기사 없음(읽은 글 ${result.scanned}건)`;
      for (const item of result.items) if (!items.has(item.id)) items.set(item.id, item);
      rates.push(...(result.rates ?? []));
      Object.assign(bodies, sourceBodies);
      state.ok = true;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      active = false;
      clearTimeout(timer);
      controller.abort();
    }
  }
  return { items: [...items.values()], rates, status, bodies };
}
