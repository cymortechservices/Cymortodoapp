import { Router } from 'express';
import { z } from 'zod';
import { Activity, NotificationSubscription } from '../db/models.js';
import { asyncHandler, HttpError, oid, parse } from '../lib/http.js';
import { requireAuth, uid, verifyAction } from '../lib/auth.js';
import { config } from '../config.js';
import { HEARTBEATS, jobsCol, makeJobStore } from '../db/connection.js';
import { hashEndpoint } from '../services/planner.js';
import { vapidConfigured } from '../services/push.js';
import { MIN } from '../core/time.js';
import mongoose from 'mongoose';

async function snoozeJob(userId: string, jobId: string, minutes: number): Promise<number> {
  const job = await jobsCol().findOne({ id: jobId, userId } as never);
  if (!job) throw new HttpError(404, 'Notification not found', 'not_found');
  const now = Date.now();
  const fireAt = now + minutes * MIN;
  const ok = await makeJobStore().insert(
    { userId, kind: job.kind, sourceId: job.sourceId, fireAt, expiresAt: fireAt + 15 * MIN, idempotencyKey: `snooze:${jobId}:${fireAt}`, title: job.title, body: job.body, url: job.url },
    now,
  );
  if (!ok) throw new HttpError(409, 'Already snoozed', 'conflict');
  return fireAt;
}

export function notificationsRouter(): Router {
  const r = Router();

  r.get('/vapid-key', (_req, res) => {
    if (!vapidConfigured()) return void res.status(503).json({ error: 'push_not_configured', message: 'Server has no VAPID keys; push is disabled.' });
    res.json({ publicKey: config.VAPID_PUBLIC_KEY });
  });

  // ---- notification buttons (no login session; authorised by a short-lived signed token in the push) ----
  r.post('/action', asyncHandler(async (req, res) => {
    const b = parse(z.object({ token: z.string(), action: z.enum(['snooze', 'delivered', 'opened', 'check-in', 'check-out']), minutes: z.number().int().min(1).max(240).optional() }), req.body);
    const { userId, jobId } = verifyAction(b.token);
    const job = await jobsCol().findOne({ id: jobId, userId } as never);
    if (!job) throw new HttpError(404, 'Notification not found', 'not_found');
    const now = Date.now();
    if (b.action === 'snooze') return void res.json({ ok: true, fireAt: await snoozeJob(userId, jobId, b.minutes ?? 10) });
    if (b.action === 'delivered' || b.action === 'opened') {
      // Client acknowledgement: the ONLY path that may set delivered/opened.
      const st = b.action === 'opened' ? ['sent_to_provider', 'delivered'] : ['sent_to_provider'];
      await jobsCol().updateOne({ id: jobId, status: { $in: st } } as never, { $set: { status: b.action, updatedAt: now } } as never);
      return void res.json({ ok: true });
    }
    if (job.kind === 'reminder' || !oid.test(job.sourceId)) throw new HttpError(400, 'Not an activity notification', 'bad_action');
    const a = await Activity.findOne({ _id: job.sourceId, userId });
    if (!a) throw new HttpError(404, 'Activity not found', 'not_found');
    if (b.action === 'check-in') {
      if (a.checkInAt) throw new HttpError(409, 'Already checked in', 'bad_state');
      a.checkInAt = now;
    } else {
      if (!a.checkInAt || a.checkOutAt) throw new HttpError(409, 'Cannot check out now', 'bad_state');
      a.checkOutAt = now;
    }
    await a.save();
    res.json({ ok: true });
  }));

  r.use(requireAuth);

  r.post('/subscribe', asyncHandler(async (req, res) => {
    const b = parse(z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(8) }) }), req.body);
    const hash = hashEndpoint(b.endpoint);
    const doc = await NotificationSubscription.findOneAndUpdate(
      { endpointHash: hash },
      { $set: { userId: uid(req), endpoint: b.endpoint, keys: b.keys, userAgent: req.get('user-agent') ?? '', active: true, expiredReason: null } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    res.status(201).json({ id: String(doc!._id) });
  }));

  r.delete('/subscribe', asyncHandler(async (req, res) => {
    const b = parse(z.object({ endpoint: z.string().url() }), req.body);
    await NotificationSubscription.deleteOne({ endpointHash: hashEndpoint(b.endpoint), userId: uid(req) });
    res.json({ ok: true });
  }));

  r.get('/subscriptions', asyncHandler(async (req, res) => {
    const rows = await NotificationSubscription.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean();
    res.json({ subscriptions: rows.map((s) => ({ id: String(s._id), userAgent: s.userAgent, active: s.active, expiredReason: s.expiredReason, lastAcceptedAt: s.lastAcceptedAt, createdAt: s.createdAt })) });
  }));

  /** Queues a real push through the same worker path. Proves the whole chain only if a worker is running. */
  r.post('/test', asyncHandler(async (req, res) => {
    const userId = uid(req);
    const now = Date.now();
    await makeJobStore().insert({ userId, kind: 'reminder', sourceId: `test:${userId}`, fireAt: now, expiresAt: now + 5 * MIN, idempotencyKey: `test:${userId}:${now}`, title: 'CYMOR TEST', body: 'If you can read this, push notifications work on this device.', url: '/settings' }, now);
    res.status(202).json({ queued: true, note: 'Delivered only if the worker is running and a device is subscribed.' });
  }));

  r.get('/jobs', asyncHandler(async (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), status: z.string().optional() }), req.query);
    const filter: Record<string, unknown> = { userId: uid(req), fireAt: { $lte: Date.now() + 24 * 3_600_000 } };
    if (q.status) filter.status = q.status;
    const rows = await jobsCol().find(filter as never).sort({ fireAt: -1 }).limit(q.limit).toArray();
    res.json({ jobs: rows.map((j) => ({ id: j.id, kind: j.kind, title: j.title, body: j.body, fireAt: j.fireAt, status: j.status, reason: j.reason, attempts: j.attempts, sentAt: j.sentAt, lastError: j.lastError })) });
  }));

  r.post('/jobs/:id/snooze', asyncHandler(async (req, res) => {
    const b = parse(z.object({ minutes: z.number().int().min(1).max(240).default(10) }), req.body ?? {});
    res.json({ ok: true, fireAt: await snoozeJob(uid(req), String(req.params.id), b.minutes) });
  }));

  /** Honest status of each link in the notification chain. */
  r.get('/diagnostics', asyncHandler(async (req, res) => {
    const userId = uid(req);
    const now = Date.now();
    const [subs, hb, pending, overdueDue, recent] = await Promise.all([
      NotificationSubscription.find({ userId }).lean(),
      mongoose.connection.db!.collection(HEARTBEATS).findOne({ _id: 'worker' } as never),
      jobsCol().countDocuments({ userId, status: { $in: ['pending', 'retry'] } } as never),
      jobsCol().countDocuments({ userId, status: { $in: ['pending', 'retry'] }, fireAt: { $lt: now - 2 * MIN } } as never),
      jobsCol().find({ userId, status: { $in: ['sent_to_provider', 'delivered', 'opened', 'failed', 'expired'] } } as never).sort({ updatedAt: -1 }).limit(5).toArray(),
    ]);
    const workerAgeMs = hb ? now - (hb as unknown as { at: number }).at : null;
    res.json({
      vapidConfigured: vapidConfigured(),
      activeDevices: subs.filter((s) => s.active).length,
      expiredDevices: subs.filter((s) => !s.active).length,
      worker: { alive: workerAgeMs !== null && workerAgeMs < 90_000, lastSeenMsAgo: workerAgeMs },
      queue: { pending: pending, lateUnsent: overdueDue },
      recent: recent.map((j) => ({ title: j.title, status: j.status, reason: j.reason, lastError: j.lastError })),
      limits: [
        'Push delivery is never guaranteed by any push service.',
        'iOS requires the app to be installed to the Home Screen (iOS 16.4+).',
        'Custom sounds cannot be forced for background pushes; the OS decides.',
      ],
    });
  }));

  return r;
}
