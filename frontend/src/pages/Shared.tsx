import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { hhmm, prettyDate } from '../lib/time';
import { Card, ErrorBox, Spinner } from '../components/ui';

interface Pub { title: string; owner: string; timezone: string; from: string; to: string; activities: { title: string; category?: string; location?: string; startUtc: number; endUtc: number; localDate: string }[] }

/** Public, read-only view. No login; shows titles, times and locations only. */
export default function Shared() {
  const { token } = useParams();
  const { data, error, loading } = useAsync(() => api<Pub>(`/public/shared/${encodeURIComponent(token ?? '')}`, { auth: false }), [token]);
  if (loading) return <div className="py-20"><Spinner /></div>;
  if (error || !data) return <div className="mx-auto max-w-md p-6"><ErrorBox msg="This shared schedule is not available. It may have expired or been revoked." /></div>;
  const days = [...new Set(data.activities.map((a) => a.localDate))].sort();
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="mb-6 flex items-center gap-3"><img src="/icon.svg" alt="" className="h-10 w-10" /><div><h1 className="text-2xl font-bold">{data.title}</h1><p className="text-sm text-fg-dim">{data.owner}'s schedule · {data.from} → {data.to} · {data.timezone}</p></div></div>
      {days.length === 0 ? <p className="text-fg-dim">Nothing scheduled.</p> : days.map((d) => (
        <div key={d} className="mb-5"><h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent-2">{prettyDate(d)}</h2>
          <ul className="space-y-2">{data.activities.filter((a) => a.localDate === d).map((a, i) => <li key={i}><Card className="!p-3.5 text-sm"><span className="font-mono text-fg-dim">{hhmm(a.startUtc, data.timezone)}–{hhmm(a.endUtc, data.timezone)}</span> <span className="ml-2 font-medium">{a.title}</span>{a.location && <span className="text-fg-dim"> · {a.location}</span>}</Card></li>)}</ul></div>
      ))}
      <p className="mt-8 text-center text-xs text-fg-dim">Shared with CYMOR TO-DO · read-only</p>
    </div>
  );
}
