import { MIN } from './time.js';

export type JobKind = 'pre_start' | 'start' | 'end' | 'overdue' | 'reminder';

export type LatePolicy = 'send' | 'expire';

export interface NotificationJobDraft {
  userId: string;
  kind: JobKind;
  /** activity id or reminder id */
  sourceId: string;
  fireAt: number;
  /** after this instant the job is no longer useful and is marked expired (never silently dropped). */
  expiresAt: number;
  idempotencyKey: string;
  title: string;
  body: string;
  /** deep link opened when the notification is clicked */
  url: string;
}

export interface ActivityNotifyConfig {
  preStart: { enabled: boolean; minutesBefore: number };
  start: { enabled: boolean };
  end: { enabled: boolean };
  overdue: { enabled: boolean; minutesAfterEnd: number };
}

export const DEFAULT_ACTIVITY_NOTIFY: ActivityNotifyConfig = {
  preStart: { enabled: true, minutesBefore: 10 },
  start: { enabled: true },
  end: { enabled: true },
  overdue: { enabled: true, minutesAfterEnd: 15 },
};

/** How long after fireAt a job is still worth sending, per kind. */
export const DEFAULT_STALE_AFTER_MIN: Record<JobKind, number> = {
  pre_start: 5,
  start: 10,
  end: 15,
  overdue: 60,
  reminder: 15,
};

export interface ActivityForPlan {
  id: string;
  userId: string;
  title: string;
  startUtc: number;
  endUtc: number;
}

export function idempotencyKey(kind: JobKind, sourceId: string, fireAt: number): string {
  return `${kind}:${sourceId}:${fireAt}`;
}

/**
 * Build the notification jobs for one activity. Pure: persistence happens elsewhere,
 * using a unique index on idempotencyKey so re-planning never creates duplicates.
 */
export function planActivityJobs(
  a: ActivityForPlan,
  cfg: ActivityNotifyConfig = DEFAULT_ACTIVITY_NOTIFY,
  staleAfterMin: Record<JobKind, number> = DEFAULT_STALE_AFTER_MIN,
): NotificationJobDraft[] {
  if (a.endUtc <= a.startUtc) throw new Error('Activity end must be after start');
  const url = `/planner?activity=${encodeURIComponent(a.id)}`;
  const jobs: NotificationJobDraft[] = [];

  const push = (kind: JobKind, fireAt: number, title: string, body: string, expiresAt?: number) => {
    jobs.push({
      userId: a.userId,
      kind,
      sourceId: a.id,
      fireAt,
      expiresAt: expiresAt ?? fireAt + staleAfterMin[kind] * MIN,
      idempotencyKey: idempotencyKey(kind, a.id, fireAt),
      title,
      body,
      url,
    });
  };

  if (cfg.preStart.enabled) {
    if (!Number.isInteger(cfg.preStart.minutesBefore) || cfg.preStart.minutesBefore < 1) {
      throw new Error('preStart.minutesBefore must be a positive integer');
    }
    const fireAt = a.startUtc - cfg.preStart.minutesBefore * MIN;
    push(
      'pre_start',
      fireAt,
      'CYMOR REMINDER',
      `Your ${a.title} session starts in ${cfg.preStart.minutesBefore} minutes. Prepare yourself.`,
      // A pre-start reminder is useless once the activity has begun.
      Math.min(fireAt + staleAfterMin.pre_start * MIN, a.startUtc),
    );
  }
  if (cfg.start.enabled) {
    push('start', a.startUtc, 'YOUR ACTIVITY STARTS NOW', `${a.title}. Time to focus and execute your plan.`);
  }
  if (cfg.end.enabled) {
    push(
      'end',
      a.endUtc,
      'TIME IS UP',
      `Your ${a.title} session has ended. Check out your activity and prepare for your next scheduled event.`,
    );
  }
  if (cfg.overdue.enabled) {
    push(
      'overdue',
      a.endUtc + cfg.overdue.minutesAfterEnd * MIN,
      'CYMOR ALERT',
      // Body is recomputed at send time with the real overrun; this is the fallback text.
      `You have exceeded your scheduled ${a.title} time. Your next activity remains on schedule.`,
    );
  }
  return jobs;
}

export function overdueBody(title: string, overrunMinutes: number): string {
  return `You have exceeded your scheduled ${title} time by ${overrunMinutes} minutes. Your next activity remains on schedule.`;
}

export interface ReminderForPlan {
  id: string;
  userId: string;
  title: string;
  description?: string;
  latePolicy?: LatePolicy;
  /** For latePolicy 'send': the maximum lateness still accepted. Default 120 min. */
  maxLateMinutes?: number;
}

/** Turn already-generated reminder fire times into job drafts. */
export function planReminderJobs(r: ReminderForPlan, fireTimes: number[]): NotificationJobDraft[] {
  const staleMin =
    r.latePolicy === 'send' ? (r.maxLateMinutes ?? 120) : DEFAULT_STALE_AFTER_MIN.reminder;
  return fireTimes.map((fireAt) => ({
    userId: r.userId,
    kind: 'reminder' as const,
    sourceId: r.id,
    fireAt,
    expiresAt: fireAt + staleMin * MIN,
    idempotencyKey: idempotencyKey('reminder', r.id, fireAt),
    title: r.title,
    body: r.description ?? 'Reminder',
    url: `/reminders?reminder=${encodeURIComponent(r.id)}`,
  }));
}
