import { COMPLETED_STATUSES, evaluateSession, type SessionInput, type SessionResult } from './accounting.js';
import { localDate, localParts, MIN } from './time.js';

export interface AnalyticsActivity {
  id: string;
  title: string;
  category: string;
  session: SessionInput;
}

export interface Evaluated extends AnalyticsActivity {
  result: SessionResult;
  date: string; // local date of scheduled start
}

export interface Summary {
  scheduled: number; // excludes cancelled
  completed: number;
  missed: number;
  overdue: number;
  unresolved: number;
  inProgress: number;
  completionPct: number; // completed / scheduled, 0 when nothing scheduled
  plannedMinutes: number;
  activeMinutes: number;
  overrunMinutes: number;
  timeSavedMinutes: number;
  interruptionMinutes: number;
  unexplainedOverrunMinutes: number;
  byCategory: Record<string, { plannedMinutes: number; activeMinutes: number; count: number }>;
}

export function evaluateAll(items: AnalyticsActivity[], now: number, tz: string): Evaluated[] {
  return items.map((i) => ({
    ...i,
    result: evaluateSession(i.session, now),
    date: localDate(i.session.scheduledStart, tz),
  }));
}

export function summarize(items: Evaluated[]): Summary {
  const live = items.filter((i) => i.result.status !== 'cancelled');
  const completed = live.filter((i) => COMPLETED_STATUSES.includes(i.result.status)).length;
  const byCategory: Summary['byCategory'] = {};
  let planned = 0, active = 0, over = 0, saved = 0, intr = 0, unexpl = 0;

  for (const i of live) {
    planned += i.result.scheduledMinutes;
    active += i.result.activeMinutes;
    over += i.result.overrunMinutes;
    saved += i.result.timeSavedMinutes;
    intr += i.result.interruptionMinutes;
    unexpl += i.result.unexplainedOverrunMinutes;
    const c = (byCategory[i.category] ??= { plannedMinutes: 0, activeMinutes: 0, count: 0 });
    c.plannedMinutes += i.result.scheduledMinutes;
    c.activeMinutes += i.result.activeMinutes;
    c.count++;
  }
  const count = (s: string) => live.filter((i) => i.result.status === s).length;
  return {
    scheduled: live.length,
    completed,
    missed: count('missed'),
    overdue: count('overdue'),
    unresolved: count('unresolved'),
    inProgress: live.filter((i) => i.result.status === 'in_progress' || i.result.status === 'paused').length,
    completionPct: live.length === 0 ? 0 : Math.round((completed / live.length) * 1000) / 10,
    plannedMinutes: planned,
    activeMinutes: active,
    overrunMinutes: over,
    timeSavedMinutes: saved,
    interruptionMinutes: intr,
    unexplainedOverrunMinutes: unexpl,
    byCategory,
  };
}

export interface DayStat {
  date: string;
  summary: Summary;
}

export function perDay(items: Evaluated[]): DayStat[] {
  const groups = new Map<string, Evaluated[]>();
  for (const i of items) groups.set(i.date, [...(groups.get(i.date) ?? []), i]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, summary: summarize(list) }));
}

/** Minutes of ACTIVE (non-paused) time per local hour-of-day, from real check-ins. */
export function hourlyHeatmap(items: AnalyticsActivity[], now: number, tz: string): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const { session: s } of items) {
    if (s.cancelled || s.checkInAt === undefined) continue;
    const end = s.checkOutAt ?? now;
    if (end <= s.checkInAt) continue;
    // Build active segments = [checkIn,end] minus pauses.
    let segs: Array<[number, number]> = [[s.checkInAt, end]];
    for (const p of [...(s.pauses ?? [])].sort((a, b) => a.start - b.start)) {
      const ps = p.start, pe = p.end ?? end;
      segs = segs.flatMap(([a, b]) => {
        if (pe <= a || ps >= b) return [[a, b]] as Array<[number, number]>;
        const out: Array<[number, number]> = [];
        if (ps > a) out.push([a, ps]);
        if (pe < b) out.push([pe, b]);
        return out;
      });
    }
    for (const [a, b] of segs) {
      let cur = a;
      while (cur < b) {
        const hour = localParts(cur, tz).hour;
        const nextBoundary = cur + (60 - localParts(cur, tz).minute) * MIN - localParts(cur, tz).second * 1000;
        const slice = Math.min(b, nextBoundary) - cur;
        buckets[hour] += slice / MIN;
        cur += slice;
      }
    }
  }
  return buckets.map((m) => Math.round(m * 10) / 10);
}

/** Longest and current run of consecutive days with at least one completed activity. */
export function completionStreak(days: DayStat[], todayDate: string): { current: number; longest: number } {
  const done = new Set(days.filter((d) => d.summary.completed > 0).map((d) => d.date));
  const sorted = [...done].sort();
  let longest = 0, run = 0, prev: string | null = null;
  for (const d of sorted) {
    run = prev && nextDay(prev) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let d = done.has(todayDate) ? todayDate : prevDay(todayDate); // today may still be in progress
  while (done.has(d)) {
    current++;
    d = prevDay(d);
  }
  return { current, longest };
}

function nextDay(d: string) { return shift(d, 1); }
function prevDay(d: string) { return shift(d, -1); }
function shift(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function hm(min: number) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** Deterministic, statistics-only insights. Never calls excess time "wasted". */
export function insights(items: Evaluated[], heatmap: number[]): string[] {
  const s = summarize(items);
  const out: string[] = [];
  if (s.scheduled === 0) return out;
  out.push(`You completed ${s.completionPct}% of your scheduled activities (${s.completed} of ${s.scheduled}).`);
  if (s.missed > 0) out.push(`You marked ${s.missed} scheduled ${s.missed === 1 ? 'activity' : 'activities'} as missed.`);
  if (s.unresolved > 0) out.push(`${s.unresolved} ${s.unresolved === 1 ? 'activity is' : 'activities are'} unresolved and need reconciling.`);

  const top = Object.entries(s.byCategory).sort((a, b) => b[1].activeMinutes - a[1].activeMinutes)[0];
  if (top && top[1].activeMinutes > 0) out.push(`You spent ${hm(top[1].activeMinutes)} on ${top[0]}, your most-tracked category.`);

  if (s.overrunMinutes > 0) {
    const parts = [`You exceeded planned time by ${hm(s.overrunMinutes)} in total`];
    if (s.interruptionMinutes > 0) {
      parts.push(`; ${hm(Math.min(s.interruptionMinutes, s.overrunMinutes))} coincided with recorded interruptions`);
    }
    out.push(parts.join('') + '.');
  }
  if (s.timeSavedMinutes > 0) out.push(`You finished ${hm(s.timeSavedMinutes)} ahead of plan across completed activities.`);

  const peak = heatmap.reduce((best, v, h) => (v > heatmap[best] ? h : best), 0);
  if (heatmap[peak] > 0) out.push(`Your most active hour was ${String(peak).padStart(2, '0')}:00–${String((peak + 1) % 24).padStart(2, '0')}:00.`);
  return out;
}
