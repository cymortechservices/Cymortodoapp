import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errMsg } from '../lib/api';
import { sessionAction } from '../lib/offline';
import { fmtClock, fmtDuration, hhmm, prettyDate, ymdOf } from '../lib/time';
import { useNow } from '../lib/hooks';
import type { Activity } from '../lib/types';
import { Card, Empty, ErrorBox, PageTitle, Spinner, StatusChip, useToast } from '../components/ui';
import { useActivities } from '../components/useActivities';

const MIN = 60_000;
const pausedMs = (a: Activity, now: number) => a.pauses.reduce((s, p) => s + ((p.end ?? now) - p.start), 0);
export const activeMs = (a: Activity, now: number) => (a.checkInAt ? (a.checkOutAt ?? now) - a.checkInAt - pausedMs(a, now) : 0);
const isPaused = (a: Activity) => a.pauses.some((p) => p.end == null);
const hasOpenInterruption = (a: Activity) => a.interruptions.some((p) => p.end == null);

/** Optimistic local state for an action that was queued while offline. */
function applyLocal(a: Activity, action: string, at: number): Activity {
  const n: Activity = JSON.parse(JSON.stringify(a));
  if (action === 'check-in') { n.checkInAt = at; n.result.status = 'in_progress'; }
  if (action === 'pause') { n.pauses.push({ start: at }); n.result.status = 'paused'; }
  if (action === 'resume') { const p = n.pauses.find((x) => x.end == null); if (p) p.end = at; n.result.status = 'in_progress'; }
  if (action === 'interrupt') n.interruptions.push({ start: at });
  if (action === 'end-interruption') { const p = n.interruptions.find((x) => x.end == null); if (p) p.end = at; }
  if (action === 'check-out') { n.checkOutAt = at; n.result.status = at > n.endUtc + 5 * MIN ? 'completed_late' : at < n.endUtc - 5 * MIN ? 'completed_early' : 'completed_on_time'; }
  if (action === 'miss') n.result.status = 'missed';
  return n;
}

export default function Dashboard() {
  const { user } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const now = useNow(1000);
  const today = ymdOf(now, tz);
  const { data, error, stale, loading, reload, setData } = useActivities(today, today);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const act = async (a: Activity, action: string, extra: { reason?: string; endedByInterruption?: boolean } = {}) => {
    setBusy(true);
    try {
      const r = await sessionAction(a.id, action, extra);
      if (r.queued && !navigator.onLine) {
        const at = Date.now();
        setData((d) => (d ? { ...d, activities: d.activities.map((x) => (x.id === a.id ? applyLocal(x, action, at) : x)) } : d));
        window.dispatchEvent(new Event('cymor:queued'));
        toast('Saved on this phone. It backs up with the real time when you are online.', 'info');
      } else await reload();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  };

  if (loading && !data) return <div className="py-20"><Spinner /></div>;
  if (error && !data) return <ErrorBox msg={error} retry={reload} />;
  const acts = (data?.activities ?? []).filter((a) => !a.cancelled);
  const running = acts.find((a) => a.checkInAt && !a.checkOutAt);
  const next = acts.find((a) => !a.checkInAt && !a.checkOutAt && a.endUtc > now && a.result.status !== 'missed');
  const focus = running ?? next;
  const done = acts.filter((a) => a.result.status.startsWith('completed')).length;
  const hour = Number(hhmm(now, tz).slice(0, 2));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageTitle title={`${greet}, ${user?.name.split(' ')[0] ?? ''}`} sub={`${prettyDate(today)} · ${hhmm(now, tz)}`} />
      {stale && <p className="mb-4 text-sm text-warn">Showing your last saved schedule (offline).</p>}

      {focus ? (
        <section className="card-gold rise relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl" style={{ background: focus.color }} />
          <div className="relative">
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-fg-dim">{running ? 'Right now' : 'Up next'} <StatusChip status={focus.result.status} /></div>
            <h2 className="text-[1.9rem] font-bold leading-tight">{focus.title}</h2>
            <p className="mt-1 text-sm text-fg-dim">{hhmm(focus.startUtc, tz)} – {hhmm(focus.endUtc, tz)} · {fmtDuration((focus.endUtc - focus.startUtc) / MIN)} planned{focus.location ? ` · ${focus.location}` : ''}</p>

            {running ? (
              <>
                <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div><div className="label">Active time</div><div className={`font-mono text-5xl tabular-nums ${isPaused(running) ? 'text-warn' : ''}`}>{fmtClock(activeMs(running, now))}</div></div>
                  <div><div className="label">{now <= running.endUtc ? 'Time left' : 'Over by'}</div><div className={`font-mono text-2xl tabular-nums ${now > running.endUtc ? 'text-bad' : 'text-fg-dim'}`}>{fmtClock(Math.abs(running.endUtc - now))}</div></div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-valuenow={Math.min(100, Math.round((activeMs(running, now) / (running.endUtc - running.startUtc)) * 100))} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (activeMs(running, now) / (running.endUtc - running.startUtc)) * 100)}%`, background: now > running.endUtc ? 'rgb(var(--c-bad))' : 'linear-gradient(90deg, rgb(var(--c-accent)), rgb(var(--c-accent2)))' }} />
                </div>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {isPaused(running) ? <button disabled={busy} className="btn-ghost" onClick={() => act(running, 'resume')}>Resume</button> : <button disabled={busy} className="btn-ghost" onClick={() => act(running, 'pause')}>Pause</button>}
                  {hasOpenInterruption(running)
                    ? <button disabled={busy} className="btn-ghost" onClick={() => act(running, 'end-interruption')}>End interruption</button>
                    : <button disabled={busy} className="btn-ghost" onClick={() => { const r = prompt('What interrupted you? (optional)') ?? undefined; void act(running, 'interrupt', { reason: r }); }}>Interrupted</button>}
                  <button disabled={busy} className="btn-primary live" onClick={() => act(running, 'check-out')}>Check out</button>
                </div>
              </>
            ) : (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button disabled={busy} className="btn-primary" onClick={() => act(focus, 'check-in')}>Check in</button>
                <span className="text-sm text-fg-dim">{focus.startUtc > now ? `Starts in ${fmtDuration((focus.startUtc - now) / MIN)}` : `Started ${fmtDuration((now - focus.startUtc) / MIN)} ago`}</span>
              </div>
            )}
          </div>
        </section>
      ) : (
        <Empty title={acts.length ? 'Everything for today is done' : 'A clear day'} hint={acts.length ? 'Nice work. Review your analytics or plan tomorrow.' : 'Plan your first activity and CYMOR will remind you at the right moments.'} action={<Link to="/planner" className="btn-primary">Plan activity</Link>} />
      )}

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {[['Planned', String(acts.length)], ['Completed', String(done)], ['Remaining', String(acts.filter((a) => !a.result.status.startsWith('completed') && a.result.status !== 'missed').length)]].map(([k, v]) => (
          <Card key={k} className="!p-4 text-center"><div className="gold-text font-display text-3xl font-bold">{v}</div><div className="text-xs text-fg-dim">{k}</div></Card>
        ))}
      </div>

      <div className="mb-3 mt-8 flex items-end justify-between"><h2 className="text-xl font-semibold">Today's schedule</h2><Link to="/planner" className="text-sm text-accent">Full planner ›</Link></div>
      {acts.length === 0 ? <p className="text-sm text-fg-dim">Nothing scheduled.</p> : (
        <div className="card overflow-hidden !rounded-2xl">
          <table className="tbl">
            <thead><tr><th>Time</th><th>Activity</th><th className="hidden sm:table-cell">Length</th><th className="text-right">Status</th></tr></thead>
            <tbody>
              {acts.map((a) => {
                const conflict = data?.conflicts.some((c) => c.a === a.id || c.b === a.id);
                const live = !!a.checkInAt && !a.checkOutAt;
                return (
                  <tr key={a.id} className={live ? 'bg-accent/[0.07]' : ''}>
                    <td className="w-[5.2rem] whitespace-nowrap font-mono text-[13px] leading-snug"><span className="text-fg">{hhmm(a.startUtc, tz)}</span><br /><span className="text-fg-dim">{hhmm(a.endUtc, tz)}</span></td>
                    <td className="max-w-0">
                      <div className="flex items-center gap-2.5"><span className="h-8 w-1 shrink-0 rounded-full" style={{ background: a.color }} /><div className="min-w-0"><div className="truncate font-medium">{a.title}</div>{(a.location || conflict) && <div className="truncate text-xs text-fg-dim">{a.location}{conflict && <span className="text-warn"> ⚠ overlap</span>}</div>}</div></div>
                    </td>
                    <td className="hidden whitespace-nowrap text-fg-dim sm:table-cell">{fmtDuration(a.result.scheduledMinutes)}</td>
                    <td className="whitespace-nowrap text-right">
                      {a.result.status === 'unresolved'
                        ? <div className="flex justify-end gap-1.5"><button className="btn-ghost btn-sm" onClick={() => act(a, 'check-in')}>Did it</button><button className="btn-ghost btn-sm" onClick={() => act(a, 'miss')}>Missed</button></div>
                        : <div className="flex flex-col items-end gap-1"><StatusChip status={a.result.status} />{a.result.overrunMinutes > 0 && <span className="text-xs text-warn">+{fmtDuration(a.result.overrunMinutes)}</span>}{a.result.timeSavedMinutes > 0 && <span className="text-xs text-good">−{fmtDuration(a.result.timeSavedMinutes)}</span>}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
