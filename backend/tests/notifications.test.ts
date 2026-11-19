import test from 'node:test';
import assert from 'node:assert/strict';
import { planActivityJobs, planReminderJobs, overdueBody } from '../src/core/notificationPlan.js';
import { InMemoryJobStore, backoffMs } from '../src/core/queue.js';
import { processBatch, type PushProvider, type PushResult, type SubscriptionStore, type PushSubscriptionRecord } from '../src/core/worker.js';
import { generateOccurrences } from '../src/core/recurrence.js';
import { MIN, zonedToUtc } from '../src/core/time.js';

const T = (hhmm: string) => Date.parse(`2026-11-16T${hhmm}:00Z`);
const activity = { id: 'act1', userId: 'u1', title: 'Programming', startUtc: T('08:00'), endUtc: T('10:00') };

class MockPush implements PushProvider {
  sent: Array<{ sub: string; jobId: string; body: string }> = [];
  constructor(private responder: (sub: PushSubscriptionRecord) => PushResult = () => ({ ok: true, status: 201 })) {}
  async send(sub: PushSubscriptionRecord, p: { jobId: string; body: string }) {
    const r = this.responder(sub);
    if (r.ok) this.sent.push({ sub: sub.id, jobId: p.jobId, body: p.body });
    return r;
  }
}
class MockSubs implements SubscriptionStore {
  expired: string[] = [];
  constructor(public subs: PushSubscriptionRecord[]) {}
  async listActive(userId: string) { return this.subs.filter((s) => s.userId === userId && s.active && !this.expired.includes(s.id)); }
  async markExpired(id: string) { this.expired.push(id); }
}
const sub = (id: string, userId = 'u1'): PushSubscriptionRecord => ({ id, userId, endpoint: `https://push.example/${id}`, active: true });

async function seed(store: InMemoryJobStore, now = 0) {
  for (const j of planActivityJobs(activity)) await store.insert(j, now);
}

test('plan: default sequence is pre(10min) / start / end / overdue with spec wording', () => {
  const jobs = planActivityJobs(activity);
  assert.deepEqual(jobs.map((j) => j.kind), ['pre_start', 'start', 'end', 'overdue']);
  assert.equal(jobs[0].fireAt, T('07:50'));
  assert.equal(jobs[0].body, 'Your Programming session starts in 10 minutes. Prepare yourself.');
  assert.equal(jobs[1].fireAt, T('08:00'));
  assert.equal(jobs[2].fireAt, T('10:00'));
  assert.equal(jobs[3].fireAt, T('10:15'));
  assert.equal(overdueBody('Programming', 15), 'You have exceeded your scheduled Programming time by 15 minutes. Your next activity remains on schedule.');
});

test('plan: stages can be disabled and custom pre-interval applied; invalid input rejected', () => {
  const jobs = planActivityJobs(activity, { preStart: { enabled: true, minutesBefore: 45 }, start: { enabled: false }, end: { enabled: true }, overdue: { enabled: false, minutesAfterEnd: 15 } });
  assert.deepEqual(jobs.map((j) => j.kind), ['pre_start', 'end']);
  assert.equal(jobs[0].fireAt, T('07:15'));
  assert.throws(() => planActivityJobs({ ...activity, endUtc: activity.startUtc }));
});

test('pre-start reminder expires no later than the activity start', () => {
  const pre = planActivityJobs(activity)[0];
  assert.ok(pre.expiresAt <= activity.startUtc);
});

test('idempotency: re-planning the same activity inserts nothing new', async () => {
  const store = new InMemoryJobStore();
  const first = await Promise.all(planActivityJobs(activity).map((j) => store.insert(j, 0)));
  const second = await Promise.all(planActivityJobs(activity).map((j) => store.insert(j, 0)));
  assert.deepEqual(first, [true, true, true, true]);
  assert.deepEqual(second, [false, false, false, false]);
  assert.equal(store.jobs.size, 4);
});

test('due-job processing: only due jobs are claimed, sent to provider (never labelled delivered)', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush(); const subs = new MockSubs([sub('s1')]);
  const s = await processBatch({ store, push, subs, workerId: 'w1' }, T('07:50'));
  assert.equal(s.claimed, 1);
  assert.equal(s.sent, 1);
  const job = await store.findByKey(`pre_start:act1:${T('07:50')}`);
  assert.equal(job?.status, 'sent_to_provider');
  assert.notEqual(job?.status, 'delivered');
  assert.equal([...store.jobs.values()].filter((j) => j.status === 'pending').length, 3); // future jobs untouched
});

test('duplicate prevention: two workers racing on the same due job send exactly once', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush(); const subs = new MockSubs([sub('s1')]);
  const [a, b] = await Promise.all([
    processBatch({ store, push, subs, workerId: 'A' }, T('08:00')),
    processBatch({ store, push, subs, workerId: 'B' }, T('08:00')),
  ]);
  // at 08:00 both pre_start (grace expired -> expired) and start are due; each job handled by one worker only
  assert.equal(a.claimed + b.claimed, 2);
  assert.equal(push.sent.length, 1);
  assert.equal(new Set(push.sent.map((x) => x.jobId)).size, 1);
});

test('multiple devices: all active subscriptions receive the notification', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush(); const subs = new MockSubs([sub('phone'), sub('laptop'), sub('other-user', 'u2')]);
  await processBatch({ store, push, subs, workerId: 'w' }, T('08:00'));
  const startSends = push.sent.filter((x) => x.body.startsWith('Programming'));
  assert.deepEqual(startSends.map((x) => x.sub).sort(), ['laptop', 'phone']);
});

test('expired subscription (410) is deactivated; job fails when no device remains', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush(() => ({ ok: false, status: 410 }));
  const subs = new MockSubs([sub('gone')]);
  const s = await processBatch({ store, push, subs, workerId: 'w' }, T('07:50'));
  assert.deepEqual(subs.expired, ['gone']);
  assert.equal(s.failed, 1);
  assert.ok(store.logs.some((l) => l.outcome === 'subscription_gone'));
});

test('partial success: one dead + one live device still counts as sent', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush((s) => (s.id === 'dead' ? { ok: false, status: 404 } : { ok: true, status: 201 }));
  const subs = new MockSubs([sub('dead'), sub('live')]);
  const s = await processBatch({ store, push, subs, workerId: 'w' }, T('07:50'));
  assert.equal(s.sent, 1);
  assert.deepEqual(subs.expired, ['dead']);
});

test('retry with exponential backoff, then give up after maxAttempts', async () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => backoffMs(n)), [30_000, 60_000, 120_000, 240_000]);
  assert.equal(backoffMs(30), 30 * MIN); // capped

  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush(() => ({ ok: false, status: 503, message: 'unavailable' }));
  const subs = new MockSubs([sub('s1')]);
  let now = T('08:00');
  const draft = planActivityJobs(activity)[1]; // start job: expires 10 min after fire
  let s = await processBatch({ store, push, subs, workerId: 'w', maxAttempts: 3 }, now);
  assert.equal(s.retried >= 1, true);
  const key = draft.idempotencyKey;
  let job = (await store.findByKey(key))!;
  assert.equal(job.status, 'retry');
  assert.equal(job.fireAt, now + 30_000);
  assert.equal(job.attempts, 1);

  now = job.fireAt; await processBatch({ store, push, subs, workerId: 'w', maxAttempts: 3 }, now);
  job = (await store.findByKey(key))!;
  assert.equal(job.attempts, 2); assert.equal(job.fireAt, now + 60_000);

  now = job.fireAt; await processBatch({ store, push, subs, workerId: 'w', maxAttempts: 3 }, now);
  job = (await store.findByKey(key))!;
  assert.equal(job.status, 'failed'); // attempts exhausted, recorded not hidden
  assert.match(job.lastError!, /transient 503/);
});

test('worker restart / crash: leased job is recovered only after its lease lapses', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const claimed = await store.claimDue(T('08:00'), 10, 'crashed-worker', 60_000); // claims then "dies"
  assert.ok(claimed.length > 0);
  const push = new MockPush(); const subs = new MockSubs([sub('s1')]);
  const during = await processBatch({ store, push, subs, workerId: 'new' }, T('08:00') + 30_000);
  assert.equal(during.claimed, 0); // still leased
  const after = await processBatch({ store, push, subs, workerId: 'new' }, T('08:00') + 61_000);
  assert.ok(after.claimed > 0); // lease expired -> recovered, not lost
});

test('offline recovery & stale policy: late jobs are EXPIRED and recorded, never silently dropped', async () => {
  const store = new InMemoryJobStore(); await seed(store);
  const push = new MockPush(); const subs = new MockSubs([sub('s1')]);
  const s = await processBatch({ store, push, subs, workerId: 'w' }, T('09:00')); // worker was down for an hour
  // pre_start, start are stale (expired); end (10:00) not yet due
  assert.equal(s.expired, 2);
  assert.equal(push.sent.length, 0);
  assert.equal(store.logs.filter((l) => l.outcome === 'expired').length, 2);
  const j = await store.findByKey(`start:act1:${T('08:00')}`);
  assert.equal(j?.status, 'expired');
  assert.equal(j?.reason, 'stale');
});

test('overdue follow-up: skipped when already checked out, real overrun text when still running', async () => {
  const mk = async (checkedOut: boolean) => {
    const store = new InMemoryJobStore(); await seed(store);
    const push = new MockPush(); const subs = new MockSubs([sub('s1')]);
    const s = await processBatch({
      store, push, subs, workerId: 'w',
      precondition: async (job) => job.kind !== 'overdue' ? { send: true } :
        checkedOut ? { send: false, reason: 'already checked out' } : { send: true, body: overdueBody('Programming', 15) },
    }, T('10:15'));
    return { s, push, store };
  };
  const done = await mk(true);
  assert.equal(done.s.skipped, 1);
  assert.equal((await done.store.findByKey(`overdue:act1:${T('10:15')}`))?.status, 'skipped');
  const running = await mk(false);
  assert.ok(running.push.sent.some((x) => x.body.includes('by 15 minutes')));
});

test('recurring reminders: Drink Water jobs are generated from occurrences with unique keys and late policy', async () => {
  const spec = { timezone: 'Africa/Nairobi', startDate: '2026-11-01', startTime: '08:00', endTime: '20:00', repeat: { type: 'hours' as const, every: 2 } };
  const from = zonedToUtc('2026-11-16', '00:00', 'Africa/Nairobi');
  const fires = generateOccurrences(spec, from, from + 24 * 60 * MIN);
  const jobs = planReminderJobs({ id: 'r1', userId: 'u1', title: 'Drink Water' }, fires);
  assert.equal(jobs.length, 7);
  assert.equal(new Set(jobs.map((j) => j.idempotencyKey)).size, 7);
  assert.equal(jobs[0].expiresAt - jobs[0].fireAt, 15 * MIN); // default: missed reminders expire rather than arrive hours late
  const critical = planReminderJobs({ id: 'r2', userId: 'u1', title: 'Medication', latePolicy: 'send', maxLateMinutes: 180 }, fires.slice(0, 1));
  assert.equal(critical[0].expiresAt - critical[0].fireAt, 180 * MIN);

  const store = new InMemoryJobStore();
  for (const j of jobs) await store.insert(j, 0);
  for (const j of jobs) assert.equal(await store.insert(j, 0), false);
});
