import { createRequire } from 'node:module';
import type * as WebPushTypes from 'web-push';
import { config } from '../config.js';
import { NotificationSubscription } from '../db/models.js';
import { jobsCol } from '../db/connection.js';
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

/** Real Web Push (VAPID) for browsers / installed PWAs. */
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

// ---------------------------------------------------------------- native (Android/iOS) via FCM

export interface FcmMessage { token: string; title: string; body: string; data: Record<string, string> }
/** Sends one FCM message. Throws an Error with `.code` like "messaging/registration-token-not-registered" on failure. */
export type FcmSender = (m: FcmMessage) => Promise<void>;

export const fcmConfigured = () => !!config.FIREBASE_SERVICE_ACCOUNT;

let fcmSender: FcmSender | null = null;
/** Real FCM sender (firebase-admin). NOT exercised against real Firebase in this build: needs a service account. */
async function realFcmSender(): Promise<FcmSender> {
  if (fcmSender) return fcmSender;
  const raw = config.FIREBASE_SERVICE_ACCOUNT.trim();
  const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const { initializeApp, getApps, getApp, cert } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(json) });
  fcmSender = async (m) => {
    await getMessaging(app).send({
      token: m.token,
      notification: { title: m.title, body: m.body },
      data: m.data,
      android: { priority: 'high', notification: { channelId: 'reminders', sound: 'default', tag: m.data.jobId } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    });
  };
  return fcmSender;
}

/**
 * Decides whether the SERVER must push to a native device for this job.
 * The phone schedules its own local alarms for everything up to `localUntil` as of its last sync, so pushing those
 * too would show every reminder twice. The server therefore only pushes what the phone does not have locally:
 *   - jobs firing after the phone's local horizon, or
 *   - jobs created after the phone last synced (e.g. planned from the web app).
 */
export function nativeNeedsServerPush(job: { fireAt: number; createdAt: number; kind: string }, dev: { localUntil?: number | null; syncedAt?: number | null }): boolean {
  if (job.kind === 'reminder' && job.fireAt === job.createdAt) return true; // immediate/test sends always go out
  const localUntil = dev.localUntil ?? 0;
  const syncedAt = dev.syncedAt ?? 0;
  if (job.fireAt > localUntil) return true;
  if (job.createdAt > syncedAt) return true;
  return false;
}

export class NativePushProvider implements PushProvider {
  constructor(private sender?: FcmSender) {}
  async send(sub: PushSubscriptionRecord, p: PushPayload): Promise<PushResult> {
    const doc = await NotificationSubscription.findById(sub.id).lean();
    if (!doc || !doc.fcmToken) return { ok: false, status: 410, message: 'device row missing' };
    const job = await jobsCol().findOne({ id: p.jobId } as never);
    if (job && !nativeNeedsServerPush(job, doc)) return { ok: true, status: 200 }; // the phone fires this one itself
    if (!this.sender && !fcmConfigured()) return { ok: false, status: 401, message: 'FCM not configured on the server' };
    try {
      const send = this.sender ?? (await realFcmSender());
      await send({ token: doc.fcmToken, title: p.title, body: p.body, data: { jobId: p.jobId, kind: p.kind, url: p.url, actionToken: signAction(sub.userId, p.jobId) } });
      await NotificationSubscription.updateOne({ _id: doc._id }, { $set: { lastAcceptedAt: Date.now() } });
      return { ok: true, status: 200 };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const dead = err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/invalid-argument';
      return { ok: false, status: dead ? 410 : 500, message: err.code || err.message };
    }
  }
}

/** Routes each device to the right channel (browser Web Push vs. native FCM). */
export class CompositePushProvider implements PushProvider {
  constructor(private web = new WebPushProvider(), private native = new NativePushProvider()) {}
  async send(sub: PushSubscriptionRecord, p: PushPayload): Promise<PushResult> {
    return sub.endpoint.startsWith('fcm:') ? this.native.send(sub, p) : this.web.send(sub, p);
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
