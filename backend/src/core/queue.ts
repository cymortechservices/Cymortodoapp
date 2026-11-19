import type { NotificationJobDraft } from './notificationPlan.js';
import { MIN } from './time.js';

/**
 * Job lifecycle. Note there is deliberately NO "delivered" state for push:
 * a push service accepting a request only proves it was handed to the provider.
 * "delivered"/"opened" may only be set from a client acknowledgement.
 */
export type JobStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'sent_to_provider'
  | 'delivered' // client-acknowledged only
  | 'opened' // client-acknowledged only
  | 'expired' // too late to be useful (recorded, never silently dropped)
  | 'skipped' // precondition said it no longer applies
  | 'failed';

export interface JobRecord extends NotificationJobDraft {
  id: string;
  status: JobStatus;
  attempts: number;
  lockedBy?: string;
  leaseUntil?: number;
  lastError?: string;
  reason?: string;
  sentAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface LogRecord {
  jobId: string;
  userId: string;
  subscriptionId?: string;
  at: number;
  outcome: 'accepted' | 'subscription_gone' | 'transient_error' | 'permanent_error' | 'no_subscription' | 'expired' | 'skipped';
  httpStatus?: number;
  message?: string;
}

/**
 * Storage contract. The MongoDB implementation (infra/mongoJobStore.ts) maps
 * claimDue onto findOneAndUpdate with the same filter/update semantics.
 */
export interface JobStore {
  /** Insert if idempotencyKey is new. Returns true when inserted, false when a duplicate. */
  insert(draft: NotificationJobDraft, now: number): Promise<boolean>;
  /**
   * ATOMICALLY claim up to `limit` due jobs for `workerId`.
   * Due = (status pending|retry AND fireAt<=now) OR (status processing AND leaseUntil<now),
   * the latter recovering jobs whose worker crashed mid-send.
   */
  claimDue(now: number, limit: number, workerId: string, leaseMs: number): Promise<JobRecord[]>;
  update(id: string, patch: Partial<JobRecord>, now: number): Promise<void>;
  addLog(log: LogRecord): Promise<void>;
  get(id: string): Promise<JobRecord | undefined>;
  findByKey(key: string): Promise<JobRecord | undefined>;
}

export function backoffMs(attempt: number, baseMs = 30_000, capMs = 30 * MIN): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export class InMemoryJobStore implements JobStore {
  jobs = new Map<string, JobRecord>();
  keys = new Map<string, string>();
  logs: LogRecord[] = [];
  private seq = 0;

  async insert(d: NotificationJobDraft, now: number): Promise<boolean> {
    if (this.keys.has(d.idempotencyKey)) return false; // unique index equivalent
    const id = `job_${++this.seq}`;
    this.jobs.set(id, { ...d, id, status: 'pending', attempts: 0, createdAt: now, updatedAt: now });
    this.keys.set(d.idempotencyKey, id);
    return true;
  }

  // Synchronous body => atomic with respect to other awaiting workers.
  async claimDue(now: number, limit: number, workerId: string, leaseMs: number): Promise<JobRecord[]> {
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          ((j.status === 'pending' || j.status === 'retry') && j.fireAt <= now) ||
          (j.status === 'processing' && (j.leaseUntil ?? 0) < now),
      )
      .sort((a, b) => a.fireAt - b.fireAt)
      .slice(0, limit);
    for (const j of due) {
      j.status = 'processing';
      j.lockedBy = workerId;
      j.leaseUntil = now + leaseMs;
      j.updatedAt = now;
    }
    return due.map((j) => ({ ...j }));
  }

  async update(id: string, patch: Partial<JobRecord>, now: number): Promise<void> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job ${id} not found`);
    Object.assign(j, patch, { updatedAt: now });
  }
  async addLog(log: LogRecord): Promise<void> {
    this.logs.push(log);
  }
  async get(id: string) {
    const j = this.jobs.get(id);
    return j ? { ...j } : undefined;
  }
  async findByKey(key: string) {
    const id = this.keys.get(key);
    return id ? this.get(id) : undefined;
  }
}
