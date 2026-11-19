/**
 * MongoDB implementation of the JobStore contract (core/queue.ts).
 *
 * Verified (tests/mongoStore.test.ts) against FerretDB, a MongoDB-compatible server, incl.
 * three racing workers. NOT yet run against Atlas itself: run `npm run test:mongo` with an
 * Atlas test URI. Crash recovery comes from the lease: a job stuck in `processing`
 * with leaseUntil < now is eligible to be claimed again.
 */
import type { JobRecord, JobStore, LogRecord } from '../core/queue.js';
import type { NotificationJobDraft } from '../core/notificationPlan.js';

/** Subset of the official `mongodb` Collection API that we use. */
export interface MiniCollection<T> {
  insertOne(doc: T): Promise<unknown>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount?: number; modifiedCount?: number }>;
  findOne(filter: Record<string, unknown>, options?: { sort?: Record<string, 1 | -1> }): Promise<T | null>;
}

/** Index definitions to create at startup (also documented in docs/ARCHITECTURE.md). */
export const NOTIFICATION_JOB_INDEXES = [
  { key: { idempotencyKey: 1 }, unique: true, name: 'uniq_idempotency' },
  { key: { status: 1, fireAt: 1 }, name: 'due_scan' },
  { key: { status: 1, leaseUntil: 1 }, name: 'lease_recovery' },
  { key: { userId: 1, fireAt: -1 }, name: 'user_history' },
  // Keep history for 90 days, then let Mongo remove it. Delete only terminal jobs via a partial index.
  {
    key: { updatedAt: 1 },
    name: 'ttl_terminal_90d',
    expireAfterSeconds: 90 * 24 * 3600,
    partialFilterExpression: { status: { $in: ['sent_to_provider', 'delivered', 'opened', 'expired', 'skipped', 'failed'] } },
  },
] as const;

export class MongoJobStore implements JobStore {
  constructor(
    private jobs: MiniCollection<JobRecord & { _id?: string }>,
    private logs: MiniCollection<LogRecord>,
    private claims: MiniCollection<Record<string, unknown>>,
    private newId: () => string,
  ) {}

  async insert(draft: NotificationJobDraft, now: number): Promise<boolean> {
    try {
      await this.jobs.insertOne({ ...draft, id: this.newId(), status: 'pending', attempts: 0, createdAt: now, updatedAt: now });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false; // duplicate idempotencyKey
      throw e;
    }
  }

  /**
   * Fenced claim. Each job carries a generation counter `claimGen`. To claim a job a worker
   * first inserts {_id: "<jobId>:<gen>"} into the claims collection. _id is unique, and a
   * unique-key insert is atomic on every MongoDB-compatible engine, so of N racing workers
   * exactly ONE insert succeeds per (job, generation); the rest get a duplicate-key error and
   * move on. Only the winner then flips the job to `processing` and bumps `claimGen`, which
   * also opens a fresh generation for lease recovery / retries.
   *
   * This deliberately does not rely on findOneAndUpdate or conditional-update atomicity: against
   * FerretDB both double-claimed jobs under concurrency (see docs/STATUS.md).
   */
  async claimDue(now: number, limit: number, workerId: string, leaseMs: number): Promise<JobRecord[]> {
    const dueFilter = {
      $or: [
        { status: { $in: ['pending', 'retry'] }, fireAt: { $lte: now } },
        { status: 'processing', leaseUntil: { $lt: now } },
      ],
    };
    const claimed: JobRecord[] = [];
    let losses = 0;
    while (claimed.length < limit && losses < limit * 4 + 20) {
      const cand = await this.jobs.findOne(dueFilter, { sort: { fireAt: 1 } });
      if (!cand) break;
      const gen = (cand as { claimGen?: number }).claimGen ?? 0;
      try {
        await this.claims.insertOne({ _id: `${cand.id}:${gen}`, jobId: cand.id, gen, workerId, at: now });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) {
          losses++; // another worker owns this generation
          continue;
        }
        throw e;
      }
      await this.jobs.updateOne(
        { id: cand.id },
        { $set: { status: 'processing', lockedBy: workerId, leaseUntil: now + leaseMs, updatedAt: now, claimGen: gen + 1 } },
      );
      const mine = await this.jobs.findOne({ id: cand.id });
      if (mine) claimed.push(mine);
    }
    return claimed;
  }

  async update(id: string, patch: Partial<JobRecord>, now: number): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: now };
    const unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) unset[k] = '';
      else set[k] = v;
    }
    await this.jobs.updateOne({ id }, Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set });
  }

  async addLog(log: LogRecord): Promise<void> {
    await this.logs.insertOne(log);
  }
  async get(id: string) {
    return (await this.jobs.findOne({ id })) ?? undefined;
  }
  async findByKey(key: string) {
    return (await this.jobs.findOne({ idempotencyKey: key })) ?? undefined;
  }
}
