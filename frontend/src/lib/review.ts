import type { AnalyticsResponse } from './types';
import { fmtDuration, prettyDate } from './time';

export interface Review { headline: string; lines: string[]; pct: number; delta: number | null; best: string | null; topCategory: string | null; focused: string; hasData: boolean }

/** Plain-language weekly review from two analytics responses (this review's week and the week before it). */
export function buildReview(cur: AnalyticsResponse | null, prev: AnalyticsResponse | null): Review {
  const s = cur?.summary;
  if (!cur || !s || s.scheduled === 0) return { headline: 'No plans to review yet', lines: ['Plan a few activities and check in. Your weekly review appears here.'], pct: 0, delta: null, best: null, topCategory: null, focused: '0m', hasData: false };
  const ps = prev?.summary && prev.summary.scheduled > 0 ? prev.summary : null;
  const delta = ps ? s.completionPct - ps.completionPct : null;
  const dayScore = cur.days.filter((d) => d.summary.scheduled > 0).map((d) => ({ date: d.date, pct: d.summary.completionPct, done: d.summary.completed })).sort((a, b) => b.pct - a.pct || b.done - a.done);
  const best = dayScore[0] ? dayScore[0].date : null;
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1].activeMinutes - a[1].activeMinutes);
  const topCategory = cats[0] && cats[0][1].activeMinutes > 0 ? cats[0][0] : null;
  const headline = s.completionPct >= 85 ? 'Outstanding week' : s.completionPct >= 65 ? 'Solid week' : s.completionPct >= 40 ? 'A fair start' : 'A tough week, a fresh start';
  const lines = [`You completed ${s.completed} of ${s.scheduled} activities (${s.completionPct}%).`, `Focused time: ${fmtDuration(s.activeMinutes)} of ${fmtDuration(s.plannedMinutes)} planned.`];
  if (delta !== null) lines.push(delta > 0 ? `Up ${delta} points on the week before.` : delta < 0 ? `Down ${-delta} points on the week before. Try planning a little less each day.` : 'Same as the week before.');
  if (best) lines.push(`Best day: ${prettyDate(best)}.`);
  if (topCategory) lines.push(`Most time went to ${topCategory}.`);
  if (s.timeSavedMinutes > 0) lines.push(`You finished ${fmtDuration(s.timeSavedMinutes)} early in total.`);
  if (s.unresolved > 0) lines.push(`${s.unresolved} ${s.unresolved === 1 ? 'activity was' : 'activities were'} never checked in. Checking in makes your review accurate.`);
  return { headline, lines, pct: s.completionPct, delta, best, topCategory, focused: fmtDuration(s.activeMinutes), hasData: true };
}
