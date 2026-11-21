/** API client: bearer auth with single-flight refresh, plus an offline queue for session actions. */
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
      if (!r.ok) { tokens.set(null); authEvents.dispatchEvent(new Event('logout')); return false; }
      const b = await r.json();
      tokens.set({ accessToken: b.accessToken, refreshToken: b.refreshToken });
      return true;
    } catch { return false; } // offline: keep tokens, try later
    finally { refreshing = null; }
  })();
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData; auth?: boolean; raw?: boolean } = {}): Promise<T> {
  const doFetch = () => {
    const h: Record<string, string> = {};
    if (!opts.form) h['content-type'] = 'application/json';
    const t = tokens.get();
    if (opts.auth !== false && t) h.authorization = `Bearer ${t.accessToken}`;
    return fetch(`${BASE}/api${path}`, { method: opts.method ?? 'GET', headers: h, body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  };
  let res: Response;
  try { res = await doFetch(); } catch { throw new NetworkError('Network unavailable'); }
  if (res.status === 401 && opts.auth !== false && (await refresh())) {
    try { res = await doFetch(); } catch { throw new NetworkError('Network unavailable'); }
  }
  if (res.ok && opts.method && opts.method !== 'GET' && !path.startsWith('/auth') && !path.startsWith('/notifications/native')) window.dispatchEvent(new Event('cymor:changed'));
  if (opts.raw) return res as unknown as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Request failed (${res.status})`, data.issues);
  return data as T;
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
