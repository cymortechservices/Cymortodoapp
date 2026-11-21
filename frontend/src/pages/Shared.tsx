import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { fmtDuration, hhmm, prettyDate } from '../lib/time';
import { saveBlob, scheduleImage } from '../lib/image';
import type { Activity } from '../lib/types';
import { ErrorBox, Spinner } from '../components/ui';

interface PubItem { title: string; category?: string; location?: string; color?: string; startUtc: number; endUtc: number; localDate: string }
interface Pub { title: string; owner: string; timezone: string; from: string; to: string; activities: PubItem[] }
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

/** Public, read-only schedule. No login; titles, times and locations only. Designed to look right when opened from a chat link on a phone. */
export default function Shared() {
  const { token } = useParams();
  const { data, error, loading } = useAsync(() => api<Pub>(`/public/shared/${encodeURIComponent(token ?? '')}`, { auth: false }), [token]);
  if (loading) return <div className="py-24"><Spinner /></div>;
  if (error || !data) return <div className="mx-auto max-w-md p-6"><ErrorBox msg="This shared schedule is not available. It may have expired or been revoked." /></div>;
  const tz = data.timezone;
  const days = [...new Set(data.activities.map((a) => a.localDate))].sort();
  const total = data.activities.reduce((s, a) => s + (a.endUtc - a.startUtc) / 60000, 0);
  const icsUrl = `${API}/api/public/shared/${encodeURIComponent(token ?? '')}/calendar.ics`;
  const asImage = async () => {
    const items = days.map((d) => ({ date: d, items: data.activities.filter((a) => a.localDate === d).map((a) => ({ ...a, color: a.color ?? '#D4AF37' }) as unknown as Activity) }));
    saveBlob(await scheduleImage(data.title, items, tz), 'cymor-schedule.png');
  };
  const share = async () => { try { await navigator.share({ title: data.title, text: `${data.owner}'s schedule on CYMOR TO-DO`, url: location.href }); } catch { /* cancelled */ } };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-[max(env(safe-area-inset-top),1.5rem)]">
      <header className="card-gold rise mb-6 overflow-hidden p-6 text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-12 w-12" />
        <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.35em] text-fg-dim">CYMOR TO-DO</p>
        <h1 className="mt-2 text-[1.75rem] font-bold leading-tight">{data.title}</h1>
        <p className="mt-1 text-sm text-fg-dim">Shared by <b className="text-fg">{data.owner}</b></p>
        <div className="hairline my-4" />
        <div className="flex justify-center gap-6 text-center">
          <div><div className="gold-text font-display text-2xl font-bold">{data.activities.length}</div><div className="text-[11px] uppercase tracking-wider text-fg-dim">Activities</div></div>
          <div><div className="gold-text font-display text-2xl font-bold">{days.length}</div><div className="text-[11px] uppercase tracking-wider text-fg-dim">Days</div></div>
          <div><div className="gold-text font-display text-2xl font-bold">{fmtDuration(total)}</div><div className="text-[11px] uppercase tracking-wider text-fg-dim">Planned</div></div>
        </div>
        <p className="mt-3 text-xs text-fg-dim">Times shown in {tz}</p>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <a className="btn-primary btn-sm" href={icsUrl}>Add to calendar</a>
        <button className="btn-ghost btn-sm" onClick={asImage}>Save image</button>
        {'share' in navigator ? <button className="btn-ghost btn-sm" onClick={share}>Share</button> : <button className="btn-ghost btn-sm" onClick={() => window.print()}>Print</button>}
      </div>

      {days.length === 0 ? <p className="text-center text-fg-dim">Nothing scheduled.</p> : days.map((d, i) => (
        <section key={d} className="rise mb-5" style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
          <h2 className="mb-2 flex items-baseline gap-2 px-1 text-base font-semibold"><span className="gold-text">{prettyDate(d)}</span></h2>
          <div className="card overflow-hidden !rounded-2xl">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Activity</th><th className="text-right">Length</th></tr></thead>
              <tbody>
                {data.activities.filter((a) => a.localDate === d).map((a, k) => (
                  <tr key={k}>
                    <td className="w-[5.2rem] whitespace-nowrap font-mono text-[13px] leading-snug">{hhmm(a.startUtc, tz)}<br /><span className="text-fg-dim">{hhmm(a.endUtc, tz)}</span></td>
                    <td className="max-w-0"><div className="flex items-center gap-2.5"><span className="h-8 w-1 shrink-0 rounded-full" style={{ background: a.color ?? '#D4AF37' }} /><div className="min-w-0"><div className="font-medium">{a.title}</div>{a.location && <div className="text-xs text-fg-dim">{a.location}</div>}</div></div></td>
                    <td className="whitespace-nowrap text-right text-fg-dim">{fmtDuration((a.endUtc - a.startUtc) / 60000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="mt-10 text-center text-xs text-fg-dim">Read-only · made with <span className="gold-text font-semibold">CYMOR TO-DO</span></p>
    </div>
  );
}
