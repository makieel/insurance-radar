import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, domainOf, stripMarkdown } from '../src/lib/text.ts';

test('normalizeUrl strips utm and www and trailing slash', () => {
  assert.equal(normalizeUrl('https://www.Example.com/a/?utm_source=x'), 'example.com/a');
});
test('normalizeUrl keeps non-utm query and drops scheme', () => {
  assert.equal(normalizeUrl('http://example.com/p?id=3&utm_medium=y'), 'example.com/p?id=3');
  assert.equal(normalizeUrl('https://example.com/'), 'example.com');
});
test('domainOf returns host without www, empty on garbage', () => {
  assert.equal(domainOf('https://www.GitHub.com/a/b'), 'github.com');
  assert.equal(domainOf('not a url'), '');
});
test('stripMarkdown removes syntax', () => {
  assert.equal(stripMarkdown('# Title\n\n**bold** and [link](http://x.y) `code`\n- item'), 'Title bold and link code item');
});
test('stripMarkdown keeps snake_case identifiers', () => {
  assert.equal(stripMarkdown('use max_tokens and top_p with _emphasis_ here'), 'use max_tokens and top_p with emphasis here');
});
