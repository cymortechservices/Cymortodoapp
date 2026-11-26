import { nativeLogout } from './native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, authEvents, netApi, NetworkError, tokens } from './api';
import { L } from './localdb';
import { hydrate, syncAll } from './sync';
import { deviceTz } from './time';

export interface NotifyCfg { preStart: { enabled: boolean; minutesBefore: number }; start: { enabled: boolean }; /** loud phone alarm at start (default on) */ alarm?: boolean; end: { enabled: boolean }; overdue: { enabled: boolean; minutesAfterEnd: number } }
export interface User { id: string; email: string | null; name: string; timezone: string; emailVerified: boolean; guest: boolean; hasPassword: boolean }
export interface Settings { theme: 'dark' | 'light' | 'system'; weekStartsOn: number; soundEnabled: boolean; sound: string; reducedMotion: boolean; introSeen: boolean; defaultNotify: NotifyCfg }

interface Ctx {
  user: User | null; settings: Settings | null; loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string, timezone: string): Promise<void>;
  /** No-email start. Returns the one-time recovery code to show the user. */
  startGuest(name: string): Promise<string>;
  recover(code: string): Promise<void>;
  refreshUser(): Promise<void>;
  logout(): Promise<void>;
  updateSettings(p: Partial<Settings>): Promise<void>;
  setUser(u: User): void;
}
const C = createContext<Ctx>(null as never);
export const useAuth = () => useContext(C);

function applyTheme(s: Settings | null) {
  const root = document.documentElement;
  const dark = !s || s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  root.classList.toggle('reduce-motion', !!s?.reducedMotion);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0a0907' : '#faf6ec');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  /** Show the phone's own copy immediately (works offline), then sync with the cloud in the background. */
  const fromLocal = useCallback(() => { setUser(L.get('user')); setSettings(L.get('settings')); }, []);
  const load = useCallback(async () => {
    try {
      await L.load();
      // First run after updating from an older version: tokens but no local copy yet. Needs the internet once.
      if (!L.get('user') && tokens.get()) { try { await hydrate(); } catch { /* offline: stay signed out until online */ } }
      fromLocal();
    } finally { setLoading(false); }
    void syncAll().then(fromLocal);
  }, [fromLocal]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const re = () => void syncAll().then(fromLocal);
    const onVis = () => { if (document.visibilityState === 'visible') re(); };
    addEventListener('online', re); document.addEventListener('visibilitychange', onVis);
    window.addEventListener('cymor:changed', re);
    const t = setInterval(re, 90_000);
    return () => { removeEventListener('online', re); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('cymor:changed', re); clearInterval(t); };
  }, [fromLocal]);
  useEffect(() => { applyTheme(settings); }, [settings]);
  useEffect(() => {
    const out = () => { setUser(null); setSettings(null); };
    authEvents.addEventListener('logout', out);
    return () => authEvents.removeEventListener('logout', out);
  }, []);

  const value = useMemo<Ctx>(() => ({
    user, settings, loading, setUser: (u: User) => { setUser(u); void L.set('user', u); },
    async login(email, password) {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await L.clear(); await hydrate(); fromLocal();
    },
    async startGuest(name) {
      const timezone = deviceTz();
      await L.load();
      try {
        const r = await netApi<{ accessToken: string; refreshToken: string; recoveryCode: string }>('/auth/guest', { method: 'POST', body: { name, timezone }, auth: false });
        tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
        await L.clear(); await hydrate(); fromLocal();
        return r.recoveryCode;
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        // No internet at first launch: start fully on this phone. The cloud account (and recovery code) is created automatically later.
        await L.clear();
        await L.set('user', { id: 'local', email: null, name, timezone, emailVerified: false, guest: true, hasPassword: false });
        await L.set('settings', { theme: 'dark', weekStartsOn: 1, soundEnabled: true, sound: 'chime', reducedMotion: false, introSeen: true, defaultNotify: { preStart: { enabled: true, minutesBefore: 10 }, start: { enabled: true }, alarm: true, end: { enabled: true }, overdue: { enabled: true, minutesAfterEnd: 15 } } });
        await L.set('pendingReg', { name, timezone });
        fromLocal();
        return '';
      }
    },
    async recover(code) {
      const r = await netApi<{ accessToken: string; refreshToken: string }>('/auth/recover', { method: 'POST', body: { recoveryCode: code }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await L.clear(); await hydrate(); fromLocal();
    },
    refreshUser: load,
    async register(name, email, password, timezone) {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/register', { method: 'POST', body: { name, email, password, timezone: timezone || deviceTz() }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await L.clear(); await hydrate(); fromLocal();
    },
    async logout() {
      await syncAll().catch(() => undefined); // push anything still waiting before this phone forgets the account
      await nativeLogout().catch(() => undefined);
      const t = tokens.get();
      if (t) await api('/auth/logout', { method: 'POST', body: { refreshToken: t.refreshToken }, auth: false }).catch(() => undefined);
      await L.clear(); tokens.set(null); setUser(null); setSettings(null);
    },
    async updateSettings(p) {
      setSettings((s) => (s ? { ...s, ...p } : s));
      const r = await api<{ settings: Settings }>('/settings', { method: 'PATCH', body: p });
      setSettings(r.settings);
    },
  }), [user, settings, loading, load, fromLocal]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
