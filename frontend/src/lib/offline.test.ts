import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api';
import { clearOne, enqueue, flushQueue, pending } from './offline';

beforeEach(async () => { for (const p of await pending()) await clearOne(p.id!); });

describe('offline queue', () => {
  it('replays in order with the ORIGINAL timestamps', async () => {
    await enqueue({ activityId: 'a1', action: 'check-in', at: 1000 });
    await enqueue({ activityId: 'a1', action: 'check-out', at: 5000 });
    const seen: [string, number][] = [];
    const r = await flushQueue(async (a) => { seen.push([a.action, a.at]); });
    expect(seen).toEqual([['check-in', 1000], ['check-out', 5000]]);
    expect(r).toMatchObject({ sent: 2, remaining: 0, conflicts: [] });
  });
  it('stops at a network failure and keeps the rest (order preserved)', async () => {
    await enqueue({ activityId: 'a', action: 'check-in', at: 1 });
    await enqueue({ activityId: 'a', action: 'check-out', at: 2 });
    let n = 0;
    const r = await flushQueue(async () => { if (n++ === 1) throw new NetworkError('x'); });
    expect(r.sent).toBe(1);
    expect(r.remaining).toBe(1);
    expect((await pending()).map((p) => p.action)).toEqual(['check-out']);
  });
  it('reports a rejected action as a conflict instead of silently dropping it', async () => {
    await enqueue({ activityId: 'a', action: 'check-in', at: 1 });
    const r = await flushQueue(async () => { throw new ApiError(409, 'bad_state', 'Already checked in'); });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.message).toBe('Already checked in');
    expect(r.remaining).toBe(0);
  });
  it('keeps actions on server errors / auth trouble', async () => {
    await enqueue({ activityId: 'a', action: 'check-in', at: 1 });
    const r = await flushQueue(async () => { throw new ApiError(500, 'internal', 'boom'); });
    expect(r.remaining).toBe(1);
  });
});
