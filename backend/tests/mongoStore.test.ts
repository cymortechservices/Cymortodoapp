// Runs only when MONGO_TEST_URI is set (e.g. a local mongod / FerretDB / Atlas test DB).
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoJobStore, NOTIFICATION_JOB_INDEXES } from '../src/infra/mongoJobStore.js';
import type { NotificationJobDraft } from '../src/core/notificationPlan.js';
import { randomUUID } from 'node:crypto';

const uri = process.env.MONGO_TEST_URI;
const draft = (i: number): NotificationJobDraft => ({
  userId: 'u1', kind: 'start', sourceId: `a${i}`, fireAt: 1000 + i, expiresAt: 10_000_000,
  idempotencyKey: `start:a${i}:${1000 + i}`, title: 't', body: 'b', url: '/',
});

test('MongoJobStore: dedupe, due-only claim, concurrent workers never double-claim, lease recovery', { skip: !uri }, async () => {
  await mongoose.connect(uri!, { dbName: `jobstore_${randomUUID().slice(0, 8)}` });
  const db = mongoose.connection.db!;
  const jobs = db.collection('jobs');
  // FerretDB (used for local verification) lacks TTL indexes; real MongoDB/Atlas has them.
  const idx = NOTIFICATION_JOB_INDEXES.filter((i) => !(process.env.MONGO_TEST_NO_TTL && 'expireAfterSeconds' in i));
  await jobs.createIndexes(idx.map((i) => ({ ...i })) as never);
  const store = new MongoJobStore(jobs as never, db.collection('logs') as never, db.collection('claims') as never, () => randomUUID());

  assert.equal(await store.insert(draft(1), 0), true);
  assert.equal(await store.insert(draft(1), 0), false, 'duplicate idempotencyKey rejected');
  for (let i = 2; i <= 40; i++) await store.insert(draft(i), 0);
  await store.insert({ ...draft(99), fireAt: 9_999_999, idempotencyKey: 'future' }, 0);

  const results = await Promise.all(['w1', 'w2', 'w3', 'w4'].map((w) => store.claimDue(5000, 40, w, 60_000)));
  const all = results.flat();
  const ids = all.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length, `no job claimed twice across 4 racing workers (got ${ids.length})`);
  assert.equal(ids.length, 40, 'all 40 due jobs claimed');
  assert.ok(!all.some((j) => j.idempotencyKey === 'future'), 'future job untouched');

  // crashed worker: lease expires => re-claimable
  assert.equal((await store.claimDue(5000, 10, 'w4', 60_000)).length, 0);
  assert.equal((await store.claimDue(5000 + 60_001, 100, 'w4', 60_000)).length, 40);
  await db.dropDatabase();
  await mongoose.disconnect();
});
