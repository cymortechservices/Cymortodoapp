import { nativeLogout } from './native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, authEvents, tokens } from './api';
import { deviceTz } from './time';

export interface NotifyCfg { preStart: { enabled: boolean; minutesBefore: number }; start: { enabled: boolean }; end: { enabled: boolean }; overdue: { enabled: boolean; minutesAfterEnd: number } }
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
  const [loading, setLoading] = useState(!!tokens.get());

  const load = useCallback(async () => {
    try {
      const [me, st] = await Promise.all([api<{ user: User }>('/auth/me'), api<{ settings: Settings }>('/settings')]);
      setUser(me.user); setSettings(st.settings);
    } catch { /* offline or logged out: stay as-is */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (tokens.get()) void load(); }, [load]);
  useEffect(() => { applyTheme(settings); }, [settings]);
  useEffect(() => {
    const out = () => { setUser(null); setSettings(null); };
    authEvents.addEventListener('logout', out);
    return () => authEvents.removeEventListener('logout', out);
  }, []);

  const value = useMemo<Ctx>(() => ({
    user, settings, loading, setUser,
    async login(email, password) {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await load();
    },
    async startGuest(name) {
      const r = await api<{ accessToken: string; refreshToken: string; recoveryCode: string }>('/auth/guest', { method: 'POST', body: { name, timezone: deviceTz() }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await load();
      return r.recoveryCode;
    },
    async recover(code) {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/recover', { method: 'POST', body: { recoveryCode: code }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await load();
    },
    refreshUser: load,
    async register(name, email, password, timezone) {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/register', { method: 'POST', body: { name, email, password, timezone: timezone || deviceTz() }, auth: false });
      tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await load();
    },
    async logout() {
      await nativeLogout().catch(() => undefined);
      const t = tokens.get();
      if (t) await api('/auth/logout', { method: 'POST', body: { refreshToken: t.refreshToken }, auth: false }).catch(() => undefined);
      tokens.set(null); setUser(null); setSettings(null);
    },
    async updateSettings(p) {
      setSettings((s) => (s ? { ...s, ...p } : s));
      const r = await api<{ settings: Settings }>('/settings', { method: 'PATCH', body: p });
      setSettings(r.settings);
    },
  }), [user, settings, loading, load]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
