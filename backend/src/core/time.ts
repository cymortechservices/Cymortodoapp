/**
 * Timezone-aware time helpers built on Intl only (no dependencies).
 * All instants are UTC epoch milliseconds; user timezone is an IANA name.
 */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(utcMs: number, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` from UTC at the given instant, in ms (e.g. Nairobi = +3h). */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function parseHHmm(t: string): { h: number; m: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!match) throw new Error(`Invalid time "${t}", expected HH:mm`);
  return { h: Number(match[1]), m: Number(match[2]) };
}

export function parseYmd(d: string): { y: number; mo: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!match) throw new Error(`Invalid date "${d}", expected YYYY-MM-DD`);
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const dd = Number(match[3]);
  const check = new Date(Date.UTC(y, mo - 1, dd));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== dd) {
    throw new Error(`Invalid calendar date "${d}"`);
  }
  return { y, mo, d: dd };
}

export function ymd(y: number, mo: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Add whole calendar days to a YYYY-MM-DD string (pure calendar arithmetic). */
export function addDays(date: string, n: number): string {
  const { y, mo, d } = parseYmd(date);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.d) - Date.UTC(pa.y, pa.mo - 1, pa.d)) / DAY);
}

/** Day of week of a calendar date: 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: string): number {
  const { y, mo, d } = parseYmd(date);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The user's local calendar date (YYYY-MM-DD) for an instant. */
export function localDate(utcMs: number, tz: string): string {
  const p = localParts(utcMs, tz);
  return ymd(p.year, p.month, p.day);
}

/**
 * Convert a local wall-clock time to a UTC instant.
 * - Ambiguous times (DST fall-back) resolve to the FIRST occurrence.
 * - Non-existent times (DST spring-forward gap) resolve to the instant
 *   immediately after the gap (the wall clock is moved forward).
 */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const { y, mo, d } = parseYmd(date);
  const { h, m } = parseHHmm(time);
  const naive = Date.UTC(y, mo - 1, d, h, m, 0);

  // Candidate offsets just before and just after the naive instant.
  const offBefore = tzOffsetMs(naive - DAY, tz);
  const offAfter = tzOffsetMs(naive + DAY, tz);
  const candidates = Array.from(new Set([offBefore, offAfter])).map((off) => naive - off);

  const valid = candidates.filter((c) => tzOffsetMs(c, tz) === naive - c);
  if (valid.length > 0) return Math.min(...valid); // earliest = first occurrence

  // In a gap: no candidate maps back. Use the pre-gap offset => lands after the gap.
  return naive - offBefore;
}

export function formatLocal(utcMs: number, tz: string): string {
  const p = localParts(utcMs, tz);
  return `${ymd(p.year, p.month, p.day)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function minutesBetween(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / MIN);
}
