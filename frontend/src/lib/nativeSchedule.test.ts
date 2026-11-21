import { describe, expect, it } from 'vitest';
import { notifId, planLocal, type UpcomingJob } from './nativeSchedule';

const job = (n: number, at: number): UpcomingJob => ({ id: `job-${n}`, kind: 'start', fireAt: at, title: 't', body: 'b' });

describe('notifId', () => {
  it('is stable, positive and fits an int32', () => {
    const a = notifId('abc123'); expect(a).toBe(notifId('abc123')); expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(0x7fffffff);
  });
  it('differs for different ids', () => { expect(notifId('a')).not.toBe(notifId('b')); });
});

describe('planLocal', () => {
  const now = 1_000_000;
  it('keeps everything and trusts the server horizon when under the cap', () => {
    const p = planLocal([job(2, now + 9000), job(1, now + 5000)], now, now + 7 * 864e5);
    expect(p.items.map((j) => j.id)).toEqual(['job-1', 'job-2']);
    expect(p.localUntil).toBe(now + 7 * 864e5);
  });
  it('drops jobs that are already due or too close to schedule', () => {
    const p = planLocal([job(1, now - 5), job(2, now + 500), job(3, now + 60_000)], now, now + 1e6);
    expect(p.items.map((j) => j.id)).toEqual(['job-3']);
  });
  it('cuts to the nearest cap and shortens localUntil so the server covers the rest', () => {
    const jobs = Array.from({ length: 100 }, (_, i) => job(i, now + 10_000 + i * 1000));
    const p = planLocal(jobs, now, now + 1e9, 60);
    expect(p.items).toHaveLength(60);
    expect(p.localUntil).toBe(p.items[59]!.fireAt);
    expect(p.items[0]!.fireAt).toBeLessThan(p.items[59]!.fireAt);
  });
  it('handles an empty list', () => { expect(planLocal([], now, now + 5)).toEqual({ items: [], localUntil: now + 5 }); });
});
