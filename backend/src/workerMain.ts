/**
 * Separate always-on worker process. Run it as its own service (Render Background Worker),
 * NOT inside a sleeping free web service: a sleeping process cannot send scheduled pushes.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDb, ensureIndexes, HEARTBEATS, makeJobStore } from './db/connection.js';
import { processBatch } from './core/worker.js';
import { CompositePushProvider, MongoSubscriptionStore } from './services/push.js';
import { mongoPrecondition } from './services/precondition.js';
import { topUpAllReminders } from './services/planner.js';

process.on('unhandledRejection', (e) => console.error('[worker] unhandledRejection', e));
process.on('uncaughtException', (e) => {
  console.error('[worker] uncaughtException, exiting so the platform restarts me', e);
  process.exit(1);
});

const workerId = `w_${randomUUID().slice(0, 8)}`;
const TICK_MS = 5_000;
const TOPUP_MS = 10 * 60_000;

await connectDb(config.MONGODB_URI);
await ensureIndexes({ skipTtl: ['1', 'true'].includes(config.SKIP_TTL_INDEXES) });
const store = makeJobStore();
const deps = { store, push: new CompositePushProvider(), subs: new MongoSubscriptionStore(), precondition: mongoPrecondition, workerId };
let lastTopUp = 0;
let stopping = false;

async function tick() {
  const now = Date.now();
  try {
    if (now - lastTopUp > TOPUP_MS) {
      const n = await topUpAllReminders(now);
      lastTopUp = now;
      if (n) console.log(`[${workerId}] planned ${n} reminder jobs`);
    }
    const s = await processBatch(deps, now);
    if (s.claimed) console.log(`[${workerId}]`, JSON.stringify(s));
    await mongoose.connection.db!.collection(HEARTBEATS).updateOne({ _id: 'worker' } as never, { $set: { at: Date.now(), workerId } }, { upsert: true });
  } catch (e) {
    console.error(`[${workerId}] tick failed`, e);
  }
}

console.log(`worker ${workerId} started`);
const loop = async () => {
  while (!stopping) {
    await tick();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await mongoose.disconnect();
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; });
await loop();
