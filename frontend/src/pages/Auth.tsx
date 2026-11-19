import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deviceTz, timezones } from '../lib/time';
import { Field } from '../components/ui';

function Frame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <div className="rise mb-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-4 h-14 w-14" />
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-fg-dim">{sub}</p>
      </div>
      <div className="card rise p-6">{children}</div>
    </div>
  );
}

export function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(email, pw); nav('/dashboard'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Frame title="Welcome back" sub="Own your time. Master your day.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="flex justify-between text-sm text-fg-dim"><Link className="hover:text-fg" to="/forgot">Forgot password?</Link><Link className="hover:text-fg" to="/register">Create account</Link></div>
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
