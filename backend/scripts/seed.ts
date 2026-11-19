/**
 * Demo data: creates demo@cymor.test / "demo-pass-123" with a week of activities, a habit, a goal and a reminder.
 * Usage: npm run seed   (needs MONGODB_URI). Refuses to run in production.
 */
import { config } from '../src/config.js';
import { connectDb, ensureIndexes } from '../src/db/connection.js';
import { Activity, Goal, Habit, Reminder, User, UserSettings } from '../src/db/models.js';
import { hashPassword } from '../src/lib/auth.js';
import { addDays, localDate, zonedToUtc } from '../src/core/time.js';
import { planActivity, planReminder } from '../src/services/planner.js';
import mongoose from 'mongoose';

if (config.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
await connectDb(config.MONGODB_URI);
await ensureIndexes({ skipTtl: ['1', 'true'].includes(config.SKIP_TTL_INDEXES) });

const email = 'demo@cymor.test';
const old = await User.findOne({ email });
if (old) {
  for (const m of [Activity, Goal, Habit, Reminder, UserSettings]) await (m as never as { deleteMany(f: object): Promise<unknown> }).deleteMany({ userId: old._id });
  await User.deleteOne({ _id: old._id });
}
const tz = config.DEFAULT_TIMEZONE;
const user = await User.create({ email, passwordHash: await hashPassword('demo-pass-123'), name: 'Demo User', timezone: tz, emailVerified: true });
await UserSettings.create({ userId: user._id, introSeen: true });

const today = localDate(Date.now(), tz);
const plan: [string, string, string, string, string][] = [
  ['Study Mathematics', 'study', '09:00', '11:00', '#7c5cff'],
  ['Computer Science project', 'study', '11:30', '13:00', '#22d3ee'],
  ['Lunch & walk', 'health', '13:00', '14:00', '#34d399'],
  ['Revision: algorithms', 'study', '15:00', '16:30', '#fbbf24'],
  ['Gym', 'health', '17:30', '18:30', '#f87171'],
];
for (let d = 0; d < 7; d++) {
  const date = addDays(today, d);
  for (const [title, category, s, e, color] of plan) {
    const a = await Activity.create({ userId: user._id, title, category, color, startUtc: zonedToUtc(date, s, tz), endUtc: zonedToUtc(date, e, tz) });
    await planActivity(a);
  }
}
const r = await Reminder.create({
  userId: user._id, title: 'Drink Water', description: 'Hydrate',
  spec: { timezone: tz, startDate: today, startTime: '08:00', endTime: '20:00', repeat: { type: 'hours', every: 2 } },
});
await planReminder(r);
await Habit.create({ userId: user._id, name: 'Read 20 pages' });
await Goal.create({ userId: user._id, title: 'Finish discrete maths notes', target: 12, unit: 'chapters', progress: 4 });
console.log(`Seeded ${email} / demo-pass-123 (${plan.length * 7} activities, 1 reminder).`);
await mongoose.disconnect();
