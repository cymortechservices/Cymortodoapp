// Integration tests: real Express app + real Mongoose against a live MongoDB-compatible server.
// Run with MONGO_TEST_URI (and MONGO_TEST_NO_TTL=1 for FerretDB). Skipped otherwise.
process.env.NODE_ENV = 'test';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const uri = process.env.MONGO_TEST_URI;
const skip = !uri;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let request: any, app: any, mongoose: any, jobsCol: any, processBatch: any, makeJobStore: any, MongoSubscriptionStore: any, mongoPrecondition: any, outbox: any;
let NotificationSubscription: any, hashEndpoint: any, signAction: any;

before(async () => {
  if (skip) return;
  ({ default: request } = await import('supertest'));
  ({ default: mongoose } = await import('mongoose'));
  const db = await import('../src/db/connection.js');
  ({ jobsCol, makeJobStore } = db);
  await db.connectDb(uri!, `api_${randomUUID().slice(0, 8)}`);
  await db.ensureIndexes({ skipTtl: !!process.env.MONGO_TEST_NO_TTL });
  ({ createApp: (globalThis as any).__createApp } = await import('../src/app.js'));
  app = (globalThis as any).__createApp();
  ({ processBatch } = await import('../src/core/worker.js'));
  ({ MongoSubscriptionStore } = await import('../src/services/push.js'));
  ({ mongoPrecondition } = await import('../src/services/precondition.js'));
  ({ outbox } = await import('../src/lib/mailer.js'));
  ({ NotificationSubscription } = await import('../src/db/models.js'));
  ({ hashEndpoint } = await import('../src/services/planner.js'));
  ({ signAction } = await import('../src/lib/auth.js'));
});
after(async () => {
  if (skip) return;
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

const T = { skip };
async function signup(email = `u${randomUUID().slice(0, 6)}@example.com`, timezone = 'Africa/Nairobi') {
  const r = await request(app).post('/api/auth/register').send({ email, password: 'correct horse 9', name: 'Test User', timezone });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { ...r.body, auth: { Authorization: `Bearer ${r.body.accessToken}` }, email };
}

test('auth: register, login, validation, no account enumeration', T, async () => {
  const u = await signup('a@example.com');
  assert.equal(u.user.emailVerified, false);
  assert.equal((await request(app).post('/api/auth/register').send({ email: 'a@example.com', password: 'correct horse 9', name: 'x' })).status, 409);
  assert.equal((await request(app).post('/api/auth/register').send({ email: 'nope', password: 'short', name: '' })).status, 400);
  const bad1 = await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'wrong wrong 1' });
  const bad2 = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'wrong wrong 1' });
  assert.equal(bad1.status, 401);
  assert.deepEqual(bad1.body, bad2.body);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'correct horse 9' })).status, 200);
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set(u.auth)).body.user.email, 'a@example.com');
});

test('auth: email verification, refresh rotation + reuse detection, password reset revokes sessions', T, async () => {
  const u = await signup();
  const v = await request(app).post('/api/auth/verify-email').send({ token: u.devVerifyToken });
  assert.equal(v.status, 200);
  assert.equal((await request(app).post('/api/auth/verify-email').send({ token: u.devVerifyToken })).status, 400, 'token is single-use');
  assert.equal((await request(app).get('/api/auth/me').set(u.auth)).body.user.emailVerified, true);
  assert.ok(outbox.some((m: any) => m.to === u.email && /Verify/.test(m.subject)));

  const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, u.refreshToken);
  const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.error, 'refresh_reuse');
  assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status, 401, 'family revoked');

  const rq = await request(app).post('/api/auth/request-reset').send({ email: u.email });
  const ghost = await request(app).post('/api/auth/request-reset').send({ email: 'ghost@example.com' });
  assert.equal(ghost.status, 200);
  assert.equal(ghost.body.devResetToken, undefined);
  const rs = await request(app).post('/api/auth/reset-password').send({ token: rq.body.devResetToken, password: 'brand new pass 7' });
  assert.equal(rs.status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: u.email, password: 'brand new pass 7' })).status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: u.email, password: 'correct horse 9' })).status, 401);
});

test('activities: create plans the 4 spec jobs at the right UTC instants (Nairobi)', T, async () => {
  const u = await signup();
  const r = await request(app).post('/api/activities').set(u.auth).send({ title: 'Study Mathematics', date: '2030-03-04', start: '09:00', end: '11:00' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.jobsPlanned, 4);
  const start = Date.parse('2030-03-04T06:00:00Z'); // 09:00 EAT
  const jobs = await jobsCol().find({ sourceId: r.body.activity.id }).sort({ fireAt: 1 }).toArray();
  assert.deepEqual(jobs.map((j: any) => j.kind), ['pre_start', 'start', 'end', 'overdue']);
  assert.deepEqual(jobs.map((j: any) => j.fireAt), [start - 10 * 60_000, start, start + 120 * 60_000, start + 135 * 60_000]);
  assert.equal(jobs[0].title, 'CYMOR REMINDER');
  assert.match(jobs[0].body, /Study Mathematics session starts in 10 minutes/);
  assert.equal(jobs[3].title, 'CYMOR ALERT');

  // edit -> old pending jobs replaced, none duplicated
  const p = await request(app).patch(`/api/activities/${r.body.activity.id}`).set(u.auth).send({ start: '10:00', end: '12:00' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const after = await jobsCol().find({ sourceId: r.body.activity.id }).toArray();
  assert.equal(after.length, 4);
  assert.equal(Math.min(...after.map((j: any) => j.fireAt)), start + 50 * 60_000);

  // delete clears pending jobs
  assert.equal((await request(app).delete(`/api/activities/${r.body.activity.id}`).set(u.auth)).status, 200);
  assert.equal(await jobsCol().countDocuments({ sourceId: r.body.activity.id }), 0);
});

test('activities: validation, conflicts detected not auto-fixed, tenant isolation', T, async () => {
  const u = await signup();
  const o = await signup();
  const bad = await request(app).post('/api/activities').set(u.auth).send({ title: 'X', date: '2030-03-04', start: '11:00', end: '10:00' });
  assert.equal(bad.status, 400);
  assert.equal((await request(app).post('/api/activities').set(u.auth).send({ title: '', date: '2030-03-04', start: '09:00', end: '10:00' })).status, 400);
  const a = await request(app).post('/api/activities').set(u.auth).send({ title: 'A', date: '2030-03-05', start: '09:00', end: '10:00' });
  const b = await request(app).post('/api/activities').set(u.auth).send({ title: 'B', date: '2030-03-05', start: '09:30', end: '10:30' });
  assert.equal(b.body.conflicts.length, 1, 'overlap reported');
  assert.equal(b.body.conflicts[0].overlapMinutes, 30);
  const list = await request(app).get('/api/activities?from=2030-03-05&to=2030-03-05').set(u.auth);
  assert.equal(list.body.activities.length, 2);
  assert.equal(list.body.activities[0].startUtc, Date.parse('2030-03-05T06:00:00Z'), 'A not moved');
  // other tenant cannot see/touch
  assert.equal((await request(app).get('/api/activities?from=2030-03-05&to=2030-03-05').set(o.auth)).body.activities.length, 0);
  assert.equal((await request(app).patch(`/api/activities/${a.body.activity.id}`).set(o.auth).send({ title: 'hacked' })).status, 404);
  assert.equal((await request(app).delete(`/api/activities/${a.body.activity.id}`).set(o.auth)).status, 404);
  assert.equal((await request(app).post(`/api/activities/${a.body.activity.id}/check-in`).set(o.auth).send({})).status, 404);
  assert.equal((await request(app).get('/api/activities/../auth/me').set(o.auth)).status, 404);
});

test('session accounting via API: spec example (120 planned, 138 active, +18 overrun), pause, interruption', T, async () => {
  const u = await signup();
  const day = '2026-01-10';
  const a = (await request(app).post('/api/activities').set(u.auth).send({ title: 'Deep work', date: day, start: '09:00', end: '11:00' })).body.activity;
  const s = Date.parse('2026-01-10T06:00:00Z');
  assert.equal((await request(app).post(`/api/activities/${a.id}/check-out`).set(u.auth).send({ at: s })).status, 409, 'cannot check out before in');
  assert.equal((await request(app).post(`/api/activities/${a.id}/check-in`).set(u.auth).send({ at: s })).status, 200);
  assert.equal((await request(app).post(`/api/activities/${a.id}/check-in`).set(u.auth).send({ at: s })).status, 409);
  const out = await request(app).post(`/api/activities/${a.id}/check-out`).set(u.auth).send({ at: s + 138 * 60_000 });
  assert.equal(out.status, 200);
  assert.equal(out.body.activity.result.status, 'completed_late');
  assert.equal(out.body.activity.result.activeMinutes, 138);
  assert.equal(out.body.activity.result.overrunMinutes, 18);

  const b = (await request(app).post('/api/activities').set(u.auth).send({ title: 'Reading', date: day, start: '12:00', end: '13:00' })).body.activity;
  const t0 = Date.parse('2026-01-10T09:00:00Z');
  await request(app).post(`/api/activities/${b.id}/check-in`).set(u.auth).send({ at: t0 });
  await request(app).post(`/api/activities/${b.id}/pause`).set(u.auth).send({ at: t0 + 10 * 60_000 });
  assert.equal((await request(app).post(`/api/activities/${b.id}/pause`).set(u.auth).send({ at: t0 + 11 * 60_000 })).status, 409);
  await request(app).post(`/api/activities/${b.id}/resume`).set(u.auth).send({ at: t0 + 20 * 60_000 });
  const o = await request(app).post(`/api/activities/${b.id}/check-out`).set(u.auth).send({ at: t0 + 60 * 60_000 });
  assert.equal(o.body.activity.result.pausedMinutes, 10);
  assert.equal(o.body.activity.result.activeMinutes, 50);
  assert.equal((await request(app).post(`/api/activities/${b.id}/check-in`).set(u.auth).send({ at: Date.now() + 3_600_000 })).status, 400);
});

test('reminders: Drink Water every 2h 08:00-20:00 => exactly 7 jobs/day; pause removes pending jobs', T, async () => {
  const u = await signup();
  const d = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const spec = { timezone: 'Africa/Nairobi', startDate: d, endDate: d, startTime: '08:00', endTime: '20:00', repeat: { type: 'hours', every: 2 } };
  const pv = await request(app).post('/api/reminders/preview').set(u.auth).send({ spec, count: 20 });
  assert.equal(pv.body.times.length, 7);
  const r = await request(app).post('/api/reminders').set(u.auth).send({ title: 'Drink Water', description: 'Hydrate', spec });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.jobsPlanned, 7);
  // re-plan idempotent
  const p = await request(app).patch(`/api/reminders/${r.body.reminder.id}`).set(u.auth).send({ title: 'Drink Water!' });
  assert.equal(await jobsCol().countDocuments({ sourceId: r.body.reminder.id }), 7);
  assert.equal(p.status, 200);
  await request(app).patch(`/api/reminders/${r.body.reminder.id}`).set(u.auth).send({ active: false });
  assert.equal(await jobsCol().countDocuments({ sourceId: r.body.reminder.id }), 0);
  assert.equal((await request(app).post('/api/reminders').set(u.auth).send({ title: 'bad', spec: { ...spec, endTime: '07:00' } })).status, 400);
});

test('worker end-to-end on real DB: push mock, 410 deactivates device, precondition skips, client ack sets delivered', T, async () => {
  const u = await signup();
  const userId = u.user.id;
  const sub = async (n: string) => (await request(app).post('/api/notifications/subscribe').set(u.auth).send({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(12) } })).body.id;
  const good = await sub('good');
  const gone = await sub('gone');
  assert.equal((await request(app).post('/api/notifications/subscribe').set(u.auth).send({ endpoint: 'not a url', keys: {} })).status, 400);

  const now = Date.now();
  const a = (await request(app).post('/api/activities').set(u.auth).send({ title: 'Gym', date: new Date(now + 2 * 86_400_000).toISOString().slice(0, 10), start: '09:00', end: '10:00' })).body.activity;
  const store = makeJobStore();
  const sent: any[] = [];
  const push = {
    async send(s: any, p: any) {
      sent.push({ sub: s.id, p });
      return s.id === gone ? { ok: false, status: 410 } : { ok: true, status: 201 };
    },
  };
  const deps = { store, push, subs: new MongoSubscriptionStore(), precondition: mongoPrecondition, workerId: 'w1' };
  const jobs = await jobsCol().find({ sourceId: a.id }).sort({ fireAt: 1 }).toArray();
  const jobTime = jobs[1].fireAt; // 'start'
  const sum = await processBatch(deps, jobTime + 1000);
  assert.equal(sum.claimed, 2, 'pre_start (expired, stale) + start; end/overdue still in the future');
  const states = Object.fromEntries((await jobsCol().find({ sourceId: a.id }).toArray()).map((j: any) => [j.kind, j.status]));
  assert.equal(states.start, 'sent_to_provider', 'never "delivered" from the server');
  assert.equal(states.pre_start, 'expired');
  assert.equal(states.end, 'pending');
  assert.ok(sent.some((x) => x.sub === good) && sent.some((x) => x.sub === gone));
  const subs = (await request(app).get('/api/notifications/subscriptions').set(u.auth)).body.subscriptions;
  assert.equal(subs.find((s: any) => s.id === gone).active, false, '410 deactivates only that device');
  assert.equal(subs.find((s: any) => s.id === good).active, true);

  // client acknowledgement is the only way to reach delivered/opened
  const startJob = jobs[1];
  const token = signAction(userId, startJob.id);
  assert.equal((await request(app).post('/api/notifications/action').send({ token, action: 'delivered' })).status, 200);
  assert.equal((await jobsCol().findOne({ id: startJob.id })).status, 'delivered');
  assert.equal((await request(app).post('/api/notifications/action').send({ token: 'garbage', action: 'delivered' })).status, 401);
  const other = await signup();
  assert.equal((await request(app).post('/api/notifications/action').send({ token: signAction(other.user.id, startJob.id), action: 'delivered' })).status, 404, 'token for another user cannot touch this job');

  // check out before the overdue job => overdue is skipped, not sent
  assert.equal((await request(app).post(`/api/activities/${a.id}/check-in`).set(u.auth).send({ at: jobs[1].fireAt })).status, 400, 'future timestamps rejected');
  await mongoose.connection.db.collection('activities').updateOne({ _id: new mongoose.Types.ObjectId(a.id) }, { $set: { checkInAt: jobs[1].fireAt, checkOutAt: jobs[1].fireAt + 30 * 60_000 } });
  await processBatch(deps, jobs[3].fireAt + 1000);
  const od = await jobsCol().findOne({ sourceId: a.id, kind: 'overdue' });
  assert.equal(od.status, 'skipped');
  assert.equal(od.reason, 'already checked out');

  // snooze creates exactly one new job
  const sn = await request(app).post(`/api/notifications/jobs/${jobs[2].id}/snooze`).set(u.auth).send({ minutes: 10 });
  assert.equal(sn.status, 200);
  assert.equal(await jobsCol().countDocuments({ sourceId: a.id, kind: 'end' }), 2);

  const dg = await request(app).get('/api/notifications/diagnostics').set(u.auth);
  assert.equal(dg.body.activeDevices, 1);
  assert.equal(dg.body.expiredDevices, 1);
  assert.equal(dg.body.worker.alive, false, 'no worker heartbeat in tests, reported honestly');
});

test('notification action buttons: check-in / check-out through signed token', T, async () => {
  const u = await signup();
  const now = Date.now();
  const a = (await request(app).post('/api/activities').set(u.auth).send({ title: 'Task', date: new Date(now + 3 * 86_400_000).toISOString().slice(0, 10), start: '09:00', end: '10:00' })).body.activity;
  const job = await jobsCol().findOne({ sourceId: a.id, kind: 'start' });
  const token = signAction(u.user.id, job.id);
  assert.equal((await request(app).post('/api/notifications/action').send({ token, action: 'check-out' })).status, 409);
  assert.equal((await request(app).post('/api/notifications/action').send({ token, action: 'check-in' })).status, 200);
  assert.equal((await request(app).post('/api/notifications/action').send({ token, action: 'check-in' })).status, 409);
  assert.equal((await request(app).post('/api/notifications/action').send({ token, action: 'check-out' })).status, 200);
});

test('analytics endpoint + import preview/confirm + exports + sharing + deletion', T, async () => {
  const u = await signup();
  const day = '2026-05-02';
  const mk = async (title: string, s: string, e: string) => (await request(app).post('/api/activities').set(u.auth).send({ title, category: 'study', date: day, start: s, end: e })).body.activity;
  const a = await mk('Maths', '09:00', '10:00');
  await mk('Missed', '11:00', '12:00');
  const st = Date.parse('2026-05-02T06:00:00Z');
  await request(app).post(`/api/activities/${a.id}/check-in`).set(u.auth).send({ at: st });
  await request(app).post(`/api/activities/${a.id}/check-out`).set(u.auth).send({ at: st + 50 * 60_000 });
  const an = await request(app).get(`/api/analytics?from=${day}&to=${day}`).set(u.auth);
  assert.equal(an.status, 200);
  assert.equal(an.body.summary.scheduled, 2);
  assert.equal(an.body.summary.completed, 1);
  assert.equal(an.body.summary.timeSavedMinutes, 10);
  assert.equal(an.body.heatmap.length, 24);
  assert.ok(!JSON.stringify(an.body.insights).toLowerCase().includes('wasted'));

  // import: always a preview first
  const csv = 'Date,Start,End,Activity\n2028-06-01,08:00,09:00,Physics\n2028-06-01,10:00,09:00,Broken\n';
  const pv = await request(app).post('/api/import/preview').set(u.auth).attach('file', Buffer.from(csv), 'tt.csv');
  assert.equal(pv.status, 200);
  assert.equal(pv.body.preview.needsReview, true);
  assert.equal(pv.body.preview.rows.length, 2);
  assert.equal((await request(app).post('/api/import/preview').set(u.auth).attach('file', Buffer.from('x'), 'a.pdf')).status, 415);
  const ok = await request(app).post('/api/import/confirm').set(u.auth).send({ rows: [{ title: 'Physics', date: '2028-06-01', start: '08:00', end: '09:00' }] });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.created, 1);
  assert.equal((await request(app).post('/api/import/confirm').set(u.auth).send({ rows: [{ title: 'No date', start: '08:00', end: '09:00' }] })).status, 400);

  // exports
  const ex = await request(app).get(`/api/export/schedule.csv?from=${day}&to=${day}`).set(u.auth);
  assert.match(ex.text, /Maths/);
  assert.match(ex.headers['content-type'], /text\/csv/);
  const ics = await request(app).get(`/api/export/schedule.ics?from=${day}&to=${day}`).set(u.auth);
  assert.match(ics.text, /BEGIN:VCALENDAR[\s\S]*DTSTART:20260502T060000Z[\s\S]*SUMMARY:Maths/);
  const pdf = await request(app).get(`/api/export/schedule.pdf?from=${day}&to=${day}`).set(u.auth).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

  // share: unguessable, read-only, revocable, minimal fields
  const sh = await request(app).post('/api/shares').set(u.auth).send({ from: day, to: day, title: 'Week' });
  assert.equal(sh.status, 201);
  const pub = await request(app).get(`/api/public/shared/${sh.body.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.activities.length, 2);
  assert.equal(pub.body.activities[0].checkInAt, undefined);
  assert.equal(pub.body.owner, 'Test');
  assert.equal((await request(app).get('/api/public/shared/not-a-real-token')).status, 404);
  await request(app).delete(`/api/shares/${sh.body.id}`).set(u.auth);
  assert.equal((await request(app).get(`/api/public/shared/${sh.body.token}`)).status, 404, 'revoked');

  // data export + deletion
  const dump = await request(app).get('/api/auth/export').set(u.auth);
  assert.equal(dump.body.activities.length, 3);
  assert.equal(JSON.stringify(dump.body).includes('passwordHash'), false);
  assert.equal((await request(app).delete('/api/auth/me').set(u.auth).send({ password: 'wrong' })).status, 401);
  assert.equal((await request(app).delete('/api/auth/me').set(u.auth).send({ password: 'correct horse 9' })).status, 200);
  assert.equal(await jobsCol().countDocuments({ userId: u.user.id }), 0);
  assert.equal((await request(app).post('/api/auth/login').send({ email: u.email, password: 'correct horse 9' })).status, 401);
  assert.equal((await request(app).get(`/api/public/shared/${sh.body.token}`)).status, 404);
});

test('habits, goals, focus, reflections, settings', T, async () => {
  const u = await signup();
  const h = (await request(app).post('/api/habits').set(u.auth).send({ name: 'Read' })).body.habit;
  const today = (await request(app).get('/api/habits').set(u.auth)).body.today;
  await request(app).put(`/api/habits/${h.id}/completions/${today}`).set(u.auth).send({ done: true });
  await request(app).put(`/api/habits/${h.id}/completions/${today}`).set(u.auth).send({ done: true }); // idempotent
  const hs = (await request(app).get('/api/habits').set(u.auth)).body.habits[0];
  assert.equal(hs.doneToday, true);
  assert.equal(hs.current, 1);
  const g = (await request(app).post('/api/goals').set(u.auth).send({ title: 'Finish book', target: 10, unit: 'ch' })).body.goal;
  await request(app).patch(`/api/goals/${g.id}`).set(u.auth).send({ progress: 10 });
  const gl = (await request(app).get('/api/goals').set(u.auth)).body.goals[0];
  assert.equal(gl.pct, 100);
  assert.equal(gl.done, true);
  const f = (await request(app).post('/api/focus').set(u.auth).send({ plannedMinutes: 25 })).body.focus;
  assert.equal((await request(app).post('/api/focus').set(u.auth).send({ plannedMinutes: 25 })).status, 409);
  assert.equal((await request(app).post(`/api/focus/${f.id}/end`).set(u.auth)).body.completed, false);
  assert.equal((await request(app).put('/api/reflections/2030-01-01').set(u.auth).send({ mood: 9 })).status, 400);
  await request(app).put('/api/reflections/2030-01-01').set(u.auth).send({ mood: 4, wins: 'ok' });
  assert.equal((await request(app).get('/api/reflections/2030-01-01').set(u.auth)).body.reflection.mood, 4);
  const st = await request(app).patch('/api/settings').set(u.auth).send({ theme: 'light', soundEnabled: false });
  assert.equal(st.body.settings.theme, 'light');
  assert.equal((await request(app).patch('/api/settings').set(u.auth).send({ theme: 'neon' })).status, 400);
});
