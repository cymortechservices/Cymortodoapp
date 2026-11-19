import { Router } from 'express';
import { z } from 'zod';
import { Activity, User } from '../db/models.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';
import { requireAuth, uid } from '../lib/auth.js';
import { rangeToUtc, ymdSchema } from '../lib/range.js';
import { completionStreak, evaluateAll, hourlyHeatmap, insights, perDay, summarize } from '../core/analytics.js';
import { addDays, localDate } from '../core/time.js';
import { toAnalytics } from '../services/sessions.js';

export function analyticsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', asyncHandler(async (req, res) => {
    const q = parse(z.object({ from: ymdSchema, to: ymdSchema }), req.query);
    const u = await User.findById(uid(req)).lean();
    if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
    const tz = u.timezone;
    const now = Date.now();
    const [a, b] = rangeToUtc(q.from, q.to, tz);
    const rows = (await Activity.find({ userId: uid(req), startUtc: { $gte: a, $lt: b } }).lean()).map((x) => toAnalytics(x as never));
    const evaluated = evaluateAll(rows, now, tz);
    const heatmap = hourlyHeatmap(rows, now, tz);

    // Streaks look back 120 days regardless of the selected range.
    const today = localDate(now, tz);
    const [sa] = rangeToUtc(addDays(today, -120), today, tz);
    const streakRows = (await Activity.find({ userId: uid(req), startUtc: { $gte: sa } }).lean()).map((x) => toAnalytics(x as never));
    const streak = completionStreak(perDay(evaluateAll(streakRows, now, tz)), today);

    res.json({ timezone: tz, summary: summarize(evaluated), days: perDay(evaluated), heatmap, streak, insights: insights(evaluated, heatmap) });
  }));
  return r;
}
