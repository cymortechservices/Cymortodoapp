import { createRequire } from 'node:module';
import type * as WebPushTypes from 'web-push';
import { config } from '../config.js';
import { NotificationSubscription } from '../db/models.js';
import type { PushPayload, PushProvider, PushResult, PushSubscriptionRecord, SubscriptionStore } from '../core/worker.js';
import { signAction } from '../lib/auth.js';

const webpush = createRequire(import.meta.url)('web-push') as typeof WebPushTypes;

export const vapidConfigured = () => !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);

let initialised = false;
function init() {
  if (initialised) return;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  initialised = true;
}

/** Real Web Push (VAPID). NOT exercised against a real push service/device in this build. */
export class WebPushProvider implements PushProvider {
  async send(sub: PushSubscriptionRecord, p: PushPayload): Promise<PushResult> {
    if (!vapidConfigured()) return { ok: false, status: 401, message: 'VAPID keys not configured' };
    init();
    const doc = await NotificationSubscription.findById(sub.id).lean();
    if (!doc) return { ok: false, status: 410, message: 'subscription row missing' };
    const payload = JSON.stringify({ ...p, actionToken: signAction(sub.userId, p.jobId), apiBase: config.BACKEND_URL });
    try {
      const res = await webpush.sendNotification({ endpoint: doc.endpoint, keys: { p256dh: doc.keys?.p256dh ?? '', auth: doc.keys?.auth ?? '' } }, payload, { TTL: 60 * 60, urgency: 'high' });
      await NotificationSubscription.updateOne({ _id: doc._id }, { $set: { lastAcceptedAt: Date.now() } });
      return { ok: true, status: res.statusCode };
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      return { ok: false, status: err.statusCode ?? 0, message: err.body || err.message };
    }
  }
}

export class MongoSubscriptionStore implements SubscriptionStore {
  async listActive(userId: string): Promise<PushSubscriptionRecord[]> {
    const rows = await NotificationSubscription.find({ userId, active: true }).lean();
    return rows.map((r) => ({ id: String(r._id), userId, endpoint: r.endpoint, active: true }));
  }
  async markExpired(id: string, reason: string): Promise<void> {
    await NotificationSubscription.updateOne({ _id: id }, { $set: { active: false, expiredReason: reason } });
  }
}
