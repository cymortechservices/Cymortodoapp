import { Router } from 'express';
import { z } from 'zod';
import { Reminder } from '../db/models.js';
import { asyncHandler, HttpError, oid, parse } from '../lib/http.js';
import { requireAuth, uid } from '../lib/auth.js';
import { hhmmSchema, ymdSchema } from '../lib/range.js';
import { generateOccurrences, nextOccurrence, validateSpec, type ReminderSpec } from '../core/recurrence.js';
import { isValidTimezone } from '../core/time.js';
import { clearPendingJobs, planReminder, replanReminder } from '../services/planner.js';

const repeat = z.discriminatedUnion('type', [
  z.object({ type: z.literal('minutes'), every: z.number().int().min(1) }),
  z.object({ type: z.literal('hours'), every: z.number().int().min(1) }),
  z.object({ type: z.literal('days'), every: z.number().int().min(1) }),
  z.object({ type: z.literal('dailyAt'), times: z.array(hhmmSchema).min(1) }),
  z.object({ type: z.literal('weekdays'), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({ type: z.literal('weekly') }),
  z.object({ type: z.literal('monthly') }),
  z.object({ type: z.literal('custom'), times: z.array(hhmmSchema).min(1), everyDays: z.number().int().min(1), days: z.array(z.number().int().min(0).max(6)).optional() }),
]);
const specSchema = z.object({
  timezone: z.string().refine(isValidTimezone, 'invalid IANA timezone'),
  startDate: ymdSchema,
  endDate: ymdSchema.optional(),
  startTime: hhmmSchema,
  endTime: hhmmSchema.optional(),
  repeat,
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});
const body = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  spec: specSchema,
  latePolicy: z.enum(['send', 'expire']).optional(),
  maxLateMinutes: z.number().int().min(1).max(1440).optional(),
});

function checked(spec: z.infer<typeof specSchema>): ReminderSpec {
  const errs = validateSpec(spec as ReminderSpec);
  if (errs.length) throw new HttpError(400, errs.join('; '), 'bad_schedule');
  return spec as ReminderSpec;
}

export function remindersRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  const mine = async (userId: string, id: string) => {
    if (!oid.test(id)) throw new HttpError(404, 'Not found', 'not_found');
    const x = await Reminder.findOne({ _id: id, userId });
    if (!x) throw new HttpError(404, 'Reminder not found', 'not_found');
    return x;
  };
  const view = (x: { _id: unknown; title: string; description?: string | null; spec: unknown; active?: boolean | null; latePolicy?: string | null; maxLateMinutes?: number | null }) => ({
    id: String(x._id), title: x.title, description: x.description, spec: x.spec, active: x.active, latePolicy: x.latePolicy, maxLateMinutes: x.maxLateMinutes,
    next: x.active ? nextOccurrence(x.spec as ReminderSpec, Date.now()) : null,
  });

  r.get('/', asyncHandler(async (req, res) => {
    const rows = await Reminder.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean();
    res.json({ reminders: rows.map(view) });
  }));

  /** Dry run: show the next N fire times for a schedule without saving anything. */
  r.post('/preview', asyncHandler(async (req, res) => {
    const b = parse(z.object({ spec: specSchema, count: z.number().int().min(1).max(50).default(10) }), req.body);
    const spec = checked(b.spec);
    const now = Date.now();
    const times = generateOccurrences(spec, now, now + 400 * 86_400_000).slice(0, b.count);
    res.json({ times });
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const b = parse(body, req.body);
    const spec = checked(b.spec);
    const doc = await Reminder.create({ ...b, spec, userId: uid(req) });
    const jobs = await planReminder(doc);
    res.status(201).json({ reminder: view(doc), jobsPlanned: jobs });
  }));

  r.patch('/:id', asyncHandler(async (req, res) => {
    const x = await mine(uid(req), String(req.params.id));
    const b = parse(body.partial().extend({ active: z.boolean().optional() }), req.body);
    if (b.spec) x.spec = checked(b.spec);
    for (const k of ['title', 'description', 'latePolicy', 'maxLateMinutes', 'active'] as const) if (b[k] !== undefined) (x as never as Record<string, unknown>)[k] = b[k];
    await x.save();
    const jobs = x.active ? await replanReminder(x) : (await clearPendingJobs(String(x._id)), 0);
    res.json({ reminder: view(x), jobsPlanned: jobs });
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    const x = await mine(uid(req), String(req.params.id));
    await clearPendingJobs(String(x._id));
    await x.deleteOne();
    res.json({ ok: true });
  }));

  return r;
}
