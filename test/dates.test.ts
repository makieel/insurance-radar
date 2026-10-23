import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, addDays, daysBetween, isIsoDate } from '../src/lib/dates.ts';

test('kstDate: UTC 15:00 is next day in KST', () => {
  assert.equal(kstDate(new Date('2026-10-21T15:00:00Z')), '2026-10-22');
  assert.equal(kstDate(new Date('2026-10-21T14:59:59Z')), '2026-10-21');
});
test('addDays / daysBetween across month', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(daysBetween('2026-10-15', '2026-10-22'), 7);
});
test('isIsoDate', () => {
  assert.ok(isIsoDate('2026-10-22'));
  for (const bad of ['abc', '2026-13-01', '2026-02-30', '']) assert.equal(isIsoDate(bad), false);
});
