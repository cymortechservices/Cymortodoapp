import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/hooks';
import { addDays, fmtDuration, prettyDate, startOfWeek, ymdOf } from '../lib/time';
import type { AnalyticsResponse } from '../lib/types';
import { Card, Empty, ErrorBox, PageTitle, Spinner } from '../components/ui';

const Stat = ({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) => (
  <Card className="!p-4"><div className="label !mb-1">{label}</div><div className={`font-display text-3xl font-bold ${tone}`}>{value}</div>{sub && <div className="mt-0.5 text-xs text-fg-dim">{sub}</div>}</Card>
);

export default function Analytics() {
  const { user, settings } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const today = ymdOf(Date.now(), tz);
  const [range, setRange] = useState<'week' | '7' | '30'>('7');
  const from = range === 'week' ? startOfWeek(today, settings?.weekStartsOn ?? 1) : addDays(today, range === '7' ? -6 : -29);
  const to = today;
  const { data, error, loading, reload } = useAsync(() => api<AnalyticsResponse>(`/analytics?from=${from}&to=${to}`), [from, to]);

  const s = data?.summary;
  const maxDay = Math.max(1, ...(data?.days.map((d) => d.summary.plannedMinutes) ?? [1]));
  const maxHeat = Math.max(1, ...(data?.heatmap ?? [1]));
  const cats = Object.entries(s?.byCategory ?? {}).sort((a, b) => b[1].activeMinutes - a[1].activeMinutes);
  const maxCat = Math.max(1, ...cats.map(([, v]) => Math.max(v.plannedMinutes, v.activeMinutes)));

  return (
    <>
      <PageTitle title="Analytics" sub={`${prettyDate(from)} – ${prettyDate(to)}`} right={
        <div role="group" aria-label="Range" className="flex gap-1.5">{([['week', 'This week'], ['7', '7 days'], ['30', '30 days']] as const).map(([k, l]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)} className={`btn-ghost !py-1.5 ${range === k ? '!border-accent !bg-accent/15' : ''}`}>{l}</button>)}</div>} />
      {loading && !data ? <div className="py-16"><Spinner /></div> : error ? <ErrorBox msg={error} retry={reload} /> : !s || s.scheduled === 0 ? <Empty title="No data in this range" hint="Analytics appear once you have planned and tracked some activities." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Completion" value={`${s.completionPct}%`} sub={`${s.completed} of ${s.scheduled} activities`} tone={s.completionPct >= 70 ? 'text-good' : ''} />
            <Stat label="Focused time" value={fmtDuration(s.activeMinutes)} sub={`of ${fmtDuration(s.plannedMinutes)} planned`} />
            <Stat label="Time saved" value={fmtDuration(s.timeSavedMinutes)} sub="finished early" tone="text-good" />
            <Stat label="Overrun" value={fmtDuration(s.overrunMinutes)} sub={s.unexplainedOverrunMinutes ? `${fmtDuration(s.unexplainedOverrunMinutes)} unexplained` : 'all explained'} tone={s.overrunMinutes ? 'text-warn' : ''} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Current streak" value={`${data!.streak.current} d`} sub={`longest ${data!.streak.longest} d`} />
            <Stat label="Missed" value={String(s.missed)} />
            <Stat label="Needs review" value={String(s.unresolved)} sub="never checked in" tone={s.unresolved ? 'text-warn' : ''} />
            <Stat label="Interruptions" value={fmtDuration(s.interruptionMinutes)} />
          </div>

          {data!.insights.length > 0 && <Card className="mt-6"><h2 className="mb-3 text-lg font-semibold">Insights</h2><ul className="space-y-2 text-sm">{data!.insights.map((i) => <li key={i} className="flex gap-2"><span className="text-accent-2">◆</span>{i}</li>)}</ul></Card>}

          <Card className="mt-6">
            <h2 className="mb-4 text-lg font-semibold">Planned vs focused, by day</h2>
            <div className="flex h-40 items-end gap-2" role="img" aria-label="Bar chart of planned and focused minutes per day">
              {data!.days.map((d) => (
                <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-32 w-full items-end justify-center gap-1">
                    <div title={`Planned ${fmtDuration(d.summary.plannedMinutes)}`} className="w-1/2 max-w-[18px] rounded-t bg-ink-700" style={{ height: `${(d.summary.plannedMinutes / maxDay) * 100}%` }} />
                    <div title={`Focused ${fmtDuration(d.summary.activeMinutes)}`} className="w-1/2 max-w-[18px] rounded-t" style={{ height: `${(d.summary.activeMinutes / maxDay) * 100}%`, background: 'linear-gradient(180deg, rgb(var(--c-accent2)), rgb(var(--c-accent)))' }} />
                  </div>
                  <div className="truncate text-[10px] text-fg-dim">{d.date.slice(5)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-fg-dim"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ink-700" />Planned</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />Focused</span></div>
          </Card>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card><h2 className="mb-4 text-lg font-semibold">By category</h2>
              <ul className="space-y-3">{cats.map(([c, v]) => (
                <li key={c}><div className="mb-1 flex justify-between text-sm"><span>{c}</span><span className="text-fg-dim">{fmtDuration(v.activeMinutes)} / {fmtDuration(v.plannedMinutes)}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full bg-accent" style={{ width: `${(v.activeMinutes / maxCat) * 100}%` }} /></div></li>
              ))}</ul></Card>
            <Card><h2 className="mb-4 text-lg font-semibold">When you focus</h2>
              <div className="grid grid-cols-12 gap-1" role="img" aria-label="Heatmap of focused time by hour of day">
                {data!.heatmap.map((m, h) => <div key={h} title={`${String(h).padStart(2, '0')}:00 · ${fmtDuration(m)}`} className="aspect-square rounded-md" style={{ background: m ? `rgb(var(--c-accent) / ${0.15 + 0.85 * (m / maxHeat)})` : 'rgb(var(--c-raised))' }} />)}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-fg-dim"><span>00:00</span><span>12:00</span><span>23:00</span></div></Card>
          </div>
        </>
      )}
    </>
  );
}
