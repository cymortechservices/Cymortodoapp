import { useEffect, useRef, useState } from 'react';
import { L } from '../lib/localdb';
import { sessionAction } from '../lib/offline';
import { startAlarm, stopAlarm } from '../lib/sound';
import { hhmm } from '../lib/time';
import { useAuth } from '../lib/auth';
import { alarmNative, hasNativeAlarm } from '../lib/alarmNative';

const WINDOW_MS = 10 * 60_000; // keep ringing the screen for up to 10 min after the start time
interface Due { id: string; title: string; startUtc: number; location?: string }

/** Full-screen "time to start" alarm. Rings (sound + vibration) while the app is open and an activity has begun without a check-in. */
export default function AlarmOverlay() {
  const { user } = useAuth();
  const [due, setDue] = useState<Due | null>(null);
  const [ring, setRing] = useState<{ title: string; source: string; since: number } | null>(null); // native alarm ringing
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

  // On the phone the native service rings (alarm volume); watch it so the screen shows even for a test alarm.
  useEffect(() => {
    if (!hasNativeAlarm()) return;
    let on = true;
    const poll = async () => { const st = await alarmNative.status(); if (on) setRing(st?.ringing ? { title: st.ringingTitle, source: st.ringingSource, since: st.ringingSince } : null); };
    void poll(); const t = setInterval(poll, 1500);
    return () => { on = false; clearInterval(t); };
  }, []);

  const view: Due | null = due ?? (ring ? { id: ring.source || 'native', title: ring.title || 'Alarm', startUtc: ring.since } : null);
  // In the browser the app plays its own beeps; on the phone the native alarm does.
  useEffect(() => { if (view && !hasNativeAlarm()) startAlarm(); else stopAlarm(); return stopAlarm; }, [view?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null;
  const real = !!due; // false for a test alarm: nothing to check in to
  const hush = (mins: number) => {
    hushed.current.set(view.id, Date.now() + mins * 60_000); setDue(null); setRing(null); stopAlarm();
    if (mins <= 5) void alarmNative.snooze(mins, view.title, real ? view.id : ''); else void alarmNative.stop();
  };
  const checkIn = async () => { stopAlarm(); void alarmNative.stop(); setDue(null); setRing(null); if (real) await sessionAction(view.id, 'check-in').catch(() => undefined); window.dispatchEvent(new Event('cymor:refresh')); };
  return (
    <div role="alertdialog" aria-label={`${view.title} is starting`} className="fixed inset-0 z-[90] flex flex-col items-center justify-center px-8 text-center"
      style={{ background: 'radial-gradient(120% 80% at 50% 30%, #2a210c 0%, #0c0a06 70%)' }}>
      <style>{`@keyframes alarmPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(212,175,55,.55)}50%{transform:scale(1.06);box-shadow:0 0 0 28px rgba(212,175,55,0)}}`}</style>
      <div className="grid h-28 w-28 place-items-center rounded-full text-[var(--on-gold)]" style={{ background: 'var(--gold-grad)', animation: 'alarmPulse 1.4s ease-in-out infinite' }}>
        <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
      </div>
      <p className="mt-9 text-xs font-semibold uppercase tracking-[0.4em] text-fg-dim">Time to start · {hhmm(view.startUtc, tz)}</p>
      <h2 className="gold-text mt-4 text-[2.4rem] font-bold leading-tight">{view.title}</h2>
      {view.location && <p className="mt-3 text-fg-dim">{view.location}</p>}
      <div className="mt-12 grid w-full max-w-xs gap-3">
        <button className="btn-primary !py-4 text-base" onClick={checkIn}>{real ? 'I am starting now' : 'Stop alarm'}</button>
        {real && <button className="btn-ghost" onClick={() => hush(5)}>Snooze 5 minutes</button>}
        {real && <button className="text-sm text-fg-dim underline underline-offset-4" onClick={() => hush(WINDOW_MS / 60_000)}>Silence</button>}
      </div>
    </div>
  );
}
