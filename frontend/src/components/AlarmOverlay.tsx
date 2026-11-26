import { useEffect, useRef, useState } from 'react';
import { L } from '../lib/localdb';
import { sessionAction } from '../lib/offline';
import { startAlarm, stopAlarm } from '../lib/sound';
import { hhmm } from '../lib/time';
import { useAuth } from '../lib/auth';

const WINDOW_MS = 10 * 60_000; // keep ringing the screen for up to 10 min after the start time
interface Due { id: string; title: string; startUtc: number; location?: string }

/** Full-screen "time to start" alarm. Rings (sound + vibration) while the app is open and an activity has begun without a check-in. */
export default function AlarmOverlay() {
  const { user } = useAuth();
  const [due, setDue] = useState<Due | null>(null);
  const hushed = useRef(new Map<string, number>()); // activity id -> don't show again until this time (snooze / dismiss)
  const tz = user?.timezone ?? 'UTC';

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const hit = L.get('acts').filter((a) => !a.cancelled && !a.checkInAt && a.notify?.alarm !== false && a.notify?.start?.enabled !== false && a.startUtc <= now && now - a.startUtc <= WINDOW_MS && (hushed.current.get(a.id) ?? 0) <= now)
        .sort((x, y) => x.startUtc - y.startUtc)[0];
      setDue((cur) => (hit ? (cur?.id === hit.id ? cur : { id: hit.id, title: hit.title, startUtc: hit.startUtc, location: hit.location }) : null));
    };
    check();
    const t = setInterval(check, 4000);
    window.addEventListener('cymor:refresh', check); window.addEventListener('cymor:queued', check);
    return () => { clearInterval(t); window.removeEventListener('cymor:refresh', check); window.removeEventListener('cymor:queued', check); };
  }, []);

  useEffect(() => { if (due) startAlarm(); else stopAlarm(); return stopAlarm; }, [due?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!due) return null;
  const hush = (mins: number) => { hushed.current.set(due.id, Date.now() + mins * 60_000); setDue(null); };
  const checkIn = async () => { stopAlarm(); setDue(null); await sessionAction(due.id, 'check-in').catch(() => undefined); window.dispatchEvent(new Event('cymor:refresh')); };
  return (
    <div role="alertdialog" aria-label={`${due.title} is starting`} className="fixed inset-0 z-[90] flex flex-col items-center justify-center px-8 text-center"
      style={{ background: 'radial-gradient(120% 80% at 50% 30%, #2a210c 0%, #0c0a06 70%)' }}>
      <style>{`@keyframes alarmPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(212,175,55,.55)}50%{transform:scale(1.06);box-shadow:0 0 0 28px rgba(212,175,55,0)}}`}</style>
      <div className="grid h-28 w-28 place-items-center rounded-full text-[var(--on-gold)]" style={{ background: 'var(--gold-grad)', animation: 'alarmPulse 1.4s ease-in-out infinite' }}>
        <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
      </div>
      <p className="mt-9 text-xs font-semibold uppercase tracking-[0.4em] text-fg-dim">Time to start · {hhmm(due.startUtc, tz)}</p>
      <h2 className="gold-text mt-4 text-[2.4rem] font-bold leading-tight">{due.title}</h2>
      {due.location && <p className="mt-3 text-fg-dim">{due.location}</p>}
      <div className="mt-12 grid w-full max-w-xs gap-3">
        <button className="btn-primary !py-4 text-base" onClick={checkIn}>I am starting now</button>
        <button className="btn-ghost" onClick={() => hush(5)}>Snooze 5 minutes</button>
        <button className="text-sm text-fg-dim underline underline-offset-4" onClick={() => hush(WINDOW_MS / 60_000)}>Silence</button>
      </div>
    </div>
  );
}
