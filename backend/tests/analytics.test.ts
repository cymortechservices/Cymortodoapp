import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAll, summarize, perDay, hourlyHeatmap, completionStreak, insights, type AnalyticsActivity } from '../src/core/analytics.js';

const T = (d: string, hhmm: string) => Date.parse(`${d}T${hhmm}:00Z`);
const D = '2026-11-16';
const data: AnalyticsActivity[] = [
  { id: 'a', title: 'Programming', category: 'Work', session: { scheduledStart: T(D, '08:00'), scheduledEnd: T(D, '10:00'), checkInAt: T(D, '08:00'), checkOutAt: T(D, '10:18') } },
  { id: 'b', title: 'Study', category: 'Study', session: { scheduledStart: T(D, '11:00'), scheduledEnd: T(D, '12:00'), checkInAt: T(D, '11:00'), checkOutAt: T(D, '11:30') } },
  { id: 'c', title: 'Reading', category: 'Personal', session: { scheduledStart: T(D, '13:00'), scheduledEnd: T(D, '14:00'), markedMissed: true } },
  { id: 'd', title: 'Gym', category: 'Health', session: { scheduledStart: T(D, '15:00'), scheduledEnd: T(D, '16:00'), cancelled: true } },
];
const now = T(D, '20:00');

test('summary matches hand-computed values (cancelled excluded)', () => {
  const s = summarize(evaluateAll(data, now, 'UTC'));
  assert.equal(s.scheduled, 3);
  assert.equal(s.completed, 2);
  assert.equal(s.completionPct, 66.7);
  assert.equal(s.missed, 1);
  assert.equal(s.plannedMinutes, 120 + 60 + 60);
  assert.equal(s.activeMinutes, 138 + 30);
  assert.equal(s.overrunMinutes, 18);
  assert.equal(s.timeSavedMinutes, 30);
  assert.deepEqual(s.byCategory.Work, { plannedMinutes: 120, activeMinutes: 138, count: 1 });
  assert.equal(s.byCategory.Health, undefined);
});

test('empty input yields zeros, not NaN or invented numbers', () => {
  const s = summarize([]);
  assert.equal(s.completionPct, 0);
  assert.equal(s.scheduled, 0);
  assert.deepEqual(insights([], new Array(24).fill(0)), []);
});

test('hourly heatmap uses real active minutes and subtracts pauses', () => {
  const h = hourlyHeatmap(data, now, 'UTC');
  assert.equal(h[8], 60); assert.equal(h[9], 60);
  assert.equal(h[10], 18);
  assert.equal(h[11], 30);
  const paused = hourlyHeatmap([{ ...data[0], session: { ...data[0].session, pauses: [{ start: T(D, '09:00'), end: T(D, '09:30') }] } }], now, 'UTC');
  assert.equal(paused[9], 30);
  assert.equal(paused[8], 60);
});

test('heatmap respects timezone (Nairobi = UTC+3)', () => {
  const h = hourlyHeatmap([data[0]], now, 'Africa/Nairobi');
  assert.equal(h[11], 60); assert.equal(h[12], 60); assert.equal(h[13], 18);
});

test('per-day grouping and streaks', () => {
  const mk = (d: string): AnalyticsActivity => ({ id: d, title: 't', category: 'c', session: { scheduledStart: T(d, '08:00'), scheduledEnd: T(d, '09:00'), checkInAt: T(d, '08:00'), checkOutAt: T(d, '09:00') } });
  const days = perDay(evaluateAll(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14', '2026-11-15'].map(mk), T('2026-11-16', '10:00'), 'UTC'));
  assert.equal(days.length, 5);
  assert.deepEqual(completionStreak(days, '2026-11-16'), { current: 2, longest: 3 });
});

test('insights are deterministic, statistic-based and never say "wasted"', () => {
  const ev = evaluateAll(data, now, 'UTC');
  const out = insights(ev, hourlyHeatmap(data, now, 'UTC'));
  assert.ok(out.includes('You completed 66.7% of your scheduled activities (2 of 3).'));
  assert.ok(out.includes('You marked 1 scheduled activity as missed.'));
  assert.ok(out.includes('You spent 2h 18m on Work, your most-tracked category.'));
  assert.ok(out.some((l) => l.includes('exceeded planned time by 18m')));
  assert.deepEqual(out, insights(ev, hourlyHeatmap(data, now, 'UTC')));
  assert.equal(out.some((l) => /wast/i.test(l)), false);
});
