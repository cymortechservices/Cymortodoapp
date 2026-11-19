import {
  addDays,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  localDate,
  parseHHmm,
  parseYmd,
  ymd,
  zonedToUtc,
  DAY,
} from './time.js';

export type Repeat =
  | { type: 'minutes'; every: number }
  | { type: 'hours'; every: number }
  | { type: 'days'; every: number }
  | { type: 'dailyAt'; times: string[] }
  | { type: 'weekdays'; days: number[] } // 0=Sun..6=Sat, fires at startTime
  | { type: 'weekly' } // same weekday as startDate, at startTime
  | { type: 'monthly' } // same day-of-month as startDate (clamped), at startTime
  | { type: 'custom'; times: string[]; everyDays: number; days?: number[] };

export interface ReminderSpec {
  timezone: string;
  startDate: string; // YYYY-MM-DD, local
  endDate?: string; // inclusive, local
  startTime: string; // HH:mm local
  endTime?: string; // HH:mm local, inclusive; bounds interval repeats within a day
  repeat: Repeat;
  /** Optional weekday filter (0=Sun..6=Sat) applied to interval/day based repeats. */
  weekdays?: number[];
}

export const MAX_OCCURRENCES_PER_CALL = 5000;

export function validateSpec(spec: ReminderSpec): string[] {
  const errs: string[] = [];
  try {
    parseYmd(spec.startDate);
    if (spec.endDate) parseYmd(spec.endDate);
    const s = parseHHmm(spec.startTime);
    if (spec.endTime) {
      const e = parseHHmm(spec.endTime);
      if (e.h * 60 + e.m < s.h * 60 + s.m) errs.push('endTime must not be before startTime');
    }
  } catch (e) {
    errs.push((e as Error).message);
  }
  if (spec.endDate && spec.endDate < spec.startDate) errs.push('endDate must not be before startDate');
  const r = spec.repeat;
  if (r.type === 'minutes' || r.type === 'hours' || r.type === 'days') {
    if (!Number.isInteger(r.every) || r.every < 1) errs.push('repeat.every must be a positive integer');
    if (r.type === 'minutes' && r.every < 1) errs.push('minimum interval is 1 minute');
  }
  if (r.type === 'dailyAt' || r.type === 'custom') {
    if (r.times.length === 0) errs.push('at least one time is required');
    for (const t of r.times) {
      try {
        parseHHmm(t);
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
  }
  if (r.type === 'weekdays' && (r.days.length === 0 || r.days.some((d) => d < 0 || d > 6))) {
    errs.push('weekdays must be a non-empty list of 0-6');
  }
  if (r.type === 'custom' && (!Number.isInteger(r.everyDays) || r.everyDays < 1)) {
    errs.push('custom.everyDays must be a positive integer');
  }
  return errs;
}

function timesForDay(spec: ReminderSpec): string[] {
  const r = spec.repeat;
  const s = parseHHmm(spec.startTime);
  const startMin = s.h * 60 + s.m;
  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  if (r.type === 'minutes' || r.type === 'hours') {
    const step = r.type === 'minutes' ? r.every : r.every * 60;
    const endMin = spec.endTime ? (() => { const e = parseHHmm(spec.endTime!); return e.h * 60 + e.m; })() : 23 * 60 + 59;
    const out: string[] = [];
    for (let m = startMin; m <= endMin; m += step) out.push(fmt(m));
    return out;
  }
  if (r.type === 'dailyAt' || r.type === 'custom') return [...new Set(r.times)].sort();
  return [spec.startTime];
}

function dayMatches(spec: ReminderSpec, date: string): boolean {
  if (date < spec.startDate) return false;
  if (spec.endDate && date > spec.endDate) return false;
  const r = spec.repeat;
  const dow = dayOfWeek(date);
  if (spec.weekdays && spec.weekdays.length > 0 && !spec.weekdays.includes(dow)) return false;

  switch (r.type) {
    case 'minutes':
    case 'hours':
    case 'dailyAt':
      return true;
    case 'days':
      return daysBetween(spec.startDate, date) % r.every === 0;
    case 'weekdays':
      return r.days.includes(dow);
    case 'weekly':
      return daysBetween(spec.startDate, date) % 7 === 0;
    case 'monthly': {
      const start = parseYmd(spec.startDate);
      const cur = parseYmd(date);
      const target = Math.min(start.d, daysInMonth(cur.y, cur.mo));
      return cur.d === target;
    }
    case 'custom':
      if (r.days && r.days.length > 0 && !r.days.includes(dow)) return false;
      return daysBetween(spec.startDate, date) % r.everyDays === 0;
  }
}

/**
 * Generate reminder fire times (UTC ms) in the half-open window [fromMs, toMs).
 * Deterministic and pure: the same spec always yields the same instants, which
 * is what makes idempotency keys (reminderId + fireAt) safe.
 * Wall-clock times are preserved across DST changes ("8:00 AM" stays 8:00 AM).
 */
export function generateOccurrences(spec: ReminderSpec, fromMs: number, toMs: number): number[] {
  const errs = validateSpec(spec);
  if (errs.length) throw new Error(`Invalid reminder spec: ${errs.join('; ')}`);
  if (toMs <= fromMs) return [];

  const firstDay = addDays(localDate(fromMs, spec.timezone), -1);
  const lastDay = addDays(localDate(toMs, spec.timezone), 1);
  const times = timesForDay(spec);
  const out: number[] = [];

  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    if (!dayMatches(spec, day)) continue;
    for (const t of times) {
      const at = zonedToUtc(day, t, spec.timezone);
      if (at >= fromMs && at < toMs) {
        out.push(at);
        if (out.length >= MAX_OCCURRENCES_PER_CALL) return out;
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** Next occurrence strictly after `afterMs`, searching up to `horizonDays`. */
export function nextOccurrence(spec: ReminderSpec, afterMs: number, horizonDays = 400): number | null {
  let from = afterMs + 1;
  for (let i = 0; i < Math.ceil(horizonDays / 30); i++) {
    const to = from + 30 * DAY;
    const hit = generateOccurrences(spec, from, to)[0];
    if (hit !== undefined) return hit;
    from = to;
  }
  return null;
}

export { ymd };
