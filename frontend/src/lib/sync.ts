/** Cloud sync: pushes the phone's queued changes to the server, then refreshes the local copy. Never blocks the UI. */
import { ApiError, netApi, NetworkError, tokens } from './api';
import { L, isLocalId, type RawActivity, type RawReminder } from './localdb';
import type { Settings, User } from './auth';
import { addDays, localDate } from '../core/time';

export interface Conflict { message: string; path: string }
export interface SyncResult { sent: number; conflicts: Conflict[]; remaining: number; offline: boolean }

const resolve = (s: string) => s.replace(/L[a-z0-9]{8,}/g, (x) => L.get('idmap')[x] ?? x);

/** Create the cloud account for a phone that started offline. Returns the recovery code. */
async function registerPending(): Promise<void> {
  const reg = L.get('pendingReg');
  if (!reg || tokens.get()) return;
  const r = await netApi<{ accessToken: string; refreshToken: string; recoveryCode: string }>('/auth/guest', { method: 'POST', body: { name: reg.name, timezone: reg.timezone }, auth: false });
  tokens.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
  await L.set('recoveryToShow', r.recoveryCode);
  await L.set('pendingReg', null);
}

/** Replay queued changes in order. Stops at the first network failure; rejected (4xx) changes are dropped and reported. */
export async function flushOps(send: (method: string, path: string, body: unknown) => Promise<unknown> = (m, p, b) => netApi(p, { method: m, body: b })): Promise<SyncResult> {
  const out: SyncResult = { sent: 0, conflicts: [], remaining: L.get('ops').length, offline: false };
  while (L.get('ops').length) {
    const op = L.get('ops')[0]!;
    const path = resolve(op.path);
    try {
      const r = await send(op.method, path, op.body) as { activity?: { id?: string } } | undefined;
      // Remember which server id a phone-made activity received, so later changes to it find the right record.
      if (op.method === 'POST' && op.path === '/activities' && (op.body as { clientId?: string })?.clientId && r?.activity?.id) {
        const cid = (op.body as { clientId: string }).clientId;
        await L.set('idmap', { ...L.get('idmap'), [cid]: r.activity.id });
        await L.set('acts', L.get('acts').map((a) => (a.id === cid ? { ...a, id: r.activity!.id! } : a)));
      }
      out.sent++;
    } catch (e) {
      if (e instanceof NetworkError) { out.offline = true; break; }
      if (e instanceof ApiError && e.status === 401) { await L.set('authLost', true); out.offline = true; break; }
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) out.conflicts.push({ message: e.message, path: op.path });
      else break; // 5xx / rate limited: keep it and retry later
    }
    await L.set('ops', L.get('ops').slice(1));
  }
  out.remaining = L.get('ops').length;
  return out;
}

/** Replace the local copy with the server's (only when nothing is waiting to upload and nothing changed meanwhile). */
export async function hydrate(): Promise<boolean> {
  if (L.get('ops').length || !tokens.get()) return false;
  const v = L.version();
  const me = await netApi<{ user: User }>('/auth/me');
  const user = me.user;
  const today = localDate(Date.now(), user.timezone);
  const [st, ac, rm] = await Promise.all([
    netApi<{ settings: Settings }>('/settings'),
    netApi<{ activities: (RawActivity & { result?: unknown; localDate?: string })[] }>(`/activities?from=${addDays(today, -120)}&to=${addDays(today, 180)}`),
    netApi<{ reminders: (RawReminder & { next?: unknown })[] }>('/reminders'),
  ]);
  if (L.version() !== v || L.get('ops').length) return false; // user changed something while we were fetching: try again next time
  await L.set('user', user);
  await L.set('settings', st.settings);
  await L.set('acts', ac.activities.map(({ result: _r, localDate: _l, ...a }) => a as RawActivity));
  await L.set('rems', rm.reminders.map(({ next: _n, ...r }) => r as RawReminder));
  await L.set('idmap', {});
  await L.set('lastSync', Date.now());
  await L.set('authLost', false);
  return true;
}

let running: Promise<SyncResult> | null = null;
/** Register (if needed) -> upload queue -> download fresh copy. Single-flight, safe to call from anywhere. */
export function syncAll(): Promise<SyncResult> {
  running ??= (async () => {
    let res: SyncResult = { sent: 0, conflicts: [], remaining: L.get('ops').length, offline: false };
    try {
      if (!navigator.onLine) return { ...res, offline: true };
      await registerPending();
      if (!tokens.get()) return res;
      res = await flushOps();
      if (!res.offline && !res.remaining) { await hydrate(); if (typeof window !== 'undefined') window.dispatchEvent(new Event('cymor:refresh')); }
    } catch (e) {
      if (e instanceof NetworkError) res.offline = true;
    } finally { if (typeof window !== 'undefined') window.dispatchEvent(new Event('cymor:synced')); }
    return res;
  })().finally(() => { running = null; });
  return running;
}

export { isLocalId };
