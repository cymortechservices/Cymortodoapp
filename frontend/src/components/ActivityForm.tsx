import { useState, type FormEvent } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth, type NotifyCfg } from '../lib/auth';
import { hhmm, ymdOf } from '../lib/time';
import type { Activity, Conflict } from '../lib/types';
import { Field, Toggle } from './ui';

const COLORS = ['#D4AF37', '#E8A87C', '#7EC681', '#6FB1C8', '#C48BD9', '#E8685C', '#A8A08A'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function ActivityForm({ initial, date, onSaved, onCancel }: { initial?: Activity; date: string; onSaved: (conflicts: Conflict[]) => void; onCancel: () => void }) {
  const { user, settings } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const [f, setF] = useState({
    title: initial?.title ?? '', category: initial?.category ?? 'general', color: initial?.color ?? COLORS[0]!, location: initial?.location ?? '', description: initial?.description ?? '',
    date: initial ? ymdOf(initial.startUtc, tz) : date, start: initial ? hhmm(initial.startUtc, tz) : '09:00', end: initial ? hhmm(initial.endUtc, tz) : '10:00',
  });
  const [notify, setNotify] = useState<NotifyCfg>(initial?.notify ?? settings?.defaultNotify ?? { preStart: { enabled: true, minutesBefore: 10 }, start: { enabled: true }, alarm: true, end: { enabled: true }, overdue: { enabled: true, minutesAfterEnd: 15 } });
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const overnight = f.end <= f.start;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: Record<string, unknown> = { title: f.title, category: f.category, color: f.color, location: f.location, description: f.description, date: f.date, start: f.start, end: f.end, notify };
      if (overnight) { const d = new Date(`${f.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); body.endDate = d.toISOString().slice(0, 10); }
      if (initial) { const r = await api<{ conflicts?: Conflict[] }>(`/activities/${initial.id}`, { method: 'PATCH', body }); onSaved(r.conflicts ?? []); }
      else if (repeat) {
        if (!until || !days.length) throw new Error('Choose the weekdays and an end date for the repeat');
        await api('/activities/series', { method: 'POST', body: { ...body, until, weekdays: days } }); onSaved([]);
      } else { const r = await api<{ conflicts: Conflict[] }>('/activities', { method: 'POST', body }); onSaved(r.conflicts); }
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  const row = (label: string, on: boolean, set: (v: boolean) => void, extra?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm"><span className="flex items-center gap-2">{label}{extra}</span><Toggle checked={on} onChange={set} label={label} /></div>
  );
  const num = (v: number, set: (n: number) => void) => <input aria-label="minutes" type="number" min={1} max={1440} className="input !w-20 !py-1" value={v} onChange={(e) => set(Math.max(1, Number(e.target.value) || 1))} />;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Activity"><input className="input" required autoFocus maxLength={200} placeholder="e.g. Study Mathematics" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Date"><input className="input" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field></div>
        <Field label="Start"><input className="input" type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="End"><input className="input" type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      {overnight && <p className="text-xs text-warn">End is earlier than start, so this runs overnight and ends the next day.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      </div>
      <div><span className="label">Colour</span><div className="flex gap-2">{COLORS.map((c) => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={`h-7 w-7 rounded-full border-2 ${f.color === c ? 'border-fg' : 'border-transparent'}`} style={{ background: c }} />)}</div></div>

      <fieldset className="rounded-xl border border-ink-700 px-4 py-2">
        <legend className="px-1 text-xs uppercase tracking-wider text-fg-dim">Notifications</legend>
        {row('Heads-up before start', notify.preStart.enabled, (v) => setNotify({ ...notify, preStart: { ...notify.preStart, enabled: v } }), notify.preStart.enabled && <>{num(notify.preStart.minutesBefore, (n) => setNotify({ ...notify, preStart: { ...notify.preStart, minutesBefore: n } }))}<span className="text-xs text-fg-dim">min</span></>)}
        {row('At start', notify.start.enabled, (v) => setNotify({ ...notify, start: { enabled: v } }))}
        {notify.start.enabled && row('Loud alarm at start', notify.alarm !== false, (v) => setNotify({ ...notify, alarm: v }))}
        {row('At end', notify.end.enabled, (v) => setNotify({ ...notify, end: { enabled: v } }))}
        {row('Overdue alert', notify.overdue.enabled, (v) => setNotify({ ...notify, overdue: { ...notify.overdue, enabled: v } }), notify.overdue.enabled && <>{num(notify.overdue.minutesAfterEnd, (n) => setNotify({ ...notify, overdue: { ...notify.overdue, minutesAfterEnd: n } }))}<span className="text-xs text-fg-dim">min after</span></>)}
      </fieldset>

      {!initial && (
        <div className="rounded-xl border border-ink-700 p-4">
          {row('Repeat weekly', repeat, setRepeat)}
          {repeat && (
            <div className="mt-2 space-y-3">
              <div className="flex gap-1.5">{DAYS.map((d, i) => <button type="button" key={i} aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={`h-9 w-9 rounded-full border text-sm ${days.includes(i) ? 'border-accent bg-accent/20' : 'border-ink-700 text-fg-dim'}`}>{d}</button>)}</div>
              <Field label="Repeat until"><input className="input" type="date" min={f.date} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
            </div>
          )}
        </div>
      )}
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add activity'}</button></div>
    </form>
  );
}
