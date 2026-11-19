import { backoffMs, type JobRecord, type JobStore } from './queue.js';

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  active: boolean;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  jobId: string;
  kind: string;
}

export type PushResult =
  | { ok: true; status: number }
  | { ok: false; status: number; message?: string };

/** Provider abstraction: real impl wraps the `web-push` package; tests use a mock. */
export interface PushProvider {
  send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<PushResult>;
}

export interface SubscriptionStore {
  listActive(userId: string): Promise<PushSubscriptionRecord[]>;
  markExpired(subscriptionId: string, reason: string): Promise<void>;
}

/**
 * Precondition checked at send time. Lets e.g. the overdue job be skipped when the
 * user has already checked out, and lets it build a body with the real overrun.
 */
export type Precondition = (job: JobRecord) => Promise<{ send: true; body?: string } | { send: false; reason: string }>;

export interface WorkerDeps {
  store: JobStore;
  push: PushProvider;
  subs: SubscriptionStore;
  precondition?: Precondition;
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
}

export interface BatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  expired: number;
  skipped: number;
}

/**
 * Process one batch of due jobs. Safe to run from many processes at once:
 * claimDue is atomic, and each job is leased so a crashed worker's jobs are
 * re-claimed after the lease runs out. Future jobs are never loaded.
 */
export async function processBatch(deps: WorkerDeps, now: number): Promise<BatchSummary> {
  const { store, push, subs, workerId } = deps;
  const maxAttempts = deps.maxAttempts ?? 5;
  const summary: BatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, expired: 0, skipped: 0 };

  const jobs = await store.claimDue(now, deps.batchSize ?? 50, workerId, deps.leaseMs ?? 60_000);
  summary.claimed = jobs.length;

  for (const job of jobs) {
    const base = { jobId: job.id, userId: job.userId, at: now };

    if (now > job.expiresAt) {
      await store.update(job.id, { status: 'expired', reason: 'stale', lockedBy: undefined, leaseUntil: undefined }, now);
      await store.addLog({ ...base, outcome: 'expired', message: `fireAt ${job.fireAt} exceeded expiresAt ${job.expiresAt}` });
      summary.expired++;
      continue;
    }

    let body = job.body;
    if (deps.precondition) {
      const pre = await deps.precondition(job);
      if (!pre.send) {
        await store.update(job.id, { status: 'skipped', reason: pre.reason, lockedBy: undefined, leaseUntil: undefined }, now);
        await store.addLog({ ...base, outcome: 'skipped', message: pre.reason });
        summary.skipped++;
        continue;
      }
      if (pre.body) body = pre.body;
    }

    const targets = await subs.listActive(job.userId);
    if (targets.length === 0) {
      await store.update(job.id, { status: 'failed', reason: 'no_active_subscription', lockedBy: undefined, leaseUntil: undefined }, now);
      await store.addLog({ ...base, outcome: 'no_subscription' });
      summary.failed++;
      continue;
    }

    let accepted = 0;
    let transient = 0;
    let lastError: string | undefined;

    for (const sub of targets) {
      let res: PushResult;
      try {
        res = await push.send(sub, { title: job.title, body, url: job.url, jobId: job.id, kind: job.kind });
      } catch (e) {
        res = { ok: false, status: 0, message: (e as Error).message };
      }
      if (res.ok) {
        accepted++;
        await store.addLog({ ...base, subscriptionId: sub.id, outcome: 'accepted', httpStatus: res.status });
      } else if (res.status === 404 || res.status === 410) {
        await subs.markExpired(sub.id, `push service returned ${res.status}`);
        await store.addLog({ ...base, subscriptionId: sub.id, outcome: 'subscription_gone', httpStatus: res.status });
      } else if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 413) {
        lastError = `permanent ${res.status}`;
        await store.addLog({ ...base, subscriptionId: sub.id, outcome: 'permanent_error', httpStatus: res.status, message: res.message });
      } else {
        transient++;
        lastError = `transient ${res.status} ${res.message ?? ''}`.trim();
        await store.addLog({ ...base, subscriptionId: sub.id, outcome: 'transient_error', httpStatus: res.status, message: res.message });
      }
    }

    const clear = { lockedBy: undefined, leaseUntil: undefined };
    if (accepted > 0) {
      // Accepted by the push provider. NOT "delivered".
      await store.update(job.id, { status: 'sent_to_provider', sentAt: now, attempts: job.attempts + 1, ...clear }, now);
      summary.sent++;
    } else if (transient > 0 && job.attempts + 1 < maxAttempts) {
      const retryAt = now + backoffMs(job.attempts + 1);
      await store.update(job.id, { status: 'retry', attempts: job.attempts + 1, fireAt: retryAt, lastError, ...clear }, now);
      summary.retried++;
    } else {
      await store.update(
        job.id,
        { status: 'failed', attempts: job.attempts + 1, lastError: lastError ?? 'all subscriptions expired', ...clear },
        now,
      );
      summary.failed++;
    }
  }
  return summary;
}
