import { Router } from 'express';
import { z } from 'zod';
import { Activity, User } from '../db/models.js';
import { asyncHandler, HttpError, oid, parse } from '../lib/http.js';
import { requireAuth, uid } from '../lib/auth.js';
import { hhmmSchema, rangeToUtc, ymdSchema } from '../lib/range.js';
import { addDays, dayOfWeek, localDate, zonedToUtc } from '../core/time.js';
import { evaluateSession } from '../core/accounting.js';
import { findConflicts, validateSlot } from '../core/overlap.js';
import { clearPendingJobs, planActivity, userDefaultNotify } from '../services/planner.js';
import { toSession } from '../services/sessions.js';

const notifySchema = z.object({
  preStart: z.object({ enabled: z.boolean(), minutesBefore: z.number().int().min(1).max(1440) }),
  start: z.object({ enabled: z.boolean() }),
  alarm: z.boolean().optional(),
  end: z.object({ enabled: z.boolean() }),
  overdue: z.object({ enabled: z.boolean(), minutesAfterEnd: z.number().int().min(1).max(1440) }),
});

const base = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  location: z.string().max(200).optional(),
  notify: notifySchema.optional(),
  clientId: z.string().max(64).optional(),
};
const when = {
  date: ymdSchema,
  start: hhmmSchema,
  end: hhmmSchema,
  /** only needed when the activity ends on a later day than it starts (e.g. overnight) */
  endDate: ymdSchema.optional(),
};
const createSchema = z.object({ ...base, ...when });
const patchSchema = z.object({ ...base, date: ymdSchema.optional(), start: hhmmSchema.optional(), end: hhmmSchema.optional(), endDate: ymdSchema.optional() }).partial();
const seriesSchema = z.object({ ...base, ...when, until: ymdSchema, weekdays: z.array(z.number().int().min(0).max(6)).min(1) });

function resolveTimes(b: { date: string; start: string; end: string; endDate?: string }, tz: string) {
  const startUtc = zonedToUtc(b.date, b.start, tz);
  const endUtc = zonedToUtc(b.endDate ?? b.date, b.end, tz);
  const err = validateSlot({ start: startUtc, end: endUtc });
  if (err) throw new HttpError(400, err, 'bad_time');
  return { startUtc, endUtc };
}

const decorate = (a: Parameters<typeof toSession>[0] & Record<string, unknown>, now: number, tz: string) => ({
  ...a,
  id: String(a._id),
  userId: undefined,
  localDate: localDate(a.startUtc, tz),
  result: evaluateSession(toSession(a), now),
});

export function activitiesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  const tzOf = async (req: Parameters<typeof uid>[0]) => {
    const u = await User.findById(uid(req)).lean();
    if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
    return u.timezone;
  };
  const mine = async (req: Parameters<typeof uid>[0], id: string) => {
    if (!oid.test(id)) throw new HttpError(404, 'Not found', 'not_found');
    const a = await Activity.findOne({ _id: id, userId: uid(req) });
    if (!a) throw new HttpError(404, 'Activity not found', 'not_found');
    return a;
  };

  r.get('/', asyncHandler(async (req, res) => {
    const q = parse(z.object({ from: ymdSchema, to: ymdSchema }), req.query);
    const tz = await tzOf(req);
    const [a, b] = rangeToUtc(q.from, q.to, tz);
    const rows = await Activity.find({ userId: uid(req), startUtc: { $gte: a, $lt: b } }).sort({ startUtc: 1 }).lean();
    const now = Date.now();
    const conflicts = findConflicts(rows.filter((x) => !x.cancelled).map((x) => ({ id: String(x._id), title: x.title, start: x.startUtc, end: x.endUtc })));
    res.json({ timezone: tz, now, activities: rows.map((x) => decorate(x as never, now, tz)), conflicts });
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const b = parse(createSchema, req.body);
    const tz = await tzOf(req);
    if (b.clientId) { // an offline-created activity may be re-sent after a flaky connection: never create it twice
      const dup = await Activity.findOne({ userId: uid(req), clientId: b.clientId }).lean();
      if (dup) return void res.status(200).json({ activity: decorate(dup as never, Date.now(), tz), jobsPlanned: 0, conflicts: [] });
    }
    const { startUtc, endUtc } = resolveTimes(b, tz);
    const { date: _d, start: _s, end: _e, endDate: _ed, ...rest } = b;
    const a = await Activity.create({ ...rest, notify: b.notify ?? (await userDefaultNotify(uid(req))), userId: uid(req), startUtc, endUtc });
    const jobs = await planActivity(a);
    const overlaps = findConflicts(
      (await Activity.find({ userId: uid(req), cancelled: false, startUtc: { $lt: endUtc }, endUtc: { $gt: startUtc } }).lean()).map((x) => ({ id: String(x._id), title: x.title, start: x.startUtc, end: x.endUtc })),
    );
    res.status(201).json({ activity: decorate(a.toObject() as never, Date.now(), tz), jobsPlanned: jobs, conflicts: overlaps });
  }));

  /** Weekly-repeating activity: materialised into individual activities (max 366). */
  r.post('/series', asyncHandler(async (req, res) => {
    const b = parse(seriesSchema, req.body);
    const tz = await tzOf(req);
    if (b.until < b.date) throw new HttpError(400, '"until" must not be before "date"', 'bad_range');
    const seriesId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const notify = b.notify ?? (await userDefaultNotify(uid(req)));
    const { date, start, end, endDate, until, weekdays, ...rest } = b;
    const nights = endDate ? Math.round((Date.parse(endDate) - Date.parse(date)) / 86_400_000) : 0;
    const docs = [];
    for (let d = date; d <= until; d = addDays(d, 1)) {
      if (!weekdays.includes(dayOfWeek(d))) continue;
      const { startUtc, endUtc } = resolveTimes({ date: d, start, end, endDate: nights ? addDays(d, nights) : undefined }, tz);
      docs.push({ ...rest, notify, userId: uid(req), startUtc, endUtc, seriesId });
      if (docs.length > 366) throw new HttpError(400, 'Series too long (max 366 occurrences)', 'too_many');
    }
    if (!docs.length) throw new HttpError(400, 'No dates match those weekdays in the range', 'empty_series');
    const created = await Activity.insertMany(docs);
    let jobs = 0;
    for (const a of created) jobs += await planActivity(a);
    res.status(201).json({ seriesId, created: created.length, jobsPlanned: jobs });
  }));

  r.patch('/:id', asyncHandler(async (req, res) => {
    const a = await mine(req, String(req.params.id));
    const b = parse(patchSchema, req.body);
    const tz = await tzOf(req);
    if (b.title !== undefined) a.title = b.title;
    if (b.description !== undefined) a.description = b.description;
    if (b.category !== undefined) a.category = b.category;
    if (b.color !== undefined) a.color = b.color;
    if (b.location !== undefined) a.location = b.location;
    if (b.notify !== undefined) a.notify = b.notify as never;
    if (b.date || b.start || b.end || b.endDate) {
      const curDate = localDate(a.startUtc, tz);
      const hhmm = (ms: number) => new Date(ms + 0).toISOString() && new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
      const { startUtc, endUtc } = resolveTimes(
        { date: b.date ?? curDate, start: b.start ?? hhmm(a.startUtc), end: b.end ?? hhmm(a.endUtc), endDate: b.endDate ?? (b.date ? undefined : localDate(a.endUtc, tz) !== curDate ? localDate(a.endUtc, tz) : undefined) },
        tz,
      );
      a.startUtc = startUtc;
      a.endUtc = endUtc;
    }
    await a.save();
    const jobs = await planActivity(a);
    res.json({ activity: decorate(a.toObject() as never, Date.now(), tz), jobsPlanned: jobs });
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    const a = await mine(req, String(req.params.id));
    await clearPendingJobs(String(a._id));
    await a.deleteOne();
    res.json({ ok: true });
  }));

  // ---- session actions. `at` lets the offline queue replay an action with its ORIGINAL time. ----
  const actSchema = z.object({ at: z.number().int().optional(), reason: z.string().max(300).optional(), endedByInterruption: z.boolean().optional() }).default({});
  const stamp = (at?: number) => {
    const now = Date.now();
    if (at === undefined) return now;
    if (at > now + 60_000) throw new HttpError(400, 'Timestamp is in the future', 'bad_time');
    return at;
  };

  const action = (name: string, fn: (a: NonNullable<Awaited<ReturnType<typeof mine>>>, t: number, b: z.infer<typeof actSchema>) => void) =>
    r.post(`/:id/${name}`, asyncHandler(async (req, res) => {
      const a = await mine(req, String(req.params.id));
      const b = parse(actSchema, req.body ?? {});
      const tz = await tzOf(req);
      fn(a, stamp(b.at), b);
      await a.save();
      if (name === 'cancel' || name === 'uncancel') await planActivity(a);
      res.json({ activity: decorate(a.toObject() as never, Date.now(), tz) });
    }));

  const open = <T extends { end?: number | null }>(arr: ArrayLike<T>): T | undefined => Array.from(arr).find((x) => x.end === undefined || x.end === null);

  action('check-in', (a, t) => {
    if (a.cancelled) throw new HttpError(409, 'Activity is cancelled', 'bad_state');
    if (a.checkInAt) throw new HttpError(409, 'Already checked in', 'bad_state');
    a.checkInAt = t;
    a.markedMissed = false;
  });
  action('pause', (a, t) => {
    if (!a.checkInAt || a.checkOutAt) throw new HttpError(409, 'Not in progress', 'bad_state');
    if (open(a.pauses)) throw new HttpError(409, 'Already paused', 'bad_state');
    a.pauses.push({ start: t } as never);
  });
  action('resume', (a, t) => {
    const p = open(a.pauses);
    if (!p) throw new HttpError(409, 'Not paused', 'bad_state');
    p.end = t;
  });
  action('interrupt', (a, t, b) => {
    if (!a.checkInAt || a.checkOutAt) throw new HttpError(409, 'Not in progress', 'bad_state');
    if (open(a.interruptions)) throw new HttpError(409, 'An interruption is already open', 'bad_state');
    a.interruptions.push({ start: t, reason: b.reason ?? '' } as never);
  });
  action('end-interruption', (a, t) => {
    const i = open(a.interruptions);
    if (!i) throw new HttpError(409, 'No open interruption', 'bad_state');
    i.end = t;
  });
  action('check-out', (a, t, b) => {
    if (!a.checkInAt) throw new HttpError(409, 'Check in first', 'bad_state');
    if (a.checkOutAt) throw new HttpError(409, 'Already checked out', 'bad_state');
    if (t < a.checkInAt) throw new HttpError(400, 'Check-out before check-in', 'bad_time');
    const op = open(a.pauses);
    if (op) op.end = t; // close anything still open at check-out
    const oi = open(a.interruptions);
    if (oi) oi.end = t;
    a.checkOutAt = t;
    if (b.endedByInterruption) a.endedByInterruption = true;
  });
  action('miss', (a) => {
    if (a.checkInAt) throw new HttpError(409, 'Already started', 'bad_state');
    a.markedMissed = true;
  });
  action('cancel', (a) => {
    a.cancelled = true;
  });
  action('uncancel', (a) => {
    a.cancelled = false;
  });

  return r;
}
