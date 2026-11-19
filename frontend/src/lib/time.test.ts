import { describe, expect, it } from 'vitest';
import { addDays, fmtClock, fmtDuration, hhmm, startOfWeek, ymdOf } from './time';

describe('time helpers', () => {
  it('formats in the user timezone, not the device one', () => {
    const t = Date.parse('2030-03-04T06:00:00Z');
    expect(hhmm(t, 'Africa/Nairobi')).toBe('09:00');
    expect(ymdOf(Date.parse('2030-03-04T22:30:00Z'), 'Africa/Nairobi')).toBe('2030-03-05');
    expect(ymdOf(Date.parse('2030-03-04T22:30:00Z'), 'UTC')).toBe('2030-03-04');
  });
  it('calendar math', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2030-01-01', -1)).toBe('2029-12-31');
    expect(startOfWeek('2030-03-06', 1)).toBe('2030-03-04'); // Wed -> Mon
    expect(startOfWeek('2030-03-03', 1)).toBe('2030-02-25'); // Sun -> previous Mon
  });
  it('durations and clock', () => {
    expect(fmtDuration(138)).toBe('2h 18m');
    expect(fmtDuration(120)).toBe('2h');
    expect(fmtDuration(-18)).toBe('18m');
    expect(fmtClock(65_000)).toBe('1:05');
    expect(fmtClock(3_725_000)).toBe('1:02:05');
  });
});
