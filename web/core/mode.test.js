import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialMode, createModeController, MODE_KEY } from './mode.js';

const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const memory = (init) => {
  const m = new Map(init ? [[MODE_KEY, init]] : []);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), m };
};

test('first visit is light', () => {
  assert.equal(initialMode(memory()), 'light');
  assert.equal(initialMode(null), 'light');
});
test('falls back to light when storage throws', () => {
  assert.equal(initialMode(throwing), 'light');
});
test('stored mode wins', () => {
  assert.equal(initialMode(memory('dark')), 'dark');
  assert.equal(initialMode(memory('light')), 'light');
});
test('invalid stored value is ignored', () => {
  assert.equal(initialMode(memory('purple')), 'light');
});
test('toggle works even when storage throws', () => {
  const root = { dataset: {} };
  const c = createModeController({ root, storage: throwing });
  assert.equal(root.dataset.mode, 'light');
  assert.equal(c.toggle(), 'dark');
  assert.equal(root.dataset.mode, 'dark');
  assert.equal(c.get(), 'dark');
});
test('toggle persists to storage', () => {
  const s = memory();
  createModeController({ root: { dataset: {} }, storage: s }).toggle();
  assert.equal(s.m.get(MODE_KEY), 'dark');
});
