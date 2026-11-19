/** Timezone-aware display helpers. Server owns the truth; these only format. */
export const MIN = 60_000;

export function localParts(ms: number, tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hh: g('hour'), mm: g('minute') };
}
export const ymdOf = (ms: number, tz: string) => localParts(ms, tz).date;
export const hhmm = (ms: number, tz: string) => { const p = localParts(ms, tz); return `${p.hh}:${p.mm}`; };

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
export function dow(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function startOfWeek(ymd: string, weekStartsOn = 1): string {
  return addDays(ymd, -((dow(ymd) - weekStartsOn + 7) % 7));
}
export function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function fmtDuration(totalMin: number): string {
  const m = Math.round(Math.abs(totalMin));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  return h ? `${h}h` : `${r}m`;
}
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;
}
export const timezones = (): string[] => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return ['Africa/Nairobi', 'UTC']; }
};
export const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
