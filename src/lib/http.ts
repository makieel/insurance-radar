export type FetchLike = typeof fetch;

export interface FetchOpts {
  fetch?: FetchLike;
  timeoutMs?: number;
  token?: string | null;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /** Extra abort signal (e.g. a caller's time budget), combined with the per-request timeout. */
  signal?: AbortSignal;
}

export const USER_AGENT = 'Mozilla/5.0 (compatible; insurance-radar/1.0; +https://github.com/marsaeel/insurance-radar)';
const DEFAULT_TIMEOUT_MS = 20_000;
const TOKEN_HOSTS = new Set(['api.github.com']);

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

function wantsToken(url: string): boolean {
  try {
    return TOKEN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const doFetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...opts.headers };
  if (opts.token && wantsToken(url)) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await doFetch(url, {
    headers,
    ...(opts.method ? { method: opts.method } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
    signal: opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)])
      : AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return await res.text();
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}
