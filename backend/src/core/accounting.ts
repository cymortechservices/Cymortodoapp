import { MIN } from './time.js';

export interface Pause {
  start: number;
  end?: number;
}
export interface Interruption {
  start: number;
  end?: number;
  reason?: string;
}

export interface SessionInput {
  scheduledStart: number;
  scheduledEnd: number;
  checkInAt?: number;
  checkOutAt?: number;
  pauses?: Pause[];
  interruptions?: Interruption[];
  markedMissed?: boolean;
  cancelled?: boolean;
  /** Set when the user ended the activity because of an interruption. */
  endedByInterruption?: boolean;
}

export type SessionStatus =
  | 'scheduled' // before start, not checked in
  | 'in_progress'
  | 'paused'
  | 'overdue' // checked in, still running past scheduled end
  | 'completed_on_time'
  | 'completed_early'
  | 'completed_late'
  | 'interrupted'
  | 'missed' // explicitly marked missed by the user
  | 'cancelled'
  | 'unresolved'; // never checked in and the slot has passed: needs reconciliation

export interface SessionResult {
  status: SessionStatus;
  scheduledMinutes: number;
  elapsedMinutes: number;
  pausedMinutes: number;
  activeMinutes: number;
  /** active time beyond scheduled duration (spec: 120 planned, 138 actual => 18). */
  overrunMinutes: number;
  /** minutes the activity finished after its scheduled end time. */
  endDelayMinutes: number;
  timeSavedMinutes: number;
  interruptionMinutes: number;
  /** overrun not explained by recorded interruptions (never labelled "wasted"). */
  unexplainedOverrunMinutes: number;
}

export const ON_TIME_TOLERANCE_MIN = 5;

function overlapMs(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Pure time-accounting. It takes ONE activity's session and returns derived
 * numbers. It deliberately has no access to any other activity, so an overrun
 * can never move a later activity: the schedule is only changed by explicit edits.
 */
export function evaluateSession(s: SessionInput, now: number, toleranceMin = ON_TIME_TOLERANCE_MIN): SessionResult {
  const scheduledMinutes = Math.round((s.scheduledEnd - s.scheduledStart) / MIN);
  const base: SessionResult = {
    status: 'scheduled',
    scheduledMinutes,
    elapsedMinutes: 0,
    pausedMinutes: 0,
    activeMinutes: 0,
    overrunMinutes: 0,
    endDelayMinutes: 0,
    timeSavedMinutes: 0,
    interruptionMinutes: 0,
    unexplainedOverrunMinutes: 0,
  };

  if (s.cancelled) return { ...base, status: 'cancelled' };

  if (s.checkInAt === undefined) {
    if (s.markedMissed) return { ...base, status: 'missed' };
    return { ...base, status: now > s.scheduledEnd ? 'unresolved' : 'scheduled' };
  }

  if (s.checkOutAt !== undefined && s.checkOutAt < s.checkInAt) {
    throw new Error('checkOutAt must not be before checkInAt');
  }
  const finished = s.checkOutAt !== undefined;
  const windowEnd = finished ? (s.checkOutAt as number) : Math.max(now, s.checkInAt);
  const window = { start: s.checkInAt, end: windowEnd };

  // Pauses clipped to the checked-in window; an open pause runs to the window end.
  const pausedMs = (s.pauses ?? []).reduce(
    (sum, p) => sum + overlapMs({ start: p.start, end: p.end ?? windowEnd }, window),
    0,
  );
  const interruptionMs = (s.interruptions ?? []).reduce(
    (sum, i) => sum + overlapMs({ start: i.start, end: i.end ?? windowEnd }, window),
    0,
  );

  const elapsedMs = window.end - window.start;
  const activeMs = Math.max(0, elapsedMs - pausedMs);
  const elapsedMinutes = Math.round(elapsedMs / MIN);
  const pausedMinutes = Math.round(pausedMs / MIN);
  const activeMinutes = Math.round(activeMs / MIN);
  const interruptionMinutes = Math.round(interruptionMs / MIN);
  const overrunMinutes = Math.max(0, activeMinutes - scheduledMinutes);

  const result: SessionResult = {
    ...base,
    elapsedMinutes,
    pausedMinutes,
    activeMinutes,
    overrunMinutes,
    interruptionMinutes,
    unexplainedOverrunMinutes: Math.max(0, overrunMinutes - interruptionMinutes),
  };

  if (!finished) {
    const openPause = (s.pauses ?? []).some((p) => p.end === undefined);
    if (now > s.scheduledEnd) {
      result.status = 'overdue';
      result.endDelayMinutes = Math.round((now - s.scheduledEnd) / MIN);
    } else {
      result.status = openPause ? 'paused' : 'in_progress';
    }
    return result;
  }

  const out = s.checkOutAt as number;
  result.endDelayMinutes = Math.max(0, Math.round((out - s.scheduledEnd) / MIN));
  result.timeSavedMinutes = Math.max(0, scheduledMinutes - activeMinutes);

  if (s.endedByInterruption) result.status = 'interrupted';
  else if (out < s.scheduledEnd - toleranceMin * MIN) result.status = 'completed_early';
  else if (out > s.scheduledEnd + toleranceMin * MIN) result.status = 'completed_late';
  else result.status = 'completed_on_time';
  return result;
}

export const COMPLETED_STATUSES: SessionStatus[] = ['completed_on_time', 'completed_early', 'completed_late'];
