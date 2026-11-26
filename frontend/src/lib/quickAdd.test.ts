import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickAdd';

const TODAY = '2026-11-26'; // a Thursday
const p = (t: string) => parseQuickAdd(t, TODAY);

describe('quick add', () => {
  it('time range with pm', () => { expect(p('Study maths 2pm-3pm')).toMatchObject({ title: 'Study maths', date: TODAY, start: '14:00', end: '15:00', errors: [] }); });
  it('tomorrow with duration', () => { expect(p('gym tomorrow 6am for 1h30')).toMatchObject({ title: 'Gym', date: '2026-11-27', start: '06:00', end: '07:30' }); });
  it('weekday name and minutes', () => { expect(p('Call mum fri 18:30 30m')).toMatchObject({ title: 'Call mum', date: '2026-11-27', start: '18:30', end: '19:00' }); });
  it('24h range + every days', () => { expect(p('Revision 14:00-16:00 every mon wed')).toMatchObject({ title: 'Revision', start: '14:00', end: '16:00', weekdays: [1, 3] }); });
  it('daily and weekdays', () => { expect(p('Walk 7am daily').weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]); expect(p('Standup 9am weekdays').weekdays).toEqual([1, 2, 3, 4, 5]); });
  it('defaults to one hour and reports missing time', () => { const r = p('Read'); expect(r.errors.length).toBeGreaterThan(0); expect(p('Read at 5pm')).toMatchObject({ start: '17:00', end: '18:00', errors: [] }); });
  it('range inherits am/pm and handles 12', () => { expect(p('Lunch 12-1pm')).toMatchObject({ start: '12:00', end: '13:00' }); });
  it('same weekday means today', () => { expect(p('Review thursday 10am').date).toBe(TODAY); });
  it('iso date', () => { expect(p('Exam 2026-12-02 9am for 3h')).toMatchObject({ date: '2026-12-02', start: '09:00', end: '12:00' }); });
});
