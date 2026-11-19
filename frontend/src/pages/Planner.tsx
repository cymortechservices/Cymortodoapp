import { useMemo, useState } from 'react';
import { api, download, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, fmtDuration, hhmm, prettyDate, startOfWeek, ymdOf } from '../lib/time';
import { saveBlob, scheduleImage } from '../lib/image';
import type { Activity, Conflict } from '../lib/types';
import { Card, Empty, ErrorBox, Modal, PageTitle, Spinner, StatusChip, useToast } from '../components/ui';
import ActivityForm from '../components/ActivityForm';
import ImportModal from '../components/ImportModal';
import { useActivities } from '../components/useActivities';

export default function Planner() {
  const { user, settings } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const toast = useToast();
  const today = ymdOf(Date.now(), tz);
  const [sel, setSel] = useState(today);
  const wk = startOfWeek(sel, settings?.weekStartsOn ?? 1);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wk, i)), [wk]);
  const { data, error, loading, reload } = useActivities(days[0]!, days[6]!);
  const [form, setForm] = useState<{ open: boolean; edit?: Activity }>({ open: false });
  const [imp, setImp] = useState(false);
  const [share, setShare] = useState<string | null>(null);

  const byDay = (d: string) => (data?.activities ?? []).filter((a) => a.localDate === d);
  const conflictIds = new Set((data?.conflicts ?? []).flatMap((c) => [c.a, c.b]));

  const saved = (conf: Conflict[]) => {
    setForm({ open: false }); void reload();
    toast(conf.length ? `Saved. ${conf.length} overlap${conf.length > 1 ? 's' : ''} detected: nothing was moved, you decide.` : 'Saved', conf.length ? 'info' : 'ok');
  };
  const del = async (a: Activity) => { if (!confirm(`Delete "${a.title}"?`)) return; try { await api(`/activities/${a.id}`, { method: 'DELETE' }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const toggleCancel = async (a: Activity) => { try { await api(`/activities/${a.id}/${a.cancelled ? 'uncancel' : 'cancel'}`, { method: 'POST', body: {} }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const exportImg = async (type: 'image/png' | 'image/jpeg') => {
    const blob = await scheduleImage(`${days[0]} to ${days[6]}`, days.map((d) => ({ date: d, items: byDay(d).filter((a) => !a.cancelled) })), tz, type);
    saveBlob(blob, `cymor-week-${days[0]}.${type === 'image/png' ? 'png' : 'jpg'}`);
  };
  const dl = (ext: string) => download(`/export/schedule.${ext}?from=${days[0]}&to=${days[6]}`, `cymor-schedule-${days[0]}.${ext}`).catch((e) => toast(errMsg(e), 'err'));
  const makeShare = async () => {
    try { const r = await api<{ url: string }>('/shares', { method: 'POST', body: { from: days[0], to: days[6], title: `Week of ${days[0]}`, expiresInDays: 30 } }); setShare(r.url); } catch (e) { toast(errMsg(e), 'err'); }
  };

  return (
    <>
      <PageTitle title="Planner" sub={`Week of ${prettyDate(days[0]!)} · ${tz}`} right={<div className="flex gap-2"><button className="btn-ghost" onClick={() => setImp(true)}>Import</button><button className="btn-primary" onClick={() => setForm({ open: true })}>+ New</button></div>} />

      <div className="mb-5 flex items-center gap-2">
        <button aria-label="Previous week" className="btn-ghost !px-3" onClick={() => setSel(addDays(wk, -7))}>‹</button>
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {days.map((d) => (
            <button key={d} aria-pressed={d === sel} onClick={() => setSel(d)} className={`rounded-xl border px-1 py-2 text-center text-xs transition ${d === sel ? 'border-accent bg-accent/15' : 'border-ink-700 hover:bg-ink-800/60'} ${d === today ? 'ring-1 ring-accent-2/60' : ''}`}>
              <div className="text-fg-dim">{prettyDate(d).split(' ')[0]}</div><div className="font-display text-lg">{d.slice(8)}</div>
              <div className="mx-auto mt-0.5 h-1 w-1 rounded-full" style={{ background: byDay(d).length ? 'rgb(var(--c-accent))' : 'transparent' }} />
            </button>
          ))}
        </div>
        <button aria-label="Next week" className="btn-ghost !px-3" onClick={() => setSel(addDays(wk, 7))}>›</button>
      </div>

      {loading && !data ? <div className="py-16"><Spinner /></div> : error && !data ? <ErrorBox msg={error} retry={reload} /> : (
        <>
          <h2 className="mb-3 text-lg font-semibold">{prettyDate(sel)}{sel === today && <span className="chip ml-2">Today</span>}</h2>
          {byDay(sel).length === 0 ? <Empty title="Nothing planned" hint="Add an activity for this day." action={<button className="btn-primary" onClick={() => setForm({ open: true })}>+ New activity</button>} /> : (
            <ol className="space-y-2.5">
              {byDay(sel).map((a) => (
                <li key={a.id}><Card className={`!p-4 ${a.cancelled ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-10 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className={`font-medium ${a.cancelled ? 'line-through' : ''}`}>{a.title}</span><StatusChip status={a.result.status} />{conflictIds.has(a.id) && <span className="chip border-warn/50 text-warn">⚠ overlap</span>}</div>
                      <div className="mt-0.5 text-sm text-fg-dim">{hhmm(a.startUtc, tz)} – {hhmm(a.endUtc, tz)} · {fmtDuration(a.result.scheduledMinutes)} · {a.category}{a.location ? ` · ${a.location}` : ''}</div>
                    </div>
                    <div className="flex shrink-0 gap-1.5"><button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setForm({ open: true, edit: a })}>Edit</button><button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => toggleCancel(a)}>{a.cancelled ? 'Restore' : 'Cancel'}</button><button aria-label={`Delete ${a.title}`} className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => del(a)}>✕</button></div>
                  </div>
                </Card></li>
              ))}
            </ol>
          )}
          {(data?.conflicts.length ?? 0) > 0 && <p className="mt-4 text-sm text-warn">This week has {data!.conflicts.length} overlapping pair(s). CYMOR never moves your activities for you.</p>}

          <h2 className="mb-3 mt-10 text-lg font-semibold">Export & share this week</h2>
          <div className="flex flex-wrap gap-2">
            {['pdf', 'csv', 'ics'].map((e) => <button key={e} className="btn-ghost" onClick={() => dl(e)}>{e.toUpperCase()}</button>)}
            <button className="btn-ghost" onClick={() => exportImg('image/png')}>PNG</button><button className="btn-ghost" onClick={() => exportImg('image/jpeg')}>JPG</button>
            <button className="btn-ghost" onClick={makeShare}>Create share link</button>
          </div>
          {share && <Card className="mt-3 !p-4 text-sm"><div className="label">Read-only link (expires in 30 days, revocable in Settings)</div><div className="flex gap-2"><input readOnly className="input font-mono text-xs" value={share} onFocus={(e) => e.target.select()} /><button className="btn-ghost" onClick={() => { void navigator.clipboard?.writeText(share); toast('Copied', 'ok'); }}>Copy</button></div></Card>}
        </>
      )}

      <Modal open={form.open} onClose={() => setForm({ open: false })} title={form.edit ? 'Edit activity' : 'New activity'}>
        <ActivityForm key={form.edit?.id ?? 'new'} initial={form.edit} date={sel} onSaved={saved} onCancel={() => setForm({ open: false })} />
      </Modal>
      <ImportModal open={imp} onClose={() => setImp(false)} defaultDate={sel} onDone={(n) => { toast(`Imported ${n} activities`, 'ok'); void reload(); }} />
    </>
  );
}
