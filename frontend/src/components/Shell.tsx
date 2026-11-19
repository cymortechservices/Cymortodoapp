import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/hooks';
import { flushQueue, pendingCount } from '../lib/offline';
import { playSound } from '../lib/sound';
import { useToast } from './ui';

const NAV = [
  ['/dashboard', 'Today', 'M12 3v9l5 3'],
  ['/planner', 'Planner', 'M4 6h16M4 12h16M4 18h10'],
  ['/reminders', 'Reminders', 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0'],
  ['/analytics', 'Analytics', 'M4 20V10m6 10V4m6 16v-7m4 7H2'],
  ['/growth', 'Growth', 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7'],
  ['/notifications', 'Alerts', 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z'],
  ['/settings', 'Settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
] as const;

const Icon = ({ d }: { d: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

export default function Shell() {
  const { user, settings } = useAuth();
  const online = useOnline();
  const toast = useToast();
  const [queued, setQueued] = useState(0);

  const sync = async () => {
    const r = await flushQueue().catch(() => null);
    setQueued(await pendingCount().catch(() => 0));
    if (r?.sent) toast(`Synced ${r.sent} offline action${r.sent > 1 ? 's' : ''}`, 'ok');
    r?.conflicts.forEach((c) => toast(`Offline "${c.action.action}" was rejected: ${c.message}`, 'err'));
    if (r?.sent || r?.conflicts.length) window.dispatchEvent(new Event('cymor:refresh'));
  };
  useEffect(() => { void sync(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => void pendingCount().then(setQueued);
    window.addEventListener('cymor:queued', h);
    return () => window.removeEventListener('cymor:queued', h);
  }, []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push-received') { playSound(settings?.sound, settings?.soundEnabled); window.dispatchEvent(new Event('cymor:refresh')); }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [settings?.sound, settings?.soundEnabled]);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 p-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5"><img src="/icon.svg" alt="" className="h-8 w-8" /><span className="font-display text-lg font-bold tracking-wide">CYMOR</span></div>
        {NAV.map(([to, label, d]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? 'bg-accent/15 text-fg' : 'text-fg-dim hover:bg-ink-800/60 hover:text-fg'}`}><Icon d={d} />{label}</NavLink>
        ))}
        <div className="mt-auto rounded-xl border border-ink-700/60 p-3 text-xs text-fg-dim"><div className="truncate font-medium text-fg">{user?.name}</div><div className="truncate">{user?.timezone}</div></div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10">
        {!online && <div role="status" className="card mb-4 border-warn/40 px-4 py-2.5 text-sm text-warn">You are offline. Check-ins are saved on this device with their real time and sync when you reconnect.</div>}
        {online && queued > 0 && <div role="status" className="card mb-4 flex items-center justify-between px-4 py-2.5 text-sm">{queued} action{queued > 1 ? 's' : ''} waiting to sync <button className="btn-ghost !py-1" onClick={sync}>Sync now</button></div>}
        {user && !user.emailVerified && <div className="card mb-4 border-warn/30 px-4 py-2.5 text-sm text-fg-dim">Your email is not verified yet. Check your inbox for the verification link.</div>}
        <Outlet />
      </main>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-ink-700/70 bg-ink-900/95 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur md:hidden">
        {NAV.slice(0, 5).map(([to, label, d]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] ${isActive ? 'text-accent' : 'text-fg-dim'}`}><Icon d={d} />{label}</NavLink>
        ))}
        <NavLink to="/settings" className={({ isActive }) => `flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] ${isActive ? 'text-accent' : 'text-fg-dim'}`}><Icon d={NAV[6][2]} />More</NavLink>
      </nav>
    </div>
  );
}
