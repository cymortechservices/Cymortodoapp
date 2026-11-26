import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, download, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/hooks';
import { SOUNDS, playSound, startAlarm, stopAlarm } from '../lib/sound';
import { isNative, testAlarm } from '../lib/native';
import { timezones } from '../lib/time';
import { RecoveryCard } from './Auth';
import { Modal, ErrorBox, Field, PageTitle, Spinner, Toggle, useToast } from '../components/ui';

const ICONS: Record<string, string> = {
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  alarm: 'M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l2.5 1.5M4 4l3 2M20 4l-3 2',
  palette: 'M12 3a9 9 0 100 18c1.4 0 2-1 2-2 0-1.5-1-1.7-1-3 0-1.2 1-2 2.2-2H17a4 4 0 004-4c0-4-4-7-9-7z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  key: 'M15 8a4 4 0 11-3.5 6L4 21v-3H1v-3l7.5-7.5A4 4 0 0115 8z',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  db: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  warn: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
};
const Section = ({ icon, title, desc, tone, children }: { icon: keyof typeof ICONS; title: string; desc?: string; tone?: 'gold' | 'danger'; children: React.ReactNode }) => (
  <section className={`${tone === 'gold' ? 'card-gold' : 'card'} mb-6 overflow-hidden ${tone === 'danger' ? '!border-bad/40' : ''}`}>
    <header className="flex items-start gap-4 px-6 pb-4 pt-6">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tone === 'danger' ? 'bg-bad/10 text-bad' : 'bg-accent/12 text-accent'}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[icon]} /></svg>
      </span>
      <div className="min-w-0"><h2 className={`text-lg font-semibold ${tone === 'danger' ? 'text-bad' : ''}`}>{title}</h2>{desc && <p className="mt-1 text-sm leading-relaxed text-fg-dim">{desc}</p>}</div>
    </header>
    <div className="px-6 pb-6">{children}</div>
  </section>
);
const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-5 border-t border-ink-700/70 py-4 first:border-t-0"><div className="min-w-0"><div className="text-[15px] font-medium">{label}</div>{hint && <div className="mt-1 text-xs leading-relaxed text-fg-dim">{hint}</div>}</div><div className="shrink-0">{children}</div></div>
);

export default function Settings() {
  const { user, settings, updateSettings, setUser, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? ''); const [tz, setTz] = useState(user?.timezone ?? 'UTC');
  const [pw, setPw] = useState({ cur: '', next: '' }); const [delPw, setDelPw] = useState('');
  const [up, setUp] = useState({ email: '', password: '' }); const [newCode, setNewCode] = useState<string | null>(null);
  const sessions = useAsync(() => api<{ sessions: { id: string; userAgent?: string; createdAt: string; current: boolean }[] }>('/auth/sessions'), []);
  const shares = useAsync(() => api<{ shares: { id: string; title: string; from: string; to: string; revoked: boolean; expiresAt?: string }[] }>('/shares'), []);
  if (!settings || !user) return <Spinner />;
  const n = settings.defaultNotify;
  const run = (fn: () => Promise<unknown>, ok: string) => fn().then(() => toast(ok, 'ok')).catch((e) => toast(errMsg(e), 'err'));
  const setNotify = (p: Partial<typeof n>) => updateSettings({ defaultNotify: { ...n, ...p } });
  const sel = 'input !w-auto !min-h-[44px] !py-2';

  return (
    <>
      <PageTitle title="Settings" sub="Make CYMOR TO-DO yours" />

      <section className="card-gold mb-6 flex items-center gap-5 p-6">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full font-display text-3xl font-bold text-[var(--on-gold)]" style={{ background: 'var(--gold-grad)' }} aria-hidden>{user.name.trim().charAt(0).toUpperCase()}</div>
        <div className="min-w-0"><div className="truncate font-display text-xl font-semibold">{user.name}</div><div className="mt-1 truncate text-sm text-fg-dim">{user.email ?? 'Username-only account'}</div><div className="mt-1 truncate text-xs text-fg-dim">{user.timezone}</div></div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <Link to="/reminders" className="card flex flex-col gap-2 p-5 text-[15px] font-medium hover:bg-ink-800/60"><span className="text-xl" aria-hidden>⏰</span>Reminders &amp; routines</Link>
        <Link to="/analytics" className="card flex flex-col gap-2 p-5 text-[15px] font-medium hover:bg-ink-800/60"><span className="text-xl" aria-hidden>📊</span>Analytics</Link>
      </div>

      <Section icon="user" title="Profile" desc="How CYMOR greets you and which clock it uses.">
        <div className="space-y-4">
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Timezone" hint="Changing this changes when your reminders fire."><select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...timezones()])].map((z) => <option key={z}>{z}</option>)}</select></Field>
          <button className="btn-primary w-full sm:w-auto" onClick={() => run(async () => { const r = await api<{ user: typeof user }>('/auth/me', { method: 'PATCH', body: { name, timezone: tz } }); setUser(r.user); }, 'Profile saved')}>Save profile</button>
        </div>
      </Section>

      <Section icon="alarm" tone="gold" title="Loud alarm" desc="When an activity starts, your phone rings a loud alarm, even if the app is closed or the phone is locked. It repeats twice until you check in.">
        <Row label="Alarm when an activity starts" hint="Applies to new activities. You can change it for each activity too."><Toggle checked={n.alarm !== false} onChange={(v) => setNotify({ alarm: v })} label="Start alarm" /></Row>
        <Row label="Test the alarm" hint={isNative() ? 'Rings in 5 seconds. Turn the phone’s notification volume up for a louder alarm.' : 'Plays the alarm sound now. The installed Android app also rings with the phone locked.'}>
          <button className="btn-ghost btn-sm" onClick={() => { if (isNative()) { void testAlarm(); toast('Alarm will ring in 5 seconds', 'ok'); } else { startAlarm(); setTimeout(stopAlarm, 4500); } }}>Test alarm</button>
        </Row>
        {isNative() && <p className="mt-2 rounded-2xl bg-ink-800/50 p-4 text-xs leading-relaxed text-fg-dim">For the most reliable alarm: Android Settings → Apps → CYMOR TO-DO → Notifications → <b className="text-fg">Activity alarm</b> → allow sound and “override Do Not Disturb”, and set Battery to Unrestricted.</p>}
      </Section>

      <Section icon="bell" title="Notifications" desc="What CYMOR tells you for every new activity.">
        <Row label="Heads-up before start" hint={`${n.preStart.minutesBefore} minutes before`}><Toggle checked={n.preStart.enabled} onChange={(v) => setNotify({ preStart: { ...n.preStart, enabled: v } })} label="Pre-start" /></Row>
        <Row label="When it starts"><Toggle checked={n.start.enabled} onChange={(v) => setNotify({ start: { enabled: v } })} label="Start" /></Row>
        <Row label="When it ends"><Toggle checked={n.end.enabled} onChange={(v) => setNotify({ end: { enabled: v } })} label="End" /></Row>
        <Row label="Overdue alert" hint={`${n.overdue.minutesAfterEnd} minutes after the end if you have not checked out`}><Toggle checked={n.overdue.enabled} onChange={(v) => setNotify({ overdue: { ...n.overdue, enabled: v } })} label="Overdue" /></Row>
        <Row label="In-app sounds" hint="Plays while the app is open."><Toggle checked={settings.soundEnabled} onChange={(v) => updateSettings({ soundEnabled: v })} label="Sounds" /></Row>
        <Row label="Sound"><div className="flex gap-2"><select className={sel} value={settings.sound} onChange={(e) => { void updateSettings({ sound: e.target.value }); playSound(e.target.value, true); }}>{SOUNDS.map((x) => <option key={x}>{x}</option>)}</select><button className="btn-ghost btn-sm" onClick={() => playSound(settings.sound, true)}>Play</button></div></Row>
      </Section>

      <Section icon="palette" title="Appearance" desc="Look and feel.">
        <Row label="Theme"><select className={sel} value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as never })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></Row>
        <Row label="Week starts on"><select className={sel} value={settings.weekStartsOn} onChange={(e) => updateSettings({ weekStartsOn: Number(e.target.value) })}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></Row>
        <Row label="Reduce motion" hint="Also respects your phone setting."><Toggle checked={settings.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} label="Reduce motion" /></Row>
      </Section>

      {user.guest && (
        <Section icon="key" tone="gold" title="Backup & recovery" desc="Your account has no email. Your recovery code is the only way to get your plans back on a new phone.">
          <button className="btn-ghost w-full sm:w-auto" onClick={() => run(async () => { const r = await api<{ recoveryCode: string }>('/auth/recovery-code', { method: 'POST', body: {} }); setNewCode(r.recoveryCode); }, 'New recovery code created')}>Create a new recovery code</button>
          <p className="mt-2 text-xs text-fg-dim">The old code stops working. Needs internet.</p>
          <div className="hairline my-6" />
          <h3 className="mb-1 text-[15px] font-semibold">Optional: add email &amp; password</h3>
          <p className="mb-4 text-sm text-fg-dim">Sign in the usual way and reset by email. Keeps all your data.</p>
          <div className="space-y-4"><Field label="Email"><input className="input" type="email" autoComplete="email" value={up.email} onChange={(e) => setUp({ ...up, email: e.target.value })} /></Field><Field label="Password"><input className="input" type="password" autoComplete="new-password" minLength={8} value={up.password} onChange={(e) => setUp({ ...up, password: e.target.value })} /></Field></div>
          <button className="btn-primary mt-4 w-full sm:w-auto" disabled={!up.email || up.password.length < 8} onClick={() => run(async () => { const r = await api<{ user: typeof user }>('/auth/upgrade', { method: 'POST', body: up }); setUser(r.user); setUp({ email: '', password: '' }); }, 'Saved. Check your inbox to verify your email')}>Add email &amp; password</button>
        </Section>
      )}
      <Modal open={!!newCode} onClose={() => undefined} title="New recovery code">{newCode && <RecoveryCard code={newCode} onDone={() => setNewCode(null)} />}</Modal>

      <Section icon="shield" title="Security & devices" desc="Needs internet.">
        {user.hasPassword && (<div className="mb-6 space-y-4"><Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} /></Field>
          <Field label="New password"><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <button className="btn-ghost" onClick={() => run(async () => { await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.cur, newPassword: pw.next } }); setPw({ cur: '', next: '' }); }, 'Password changed; other devices signed out')}>Change password</button></div>)}
        <h3 className="mb-3 text-[15px] font-semibold">Signed-in devices</h3>
        {sessions.loading ? <Spinner /> : sessions.error ? <ErrorBox msg={sessions.error} /> : <ul className="space-y-3 text-sm">{sessions.data?.sessions.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 px-4 py-3"><span className="min-w-0 truncate">{(s.userAgent ?? 'Unknown device').slice(0, 60)}{s.current && <span className="chip ml-2">this device</span>}</span>{!s.current && <button className="btn-ghost !py-1 text-xs" onClick={async () => { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); void sessions.reload(); }}>Sign out</button>}</li>)}</ul>}

        <button className="btn-ghost mt-6" onClick={async () => { if (user.guest && !confirm('Signing out of a username-only account needs your recovery code to get back in. Sign out?')) return; await logout(); nav('/welcome'); }}>Sign out</button>
      </Section>

      <Section icon="share" title="Shared schedules" desc="Links you created from the Planner.">
        {shares.loading ? <Spinner /> : !shares.data?.shares.length ? <p className="text-sm text-fg-dim">No share links. Create one from the Planner.</p> : <ul className="space-y-3 text-sm">{shares.data.shares.map((s) => <li key={s.id} className="flex items-center justify-between rounded-xl border border-ink-700 px-4 py-3"><span>{s.title} · {s.from} → {s.to}{s.revoked && <span className="chip ml-2">revoked</span>}</span>{!s.revoked && <button className="btn-danger !py-1 text-xs" onClick={async () => { await api(`/shares/${s.id}`, { method: 'DELETE' }); void shares.reload(); }}>Revoke</button>}</li>)}</ul>}
      </Section>

      <Section icon="db" title="Your data" desc="Download everything CYMOR TO-DO stores about you (no passwords or tokens).">
        <button className="btn-ghost w-full sm:w-auto" onClick={() => run(() => download('/auth/export', 'cymor-todo-export.json'), 'Export downloaded')}>Export all data (JSON)</button>
      </Section>

      <Section icon="warn" tone="danger" title="Delete account" desc="Permanently deletes your account, schedule, reminders, history and devices. This cannot be undone. Needs internet.">
        <div className="space-y-3"><input className="input" type={user.hasPassword ? 'password' : 'text'} placeholder={user.hasPassword ? 'Confirm with your password' : `Type "${user.name}" to confirm`} autoComplete="off" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          <button className="btn-danger w-full sm:w-auto" disabled={!delPw} onClick={async () => { if (!confirm('Delete your account permanently?')) return; try { await api('/auth/me', { method: 'DELETE', body: user.hasPassword ? { password: delPw } : { confirmName: delPw } }); await logout(); nav('/welcome'); } catch (e) { toast(errMsg(e), 'err'); } }}>Delete my account</button></div>
      </Section>

      <footer className="card-gold mb-4 px-6 py-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-12 w-12" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.35em] text-fg-dim">CYMOR TO-DO</p>
        <div className="hairline mx-auto my-5 w-40" />
        <p className="text-xs uppercase tracking-[0.25em] text-fg-dim">Designed &amp; developed by</p>
        <p className="gold-text mt-2 font-display text-2xl font-bold">Legendary Smiley Cymor</p>
        <p className="mt-2 text-sm text-fg-dim">C.E.O, CYMORTECHSERVICES</p>
        <p className="mt-6 text-xs text-fg-dim">Version 1.2 · Own your time. Master your day.</p>
      </footer>
    </>
  );
}
