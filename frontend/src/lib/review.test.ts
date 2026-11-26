import { describe, expect, it } from 'vitest';
import { buildReview } from './review';
import type { AnalyticsResponse } from './types';

const sum = (o: Partial<AnalyticsResponse['summary']>) => ({ scheduled: 10, completed: 8, missed: 1, overdue: 0, unresolved: 1, inProgress: 0, completionPct: 80, plannedMinutes: 600, activeMinutes: 540, overrunMinutes: 0, timeSavedMinutes: 30, interruptionMinutes: 0, unexplainedOverrunMinutes: 0, byCategory: { study: { plannedMinutes: 300, activeMinutes: 300, count: 4 }, gym: { plannedMinutes: 60, activeMinutes: 50, count: 2 } }, ...o });
const resp = (o: Partial<AnalyticsResponse['summary']>): AnalyticsResponse => ({ timezone: 'UTC', summary: sum(o), days: [{ date: '2026-11-16', summary: sum({ completionPct: 50, completed: 1 }) }, { date: '2026-11-17', summary: sum({ completionPct: 100, completed: 3 }) }], heatmap: [], streak: { current: 3, longest: 5 }, insights: [] });

describe('weekly review', () => {
  it('summarises the week and compares with the previous one', () => {
    const r = buildReview(resp({}), resp({ completionPct: 60 }));
    expect(r.hasData).toBe(true); expect(r.headline).toBe('Solid week'); expect(r.delta).toBe(20); expect(r.best).toBe('2026-11-17'); expect(r.topCategory).toBe('study');
    expect(r.lines.join(' ')).toContain('Up 20 points');
  });
  it('handles an empty week', () => { expect(buildReview(resp({ scheduled: 0 }), null).hasData).toBe(false); expect(buildReview(null, null).hasData).toBe(false); });
  it('no comparison without a previous week', () => { expect(buildReview(resp({}), resp({ scheduled: 0 })).delta).toBeNull(); });
});
