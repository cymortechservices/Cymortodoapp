import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, download, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/hooks';
import { SOUNDS, playSound } from '../lib/sound';
import { timezones } from '../lib/time';
import { RecoveryCard } from './Auth';
import { Modal, Card, ErrorBox, Field, PageTitle, Spinner, Toggle, useToast } from '../components/ui';

const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2.5"><div><div className="text-sm">{label}</div>{hint && <div className="text-xs text-fg-dim">{hint}</div>}</div>{children}</div>
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

  return (
    <>
      <PageTitle title="Settings" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2"><Link to="/reminders" className="card px-4 py-3 text-sm hover:bg-ink-800/60">⏰ Reminders & routines</Link><Link to="/analytics" className="card px-4 py-3 text-sm hover:bg-ink-800/60">📊 Analytics</Link><Link to="/growth" className="card px-4 py-3 text-sm hover:bg-ink-800/60">🌱 Growth · habits, goals, focus</Link><Link to="/notifications" className="card px-4 py-3 text-sm hover:bg-ink-800/60">🔔 Notification centre & system check</Link></div>

      <Card className="mb-4"><h2 className="mb-2 text-lg font-semibold">Profile</h2>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Timezone" hint="Changing this changes when your reminders fire."><select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...timezones()])].map((z) => <option key={z}>{z}</option>)}</select></Field></div>
        <button className="btn-primary mt-3" onClick={() => run(async () => { const r = await api<{ user: typeof user }>('/auth/me', { method: 'PATCH', body: { name, timezone: tz } }); setUser(r.user); }, 'Profile saved')}>Save profile</button>
        <p className="mt-2 text-xs text-fg-dim">{user.email ? `${user.email}${user.emailVerified ? ' · verified' : ' · not verified'}` : 'Username-only account · no email'}</p></Card>

      <Card className="mb-4"><h2 className="mb-1 text-lg font-semibold">Appearance & sound</h2>
        <Row label="Theme"><select className="input !w-32" value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as never })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></Row>
        <Row label="Reduce motion" hint="Also respects your device setting."><Toggle checked={settings.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} label="Reduce motion" /></Row>
        <Row label="Week starts on"><select className="input !w-32" value={settings.weekStartsOn} onChange={(e) => updateSettings({ weekStartsOn: Number(e.target.value) })}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></Row>
        <Row label="In-app sounds" hint="Plays while the app is open. Background push sounds are controlled by your device."><Toggle checked={settings.soundEnabled} onChange={(v) => updateSettings({ soundEnabled: v })} label="Sounds" /></Row>
        <Row label="Sound"><div className="flex gap-2"><select className="input !w-28" value={settings.sound} onChange={(e) => { void updateSettings({ sound: e.target.value }); playSound(e.target.value, true); }}>{SOUNDS.map((s) => <option key={s}>{s}</option>)}</select><button className="btn-ghost !py-1.5" onClick={() => playSound(settings.sound, true)}>▶</button></div></Row>
        <Row label="Replay intro animation"><button className="btn-ghost !py-1.5" onClick={() => { try { localStorage.removeItem('cymor.intro.v2'); } catch { /* ignore */ } location.href = '/'; }}>Replay</button></Row></Card>

      <Card className="mb-4"><h2 className="mb-1 text-lg font-semibold">Default notifications for new activities</h2>
        <Row label="Heads-up before start" hint={`${n.preStart.minutesBefore} min before`}><Toggle checked={n.preStart.enabled} onChange={(v) => updateSettings({ defaultNotify: { ...n, preStart: { ...n.preStart, enabled: v } } })} label="Pre-start" /></Row>
        <Row label="At start"><Toggle checked={n.start.enabled} onChange={(v) => updateSettings({ defaultNotify: { ...n, start: { enabled: v } } })} label="Start" /></Row>
        <Row label="At end"><Toggle checked={n.end.enabled} onChange={(v) => updateSettings({ defaultNotify: { ...n, end: { enabled: v } } })} label="End" /></Row>
        <Row label="Overdue alert" hint={`${n.overdue.minutesAfterEnd} min after end if not checked out`}><Toggle checked={n.overdue.enabled} onChange={(v) => updateSettings({ defaultNotify: { ...n, overdue: { ...n.overdue, enabled: v } } })} label="Overdue" /></Row></Card>

      {user.guest && (
        <Card className="card-gold mb-4 !border-accent/40">
          <h2 className="mb-1 text-lg font-semibold">Backup & recovery</h2>
          <p className="mb-3 text-sm text-fg-dim">Your account has no email. Your <b className="text-fg">recovery code</b> is the only way to get your plans back on a new phone. Lost it? Make a new one (the old one stops working).</p>
          <button className="btn-ghost" onClick={() => run(async () => { const r = await api<{ recoveryCode: string }>('/auth/recovery-code', { method: 'POST', body: {} }); setNewCode(r.recoveryCode); }, 'New recovery code created')}>Create a new recovery code</button>
          <div className="hairline my-5" />
          <h3 className="mb-1 text-sm font-semibold">Optional: add email &amp; password</h3>
          <p className="mb-3 text-xs text-fg-dim">Lets you sign in the usual way and reset by email. Keeps all your data.</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Email"><input className="input" type="email" autoComplete="email" value={up.email} onChange={(e) => setUp({ ...up, email: e.target.value })} /></Field><Field label="Password"><input className="input" type="password" autoComplete="new-password" minLength={8} value={up.password} onChange={(e) => setUp({ ...up, password: e.target.value })} /></Field></div>
          <button className="btn-primary mt-3" disabled={!up.email || up.password.length < 8} onClick={() => run(async () => { const r = await api<{ user: typeof user }>('/auth/upgrade', { method: 'POST', body: up }); setUser(r.user); setUp({ email: '', password: '' }); }, 'Saved. Check your inbox to verify your email')}>Add email &amp; password</button>
        </Card>
      )}
      <Modal open={!!newCode} onClose={() => undefined} title="New recovery code">{newCode && <RecoveryCard code={newCode} onDone={() => setNewCode(null)} />}</Modal>

      <Card className="mb-4"><h2 className="mb-2 text-lg font-semibold">Security</h2>
        {user.hasPassword && <><div className="grid gap-3 sm:grid-cols-2"><Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} /></Field><Field label="New password"><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field></div>
        <button className="btn-ghost mt-3" onClick={() => run(async () => { await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.cur, newPassword: pw.next } }); setPw({ cur: '', next: '' }); }, 'Password changed; other devices signed out')}>Change password</button></>}
        <h3 className="mb-2 mt-6 text-sm font-semibold">Signed-in devices</h3>
        {sessions.loading ? <Spinner /> : sessions.error ? <ErrorBox msg={sessions.error} /> : <ul className="space-y-2 text-sm">{sessions.data?.sessions.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 px-3 py-2"><span className="min-w-0 truncate">{(s.userAgent ?? 'Unknown device').slice(0, 60)}{s.current && <span className="chip ml-2">this device</span>}</span>{!s.current && <button className="btn-ghost !py-1 text-xs" onClick={async () => { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); void sessions.reload(); }}>Sign out</button>}</li>)}</ul>}
        <button className="btn-ghost mt-3" onClick={async () => { await logout(); nav('/welcome'); }}>Sign out</button>{user.guest && <p className="mt-2 text-xs text-fg-dim">Signing out of a username-only account needs your recovery code to get back in.</p>}</Card>

      <Card className="mb-4"><h2 className="mb-2 text-lg font-semibold">Shared schedules</h2>
        {shares.loading ? <Spinner /> : !shares.data?.shares.length ? <p className="text-sm text-fg-dim">No share links. Create one from the Planner.</p> : <ul className="space-y-2 text-sm">{shares.data.shares.map((s) => <li key={s.id} className="flex items-center justify-between rounded-xl border border-ink-700 px-3 py-2"><span>{s.title} · {s.from} → {s.to}{s.revoked && <span className="chip ml-2">revoked</span>}</span>{!s.revoked && <button className="btn-danger !py-1 text-xs" onClick={async () => { await api(`/shares/${s.id}`, { method: 'DELETE' }); void shares.reload(); }}>Revoke</button>}</li>)}</ul>}</Card>

      <Card className="mb-4"><h2 className="mb-2 text-lg font-semibold">Your data</h2><p className="mb-3 text-sm text-fg-dim">Download everything CYMOR TO-DO stores about you (no passwords or tokens).</p><button className="btn-ghost" onClick={() => run(() => download('/auth/export', 'cymor-todo-export.json'), 'Export downloaded')}>Export all data (JSON)</button></Card>

      <Card className="border-bad/40"><h2 className="mb-2 text-lg font-semibold text-bad">Delete account</h2><p className="mb-3 text-sm text-fg-dim">Permanently deletes your account, schedule, reminders, history and devices. This cannot be undone.</p>
        <div className="flex gap-2"><input className="input" type={user.hasPassword ? 'password' : 'text'} placeholder={user.hasPassword ? 'Confirm with your password' : `Type "${user.name}" to confirm`} autoComplete="off" value={delPw} onChange={(e) => setDelPw(e.target.value)} /><button className="btn-danger" disabled={!delPw} onClick={async () => { if (!confirm('Delete your account permanently?')) return; try { await api('/auth/me', { method: 'DELETE', body: user.hasPassword ? { password: delPw } : { confirmName: delPw } }); await logout(); nav('/welcome'); } catch (e) { toast(errMsg(e), 'err'); } }}>Delete</button></div></Card>
    </>
  );
}
