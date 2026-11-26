/** API client: bearer auth with single-flight refresh. Core routes are answered by the on-phone database first (local-first), see localApi.ts. */
import { localRoute, NOT_LOCAL } from './localApi';
import { L } from './localdb';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const KEY = 'cymor.tokens';

export interface Tokens { accessToken: string; refreshToken: string }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: { path: string; message: string }[]) { super(message); }
}
export class NetworkError extends Error {}

export const tokens = {
  get(): Tokens | null { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } },
  set(t: Tokens | null) { try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};
export const authEvents = new EventTarget();

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const t = tokens.get();
  if (!t) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
      if (!r.ok) {
        tokens.set(null);
        // A signed-in phone keeps working offline from its own data; only cloud sync pauses.
        if (L.get('user')) void L.set('authLost', true); else authEvents.dispatchEvent(new Event('logout'));
        return false;
      }
      const b = await r.json();
      tokens.set({ accessToken: b.accessToken, refreshToken: b.refreshToken });
      return true;
    } catch { return false; } // offline: keep tokens, try later
    finally { refreshing = null; }
  })();
  return refreshing;
}

const TIMEOUT_MS = 20_000;
const readCache = {
  get(k: string): unknown { try { const v = localStorage.getItem('cymor.get.' + k); return v ? JSON.parse(v) : undefined; } catch { return undefined; } },
  set(k: string, v: unknown) { try { localStorage.setItem('cymor.get.' + k, JSON.stringify(v)); } catch { /* quota */ } },
};

type Opts = { method?: string; body?: unknown; form?: FormData; auth?: boolean; raw?: boolean };

/** Talks to the server only. Used by the sync engine and for routes that need the internet. */
export async function netApi<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const doFetch = () => {
    const h: Record<string, string> = {};
    if (!opts.form) h['content-type'] = 'application/json';
    const t = tokens.get();
    if (opts.auth !== false && t) h.authorization = `Bearer ${t.accessToken}`;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    return fetch(`${BASE}/api${path}`, { method: opts.method ?? 'GET', headers: h, signal: ctl.signal, body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }).finally(() => clearTimeout(timer));
  };
  let res: Response;
  try { res = await doFetch(); } catch { throw new NetworkError('No internet connection'); }
  if (res.status === 401 && opts.auth !== false && (await refresh())) {
    try { res = await doFetch(); } catch { throw new NetworkError('No internet connection'); }
  }
  if (opts.raw) return res as unknown as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Request failed (${res.status})`, data.issues);
  return data as T;
}

/**
 * The app's API. Order: (1) core routes are served from the phone's own database, instantly and offline;
 * (2) anything else goes to the server, and GETs fall back to the last good copy when there is no internet.
 */
export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (opts.auth !== false && !opts.form && !opts.raw) {
    const local = await localRoute(method, path, opts.body);
    if (local !== NOT_LOCAL) {
      if (method !== 'GET' && typeof window !== 'undefined') window.dispatchEvent(new Event('cymor:changed'));
      return local as T;
    }
  }
  try {
    const r = await netApi<T>(path, opts);
    if (method === 'GET' && opts.auth !== false && !opts.raw) readCache.set(path, r);
    return r;
  } catch (e) {
    if (e instanceof NetworkError) {
      if (method === 'GET' && !opts.raw) { const c = readCache.get(path); if (c !== undefined) return c as T; }
      throw new NetworkError(method === 'GET' ? 'No internet connection and nothing saved for this screen yet.' : 'This needs an internet connection.');
    }
    throw e;
  }
}

/** Download an authenticated file (CSV/ICS/PDF/JSON). */
export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) throw new ApiError(res.status, 'error', 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? (e.issues?.length ? `${e.message}: ${e.issues.map((i) => `${i.path} ${i.message}`).join(', ')}` : e.message) : e instanceof Error ? e.message : 'Something went wrong');
