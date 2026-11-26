/**
 * Quick-add: turns one typed line into an activity.
 *   "Study maths 2pm-3pm"            today (or tomorrow if that time has passed is NOT assumed: today)
 *   "Gym tomorrow 6am for 1h30"      tomorrow 06:00-07:30
 *   "Call mum fri 18:30 30m"         next Friday 18:30-19:00
 *   "Revision 14:00-16:00 every mon wed"  weekly series (until 12 weeks ahead)
 *   "Walk 7am daily" / "Standup 9am weekdays"
 */
import { addDays, dow } from './time';

export interface QuickParsed { title: string; date: string; start: string; end: string; weekdays?: number[]; until?: string; errors: string[] }

const DAY_NAMES: [string, number][] = [['sunday', 0], ['sun', 0], ['monday', 1], ['mon', 1], ['tuesday', 2], ['tues', 2], ['tue', 2], ['wednesday', 3], ['wed', 3], ['thursday', 4], ['thurs', 4], ['thur', 4], ['thu', 4], ['friday', 5], ['fri', 5], ['saturday', 6], ['sat', 6]];
const dayIdx = (w: string) => DAY_NAMES.find(([n]) => n === w)?.[1];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (min: number) => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad(((min % 60) + 60) % 60)}`;

function parseTime(h: string, m: string | undefined, ap: string | undefined): number | null {
  let hh = Number(h); const mm = m ? Number(m) : 0;
  if (mm > 59) return null;
  if (ap) { if (hh < 1 || hh > 12) return null; hh = hh % 12 + (ap.toLowerCase() === 'pm' ? 12 : 0); } else if (hh > 23) return null;
  return hh * 60 + mm;
}

export function parseQuickAdd(input: string, today: string): QuickParsed {
  let s = ` ${input.trim()} `;
  const errors: string[] = [];
  const take = (re: RegExp): RegExpMatchArray | null => { const m = s.match(re); if (m) s = s.replace(re, ' '); return m; };
  let date = today; let weekdays: number[] | undefined;

  // repeat
  const daily = take(/\s(daily|every day|everyday)\s/i);
  const wkd = take(/\s(weekdays|every weekday)\s/i);
  const every = take(/\severy\s+((?:(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*[\s,]*(?:and\s+)?)+)/i);
  if (daily) weekdays = [0, 1, 2, 3, 4, 5, 6];
  else if (wkd) weekdays = [1, 2, 3, 4, 5];
  else if (every) weekdays = [...new Set(every[1]!.toLowerCase().split(/[\s,]+/).map((w) => dayIdx(w)).filter((x): x is number => x !== undefined))].sort();

  // date
  const iso = take(/\s(\d{4}-\d{2}-\d{2})\s/);
  if (iso) date = iso[1]!;
  else if (take(/\s(tomorrow|tmrw|tmr)\s/i)) date = addDays(today, 1);
  else if (take(/\s(today|tonight)\s/i)) date = today;
  else {
    const d = take(/\s(?:on\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\s/i);
    if (d && !every) { const want = dayIdx(d[1]!.toLowerCase())!; const diff = (want - dow(today) + 7) % 7; date = addDays(today, diff); }
    else if (d && every) s += ` ${d[1]} `; // belongs to the title
  }

  // time range, single time, duration
  let startMin: number | null = null, endMin: number | null = null, dur: number | null = null;
  const range = take(/\s(?:from\s+|at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s/i);
  if (range) {
    const apEnd = range[6], apStart = range[3] ?? apEnd;
    startMin = parseTime(range[1]!, range[2], apStart); endMin = parseTime(range[4]!, range[5], apEnd ?? apStart);
    if (startMin === null || endMin === null) errors.push('Could not read the time range');
  }
  const durM = take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)(?:\s*(\d+)\s*(?:m|min|mins)?)?\s/i);
  const dur2 = take(/\s(?:for\s+)?(\d+)h(\d{1,2})\s/i);
  if (dur2) dur = Number(dur2[1]) * 60 + Number(dur2[2]);
  else if (durM) { const n = Number(durM[1]); dur = /^h/i.test(durM[2]!) ? Math.round(n * 60) + (durM[3] ? Number(durM[3]) : 0) : Math.round(n); }
  if (startMin === null) {
    const one = take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i) ?? take(/\s(?:at\s+)?(\d{1,2}):(\d{2})\s/i) ?? take(/\sat\s+(\d{1,2})\s/i);
    if (one) { startMin = parseTime(one[1]!, one[2], one[3]); if (startMin === null) errors.push('Could not read the time'); }
  }
  if (startMin === null) { errors.push('Add a time, for example "2pm" or "14:00-15:30"'); startMin = 9 * 60; }
  if (endMin === null) endMin = startMin + (dur ?? 60);
  if (endMin === startMin) endMin = startMin + 60;

  const title = s.replace(/\s+/g, ' ').replace(/^\s*(?:on|at|from|for)\s+/i, '').trim().replace(/\s+(?:on|at|from|for|every)$/i, '');
  if (!title) errors.push('Add a name for the activity');
  const out: QuickParsed = { title: title.charAt(0).toUpperCase() + title.slice(1), date, start: hm(startMin), end: hm(endMin), errors };
  if (weekdays?.length) { out.weekdays = weekdays; out.until = addDays(date, 7 * 12); }
  return out;
}
