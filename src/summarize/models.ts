import { fetchJson, HttpError, type FetchLike } from '../lib/http.ts';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

/** Reasoning-heavy models can take minutes on a long prompt. */
export const DEFAULT_TIMEOUT_MS = 150_000;

interface ChatResponse {
  choices?: { message?: { content?: unknown } }[];
}

/** One request to an OpenAI-compatible `/chat/completions` endpoint (config.json `ai.baseUrl`). */
export async function chat(
  messages: ChatMessage[],
  opts: { apiKey: string; baseUrl: string; model: string; timeoutMs?: number; fetch?: FetchLike },
): Promise<string> {
  const base = new URL(opts.baseUrl.replace(/\/+$/, '') + '/chat/completions');
  if (base.protocol !== 'https:') throw new Error(`ai: refusing non-https endpoint ${base.origin}`);
  const res = await fetchJson<ChatResponse>(base.href, {
    fetch: opts.fetch,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: opts.model, messages, temperature: 0.2 }),
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('ai: empty response');
  return content;
}

/**
 * ChatFn over a list of candidate models: on the first call it tries them in order, skipping
 * ones the provider rejects as unknown/unavailable (HTTP 400/404) or that time out, then sticks
 * with the first that answers. Model names change often, so config.json lists several.
 */
export function makeChatFn(opts: { apiKey: string; baseUrl: string; models: string[]; timeoutMs?: number; fetch?: FetchLike }): {
  chat: ChatFn;
  model: () => string | null;
} {
  let chosen: string | null = null;
  const call = (model: string, messages: ChatMessage[]) =>
    chat(messages, { apiKey: opts.apiKey, baseUrl: opts.baseUrl, model, timeoutMs: opts.timeoutMs, fetch: opts.fetch });
  return {
    model: () => chosen,
    async chat(messages) {
      if (chosen) return call(chosen, messages);
      for (const model of opts.models) {
        try {
          const out = await call(model, messages);
          chosen = model;
          return out;
        } catch (e) {
          if (e instanceof HttpError && (e.status === 400 || e.status === 404)) {
            console.warn(`ai: model ${model} unavailable (HTTP ${e.status}), trying next`);
            continue;
          }
          if (e instanceof Error && e.name === 'TimeoutError') {
            console.warn(`ai: model ${model} timed out, trying next`);
            continue;
          }
          throw e;
        }
      }
      throw new Error(`ai: no usable model among ${opts.models.join(', ')}`);
    },
  };
}

/** 모델 응답에서 JSON 객체를 꺼낸다. ```json 울타리가 있으면 벗기고, 객체가 아니면 null. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1];
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 문자열이면 다듬고 max자로 자른다. 아니거나 비면 null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
