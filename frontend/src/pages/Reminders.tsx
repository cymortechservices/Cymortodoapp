import { useEffect, useState, type FormEvent } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/hooks';
import { hhmm, prettyDate, ymdOf } from '../lib/time';
import type { Reminder, ReminderSpec } from '../lib/types';
import { Card, Empty, ErrorBox, Field, Modal, PageTitle, Spinner, Toggle, useToast } from '../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRESETS: { name: string; title: string; spec: (tz: string, d: string) => ReminderSpec }[] = [
  { name: 'Drink water (every 2h, 08:00–20:00)', title: 'Drink Water', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '08:00', endTime: '20:00', repeat: { type: 'hours', every: 2 } }) },
  { name: 'Stretch break (hourly, 09:00–17:00)', title: 'Take a break', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '09:00', endTime: '17:00', repeat: { type: 'hours', every: 1 } }) },
  { name: 'Daily at a time', title: 'Daily reminder', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '07:00', repeat: { type: 'dailyAt', times: ['07:00'] } }) },
  { name: 'Selected weekdays', title: 'Weekday reminder', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '08:00', repeat: { type: 'weekdays', days: [1, 2, 3, 4, 5] } }) },
  { name: 'Weekly', title: 'Weekly reminder', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '09:00', repeat: { type: 'weekly' } }) },
  { name: 'Monthly', title: 'Monthly reminder', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '09:00', repeat: { type: 'monthly' } }) },
  { name: 'Every N minutes', title: 'Interval reminder', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '09:00', endTime: '18:00', repeat: { type: 'minutes', every: 45 } }) },
  { name: 'Every N days', title: 'Every few days', spec: (tz, d) => ({ timezone: tz, startDate: d, startTime: '09:00', repeat: { type: 'days', every: 3 } }) },
];

function describe(s: ReminderSpec): string {
  const r = s.repeat;
  const win = s.endTime ? `${s.startTime}–${s.endTime}` : s.startTime;
  switch (r.type) {
    case 'minutes': return `Every ${r.every} min, ${win}`;
    case 'hours': return `Every ${r.every}h, ${win}`;
    case 'days': return `Every ${r.every} days at ${win}`;
    case 'dailyAt': return `Daily at ${r.times?.join(', ')}`;
    case 'weekdays': return `${r.days?.map((d) => DAYS[d]).join(', ')} at ${s.startTime}`;
    case 'weekly': return `Weekly at ${s.startTime}`;
    case 'monthly': return `Monthly at ${s.startTime}`;
    default: return 'Custom';
  }
}

function ReminderForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { user } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const today = ymdOf(Date.now(), tz);
  const [title, setTitle] = useState(PRESETS[0]!.title);
  const [desc, setDesc] = useState('');
  const [spec, setSpec] = useState<ReminderSpec>(PRESETS[0]!.spec(tz, today));
  const [late, setLate] = useState(false);
  const [times, setTimes] = useState<number[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const r = spec.repeat;

  useEffect(() => {
    const t = setTimeout(async () => {
      try { setTimes((await api<{ times: number[] }>('/reminders/preview', { method: 'POST', body: { spec, count: 8 } })).times); setErr(''); } catch (e) { setTimes([]); setErr(errMsg(e)); }
    }, 300);
    return () => clearTimeout(t);
  }, [spec]);

  const setRepeat = (p: Partial<ReminderSpec['repeat']>) => setSpec({ ...spec, repeat: { ...spec.repeat, ...p } });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api('/reminders', { method: 'POST', body: { title, description: desc || undefined, spec, latePolicy: late ? 'send' : 'expire' } }); onSaved(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Start from a template"><select className="input" onChange={(e) => { const p = PRESETS[Number(e.target.value)]!; setTitle(p.title); setSpec(p.spec(tz, today)); }}>{PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}</select></Field>
      <Field label="Title"><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Message (optional)"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day"><input className="input" type="date" value={spec.startDate} onChange={(e) => setSpec({ ...spec, startDate: e.target.value })} /></Field>
        <Field label="Last day (optional)"><input className="input" type="date" value={spec.endDate ?? ''} onChange={(e) => setSpec({ ...spec, endDate: e.target.value || undefined })} /></Field>
        <Field label="Starts at"><input className="input" type="time" value={spec.startTime} onChange={(e) => setSpec({ ...spec, startTime: e.target.value })} /></Field>
        {['minutes', 'hours'].includes(r.type) && <Field label="Stops at"><input className="input" type="time" value={spec.endTime ?? ''} onChange={(e) => setSpec({ ...spec, endTime: e.target.value || undefined })} /></Field>}
      </div>
      {['minutes', 'hours', 'days'].includes(r.type) && <Field label={`Every how many ${r.type}?`}><input className="input" type="number" min={1} value={r.every ?? 1} onChange={(e) => setRepeat({ every: Math.max(1, Number(e.target.value) || 1) })} /></Field>}
      {r.type === 'dailyAt' && <Field label="Times (comma separated, HH:mm)"><input className="input" value={r.times?.join(', ')} onChange={(e) => setRepeat({ times: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>}
      {r.type === 'weekdays' && <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => { const on = r.days?.includes(i); return <button type="button" key={d} aria-pressed={on} onClick={() => setRepeat({ days: on ? r.days?.filter((x) => x !== i) : [...(r.days ?? []), i] })} className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-accent bg-accent/20' : 'border-ink-700 text-fg-dim'}`}>{d}</button>; })}</div>}
      <label className="flex items-center justify-between text-sm"><span>If the worker was offline, still send late (up to 2h)<span className="block text-xs text-fg-dim">For critical reminders like medication. Default: skip stale ones.</span></span><Toggle checked={late} onChange={setLate} label="Send late" /></label>

      <div className="rounded-xl border border-ink-700 p-3">
        <div className="label">Next firings ({tz})</div>
        {err ? <p role="alert" className="text-sm text-bad">{err}</p> : times.length ? <ul className="grid grid-cols-2 gap-x-4 text-sm text-fg-dim">{times.map((t) => <li key={t}>{prettyDate(ymdOf(t, tz))} {hhmm(t, tz)}</li>)}</ul> : <p className="text-sm text-fg-dim">No upcoming times in this schedule.</p>}
      </div>
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button className="btn-primary" disabled={busy || !!err}>Create reminder</button></div>
    </form>
  );
}

export default function Reminders() {
  const { user } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<{ reminders: Reminder[] }>('/reminders'), []);
  const [open, setOpen] = useState(false);

  const toggle = async (r: Reminder, active: boolean) => { try { await api(`/reminders/${r.id}`, { method: 'PATCH', body: { active } }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const del = async (r: Reminder) => { if (!confirm(`Delete "${r.title}"?`)) return; try { await api(`/reminders/${r.id}`, { method: 'DELETE' }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };

  return (
    <>
      <PageTitle title="Reminders" sub="Recurring nudges that keep firing without you opening the app." right={<button className="btn-primary" onClick={() => setOpen(true)}>+ New reminder</button>} />
      {loading ? <div className="py-16"><Spinner /></div> : error ? <ErrorBox msg={error} retry={reload} /> : !data?.reminders.length ? (
        <Empty title="No reminders yet" hint="Try 'Drink water' every 2 hours between 08:00 and 20:00." action={<button className="btn-primary" onClick={() => setOpen(true)}>Create one</button>} />
      ) : (
        <ul className="space-y-3">{data.reminders.map((r) => (
          <li key={r.id}><Card className="!p-4"><div className="flex items-center gap-3">
            <div className="min-w-0 flex-1"><div className="font-medium">{r.title}</div><div className="text-sm text-fg-dim">{describe(r.spec)}</div>
              <div className="mt-1 text-xs text-fg-dim">{r.active ? (r.next ? `Next: ${prettyDate(ymdOf(r.next, tz))} ${hhmm(r.next, tz)}` : 'No upcoming times') : 'Paused'}{r.latePolicy === 'send' ? ' · sends even if late' : ''}</div></div>
            <Toggle checked={r.active} onChange={(v) => toggle(r, v)} label={`${r.title} active`} />
            <button aria-label={`Delete ${r.title}`} className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => del(r)}>✕</button>
          </div></Card></li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New reminder"><ReminderForm onSaved={() => { setOpen(false); void reload(); toast('Reminder created', 'ok'); }} onCancel={() => setOpen(false)} /></Modal>
    </>
  );
}
