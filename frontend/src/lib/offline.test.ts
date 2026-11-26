import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api';
import { L } from './localdb';
import { flushOps } from './sync';
import { api } from './api';
import { upcomingJobs } from './localApi';

const user = { id: 'local', email: null, name: 'Amina', timezone: 'Africa/Nairobi', emailVerified: false, guest: true, hasPassword: false };
const settings = { theme: 'dark', weekStartsOn: 1, soundEnabled: true, sound: 'chime', reducedMotion: false, introSeen: true, defaultNotify: { preStart: { enabled: true, minutesBefore: 10 }, start: { enabled: true }, alarm: true, end: { enabled: true }, overdue: { enabled: true, minutesAfterEnd: 15 } } } as never;

beforeEach(async () => { await L.reset(); await L.set('user', user); await L.set('settings', settings); });

const create = (title: string, date: string, start: string, end: string) => api<{ activity: { id: string } }>('/activities', { method: 'POST', body: { title, date, start, end } });
const list = (date: string) => api<{ activities: { id: string; title: string; result: { status: string } }[] }>(`/activities?from=${date}&to=${date}`);

describe('local-first (no internet at all)', () => {
  it('creates, lists, edits and deletes activities locally and queues each change', async () => {
    const a = await create('Study', '2030-01-10', '08:00', '09:00');
    expect((await list('2030-01-10')).activities.map((x) => x.title)).toEqual(['Study']);
    await api(`/activities/${a.activity.id}`, { method: 'PATCH', body: { title: 'Study maths' } });
    expect((await list('2030-01-10')).activities[0]!.title).toBe('Study maths');
    await api(`/activities/${a.activity.id}`, { method: 'DELETE' });
    expect((await list('2030-01-10')).activities).toHaveLength(0);
    expect(L.get('ops').map((o) => o.method)).toEqual(['POST', 'PATCH', 'DELETE']);
  });
  it('rejects bad input like the server does', async () => {
    await expect(create('', '2030-01-10', '08:00', '09:00')).rejects.toBeInstanceOf(ApiError);
    await expect(create('x', '2030-01-10', '09:00', '08:00')).rejects.toThrow(/after start/);
  });
  it('session actions keep the original time and follow the same state rules', async () => {
    const a = await create('Gym', '2020-01-10', '08:00', '09:00');
    const id = a.activity.id;
    await api(`/activities/${id}/check-in`, { method: 'POST', body: { at: 1578636000000 } });
    await expect(api(`/activities/${id}/check-in`, { method: 'POST', body: {} })).rejects.toThrow(/Already checked in/);
    await api(`/activities/${id}/check-out`, { method: 'POST', body: { at: 1578639000000 } });
    const r = (await list('2020-01-10')).activities[0]!;
    expect(r.result.status).toMatch(/completed/);
    expect(L.get('ops').at(-1)!.body).toMatchObject({ at: 1578639000000 });
  });
  it('flush replays in order, maps phone ids to server ids, and stops on network loss', async () => {
    const a = await create('Read', '2030-02-01', '10:00', '11:00');
    await api(`/activities/${a.activity.id}`, { method: 'PATCH', body: { title: 'Read more' } });
    const seen: string[] = [];
    const r = await flushOps(async (m, p, b) => { seen.push(`${m} ${p}`); if (m === 'POST') return { activity: { id: 'srv123' } }; void b; });
    expect(seen).toEqual(['POST /activities', 'PATCH /activities/srv123']);
    expect(r).toMatchObject({ sent: 2, remaining: 0 });
    expect(L.get('acts')[0]!.id).toBe('srv123');
    await create('Another', '2030-02-02', '10:00', '11:00');
    const r2 = await flushOps(async () => { throw new NetworkError('x'); });
    expect(r2).toMatchObject({ offline: true, remaining: 1 });
  });
  it('drops a change the server rejects and reports it', async () => {
    await create('Once', '2030-03-01', '10:00', '11:00');
    const r = await flushOps(async () => { throw new ApiError(409, 'bad_state', 'Already checked in'); });
    expect(r.conflicts).toHaveLength(1); expect(r.remaining).toBe(0);
  });
  it('keeps a change on server errors', async () => {
    await create('Once', '2030-03-01', '10:00', '11:00');
    expect((await flushOps(async () => { throw new ApiError(500, 'x', 'boom'); })).remaining).toBe(1);
  });
  it('plans phone alarms for the future start time, skips cancelled and started activities', async () => {
    const soon = Date.now() + 3_600_000;
    const d = new Date(soon + 3 * 3_600_000);
    const fmt = (t: number) => ({
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(t),
      hm: new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t),
    });
    // built from real instants so it also works when the hour is 23:xx (the end then falls on the next day)
    const s0 = fmt(d.getTime()), e0 = fmt(d.getTime() + 3_600_000);
    const a = await api<{ activity: { id: string } }>('/activities', { method: 'POST', body: { title: 'Meeting', date: s0.date, start: s0.hm, end: e0.hm, endDate: e0.date } });
    const kinds = () => upcomingJobs(Date.now()).jobs.filter((j) => j.sourceId === a.activity.id).map((j) => j.kind);
    expect(kinds()).toEqual(expect.arrayContaining(['pre_start', 'start', 'end', 'overdue']));
    expect(upcomingJobs(Date.now()).jobs.find((j) => j.kind === 'start')!.alarm).toBe(true);
    await api(`/activities/${a.activity.id}/cancel`, { method: 'POST', body: {} });
    expect(kinds()).toEqual([]);
  });
});
