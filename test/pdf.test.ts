import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pdfText, fetchPdfText } from '../src/lib/pdf.ts';

const pdf = readFileSync(new URL('./fixtures/knia-news-88765.pdf', import.meta.url));

test('pdfText extracts the effective-date sentence from a KNIA press PDF', async () => {
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /경상환자/);
  assert.match(text, /'26\.10\.12\./);
});

test('fetchPdfText spends budget and returns null when exhausted or too big', async () => {
  const f = (async () => new Response(pdf)) as unknown as typeof fetch;
  const budget = { left: 1, maxBytes: 10_000_000 };
  assert.ok(await fetchPdfText('https://x.test/a.pdf', budget, { fetch: f }));
  assert.equal(budget.left, 0);
  assert.equal(await fetchPdfText('https://x.test/a.pdf', budget, { fetch: f }), null);
  assert.equal(await fetchPdfText('https://x.test/a.pdf', { left: 1, maxBytes: 10 }, { fetch: f }), null);
});

test('fetchPdfText returns null on HTTP error instead of throwing', async () => {
  const f = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
  assert.equal(await fetchPdfText('https://x.test/a.pdf', { left: 3, maxBytes: 1e7 }, { fetch: f }), null);
});
