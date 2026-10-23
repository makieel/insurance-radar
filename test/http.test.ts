import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchText, fetchJson, HttpError, USER_AGENT } from '../src/lib/http.ts';

test('fetchJson throws HttpError on 403', async () => {
  const f = async () => new Response('no', { status: 403 });
  await assert.rejects(fetchJson('https://x.test/a', { fetch: f as any }), (e: any) => {
    return e instanceof HttpError && e.status === 403 && e.url === 'https://x.test/a';
  });
});

test('fetchText returns body and sends the User-Agent', async () => {
  let seen: Headers | undefined;
  const f = async (_u: any, init?: RequestInit) => {
    seen = new Headers(init?.headers);
    return new Response('hello');
  };
  assert.equal(await fetchText('https://x.test/a', { fetch: f as any }), 'hello');
  assert.equal(seen!.get('user-agent'), USER_AGENT);
  assert.ok(!/bot/i.test(USER_AGENT), 'FSS drops connections whose UA contains "bot"');
});

test('fetchJson parses JSON', async () => {
  const f = async () => new Response('{"a":1}');
  assert.deepEqual(await fetchJson('https://x.test/a', { fetch: f as any }), { a: 1 });
});

test('token header only for GitHub API hosts', async () => {
  const auth: Record<string, string | null> = {};
  const f = async (u: any, init?: RequestInit) => {
    auth[String(u)] = new Headers(init?.headers).get('authorization');
    return new Response('ok');
  };
  for (const url of [
    'https://api.github.com/x',
    'https://models.github.ai/x',
    'https://www.reddit.com/r/a/.rss',
    'https://api.github.com.evil.test/x',
  ]) {
    await fetchText(url, { fetch: f as any, token: 'tok' });
  }
  assert.equal(auth['https://api.github.com/x'], 'Bearer tok');
  assert.equal(auth['https://models.github.ai/x'], null);
  assert.equal(auth['https://www.reddit.com/r/a/.rss'], null);
  assert.equal(auth['https://api.github.com.evil.test/x'], null);
});

test('no Authorization when token is null', async () => {
  let a: string | null = 'unset';
  const f = async (_u: any, init?: RequestInit) => {
    a = new Headers(init?.headers).get('authorization');
    return new Response('ok');
  };
  await fetchText('https://api.github.com/x', { fetch: f as any, token: null });
  assert.equal(a, null);
});

test('timeout aborts', async () => {
  const f = (_u: any, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
    });
  await assert.rejects(fetchText('https://x.test/a', { fetch: f as any, timeoutMs: 10 }));
});

test('fetchText forwards method and body', async () => {
  let seen: RequestInit | undefined;
  const f = async (_u: any, init?: RequestInit) => {
    seen = init;
    return new Response('ok');
  };
  await fetchText('https://x.test/a', { fetch: f as any, method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.body, '{"a":1}');
});
