import { useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync, useNow } from '../lib/hooks';
import { fmtClock, ymdOf } from '../lib/time';
import { playSound } from '../lib/sound';
import { Card, Empty, ErrorBox, Field, PageTitle, Spinner, useToast } from '../components/ui';

type Tab = 'habits' | 'goals' | 'focus' | 'reflect';

function Habits() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<{ today: string; habits: { id: string; name: string; color: string; doneToday: boolean; current: number; longest: number; recent: string[] }[] }>('/habits'), []);
  const [name, setName] = useState('');
  const add = async () => { if (!name.trim()) return; try { await api('/habits', { method: 'POST', body: { name } }); setName(''); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const toggle = async (id: string, today: string, done: boolean) => { try { await api(`/habits/${id}/completions/${today}`, { method: 'PUT', body: { done } }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  return (
    <>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}><input className="input" placeholder="New habit, e.g. Read 20 pages" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary">Add</button></form>
      {!data?.habits.length ? <Empty title="No habits yet" hint="Small daily wins build streaks." /> : (
        <ul className="space-y-3">{data.habits.map((h) => (
          <li key={h.id}><Card className="!p-4"><div className="flex items-center gap-3">
            <button aria-label={`${h.name}: mark ${h.doneToday ? 'not done' : 'done'} today`} aria-pressed={h.doneToday} onClick={() => toggle(h.id, data.today, !h.doneToday)} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 text-lg transition ${h.doneToday ? 'border-good bg-good/20 text-good' : 'border-ink-700 text-transparent hover:border-accent'}`}>✓</button>
            <div className="min-w-0 flex-1"><div className="font-medium">{h.name}</div><div className="text-xs text-fg-dim">🔥 {h.current} day streak · best {h.longest}</div></div>
            <button aria-label={`Archive ${h.name}`} className="btn-ghost !px-3 !py-1.5 text-xs" onClick={async () => { await api(`/habits/${h.id}`, { method: 'DELETE' }); void reload(); }}>Archive</button>
          </div></Card></li>
        ))}</ul>
      )}
    </>
  );
}

function Goals() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<{ goals: { id: string; title: string; target: number; progress: number; unit: string; done: boolean; pct: number }[] }>('/goals'), []);
  const [f, setF] = useState({ title: '', target: '100', unit: '%' });
  const add = async () => { if (!f.title.trim()) return; try { await api('/goals', { method: 'POST', body: { title: f.title, target: Number(f.target) || 100, unit: f.unit } }); setF({ title: '', target: '100', unit: '%' }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  return (
    <>
      <form className="mb-4 grid grid-cols-[1fr_80px_70px_auto] gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="input" placeholder="Goal, e.g. Finish calculus notes" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input className="input" aria-label="Target" inputMode="numeric" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <input className="input" aria-label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /><button className="btn-primary">Add</button>
      </form>
      {!data?.goals.length ? <Empty title="No goals yet" hint="Set a target and move the progress as you go." /> : (
        <ul className="space-y-3">{data.goals.map((g) => (
          <li key={g.id}><Card className="!p-4">
            <div className="flex items-center justify-between"><span className={`font-medium ${g.done ? 'text-good' : ''}`}>{g.title}{g.done && ' ✓'}</span><span className="text-sm text-fg-dim">{g.progress}/{g.target} {g.unit}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full bg-good" style={{ width: `${g.pct}%` }} /></div>
            <div className="mt-3 flex gap-2"><button className="btn-ghost !py-1 text-xs" onClick={async () => { await api(`/goals/${g.id}`, { method: 'PATCH', body: { progress: Math.max(0, g.progress - Math.max(1, Math.round(g.target / 10))) } }); void reload(); }}>−</button>
              <button className="btn-ghost !py-1 text-xs" onClick={async () => { await api(`/goals/${g.id}`, { method: 'PATCH', body: { progress: g.progress + Math.max(1, Math.round(g.target / 10)) } }); void reload(); }}>+</button>
              <button className="btn-danger !py-1 text-xs ml-auto" onClick={async () => { await api(`/goals/${g.id}`, { method: 'DELETE' }); void reload(); }}>Delete</button></div>
          </Card></li>
        ))}</ul>
      )}
    </>
  );
}

function Focus() {
  const { settings } = useAuth();
  const toast = useToast();
  const now = useNow(500);
  const { data, error, loading, reload } = useAsync(() => api<{ running: { id: string; startedAt: number; plannedMinutes: number } | null; totalMinutes: number; sessions: { id: string; label: string; startedAt: number; minutes: number; completed: boolean }[] }>('/focus'), []);
  const [mins, setMins] = useState(25);
  const run = data?.running;
  const left = run ? run.startedAt + run.plannedMinutes * 60_000 - now : 0;
  const [rung, setRung] = useState(false);
  useEffect(() => { if (run && left <= 0 && !rung) { setRung(true); playSound('alert', settings?.soundEnabled); toast('Focus session complete. Well done.', 'ok'); } if (!run) setRung(false); }, [run, left, rung, settings?.soundEnabled, toast]);
  const start = async () => { try { await api('/focus', { method: 'POST', body: { plannedMinutes: mins } }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const end = async () => { try { await api(`/focus/${run!.id}/end`, { method: 'POST', body: {} }); void reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  return (
    <>
      <Card className="text-center">
        <div className={`font-mono text-6xl tabular-nums ${run && left <= 0 ? 'text-good' : ''}`}>{run ? fmtClock(Math.max(0, left)) : fmtClock(mins * 60_000)}</div>
        {run ? <div className="mt-5"><button className="btn-primary" onClick={end}>{left <= 0 ? 'Finish' : 'End early'}</button></div> : (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{[15, 25, 45, 60].map((m) => <button key={m} aria-pressed={mins === m} onClick={() => setMins(m)} className={`btn-ghost ${mins === m ? '!border-accent !bg-accent/15' : ''}`}>{m}m</button>)}<button className="btn-primary" onClick={start}>Start focus</button></div>
        )}
        <p className="mt-4 text-xs text-fg-dim">Total focused: {data?.totalMinutes ?? 0} min</p>
      </Card>
      {!!data?.sessions.length && <ul className="mt-4 space-y-2">{data.sessions.map((s) => <li key={s.id} className="card flex justify-between px-4 py-3 text-sm"><span>{s.label}</span><span className="text-fg-dim">{s.minutes} min {s.completed ? '✓' : '(ended early)'}</span></li>)}</ul>}
    </>
  );
}

function Reflect() {
  const { user } = useAuth();
  const toast = useToast();
  const date = ymdOf(Date.now(), user?.timezone ?? 'UTC');
  const [f, setF] = useState({ mood: 3, wins: '', improve: '' });
  useEffect(() => { void api<{ reflection: { mood?: number; wins?: string; improve?: string } | null }>(`/reflections/${date}`).then((r) => r.reflection && setF({ mood: r.reflection.mood ?? 3, wins: r.reflection.wins ?? '', improve: r.reflection.improve ?? '' })).catch(() => undefined); }, [date]);
  const save = async () => { try { await api(`/reflections/${date}`, { method: 'PUT', body: f }); toast('Reflection saved', 'ok'); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <Card className="space-y-4">
      <div><span className="label">How did today feel?</span><div className="flex gap-2">{[1, 2, 3, 4, 5].map((m) => <button key={m} aria-pressed={f.mood === m} onClick={() => setF({ ...f, mood: m })} className={`h-11 w-11 rounded-full border text-xl ${f.mood === m ? 'border-accent bg-accent/20' : 'border-ink-700'}`}>{['😞', '😕', '😐', '🙂', '😄'][m - 1]}</button>)}</div></div>
      <Field label="What went well?"><textarea className="input h-24" value={f.wins} onChange={(e) => setF({ ...f, wins: e.target.value })} /></Field>
      <Field label="What would you do differently?"><textarea className="input h-24" value={f.improve} onChange={(e) => setF({ ...f, improve: e.target.value })} /></Field>
      <button className="btn-primary" onClick={save}>Save reflection</button>
    </Card>
  );
}

export default function Growth() {
  const [tab, setTab] = useState<Tab>('habits');
  const tabs: [Tab, string][] = [['habits', 'Habits'], ['goals', 'Goals'], ['focus', 'Focus'], ['reflect', 'Reflection']];
  return (
    <>
      <PageTitle title="Growth" sub="Habits, goals, focus sessions and a daily reflection." />
      <div role="tablist" className="mb-5 flex gap-1.5 overflow-x-auto">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`btn-ghost whitespace-nowrap ${tab === k ? '!border-accent !bg-accent/15' : ''}`}>{l}</button>)}</div>
      {tab === 'habits' && <Habits />}{tab === 'goals' && <Goals />}{tab === 'focus' && <Focus />}{tab === 'reflect' && <Reflect />}
    </>
  );
}
