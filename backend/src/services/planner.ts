import { createHash } from 'node:crypto';
import { Activity, Reminder, UserSettings } from '../db/models.js';
import { jobsCol, makeJobStore } from '../db/connection.js';
import { DEFAULT_ACTIVITY_NOTIFY, planActivityJobs, planReminderJobs, type ActivityNotifyConfig } from '../core/notificationPlan.js';
import { generateOccurrences, type ReminderSpec } from '../core/recurrence.js';
import { DAY } from '../core/time.js';

export const HORIZON_DAYS = 7;

interface PlanActivity {
  _id: unknown;
  userId: unknown;
  title: string;
  startUtc: number;
  endUtc: number;
  cancelled?: boolean | null;
  notify?: unknown;
}

const cfgOf = (n: unknown): ActivityNotifyConfig => JSON.parse(JSON.stringify(n ?? DEFAULT_ACTIVITY_NOTIFY)) as ActivityNotifyConfig;

/** Remove not-yet-sent jobs for a source (activity/reminder). Already-sent history is kept. */
export async function clearPendingJobs(sourceId: string): Promise<void> {
  await jobsCol().deleteMany({ sourceId, status: { $in: ['pending', 'retry'] } } as never);
}

/** (Re)plan jobs for one activity. Past-due jobs are not created. Idempotent via the unique key. */
export async function planActivity(a: PlanActivity, now = Date.now()): Promise<number> {
  const id = String(a._id);
  await clearPendingJobs(id);
  if (a.cancelled) return 0;
  const store = makeJobStore();
  const drafts = planActivityJobs({ id, userId: String(a.userId), title: a.title, startUtc: a.startUtc, endUtc: a.endUtc }, cfgOf(a.notify));
  let n = 0;
  for (const d of drafts) {
    if (d.expiresAt < now) continue; // already stale
    if (await store.insert(d, now)) n++;
  }
  return n;
}

/** Top up the rolling horizon of reminder jobs for one reminder. */
export async function planReminder(r: { _id: unknown; userId: unknown; title: string; description?: string | null; spec: unknown; active?: boolean | null; latePolicy?: string | null; maxLateMinutes?: number | null }, now = Date.now()): Promise<number> {
  if (!r.active) return 0;
  const spec = r.spec as ReminderSpec;
  const times = generateOccurrences(spec, now, now + HORIZON_DAYS * DAY);
  const drafts = planReminderJobs(
    { id: String(r._id), userId: String(r.userId), title: r.title, description: r.description || undefined, latePolicy: r.latePolicy === 'send' ? 'send' : 'expire', maxLateMinutes: r.maxLateMinutes ?? 120 },
    times,
  );
  const store = makeJobStore();
  let n = 0;
  for (const d of drafts) if (await store.insert(d, now)) n++;
  return n;
}

export async function replanReminder(r: Parameters<typeof planReminder>[0], now = Date.now()): Promise<number> {
  await clearPendingJobs(String(r._id));
  return planReminder(r, now);
}

/** Worker-side maintenance: keep every active reminder's horizon filled. */
export async function topUpAllReminders(now = Date.now()): Promise<number> {
  let n = 0;
  for await (const r of Reminder.find({ active: true }).lean().cursor()) n += await planReminder(r as never, now);
  return n;
}

export async function userDefaultNotify(userId: string): Promise<ActivityNotifyConfig> {
  const s = await UserSettings.findOne({ userId }).lean();
  return cfgOf(s?.defaultNotify);
}

export const hashEndpoint = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

export async function activityCount(userId: string) {
  return Activity.countDocuments({ userId });
}
