import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/hooks';
import { flushQueue, pendingCount } from '../lib/offline';
import { L } from '../lib/localdb';
import { RecoveryCard } from '../pages/Auth';
import { playSound } from '../lib/sound';
import { Modal, useToast } from './ui';
import AlarmOverlay from './AlarmOverlay';
import AlarmReadiness from './AlarmReadiness';
import { hasNativeAlarm } from '../lib/alarmNative';

const NAV = [
  ['/dashboard', 'Today', 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2'],
  ['/planner', 'Planner', 'M4 6h16M4 12h16M4 18h10'],
  ['/reminders', 'Reminders', 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0'],
  ['/analytics', 'Analytics', 'M4 20V10m6 10V4m6 16v-7m4 7H2'],
  ['/growth', 'Growth', 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7'],
  ['/notifications', 'Alerts', 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0'],
  ['/settings', 'Settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
] as const;

const Icon = ({ d }: { d: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

export default function Shell() {
  const { user, settings } = useAuth();
  const online = useOnline();
  const toast = useToast();
  const [queued, setQueued] = useState(0);

  const [guide, setGuide] = useState(() => { try { return hasNativeAlarm() && localStorage.getItem('cymor.permGuide') !== '2'; } catch { return false; } });
  const [pendingCode, setPendingCode] = useState<string | null>(L.get('recoveryToShow'));
  const [authLost, setAuthLost] = useState(L.get('authLost'));
  const refreshState = async () => { setQueued(await pendingCount().catch(() => 0)); setPendingCode(L.get('recoveryToShow')); setAuthLost(L.get('authLost')); };
  const sync = async () => {
    const r = await flushQueue().catch(() => null);
    await refreshState();
    if (r?.sent) toast(`Backed up ${r.sent} change${r.sent > 1 ? 's' : ''}`, 'ok');
    r?.conflicts.forEach((c) => toast(`A change made offline was not accepted: ${c.message}`, 'err'));
    if (r?.sent || r?.conflicts.length) window.dispatchEvent(new Event('cymor:refresh'));
  };
  useEffect(() => { void sync(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => void refreshState();
    for (const e of ['cymor:queued', 'cymor:synced']) window.addEventListener(e, h);
    return () => { for (const e of ['cymor:queued', 'cymor:synced']) window.removeEventListener(e, h); };
  }, []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push-received') { playSound(settings?.sound, settings?.soundEnabled); window.dispatchEvent(new Event('cymor:refresh')); }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [settings?.sound, settings?.soundEnabled]);

  const link = (to: string, label: string, d: string, mobile = false) => (
    <NavLink key={to} to={to} className={({ isActive }) => mobile
      ? `relative flex min-w-[58px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-medium tracking-wide transition ${isActive ? 'text-accent' : 'text-fg-dim'}`
      : `flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm transition ${isActive ? 'bg-accent/12 text-accent' : 'text-fg-dim hover:bg-ink-800/60 hover:text-fg'}`}>
      {({ isActive }) => (<><Icon d={d} />{label}{mobile && isActive && <span className="absolute -top-1 h-0.5 w-6 rounded-full" style={{ background: 'var(--gold-grad)' }} />}</>)}
    </NavLink>
  );
  return (
    <div className="mx-auto flex min-h-full max-w-6xl">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 p-5 md:flex">
        <div className="mb-7 flex items-center gap-3"><img src="/icon.svg" alt="" className="h-9 w-9" /><span className="gold-text font-display text-xl font-bold tracking-wide">CYMOR</span></div>
        {NAV.map(([to, label, d]) => link(to, label, d))}
        <Link to="/planner?new=1" className="btn-primary mt-4">+ New activity</Link>
        <div className="card mt-auto p-3 text-xs text-fg-dim"><div className="truncate font-medium text-fg">{user?.name}</div><div className="truncate">{user?.timezone}</div></div>
      </aside>
      <main className="min-w-0 flex-1 px-5 pb-36 pt-[max(env(safe-area-inset-top),1.75rem)] md:px-10 md:pb-12">
        {!online && <div role="status" className="card mb-4 px-4 py-3 text-sm leading-relaxed text-fg-dim"><b className="text-fg">Offline mode.</b> Everything still works. Changes are saved on this phone{queued > 0 ? ` (${queued} waiting)` : ''} and back up when you are online.</div>}
        {online && queued > 0 && <div role="status" className="card mb-4 flex items-center justify-between gap-3 px-4 py-3 text-sm">{queued} change{queued > 1 ? 's' : ''} waiting to back up <button className="btn-ghost btn-sm" onClick={sync}>Back up now</button></div>}
        {authLost && <div role="alert" className="card mb-4 border-warn/40 px-4 py-3 text-sm leading-relaxed text-warn">Cloud backup is paused because this phone was signed out by the server. Your plans are safe on this phone. In Settings, sign out and restore with your recovery code.</div>}
        {user?.email && !user.emailVerified && <div className="card mb-4 border-warn/30 px-4 py-2.5 text-sm text-fg-dim">Your email is not verified yet. Check your inbox for the verification link.</div>}
        <Outlet />
      </main>
      <Modal open={!!pendingCode} onClose={() => undefined} title="Save your recovery code">{pendingCode && <RecoveryCard code={pendingCode} onDone={async () => { await L.set('recoveryToShow', null); setPendingCode(null); }} />}</Modal>
      <Modal open={guide && !pendingCode} onClose={() => undefined} title="Make sure your alarm can ring">
        <p className="mb-5 text-[15px] leading-relaxed text-fg-dim">Phones often block alarms to save battery. Tap Allow on each line so CYMOR can wake you at the exact start time.</p>
        <AlarmReadiness />
        <button className="btn-primary mt-5 w-full" onClick={() => { try { localStorage.setItem('cymor.permGuide', '2'); } catch { /* */ } setGuide(false); }}>Continue</button>
      </Modal>
      <AlarmOverlay />
      <nav aria-label="Primary" className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),10px)] z-40 flex items-center justify-between rounded-[1.75rem] border border-accent/25 bg-ink-900/92 px-2 py-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl md:hidden">
        {link(NAV[0][0], NAV[0][1], NAV[0][2], true)}
        {link(NAV[1][0], NAV[1][1], NAV[1][2], true)}
        <Link to="/planner?new=1" aria-label="New activity" className="-mt-7 grid h-14 w-14 shrink-0 place-items-center rounded-full text-[var(--on-gold)] shadow-[0_10px_30px_-6px_rgb(var(--c-accent)/0.8)] active:scale-95" style={{ background: 'var(--gold-grad)' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </Link>
        {link(NAV[5][0], NAV[5][1], NAV[5][2], true)}
        {link(NAV[6][0], 'More', NAV[6][2], true)}
      </nav>
    </div>
  );
}
