import { Router } from 'express';
import { z } from 'zod';
import { DailyReflection, FocusSession, Goal, Habit, HabitCompletion, User, UserSettings } from '../db/models.js';
import { asyncHandler, HttpError, oid, parse } from '../lib/http.js';
import { requireAuth, uid } from '../lib/auth.js';
import { ymdSchema } from '../lib/range.js';
import { addDays, dayOfWeek, localDate } from '../core/time.js';

const notify = z.object({
  preStart: z.object({ enabled: z.boolean(), minutesBefore: z.number().int().min(1).max(1440) }),
  start: z.object({ enabled: z.boolean() }),
  end: z.object({ enabled: z.boolean() }),
  overdue: z.object({ enabled: z.boolean(), minutesAfterEnd: z.number().int().min(1).max(1440) }),
});

/** Current and longest streak for a habit, counting only days the habit is scheduled. */
export function habitStreak(dates: string[], weekdays: number[], today: string): { current: number; longest: number } {
  const done = new Set(dates);
  const scheduled = (d: string) => weekdays.includes(dayOfWeek(d));
  let current = 0;
  let d = today;
  if (scheduled(d) && !done.has(d)) d = addDays(d, -1); // today not done yet does not break the streak
  for (let i = 0; i < 4000; i++) {
    if (!scheduled(d)) { d = addDays(d, -1); continue; }
    if (!done.has(d)) break;
    current++;
    d = addDays(d, -1);
  }
  let longest = 0;
  if (dates.length) {
    const first = [...dates].sort()[0]!;
    let run = 0;
    for (let x = first; x <= today; x = addDays(x, 1)) {
      if (!scheduled(x)) continue;
      if (done.has(x)) { run++; longest = Math.max(longest, run); } else run = 0;
    }
  }
  return { current, longest: Math.max(longest, current) };
}

export function lifeRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  const id = (req: { params: Record<string, unknown> }) => {
    const v = String(req.params.id);
    if (!oid.test(v)) throw new HttpError(404, 'Not found', 'not_found');
    return v;
  };

  // ---- settings ----
  r.get('/settings', asyncHandler(async (req, res) => {
    const s = (await UserSettings.findOne({ userId: uid(req) }).lean()) ?? (await UserSettings.create({ userId: uid(req) })).toObject();
    res.json({ settings: s });
  }));
  r.patch('/settings', asyncHandler(async (req, res) => {
    const b = parse(z.object({
      theme: z.enum(['dark', 'light', 'system']).optional(), weekStartsOn: z.number().int().min(0).max(6).optional(), soundEnabled: z.boolean().optional(),
      sound: z.string().max(30).optional(), reducedMotion: z.boolean().optional(), introSeen: z.boolean().optional(), defaultNotify: notify.optional(),
    }), req.body);
    const s = await UserSettings.findOneAndUpdate({ userId: uid(req) }, { $set: b }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
    res.json({ settings: s });
  }));

  // ---- habits ----
  r.get('/habits', asyncHandler(async (req, res) => {
    const u = await User.findById(uid(req)).lean();
    const today = localDate(Date.now(), u?.timezone ?? 'UTC');
    const habits = await Habit.find({ userId: uid(req), archived: false }).sort({ createdAt: 1 }).lean();
    const comps = await HabitCompletion.find({ userId: uid(req), habitId: { $in: habits.map((h) => h._id) } }).lean();
    res.json({ today, habits: habits.map((h) => {
      const dates = comps.filter((c) => String(c.habitId) === String(h._id)).map((c) => c.date);
      return { id: String(h._id), name: h.name, color: h.color, weekdays: h.weekdays, doneToday: dates.includes(today), ...habitStreak(dates, h.weekdays, today), recent: dates.filter((d) => d >= addDays(today, -30)) };
    }) });
  }));
  r.post('/habits', asyncHandler(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional() }), req.body);
    const h = await Habit.create({ ...b, userId: uid(req) });
    res.status(201).json({ habit: { id: String(h._id), name: h.name } });
  }));
  r.delete('/habits/:id', asyncHandler(async (req, res) => {
    await Habit.updateOne({ _id: id(req), userId: uid(req) }, { $set: { archived: true } });
    res.json({ ok: true });
  }));
  r.put('/habits/:id/completions/:date', asyncHandler(async (req, res) => {
    const date = parse(ymdSchema, req.params.date);
    const { done } = parse(z.object({ done: z.boolean() }), req.body);
    const h = await Habit.findOne({ _id: id(req), userId: uid(req) }).lean();
    if (!h) throw new HttpError(404, 'Habit not found', 'not_found');
    if (done) await HabitCompletion.updateOne({ habitId: h._id, date }, { $setOnInsert: { userId: uid(req), habitId: h._id, date } }, { upsert: true });
    else await HabitCompletion.deleteOne({ habitId: h._id, date });
    res.json({ ok: true });
  }));

  // ---- goals ----
  r.get('/goals', asyncHandler(async (req, res) => {
    const rows = await Goal.find({ userId: uid(req) }).sort({ done: 1, createdAt: -1 }).lean();
    res.json({ goals: rows.map((g) => ({ id: String(g._id), title: g.title, target: g.target, progress: g.progress, unit: g.unit, dueDate: g.dueDate, done: g.done, pct: g.target > 0 ? Math.min(100, Math.round((g.progress / g.target) * 100)) : 0 })) });
  }));
  r.post('/goals', asyncHandler(async (req, res) => {
    const b = parse(z.object({ title: z.string().trim().min(1).max(200), target: z.number().positive().default(100), unit: z.string().max(20).optional(), dueDate: ymdSchema.optional() }), req.body);
    const g = await Goal.create({ ...b, userId: uid(req) });
    res.status(201).json({ goal: { id: String(g._id) } });
  }));
  r.patch('/goals/:id', asyncHandler(async (req, res) => {
    const b = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), target: z.number().positive().optional(), progress: z.number().min(0).optional(), dueDate: ymdSchema.optional(), done: z.boolean().optional() }), req.body);
    const g = await Goal.findOneAndUpdate({ _id: id(req), userId: uid(req) }, { $set: b }, { returnDocument: 'after' });
    if (!g) throw new HttpError(404, 'Goal not found', 'not_found');
    if (g.progress >= g.target && !g.done && b.done === undefined) { g.done = true; await g.save(); }
    res.json({ ok: true });
  }));
  r.delete('/goals/:id', asyncHandler(async (req, res) => {
    await Goal.deleteOne({ _id: id(req), userId: uid(req) });
    res.json({ ok: true });
  }));

  // ---- focus sessions ----
  r.post('/focus', asyncHandler(async (req, res) => {
    const b = parse(z.object({ label: z.string().max(100).optional(), plannedMinutes: z.number().int().min(1).max(240) }), req.body);
    const open = await FocusSession.findOne({ userId: uid(req), endedAt: { $exists: false } });
    if (open) throw new HttpError(409, 'A focus session is already running', 'bad_state');
    const f = await FocusSession.create({ ...b, userId: uid(req), startedAt: Date.now() });
    res.status(201).json({ focus: { id: String(f._id), startedAt: f.startedAt, plannedMinutes: f.plannedMinutes } });
  }));
  r.post('/focus/:id/end', asyncHandler(async (req, res) => {
    const f = await FocusSession.findOne({ _id: id(req), userId: uid(req) });
    if (!f) throw new HttpError(404, 'Focus session not found', 'not_found');
    if (f.endedAt) throw new HttpError(409, 'Already ended', 'bad_state');
    f.endedAt = Date.now();
    f.completed = f.endedAt - f.startedAt >= f.plannedMinutes * 60_000 - 5_000;
    await f.save();
    res.json({ ok: true, completed: f.completed, minutes: Math.round((f.endedAt - f.startedAt) / 60_000) });
  }));
  r.get('/focus', asyncHandler(async (req, res) => {
    const rows = await FocusSession.find({ userId: uid(req) }).sort({ startedAt: -1 }).limit(100).lean();
    const done = rows.filter((x) => x.endedAt);
    res.json({
      running: rows.find((x) => !x.endedAt) ? { id: String(rows.find((x) => !x.endedAt)!._id), startedAt: rows.find((x) => !x.endedAt)!.startedAt, plannedMinutes: rows.find((x) => !x.endedAt)!.plannedMinutes } : null,
      totalMinutes: Math.round(done.reduce((a, x) => a + (x.endedAt! - x.startedAt) / 60_000, 0)),
      sessions: done.slice(0, 20).map((x) => ({ id: String(x._id), label: x.label, startedAt: x.startedAt, minutes: Math.round((x.endedAt! - x.startedAt) / 60_000), completed: x.completed })),
    });
  }));

  // ---- daily reflection ----
  r.get('/reflections/:date', asyncHandler(async (req, res) => {
    res.json({ reflection: await DailyReflection.findOne({ userId: uid(req), date: parse(ymdSchema, req.params.date) }).lean() });
  }));
  r.put('/reflections/:date', asyncHandler(async (req, res) => {
    const date = parse(ymdSchema, req.params.date);
    const b = parse(z.object({ mood: z.number().int().min(1).max(5).optional(), wins: z.string().max(2000).optional(), improve: z.string().max(2000).optional() }), req.body);
    await DailyReflection.updateOne({ userId: uid(req), date }, { $set: b }, { upsert: true });
    res.json({ ok: true });
  }));

  return r;
}
