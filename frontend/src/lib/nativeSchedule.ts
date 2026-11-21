/** Pure planning logic for phone-side (local) notifications. No Capacitor imports so it is unit-testable. */
export interface UpcomingJob { id: string; kind: string; sourceId?: string; fireAt: number; title: string; body: string; url?: string }

/** Stable positive 31-bit integer id (Android notification ids are ints). FNV-1a. */
export function notifId(jobId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < jobId.length; i++) { h ^= jobId.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h & 0x7fffffff) || 1;
}

export interface Plan { items: UpcomingJob[]; /** every server job firing at or before this instant is scheduled locally */ localUntil: number }

/**
 * Pick the nearest `cap` future jobs. `horizon` is what the server guarantees it listed completely.
 * If we had to cut the list, local coverage only extends to the last scheduled job, so the server keeps
 * pushing anything later (nativeNeedsServerPush uses this value).
 */
export function planLocal(jobs: UpcomingJob[], now: number, horizon: number, cap = 60, minLeadMs = 2000): Plan {
  const seen = new Set<number>();
  const future = jobs.filter((j) => j.fireAt > now + minLeadMs).sort((a, b) => a.fireAt - b.fireAt || a.id.localeCompare(b.id))
    .filter((j) => { const n = notifId(j.id); if (seen.has(n)) return false; seen.add(n); return true; });
  if (future.length <= cap) return { items: future, localUntil: horizon };
  const items = future.slice(0, cap);
  return { items, localUntil: Math.min(horizon, items[items.length - 1]!.fireAt) };
}

export const ACTIONS_BY_KIND: Record<string, { id: string; title: string }[]> = {
  pre_start: [{ id: 'snooze', title: 'Snooze 5 min' }],
  start: [{ id: 'check-in', title: 'Check in' }, { id: 'snooze', title: 'Snooze 5 min' }],
  end: [{ id: 'check-out', title: 'Check out' }, { id: 'snooze', title: 'Snooze 5 min' }],
  overdue: [{ id: 'check-out', title: 'Check out' }],
  reminder: [{ id: 'snooze', title: 'Snooze 10 min' }],
};
