/**
 * Local-first API: answers the core routes from the on-phone database and queues every change for the server.
 * It reuses the very same engine as the backend (src/core), so statuses, overlaps, reminders and schedules agree.
 * Returns `NOT_LOCAL` for routes that genuinely need the server (sharing, habits, import, devices ...).
 */
import { ApiError } from './api';
import { L, newId, type Op, type RawActivity, type RawReminder } from './localdb';
import type { NotifyCfg, Settings } from './auth';
import { evaluateSession, type SessionInput } from '../core/accounting';
import { findConflicts, validateSlot } from '../core/overlap';
import { addDays, dayOfWeek, localDate, zonedToUtc } from '../core/time';
import { DEFAULT_ACTIVITY_NOTIFY, overdueBody, planActivityJobs, planReminderJobs } from '../core/notificationPlan';
import { generateOccurrences, nextOccurrence, validateSpec, type ReminderSpec } from '../core/recurrence';
import { completionStreak, evaluateAll, hourlyHeatmap, insights, perDay, summarize } from '../core/analytics';

export const NOT_LOCAL = Symbol('not-local');
const YMD = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const bad = (m: string, code = 'bad_request') => new ApiError(400, code, m);
const conflict = (m: string) => new ApiError(409, 'bad_state', m);
const notFound = (m: string) => new ApiError(404, 'not_found', m);

const tzOf = () => L.get('user')?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
const defaultNotify = (): NotifyCfg => ({ ...structuredClone(DEFAULT_ACTIVITY_NOTIFY), ...(L.get('settings')?.defaultNotify ?? {}) } as NotifyCfg);

async function queue(method: string, path: string, body?: unknown) {
  const id = L.get('opSeq') + 1;
  await L.set('opSeq', id);
  const op: Op = { id, method, path, body, queuedAt: Date.now() };
  await L.set('ops', [...L.get('ops'), op]);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('cymor:queued'));
}

const toSession = (a: RawActivity): SessionInput => ({
  scheduledStart: a.startUtc, scheduledEnd: a.endUtc, checkInAt: a.checkInAt ?? undefined, checkOutAt: a.checkOutAt ?? undefined,
  pauses: a.pauses.map((p) => ({ start: p.start, end: p.end ?? undefined })),
  interruptions: a.interruptions.map((i) => ({ start: i.start, end: i.end ?? undefined, reason: i.reason })),
  markedMissed: !!a.markedMissed, cancelled: a.cancelled, endedByInterruption: !!a.endedByInterruption,
});
const decorate = (a: RawActivity, now: number, tz: string) => ({ ...a, localDate: localDate(a.startUtc, tz), result: evaluateSession(toSession(a), now) });

function resolveTimes(b: { date: string; start: string; end: string; endDate?: string }, tz: string) {
  if (!YMD.test(b.date) || (b.endDate && !YMD.test(b.endDate))) throw bad('Dates must look like YYYY-MM-DD');
  if (!HHMM.test(b.start) || !HHMM.test(b.end)) throw bad('Times must look like HH:mm');
  const startUtc = zonedToUtc(b.date, b.start, tz), endUtc = zonedToUtc(b.endDate ?? b.date, b.end, tz);
  const err = validateSlot({ start: startUtc, end: endUtc });
  if (err) throw bad(err, 'bad_time');
  return { startUtc, endUtc };
}
const hhmmOf = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

function cleanBase(b: Record<string, unknown>) {
  const out: Partial<RawActivity> = {};
  if (b.title !== undefined) { const t = String(b.title).trim(); if (!t || t.length > 200) throw bad('Title is required (max 200 characters)'); out.title = t; }
  if (b.description !== undefined) out.description = String(b.description).slice(0, 2000);
  if (b.category !== undefined) out.category = String(b.category).trim().slice(0, 50) || 'general';
  if (b.color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(String(b.color))) throw bad('Invalid colour'); out.color = String(b.color); }
  if (b.location !== undefined) out.location = String(b.location).slice(0, 200);
  if (b.notify !== undefined) out.notify = b.notify as NotifyCfg;
  return out;
}

const range = (q: URLSearchParams) => {
  const from = q.get('from') ?? '', to = q.get('to') ?? '';
  if (!YMD.test(from) || !YMD.test(to)) throw bad('from and to are required (YYYY-MM-DD)');
  if (to < from) throw bad('"to" must not be before "from"', 'bad_range');
  const tz = tzOf();
  return [zonedToUtc(from, '00:00', tz), zonedToUtc(addDays(to, 1), '00:00', tz)] as const;
};

const OPEN = <T extends { end?: number | null }>(arr: T[]) => arr.find((x) => x.end === undefined || x.end === null);

function applyAction(a: RawActivity, name: string, t: number, b: { reason?: string; endedByInterruption?: boolean }) {
  switch (name) {
    case 'check-in': if (a.cancelled) throw conflict('Activity is cancelled'); if (a.checkInAt) throw conflict('Already checked in'); a.checkInAt = t; a.markedMissed = false; break;
    case 'pause': if (!a.checkInAt || a.checkOutAt) throw conflict('Not in progress'); if (OPEN(a.pauses)) throw conflict('Already paused'); a.pauses.push({ start: t }); break;
    case 'resume': { const p = OPEN(a.pauses); if (!p) throw conflict('Not paused'); p.end = t; break; }
    case 'interrupt': if (!a.checkInAt || a.checkOutAt) throw conflict('Not in progress'); if (OPEN(a.interruptions)) throw conflict('An interruption is already open'); a.interruptions.push({ start: t, reason: b.reason ?? '' }); break;
    case 'end-interruption': { const i = OPEN(a.interruptions); if (!i) throw conflict('No open interruption'); i.end = t; break; }
    case 'check-out': {
      if (!a.checkInAt) throw conflict('Check in first'); if (a.checkOutAt) throw conflict('Already checked out'); if (t < a.checkInAt) throw bad('Check-out before check-in', 'bad_time');
      const p = OPEN(a.pauses); if (p) p.end = t; const i = OPEN(a.interruptions); if (i) i.end = t;
      a.checkOutAt = t; if (b.endedByInterruption) a.endedByInterruption = true; break;
    }
    case 'miss': if (a.checkInAt) throw conflict('Already started'); a.markedMissed = true; break;
    case 'cancel': a.cancelled = true; break;
    case 'uncancel': a.cancelled = false; break;
    default: throw notFound('Unknown action');
  }
}

const remView = (r: RawReminder, now: number) => ({ ...r, next: r.active ? nextOccurrence(r.spec, now) : null });
function checkedSpec(spec: ReminderSpec): ReminderSpec {
  const errs = validateSpec(spec);
  if (errs.length) throw bad(errs.join('; '), 'bad_schedule');
  return spec;
}

/** Everything the phone should ring for, already filtered like the server's send-time checks. */
export function upcomingJobs(now: number, hours = 168, limit = 60) {
  const jobs: { id: string; kind: string; sourceId: string; fireAt: number; title: string; body: string; url: string; alarm?: boolean }[] = [];
  for (const a of L.get('acts')) {
    if (a.cancelled || a.endUtc <= a.startUtc || a.endUtc < now - 3_600_000) continue;
    const res = evaluateSession(toSession(a), now);
    for (const j of planActivityJobs({ id: a.id, userId: 'local', title: a.title, startUtc: a.startUtc, endUtc: a.endUtc }, a.notify ?? DEFAULT_ACTIVITY_NOTIFY)) {
      if (j.fireAt <= now || j.fireAt > now + hours * 3_600_000) continue;
      if ((j.kind === 'pre_start' || j.kind === 'start') && a.checkInAt) continue;
      if ((j.kind === 'end' || j.kind === 'overdue') && a.checkOutAt) continue;
      if (j.kind === 'overdue' && res.status === 'missed') continue;
      jobs.push({ id: j.idempotencyKey, kind: j.kind, sourceId: j.sourceId, fireAt: j.fireAt, title: j.title, body: j.kind === 'overdue' ? overdueBody(a.title, Math.max(res.overrunMinutes, 0)) : j.body, url: j.url, ...(j.kind === 'start' ? { alarm: a.notify?.alarm !== false } : {}) });
    }
  }
  for (const r of L.get('rems')) {
    if (!r.active) continue;
    const times = generateOccurrences(r.spec, now, now + Math.min(hours, 168) * 3_600_000);
    for (const j of planReminderJobs({ id: r.id, userId: 'local', title: r.title, description: r.description, latePolicy: r.latePolicy === 'send' ? 'send' : 'expire', maxLateMinutes: r.maxLateMinutes }, times)) {
      if (j.fireAt > now) jobs.push({ id: j.idempotencyKey, kind: j.kind, sourceId: j.sourceId, fireAt: j.fireAt, title: j.title, body: j.body, url: j.url });
    }
  }
  jobs.sort((x, y) => x.fireAt - y.fireAt || x.id.localeCompare(y.id));
  const out = jobs.slice(0, limit);
  const horizon = jobs.length > limit ? out[out.length - 1]!.fireAt : now + hours * 3_600_000;
  return { now, horizon, jobs: out };
}

export async function localRoute(method: string, rawPath: string, body: unknown): Promise<unknown | typeof NOT_LOCAL> {
  if (!L.get('user')) return NOT_LOCAL;
  const [path, qs = ''] = rawPath.split('?');
  const q = new URLSearchParams(qs);
  const b = (body ?? {}) as Record<string, unknown>;
  const now = Date.now(), tz = tzOf();
  let m: RegExpMatchArray | null;

  if (path === '/auth/me') {
    if (method === 'GET') return { user: L.get('user') };
    if (method === 'PATCH') {
      const u = { ...L.get('user')! };
      if (typeof b.name === 'string' && b.name.trim()) u.name = b.name.trim();
      if (typeof b.timezone === 'string') { try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }); u.timezone = b.timezone; } catch { throw bad('Invalid timezone'); } }
      await L.set('user', u); await queue('PATCH', path, body);
      return { user: u };
    }
    return NOT_LOCAL;
  }
  if (path === '/settings') {
    if (method === 'GET') return { settings: L.get('settings') };
    if (method === 'PATCH') { const s = { ...(L.get('settings') as Settings), ...b } as Settings; await L.set('settings', s); await queue('PATCH', path, body); return { settings: s }; }
    return NOT_LOCAL;
  }

  if (path === '/activities') {
    if (method === 'GET') {
      const [a, z] = range(q);
      const rows = L.get('acts').filter((x) => x.startUtc >= a && x.startUtc < z).sort((x, y) => x.startUtc - y.startUtc);
      const conflicts = findConflicts(rows.filter((x) => !x.cancelled).map((x) => ({ id: x.id, title: x.title, start: x.startUtc, end: x.endUtc })));
      return { timezone: tz, now, activities: rows.map((x) => decorate(x, now, tz)), conflicts };
    }
    if (method === 'POST') {
      const base = cleanBase(b);
      if (!base.title) throw bad('Title is required');
      const { startUtc, endUtc } = resolveTimes(b as never, tz);
      const id = newId();
      const a: RawActivity = { id, title: base.title, description: base.description ?? '', category: base.category ?? 'general', color: base.color ?? '#D4AF37', location: base.location ?? '', startUtc, endUtc, cancelled: false, notify: base.notify ?? defaultNotify(), checkInAt: null, checkOutAt: null, pauses: [], interruptions: [] };
      await L.set('acts', [...L.get('acts'), a]);
      await queue('POST', path, { ...b, clientId: id });
      const overl = findConflicts(L.get('acts').filter((x) => !x.cancelled && x.startUtc < endUtc && x.endUtc > startUtc).map((x) => ({ id: x.id, title: x.title, start: x.startUtc, end: x.endUtc })));
      return { activity: decorate(a, now, tz), jobsPlanned: 0, conflicts: overl };
    }
  }
  if (path === '/activities/series' && method === 'POST') {
    const base = cleanBase(b);
    if (!base.title) throw bad('Title is required');
    const { date, start, end, endDate, until } = b as { date: string; start: string; end: string; endDate?: string; until: string };
    const weekdays = (b.weekdays as number[] | undefined) ?? [];
    if (!YMD.test(until ?? '') || until < date) throw bad('"until" must not be before "date"', 'bad_range');
    if (!weekdays.length) throw bad('Pick at least one weekday');
    const seriesId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const nights = endDate ? Math.round((Date.parse(endDate) - Date.parse(date)) / 86_400_000) : 0;
    const created: RawActivity[] = [];
    for (let d = date; d <= until; d = addDays(d, 1)) {
      if (!weekdays.includes(dayOfWeek(d))) continue;
      const { startUtc, endUtc } = resolveTimes({ date: d, start, end, endDate: nights ? addDays(d, nights) : undefined }, tz);
      created.push({ id: newId(), title: base.title, description: base.description ?? '', category: base.category ?? 'general', color: base.color ?? '#D4AF37', location: base.location ?? '', startUtc, endUtc, cancelled: false, notify: base.notify ?? defaultNotify(), seriesId, checkInAt: null, checkOutAt: null, pauses: [], interruptions: [] });
      if (created.length > 366) throw bad('Series too long (max 366 occurrences)', 'too_many');
    }
    if (!created.length) throw bad('No dates match those weekdays in the range', 'empty_series');
    await L.set('acts', [...L.get('acts'), ...created]);
    await queue('POST', path, body);
    return { seriesId, created: created.length, jobsPlanned: 0 };
  }
  if ((m = path.match(/^\/activities\/([^/]+)(?:\/([a-z-]+))?$/))) {
    const [, id, act] = m as unknown as [string, string, string | undefined];
    const acts = L.get('acts'); const i = acts.findIndex((x) => x.id === id);
    if (i < 0) throw notFound('Activity not found');
    const a = structuredClone(acts[i]!);
    const save = async () => { const n = [...L.get('acts')]; n[i] = a; await L.set('acts', n); };
    if (!act && method === 'PATCH') {
      Object.assign(a, cleanBase(b));
      if (b.date || b.start || b.end || b.endDate) {
        const cur = localDate(a.startUtc, tz);
        const t = resolveTimes({ date: (b.date as string) ?? cur, start: (b.start as string) ?? hhmmOf(a.startUtc, tz), end: (b.end as string) ?? hhmmOf(a.endUtc, tz), endDate: (b.endDate as string) ?? (b.date ? undefined : localDate(a.endUtc, tz) !== cur ? localDate(a.endUtc, tz) : undefined) }, tz);
        a.startUtc = t.startUtc; a.endUtc = t.endUtc;
      }
      await save(); await queue('PATCH', rawPath, body);
      return { activity: decorate(a, now, tz), jobsPlanned: 0 };
    }
    if (!act && method === 'DELETE') { await L.set('acts', acts.filter((x) => x.id !== id)); await queue('DELETE', rawPath); return { ok: true }; }
    if (act && method === 'POST') {
      const t = typeof b.at === 'number' ? Math.min(b.at, now) : now;
      applyAction(a, act, t, b as never);
      await save(); await queue('POST', rawPath, { ...b, at: t });
      return { activity: decorate(a, now, tz) };
    }
  }

  if (path === '/reminders') {
    if (method === 'GET') return { reminders: [...L.get('rems')].reverse().map((r) => remView(r, now)) };
    if (method === 'POST') {
      const title = String(b.title ?? '').trim(); if (!title) throw bad('Title is required');
      const spec = checkedSpec(b.spec as ReminderSpec);
      const r: RawReminder = { id: newId(), title, description: b.description ? String(b.description) : '', spec, active: true, latePolicy: b.latePolicy === 'send' ? 'send' : 'expire', maxLateMinutes: Number(b.maxLateMinutes) || 120 };
      await L.set('rems', [...L.get('rems'), r]); await queue('POST', path, body);
      return { reminder: remView(r, now), jobsPlanned: 0 };
    }
  }
  if (path === '/reminders/preview' && method === 'POST') {
    const spec = checkedSpec(b.spec as ReminderSpec);
    return { times: generateOccurrences(spec, now, now + 400 * 86_400_000).slice(0, Number(b.count) || 10) };
  }
  if ((m = path.match(/^\/reminders\/([^/]+)$/))) {
    const id = m[1]!; const rems = L.get('rems'); const i = rems.findIndex((x) => x.id === id);
    if (i < 0) throw notFound('Reminder not found');
    if (method === 'DELETE') { await L.set('rems', rems.filter((x) => x.id !== id)); await queue('DELETE', rawPath); return { ok: true }; }
    if (method === 'PATCH') {
      const r = { ...rems[i]! };
      if (b.spec) r.spec = checkedSpec(b.spec as ReminderSpec);
      for (const k of ['title', 'description', 'latePolicy', 'maxLateMinutes', 'active'] as const) if (b[k] !== undefined) (r as Record<string, unknown>)[k] = b[k];
      const n = [...rems]; n[i] = r; await L.set('rems', n); await queue('PATCH', rawPath, body);
      return { reminder: remView(r, now), jobsPlanned: 0 };
    }
  }

  if (path === '/analytics' && method === 'GET') {
    const [a, z] = range(q);
    const toA = (x: RawActivity) => ({ id: x.id, title: x.title, category: x.category || 'general', session: toSession(x) });
    const rows = L.get('acts').filter((x) => x.startUtc >= a && x.startUtc < z).map(toA);
    const evaluated = evaluateAll(rows, now, tz);
    const heatmap = hourlyHeatmap(rows, now, tz);
    const today = localDate(now, tz);
    const sa = zonedToUtc(addDays(today, -120), '00:00', tz);
    const streak = completionStreak(perDay(evaluateAll(L.get('acts').filter((x) => x.startUtc >= sa).map(toA), now, tz)), today);
    return { timezone: tz, summary: summarize(evaluated), days: perDay(evaluated), heatmap, streak, insights: insights(evaluated, heatmap) };
  }

  if (path === '/notifications/upcoming' && method === 'GET') return upcomingJobs(now, Number(q.get('hours')) || 168, Number(q.get('limit')) || 60);

  return NOT_LOCAL;
}
