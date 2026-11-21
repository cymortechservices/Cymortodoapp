import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deviceTz, timezones } from '../lib/time';
import { Field } from '../components/ui';

function Frame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10 safe-top">
      <div className="rise mb-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-5 h-16 w-16 drop-shadow-[0_8px_24px_rgba(212,175,55,.35)]" />
        <h1 className="text-[2rem] font-bold leading-tight">{title}</h1>
        <p className="mt-2 text-sm text-fg-dim">{sub}</p>
      </div>
      <div className="card rise p-6">{children}</div>
    </div>
  );
}

/** One-time recovery code display. The code is the ONLY way to restore a username-only account on a new phone. */
export function RecoveryCard({ code, onDone, doneLabel = 'I have saved it' }: { code: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false); const [note, setNote] = useState('');
  const text = `CYMOR TO-DO recovery code\n\n${code}\n\nKeep this private. Anyone with this code can open your account.`;
  const copy = async () => { try { await navigator.clipboard.writeText(code); setNote('Copied'); } catch { setNote('Select the code and copy it manually'); } };
  const save = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'cymor-recovery-code.txt'; a.click(); setNote('Saved to your downloads'); };
  const share = async () => { try { await navigator.share({ title: 'CYMOR recovery code', text }); } catch { /* cancelled */ } };
  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="text-2xl font-bold">Your recovery code</h2>
        <p className="mt-1.5 text-sm text-fg-dim">There is no email or password on your account. This code is the <b className="text-fg">only way</b> to get your plans back on a new phone.</p>
      </div>
      <div className="card-gold px-3 py-5"><div aria-label="Recovery code" className="select-all break-all font-mono text-[1.35rem] font-semibold leading-snug tracking-[0.12em] gold-text">{code}</div></div>
      <div className="grid grid-cols-3 gap-2">
        <button className="btn-ghost btn-sm" onClick={copy}>Copy</button>
        <button className="btn-ghost btn-sm" onClick={save}>Save file</button>
        {'share' in navigator ? <button className="btn-ghost btn-sm" onClick={share}>Share</button> : <span />}
      </div>
      {note && <p role="status" className="text-xs text-good">{note}</p>}
      <label className="flex items-start gap-3 rounded-2xl border border-ink-700 p-3 text-left text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#D4AF37]" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>I stored this code somewhere safe (notes app, password manager or a screenshot).</span></label>
      <button className="btn-primary w-full" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

/** First screen for new users: only a username. */
export function Welcome() {
  const { startGuest, user } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [code, setCode] = useState<string | null>(null);
  if (user && !code) return <Navigate to="/dashboard" replace />;
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { setCode(await startGuest(name.trim())); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  if (code) return <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10 safe-top"><div className="card p-6 rise"><RecoveryCard code={code} onDone={() => nav('/dashboard', { replace: true })} doneLabel="Enter CYMOR" /></div></div>;
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-between px-6 pb-8 pt-14 safe-top">
      <div className="rise text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-20 w-20 drop-shadow-[0_10px_30px_rgba(212,175,55,.4)]" />
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.4em] text-fg-dim">CYMOR TO-DO</p>
        <h1 className="mt-4 text-[2.4rem] font-bold leading-[1.1]">What shall we <span className="gold-text italic">call you?</span></h1>
        <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-fg-dim">That is all we need. No email, no password, no waiting.</p>
      </div>
      <form onSubmit={go} className="rise space-y-4" style={{ animationDelay: '.12s' }}>
        <input aria-label="Your username" className="input !py-4 text-center font-display text-xl" placeholder="Your name" autoComplete="nickname" autoFocus minLength={2} maxLength={30} required value={name} onChange={(e) => setName(e.target.value)} />
        {err && <p role="alert" className="text-center text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full !py-4 text-base" disabled={busy || name.trim().length < 2}>{busy ? 'Setting things up…' : 'Begin'}</button>
        <p className="text-center text-sm text-fg-dim">Already use CYMOR? <Link className="font-semibold text-accent" to="/restore">Restore my account</Link></p>
      </form>
    </div>
  );
}

/** Restore with a recovery code, or sign in with email (for upgraded accounts). */
export function Restore() {
  const { recover, user } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await recover(code); nav('/dashboard'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Frame title="Welcome back" sub="Enter the recovery code you saved when you started.">
      <form onSubmit={go} className="space-y-4">
        <Field label="Recovery code"><input className="input text-center font-mono text-lg uppercase tracking-widest" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 16}>{busy ? 'Restoring…' : 'Restore my account'}</button>
        <div className="flex justify-between text-sm text-fg-dim"><Link className="hover:text-fg" to="/login">Sign in with email</Link><Link className="hover:text-fg" to="/welcome">Start fresh</Link></div>
      </form>
    </Frame>
  );
}

export function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(email, pw); nav('/dashboard'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Frame title="Welcome back" sub="Sign in with your email and password.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="flex justify-between text-sm text-fg-dim"><Link className="hover:text-fg" to="/forgot">Forgot password?</Link><Link className="hover:text-fg" to="/restore">Use recovery code</Link></div>
      </form>
    </Frame>
  );
}

export function Register() {
  const { register, user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', pw: '', tz: deviceTz() }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await register(f.name, f.email, f.pw, f.tz); nav('/dashboard'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Frame title="Create your account" sub="Plan it. Track it. Own it.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 8 characters."><input className="input" type="password" autoComplete="new-password" minLength={8} required value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
        <Field label="Timezone" hint="All reminders fire in this timezone, even if you travel."><select className="input" value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })}>{[...new Set([f.tz, ...timezones()])].map((z) => <option key={z}>{z}</option>)}</select></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="text-center text-sm text-fg-dim">Already registered? <Link className="text-accent" to="/login">Sign in</Link></p>
      </form>
    </Frame>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); try { await api('/auth/request-reset', { method: 'POST', body: { email }, auth: false }); setDone(true); } catch (x) { setErr(errMsg(x)); } };
  return (
    <Frame title="Reset password" sub="We will email you a reset link.">
      {done ? <p className="text-sm">If that email has an account, a reset link is on its way. <Link className="text-accent" to="/login">Back to sign in</Link></p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          <button className="btn-primary w-full">Send reset link</button>
        </form>
      )}
    </Frame>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams(); const nav = useNavigate();
  const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); try { await api('/auth/reset-password', { method: 'POST', body: { token: sp.get('token'), password: pw }, auth: false }); nav('/login'); } catch (x) { setErr(errMsg(x)); } };
  return (
    <Frame title="Choose a new password" sub="You will be signed out on all devices.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password"><input className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full">Update password</button>
      </form>
    </Frame>
  );
}

export function VerifyEmail() {
  const [sp] = useSearchParams(); const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle'); const [msg, setMsg] = useState('');
  const go = async () => { try { await api('/auth/verify-email', { method: 'POST', body: { token: sp.get('token') }, auth: false }); setState('ok'); } catch (x) { setMsg(errMsg(x)); setState('err'); } };
  return (
    <Frame title="Verify your email" sub="One quick step.">
      {state === 'ok' ? <p className="text-sm text-good">Email verified. <Link className="text-accent" to="/dashboard">Continue</Link></p> : (
        <div className="space-y-3"><button className="btn-primary w-full" onClick={go}>Confirm my email</button>{state === 'err' && <p role="alert" className="text-sm text-bad">{msg}</p>}</div>
      )}
    </Frame>
  );
}
