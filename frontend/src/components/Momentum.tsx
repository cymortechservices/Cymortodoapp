import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/hooks';
import { buildReview } from '../lib/review';
import { addDays, startOfWeek, ymdOf } from '../lib/time';
import type { AnalyticsResponse } from '../lib/types';
import { Card } from './ui';

const MILESTONES = [3, 7, 14, 30, 60, 100];

/** Dashboard motivation: current streak with the next milestone, and the weekly review for last week. */
export default function Momentum() {
  const { user, settings } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const today = ymdOf(Date.now(), tz);
  const thisWk = startOfWeek(today, settings?.weekStartsOn ?? 1);
  const lastWk = addDays(thisWk, -7), lastEnd = addDays(thisWk, -1), prevWk = addDays(thisWk, -14);
  const [open, setOpen] = useState(false);
  const streak = useAsync(() => api<AnalyticsResponse>(`/analytics?from=${addDays(today, -59)}&to=${today}`), [today]);
  const cur = useAsync(() => api<AnalyticsResponse>(`/analytics?from=${lastWk}&to=${lastEnd}`), [lastWk]);
  const prev = useAsync(() => api<AnalyticsResponse>(`/analytics?from=${prevWk}&to=${addDays(prevWk, 6)}`), [prevWk]);
  const st = streak.data?.streak;
  if (!st && !cur.data) return null;
  const review = buildReview(cur.data ?? null, prev.data ?? null);
  const next = MILESTONES.find((m) => m > (st?.current ?? 0)) ?? (st?.current ?? 0) + 10;
  const pct = Math.min(100, Math.round(((st?.current ?? 0) / next) * 100));
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <Card className="!p-6">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl" style={{ background: 'var(--gold-grad)' }} aria-hidden>🔥</div>
          <div className="min-w-0"><div className="label !mb-1">Streak</div><div className="font-display text-3xl font-bold leading-none">{st?.current ?? 0} <span className="text-base font-medium text-fg-dim">{(st?.current ?? 0) === 1 ? 'day' : 'days'}</span></div></div>
          <div className="ml-auto text-right text-xs text-fg-dim">Longest<div className="text-lg font-semibold text-fg">{st?.longest ?? 0}</div></div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next streak milestone"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--gold-grad)' }} /></div>
        <p className="mt-3 text-sm leading-relaxed text-fg-dim">{(st?.current ?? 0) === 0 ? 'Complete today’s activities to start a streak.' : `${next - (st?.current ?? 0)} more ${next - (st?.current ?? 0) === 1 ? 'day' : 'days'} to reach ${next}. Keep it going today.`}</p>
      </Card>
      <Card className="!p-6">
        <div className="label !mb-1">Weekly review · last week</div>
        <div className="font-display text-xl font-bold">{review.headline}</div>
        {review.hasData && <div className="mt-3 flex items-end gap-3"><span className="gold-text font-display text-4xl font-bold leading-none">{review.pct}%</span><span className="pb-0.5 text-sm text-fg-dim">completed{review.delta !== null && <b className={review.delta >= 0 ? 'ml-2 text-good' : 'ml-2 text-warn'}>{review.delta >= 0 ? '▲' : '▼'} {Math.abs(review.delta)}</b>}</span></div>}
        <ul className={`mt-4 space-y-2 text-sm leading-relaxed text-fg-dim ${open ? '' : 'line-clamp-3'}`}>{review.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {review.lines.length > 2 && <button className="mt-3 text-sm text-accent" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read the full review'}</button>}
      </Card>
    </div>
  );
}
