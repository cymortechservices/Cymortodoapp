import mongoose from 'mongoose';
import './models.js'; // register every model so ensureIndexes() sees them
import { randomUUID } from 'node:crypto';
import { MongoJobStore, NOTIFICATION_JOB_INDEXES } from '../infra/mongoJobStore.js';
import type { JobRecord } from '../core/queue.js';

export const JOBS = 'notificationjobs';
export const LOGS = 'notificationlogs';
export const CLAIMS = 'notificationjobclaims';
export const HEARTBEATS = 'workerheartbeats';

export async function connectDb(uri: string, dbName?: string): Promise<void> {
  // Indexes are created explicitly (and only when missing) by ensureIndexes(), not implicitly on every process start.
  mongoose.set('autoIndex', false);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, ...(dbName ? { dbName } : {}) });
}

export function jobsCol() {
  return mongoose.connection.db!.collection<JobRecord>(JOBS);
}
export function logsCol() {
  return mongoose.connection.db!.collection(LOGS);
}

export function makeJobStore(): MongoJobStore {
  const db = mongoose.connection.db!;
  return new MongoJobStore(db.collection(JOBS) as never, db.collection(LOGS) as never, db.collection(CLAIMS) as never, () => randomUUID());
}

/**
 * Create only the indexes that are missing, so the API and the worker can both call this at startup
 * (and re-run on every deploy) without re-issuing createIndex for indexes that already exist.
 */
export async function ensureIndexes(opts: { skipTtl?: boolean } = {}): Promise<void> {
  const skip = (e: unknown) => !!opts.skipTtl && /expireAfterSeconds/.test(String(e));
  for (const mdl of Object.values(mongoose.models)) {
    const { toCreate } = await mdl.diffIndexes().catch(() => ({ toCreate: [{}] }));
    if (!toCreate.length) continue;
    for (let attempt = 0; ; attempt++) {
      try { await mdl.createIndexes(); break; }
      catch (e) {
        if (skip(e)) break;
        // An index from an older version has the same name but different options (e.g. users.email became sparse in V1.1).
        // Drop just that index and build it again; data is untouched.
        const code = (e as { code?: number }).code;
        const name = /existing index:.*?name: "([^"]+)"/.exec(String((e as Error).message))?.[1];
        if ((code === 85 || code === 86) && name && attempt < 6) {
          console.warn(`Rebuilding index ${mdl.collection.name}.${name} (options changed)`);
          await mdl.collection.dropIndex(name);
        } else throw e;
      }
    }
  }
  const db = mongoose.connection.db!;
  const missing = async (col: string, wanted: { name: string }[]) => {
    const have = new Set((await db.collection(col).indexes().catch(() => [])).map((i) => i.name));
    return wanted.filter((w) => !have.has(w.name));
  };
  const jobIdx = NOTIFICATION_JOB_INDEXES.filter((i) => !(opts.skipTtl && 'expireAfterSeconds' in i)).map((i) => ({ ...i }));
  const jm = await missing(JOBS, jobIdx);
  if (jm.length) await db.collection(JOBS).createIndexes(jm as never);
  const lm = await missing(LOGS, [{ name: 'log_user' }]);
  if (lm.length) await db.collection(LOGS).createIndexes([{ key: { userId: 1, at: -1 }, name: 'log_user' }] as never);
  if (!opts.skipTtl) {
    const cm = await missing(CLAIMS, [{ name: 'claims_ttl' }]);
    if (cm.length) await db.collection(CLAIMS).createIndexes([{ key: { at: 1 }, name: 'claims_ttl', expireAfterSeconds: 7 * 24 * 3600 }] as never);
  }
}
