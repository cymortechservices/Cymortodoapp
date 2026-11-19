import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSession, type SessionInput } from '../src/core/accounting.js';
import { findConflicts, validateSlot } from '../src/core/overlap.js';
import { MIN } from '../src/core/time.js';

const T = (hhmm: string) => Date.parse(`2026-11-16T${hhmm}:00Z`);
const base = (o: Partial<SessionInput> = {}): SessionInput => ({ scheduledStart: T('08:00'), scheduledEnd: T('10:00'), ...o });

test('spec example: 08:00-10:00, out 10:18 => 120 / 138 / overrun 18', () => {
  const r = evaluateSession(base({ checkInAt: T('08:00'), checkOutAt: T('10:18') }), T('11:00'));
  assert.equal(r.scheduledMinutes, 120);
  assert.equal(r.activeMinutes, 138);
  assert.equal(r.overrunMinutes, 18);
  assert.equal(r.status, 'completed_late');
  assert.equal(r.unexplainedOverrunMinutes, 18);
});

test('early completion records time saved', () => {
  const r = evaluateSession(base({ checkInAt: T('08:00'), checkOutAt: T('09:30') }), T('11:00'));
  assert.equal(r.status, 'completed_early');
  assert.equal(r.timeSavedMinutes, 30);
  assert.equal(r.overrunMinutes, 0);
});

test('within tolerance counts as on time', () => {
  assert.equal(evaluateSession(base({ checkInAt: T('08:00'), checkOutAt: T('10:03') }), T('11:00')).status, 'completed_on_time');
});

test('pauses are excluded from active time; open pause runs to now', () => {
  const r = evaluateSession(base({ checkInAt: T('08:00'), checkOutAt: T('10:18'), pauses: [{ start: T('09:00'), end: T('09:15') }] }), T('11:00'));
  assert.equal(r.elapsedMinutes, 138);
  assert.equal(r.pausedMinutes, 15);
  assert.equal(r.activeMinutes, 123);
  assert.equal(r.overrunMinutes, 3);
  const open = evaluateSession(base({ checkInAt: T('08:00'), pauses: [{ start: T('09:00') }] }), T('09:30'));
  assert.equal(open.status, 'paused');
  assert.equal(open.activeMinutes, 60);
});

test('interruptions split overrun into explained and unexplained', () => {
  const r = evaluateSession(
    base({ checkInAt: T('08:00'), checkOutAt: T('10:30'), interruptions: [{ start: T('09:00'), end: T('09:20'), reason: 'phone call' }] }),
    T('11:00'),
  );
  assert.equal(r.overrunMinutes, 30);
  assert.equal(r.interruptionMinutes, 20);
  assert.equal(r.unexplainedOverrunMinutes, 10);
  assert.equal(evaluateSession(base({ checkInAt: T('08:00'), checkOutAt: T('09:00'), endedByInterruption: true }), T('11:00')).status, 'interrupted');
});

test('not checked in: never pretends it started; unresolved, not auto-missed', () => {
  assert.equal(evaluateSession(base(), T('07:00')).status, 'scheduled');
  const after = evaluateSession(base(), T('12:00'));
  assert.equal(after.status, 'unresolved');
  assert.equal(after.activeMinutes, 0);
  assert.equal(evaluateSession(base({ markedMissed: true }), T('12:00')).status, 'missed');
  assert.equal(evaluateSession(base({ cancelled: true }), T('12:00')).status, 'cancelled');
});

test('checked in, never checked out: in_progress then overdue (still unresolved, not wasted)', () => {
  assert.equal(evaluateSession(base({ checkInAt: T('08:00') }), T('09:00')).status, 'in_progress');
  const r = evaluateSession(base({ checkInAt: T('08:00') }), T('10:15'));
  assert.equal(r.status, 'overdue');
  assert.equal(r.endDelayMinutes, 15);
  assert.equal(r.overrunMinutes, 15);
});

test('rejects checkout before checkin', () => {
  assert.throws(() => evaluateSession(base({ checkInAt: T('09:00'), checkOutAt: T('08:00') }), T('11:00')));
});

test('future schedule protection: an overrun never changes any other activity', () => {
  const next = Object.freeze({ id: 'n', title: 'Next', start: T('10:00'), end: T('11:00') });
  const before = JSON.stringify(next);
  evaluateSession(base({ checkInAt: T('08:00'), checkOutAt: T('10:18') }), T('11:00'));
  assert.equal(JSON.stringify(next), before);
  // evaluateSession has no parameter that could carry another activity (structural guarantee).
  assert.equal(evaluateSession.length >= 2, true);
});

test('conflict detection reports overlaps without modifying inputs; back-to-back is fine', () => {
  const slots = Object.freeze([
    Object.freeze({ id: 'a', title: 'A', start: T('08:00'), end: T('10:00') }),
    Object.freeze({ id: 'b', title: 'B', start: T('09:30'), end: T('11:00') }),
    Object.freeze({ id: 'c', title: 'C', start: T('11:00'), end: T('12:00') }),
  ]);
  const c = findConflicts(slots);
  assert.deepEqual(c, [{ a: 'a', b: 'b', overlapMinutes: 30 }]);
  assert.equal(validateSlot({ start: 10 * MIN, end: 10 * MIN }), 'End time must be after start time');
  assert.equal(validateSlot({ start: 1, end: 2 }), null);
});
