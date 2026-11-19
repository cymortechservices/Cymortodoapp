import { Activity, Reminder } from '../db/models.js';
import type { Precondition } from '../core/worker.js';
import { evaluateSession } from '../core/accounting.js';
import { overdueBody } from '../core/notificationPlan.js';
import { toSession } from './sessions.js';

/** Send-time checks so a notification never fires for something that no longer applies. */
export const mongoPrecondition: Precondition = async (job) => {
  if (job.sourceId.startsWith('test:')) return { send: true };
  if (!/^[a-f\d]{24}$/i.test(job.sourceId)) return { send: false, reason: 'unknown source' };
  if (job.kind === 'reminder') {
    const r = await Reminder.findById(job.sourceId).lean();
    if (!r) return { send: false, reason: 'reminder deleted' };
    if (!r.active) return { send: false, reason: 'reminder paused' };
    return { send: true };
  }
  const a = await Activity.findById(job.sourceId).lean();
  if (!a) return { send: false, reason: 'activity deleted' };
  if (a.cancelled) return { send: false, reason: 'activity cancelled' };
  if (job.kind === 'overdue') {
    const res = evaluateSession(toSession(a), Date.now());
    if (a.checkOutAt) return { send: false, reason: 'already checked out' };
    if (res.status === 'missed') return { send: false, reason: 'activity was missed (never started)' };
    return { send: true, body: overdueBody(a.title, Math.max(res.overrunMinutes, 0)) };
  }
  return { send: true };
};
