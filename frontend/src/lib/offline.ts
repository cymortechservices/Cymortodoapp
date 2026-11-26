/** Thin helpers over the on-phone database. Session actions (check-in, pause ...) go through api() and are queued automatically. */
import { api } from './api';
import { L } from './localdb';
import { syncAll } from './sync';

export const pendingCount = async () => { await L.load(); return L.get('ops').length; };
export const flushQueue = () => syncAll();

/** Check in / pause / check out ... Always succeeds locally with the REAL time; `queued` says it still has to reach the cloud. */
export async function sessionAction(activityId: string, action: string, extra: { reason?: string; endedByInterruption?: boolean } = {}): Promise<{ queued: boolean }> {
  await api(`/activities/${activityId}/${action}`, { method: 'POST', body: { at: Date.now(), ...extra } });
  return { queued: (await pendingCount()) > 0 };
}

/** Tiny read-cache (kept for screens that remember their last view). */
export const cache = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem('cymor.cache.' + k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem('cymor.cache.' + k, JSON.stringify(v)); } catch { /* quota */ } },
};
