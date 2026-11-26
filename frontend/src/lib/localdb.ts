/**
 * On-phone database (IndexedDB) so the app works with no internet at all.
 * One key/value store; values are small JSON documents. A write-through memory copy keeps reads synchronous after load().
 */
import type { NotifyCfg, Settings, User } from './auth';
import type { ReminderSpec } from '../core/recurrence';

export interface RawActivity {
  id: string; title: string; description?: string; category: string; color: string; location?: string;
  startUtc: number; endUtc: number; cancelled: boolean; notify: NotifyCfg; seriesId?: string;
  checkInAt?: number | null; checkOutAt?: number | null;
  pauses: { start: number; end?: number | null }[]; interruptions: { start: number; end?: number | null; reason?: string }[];
  markedMissed?: boolean; endedByInterruption?: boolean;
}
export interface RawReminder { id: string; title: string; description?: string; spec: ReminderSpec; active: boolean; latePolicy: string; maxLateMinutes: number }
export interface Op { id: number; method: string; path: string; body?: unknown; queuedAt: number }

export interface Schema {
  user: User | null; settings: Settings | null; acts: RawActivity[]; rems: RawReminder[]; ops: Op[];
  idmap: Record<string, string>; opSeq: number; lastSync: number;
  pendingReg: { name: string; timezone: string } | null; recoveryToShow: string | null; authLost: boolean;
}
const DEFAULTS: Schema = { user: null, settings: null, acts: [], rems: [], ops: [], idmap: {}, opSeq: 0, lastSync: 0, pendingReg: null, recoveryToShow: null, authLost: false };

const DB = 'cymor-local', STORE = 'kv';
let mem: Schema = structuredClone(DEFAULTS);
let loaded: Promise<void> | null = null;
let version = 0;
let chain: Promise<unknown> = Promise.resolve();

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll(): Promise<Partial<Schema>> {
  const db = await open();
  return new Promise((res, rej) => {
    const out: Record<string, unknown> = {};
    const q = db.transaction(STORE).objectStore(STORE).openCursor();
    q.onsuccess = () => { const c = q.result; if (c) { out[String(c.key)] = c.value; c.continue(); } else res(out as Partial<Schema>); };
    q.onerror = () => rej(q.error);
  });
}
async function idbPut(k: string, v: unknown): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export const L = {
  /** Must be awaited once before any get(). */
  load(): Promise<void> {
    loaded ??= idbAll().then((all) => { mem = { ...structuredClone(DEFAULTS), ...all }; }).catch(() => { mem = structuredClone(DEFAULTS); });
    return loaded;
  },
  get<K extends keyof Schema>(k: K): Schema[K] { return mem[k]; },
  /** Counter that changes on every write: lets a background refresh detect that the user changed something meanwhile. */
  version: () => version,
  set<K extends keyof Schema>(k: K, v: Schema[K]): Promise<void> {
    mem[k] = v; version++;
    chain = chain.then(() => idbPut(k, v)).catch(() => undefined);
    return chain as Promise<void>;
  },
  async clear(): Promise<void> {
    mem = structuredClone(DEFAULTS); version++;
    for (const k of Object.keys(DEFAULTS)) await L.set(k as keyof Schema, DEFAULTS[k as keyof Schema] as never);
  },
  /** test helper */
  async reset() { loaded = null; await L.clear(); loaded = Promise.resolve(); },
};

export const newId = () => `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const isLocalId = (id: string) => /^L[a-z0-9]{8,}$/.test(id);
