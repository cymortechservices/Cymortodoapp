import type { Activity } from './types';
import { hhmm, prettyDate } from './time';

/** Render a schedule to a PNG/JPG (client-side canvas). */
export async function scheduleImage(title: string, days: { date: string; items: Activity[] }[], tz: string, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const rows = days.reduce((n, d) => n + 1 + Math.max(d.items.length, 1), 0);
  const W = 1080, rowH = 64, pad = 56, H = pad * 2 + 120 + rows * rowH;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a0b14'); bg.addColorStop(1, '#161a33');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ecf0ff'; g.font = '700 44px system-ui, sans-serif'; g.fillText('CYMOR TO-DO', pad, pad + 40);
  g.fillStyle = '#949aba'; g.font = '24px system-ui, sans-serif'; g.fillText(`${title} · ${tz}`, pad, pad + 80);
  let y = pad + 130;
  for (const d of days) {
    g.fillStyle = '#22d3ee'; g.font = '600 26px system-ui, sans-serif'; g.fillText(prettyDate(d.date), pad, y + 30); y += rowH;
    if (!d.items.length) { g.fillStyle = '#5b6190'; g.font = '22px system-ui, sans-serif'; g.fillText('Nothing scheduled', pad + 24, y + 28); y += rowH; }
    for (const a of d.items) {
      g.fillStyle = a.color || '#7c5cff'; g.fillRect(pad, y + 6, 8, rowH - 20);
      g.fillStyle = '#ecf0ff'; g.font = '500 26px system-ui, sans-serif'; g.fillText(a.title.slice(0, 40), pad + 28, y + 28);
      g.fillStyle = '#949aba'; g.font = '22px system-ui, sans-serif'; g.fillText(`${hhmm(a.startUtc, tz)} – ${hhmm(a.endUtc, tz)}${a.location ? '  ·  ' + a.location : ''}`, pad + 28, y + 54);
      y += rowH;
    }
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not render image'))), type, 0.92));
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
