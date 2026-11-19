import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, localDate, addDays, formatLocal, isValidTimezone } from '../src/core/time.js';

const iso = (ms: number) => new Date(ms).toISOString();

test('Nairobi (UTC+3, no DST)', () => {
  assert.equal(iso(zonedToUtc('2026-11-16', '08:00', 'Africa/Nairobi')), '2026-11-16T05:00:00.000Z');
  assert.equal(localDate(Date.parse('2026-11-15T21:00:00Z'), 'Africa/Nairobi'), '2026-11-16'); // midnight transition
});

test('DST spring-forward gap moves the wall clock forward', () => {
  // 02:30 does not exist on 2026-03-08 in New York; 03:30 EDT = 07:30Z
  assert.equal(iso(zonedToUtc('2026-03-08', '02:30', 'America/New_York')), '2026-03-08T07:30:00.000Z');
});

test('DST fall-back ambiguity picks first occurrence', () => {
  // 01:30 happens twice on 2026-11-01; first is EDT = 05:30Z
  assert.equal(iso(zonedToUtc('2026-11-01', '01:30', 'America/New_York')), '2026-11-01T05:30:00.000Z');
});

test('normal winter/summer offsets in New York', () => {
  assert.equal(iso(zonedToUtc('2026-01-15', '08:00', 'America/New_York')), '2026-01-15T13:00:00.000Z');
  assert.equal(iso(zonedToUtc('2026-07-15', '08:00', 'America/New_York')), '2026-07-15T12:00:00.000Z');
});

test('calendar helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(formatLocal(Date.parse('2026-11-16T05:00:00Z'), 'Africa/Nairobi'), '2026-11-16 08:00');
  assert.equal(isValidTimezone('Africa/Nairobi'), true);
  assert.equal(isValidTimezone('Mars/Olympus'), false);
  assert.throws(() => zonedToUtc('2026-02-30', '08:00', 'UTC'));
  assert.throws(() => zonedToUtc('2026-02-10', '25:00', 'UTC'));
});
