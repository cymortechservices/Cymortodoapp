export interface Slot {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
}

export interface Conflict {
  a: string;
  b: string;
  overlapMinutes: number;
}

/**
 * Report overlapping activities. This only DETECTS: it never edits or removes
 * anything, so the UI can warn while the user decides. Back-to-back slots
 * (end == start) are not conflicts.
 */
export function findConflicts(slots: readonly Slot[]): Conflict[] {
  const timed = slots.filter((s) => !s.allDay).slice().sort((x, y) => x.start - y.start);
  const out: Conflict[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j].start >= timed[i].end) break;
      const overlap = Math.min(timed[i].end, timed[j].end) - timed[j].start;
      if (overlap > 0) out.push({ a: timed[i].id, b: timed[j].id, overlapMinutes: Math.round(overlap / 60000) });
    }
  }
  return out;
}

export function validateSlot(s: Pick<Slot, 'start' | 'end' | 'allDay'>): string | null {
  if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return 'Start and end are required';
  if (!s.allDay && s.end <= s.start) return 'End time must be after start time';
  return null;
}
