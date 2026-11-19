import type { SessionInput } from '../core/accounting.js';
import type { AnalyticsActivity } from '../core/analytics.js';

export interface ActivityLike {
  _id: unknown;
  title: string;
  category?: string | null;
  startUtc: number;
  endUtc: number;
  cancelled?: boolean | null;
  checkInAt?: number | null;
  checkOutAt?: number | null;
  pauses?: { start?: number | null; end?: number | null }[] | null;
  interruptions?: { start?: number | null; end?: number | null; reason?: string | null }[] | null;
  markedMissed?: boolean | null;
  endedByInterruption?: boolean | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);

export function toSession(a: ActivityLike): SessionInput {
  return {
    scheduledStart: a.startUtc,
    scheduledEnd: a.endUtc,
    checkInAt: opt(a.checkInAt),
    checkOutAt: opt(a.checkOutAt),
    pauses: (a.pauses ?? []).map((p) => ({ start: p.start as number, end: opt(p.end) })),
    interruptions: (a.interruptions ?? []).map((i) => ({ start: i.start as number, end: opt(i.end), reason: opt(i.reason) })),
    markedMissed: !!a.markedMissed,
    cancelled: !!a.cancelled,
    endedByInterruption: !!a.endedByInterruption,
  };
}

export function toAnalytics(a: ActivityLike): AnalyticsActivity {
  return { id: String(a._id), title: a.title, category: a.category || 'general', session: toSession(a) };
}
