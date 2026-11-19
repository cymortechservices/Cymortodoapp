import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOccurrences, nextOccurrence, validateSpec, type ReminderSpec } from '../src/core/recurrence.js';
import { formatLocal, zonedToUtc, DAY } from '../src/core/time.js';

const NBO = 'Africa/Nairobi';
const day = (d: string, tz = NBO) => [zonedToUtc(d, '00:00', tz), zonedToUtc(d, '00:00', tz) + DAY] as const;
const locals = (xs: number[], tz = NBO) => xs.map((x) => formatLocal(x, tz).slice(11));

test('Drink Water: every 2 hours 08:00-20:00 gives exactly 7 reminders', () => {
  const spec: ReminderSpec = { timezone: NBO, startDate: '2026-11-01', startTime: '08:00', endTime: '20:00', repeat: { type: 'hours', every: 2 } };
  const [a, b] = day('2026-11-16');
  assert.deepEqual(locals(generateOccurrences(spec, a, b)), ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00']);
});

test('Take a break: every 60 min within 09:00-17:00 gives 9 reminders', () => {
  const spec: ReminderSpec = { timezone: NBO, startDate: '2026-11-01', startTime: '09:00', endTime: '17:00', repeat: { type: 'minutes', every: 60 } };
  const [a, b] = day('2026-11-16');
  const out = locals(generateOccurrences(spec, a, b));
  assert.equal(out.length, 9);
  assert.equal(out[0], '09:00');
  assert.equal(out[8], '17:00');
});

test('respects start/end dates and weekday filter', () => {
  const spec: ReminderSpec = { timezone: NBO, startDate: '2026-11-16', endDate: '2026-11-22', startTime: '07:00', repeat: { type: 'weekdays', days: [1, 3] } };
  const [a] = day('2026-11-01');
  const [, b] = day('2026-12-31');
  // 2026-11-16 is a Monday, 11-18 a Wednesday; window ends 11-22
  assert.deepEqual(generateOccurrences(spec, a, b).map((x) => formatLocal(x, NBO).slice(0, 10)), ['2026-11-16', '2026-11-18']);
});

test('every N days anchors on startDate', () => {
  const spec: ReminderSpec = { timezone: NBO, startDate: '2026-11-01', startTime: '09:00', repeat: { type: 'days', every: 3 } };
  const [a] = day('2026-11-01');
  const [, b] = day('2026-11-10');
  assert.deepEqual(generateOccurrences(spec, a, b).map((x) => formatLocal(x, NBO).slice(5, 10)), ['11-01', '11-04', '11-07', '11-10']);
});

test('daily at selected times, weekly, monthly (clamped to month end)', () => {
  const dailyAt: ReminderSpec = { timezone: NBO, startDate: '2026-11-01', startTime: '06:00', repeat: { type: 'dailyAt', times: ['21:00', '06:30'] } };
  const [a, b] = day('2026-11-16');
  assert.deepEqual(locals(generateOccurrences(dailyAt, a, b)), ['06:30', '21:00']);

  const weekly: ReminderSpec = { timezone: NBO, startDate: '2026-11-02', startTime: '09:00', repeat: { type: 'weekly' } }; // Mondays
  const w = generateOccurrences(weekly, day('2026-11-01')[0], day('2026-11-30')[1]);
  assert.deepEqual(w.map((x) => formatLocal(x, NBO).slice(5, 10)), ['11-02', '11-09', '11-16', '11-23', '11-30']);

  const monthly: ReminderSpec = { timezone: NBO, startDate: '2026-01-31', startTime: '09:00', repeat: { type: 'monthly' } };
  const m = generateOccurrences(monthly, day('2026-01-01')[0], day('2026-04-01')[0]);
  assert.deepEqual(m.map((x) => formatLocal(x, NBO).slice(0, 10)), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('wall-clock time is preserved across DST (08:00 New York)', () => {
  const NY = 'America/New_York';
  const spec: ReminderSpec = { timezone: NY, startDate: '2026-03-01', startTime: '08:00', repeat: { type: 'dailyAt', times: ['08:00'] } };
  const out = generateOccurrences(spec, Date.parse('2026-03-07T00:00:00Z'), Date.parse('2026-03-10T00:00:00Z'));
  assert.deepEqual(out.map((x) => new Date(x).toISOString()), ['2026-03-07T13:00:00.000Z', '2026-03-08T12:00:00.000Z', '2026-03-09T12:00:00.000Z']);
});

test('generation is deterministic and window is half-open', () => {
  const spec: ReminderSpec = { timezone: NBO, startDate: '2026-11-01', startTime: '08:00', endTime: '10:00', repeat: { type: 'hours', every: 1 } };
  const a = zonedToUtc('2026-11-16', '08:00', NBO);
  const b = zonedToUtc('2026-11-16', '10:00', NBO);
  const out = generateOccurrences(spec, a, b);
  assert.equal(out.length, 2); // 08:00 included, 10:00 excluded
  assert.deepEqual(out, generateOccurrences(spec, a, b));
});

test('nextOccurrence and validation', () => {
  const spec: ReminderSpec = { timezone: NBO, startDate: '2026-11-01', startTime: '08:00', endTime: '20:00', repeat: { type: 'hours', every: 2 } };
  const after = zonedToUtc('2026-11-16', '20:30', NBO);
  assert.equal(formatLocal(nextOccurrence(spec, after)!, NBO), '2026-11-17 08:00');
  assert.ok(validateSpec({ ...spec, endTime: '07:00' }).length > 0);
  assert.ok(validateSpec({ ...spec, repeat: { type: 'hours', every: 0 } }).length > 0);
  assert.throws(() => generateOccurrences({ ...spec, startTime: '99:00' }, 0, DAY));
});
