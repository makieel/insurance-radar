import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, count, signed, ago, kstStamp, koOr, safeUrl } from './format.js';

test('esc escapes markup and quotes', () => {
  assert.equal(esc('<img src=x onerror=a>'), '&lt;img src=x onerror=a&gt;');
  assert.equal(esc(`a&b "c" 'd'`), 'a&amp;b &quot;c&quot; &#39;d&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(12), '12');
});
test('count formats like mockup', () => {
  assert.equal(count(16000), '16.0K');
  assert.equal(count(3681), '3,681');
  assert.equal(count(358000), '358K');
  assert.equal(count(9999), '9,999');
  assert.equal(count(10000), '10.0K');
  assert.equal(count(0), '0');
});
test('signed', () => {
  assert.equal(signed(3681), '+3,681');
  assert.equal(signed(-12), '-12');
  assert.equal(signed(0), '0');
});
test('ago', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(ago('2026-10-22T10:00:00Z', now), '2시간 전');
  assert.equal(ago('2026-10-22T11:30:00Z', now), '30분 전');
  assert.equal(ago('2026-10-22T11:59:50Z', now), '방금 전');
  assert.equal(ago('2026-10-21T10:00:00Z', now), '어제');
  assert.equal(ago('2026-10-19T11:00:00Z', now), '3일 전');
});
test('kstStamp', () => {
  assert.equal(kstStamp('2026-10-22T00:08:00Z'), '2026.10.22 THU · 09:08 KST');
  assert.equal(kstStamp('2026-10-22T20:00:00Z'), '2026.10.23 FRI · 05:00 KST');
});
test('koOr', () => {
  assert.equal(koOr('한글', 'orig'), '한글');
  assert.equal(koOr(null, 'orig'), 'orig');
  assert.equal(koOr('', 'orig'), 'orig');
});
test('safeUrl allows only absolute http(s)', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'rel/path', '', null, undefined, 5, 'JaVaScRiPt:alert(1)']) {
    assert.equal(safeUrl(bad), '#');
  }
});
