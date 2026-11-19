/**
 * Offline queue for session actions (check-in, pause, check-out ...).
 * Each action is stored with the ORIGINAL time it happened (`at`) so replaying later
 * records the true time, not the sync time. The server rejects future timestamps and
 * invalid state transitions; those are surfaced as conflicts, never silently dropped.
 */
import { api, ApiError, NetworkError } from './api';

export interface QueuedAction { id?: number; activityId: string; action: string; at: number; reason?: string; endedByInterruption?: boolean }
export interface Conflict { action: QueuedAction; message: string }

const DB = 'cymor-todo', STORE = 'queue';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((res, rej) => { const r = fn(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
};

export const enqueue = (a: QueuedAction) => tx('readwrite', (s) => s.add(a));
export const pending = () => tx<QueuedAction[]>('readonly', (s) => s.getAll());
export const clearOne = (id: number) => tx('readwrite', (s) => s.delete(id));
export const pendingCount = async () => (await pending()).length;

export interface FlushResult { sent: number; conflicts: Conflict[]; remaining: number }

/** Replay in order. Stops at the first network failure (order matters); conflicts are dropped but reported. */
export async function flushQueue(send: (a: QueuedAction) => Promise<unknown> = defaultSend): Promise<FlushResult> {
  const items = (await pending()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const out: FlushResult = { sent: 0, conflicts: [], remaining: items.length };
  for (const it of items) {
    try {
      await send(it);
      await clearOne(it.id!);
      out.sent++; out.remaining--;
    } catch (e) {
      if (e instanceof NetworkError) break;
      if (e instanceof ApiError && (e.status >= 400 && e.status < 500) && e.status !== 401 && e.status !== 429) {
        await clearOne(it.id!);
        out.conflicts.push({ action: it, message: e.message });
        out.remaining--;
      } else break; // 5xx / auth trouble: keep and retry later
    }
  }
  return out;
}

const defaultSend = (a: QueuedAction) => api(`/activities/${a.activityId}/${a.action}`, { method: 'POST', body: { at: a.at, reason: a.reason, endedByInterruption: a.endedByInterruption } });

/** Try online first; on network failure queue it with the real timestamp. */
export async function sessionAction(activityId: string, action: string, extra: { reason?: string; endedByInterruption?: boolean } = {}): Promise<{ queued: boolean }> {
  const at = Date.now();
  try {
    await api(`/activities/${activityId}/${action}`, { method: 'POST', body: { at, ...extra } });
    return { queued: false };
  } catch (e) {
    if (e instanceof NetworkError) { await enqueue({ activityId, action, at, ...extra }); return { queued: true }; }
    throw e;
  }
}

/** Tiny read-cache so the schedule is still visible offline. */
export const cache = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem('cymor.cache.' + k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem('cymor.cache.' + k, JSON.stringify(v)); } catch { /* quota */ } },
};
