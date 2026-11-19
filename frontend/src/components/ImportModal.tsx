import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import type { Conflict } from '../lib/types';
import { Field, Modal } from './ui';

interface Row { title: string; date?: string; start?: string; end?: string; description?: string; warnings: string[]; sourceRow: number }
interface Preview { rows: Row[]; errors: string[]; needsReview: true }

/** Timetable import: upload -> preview with warnings -> user reviews/deselects -> confirm. Nothing is created before confirm. */
export default function ImportModal({ open, onClose, defaultDate, onDone }: { open: boolean; onClose: () => void; defaultDate: string; onDone: (n: number) => void }) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(defaultDate);
  const [text, setText] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const preview = async (file?: File) => {
    setBusy(true); setErr('');
    try {
      let r: { preview: Preview };
      if (file) { const fd = new FormData(); fd.append('file', file); r = await api('/import/preview', { method: 'POST', form: fd }); }
      else r = await api('/import/preview', { method: 'POST', body: { text } });
      setPv(r.preview); setSkip(new Set(r.preview.rows.filter((x) => !x.start || !x.end).map((x) => x.sourceRow)));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!pv) return;
    setBusy(true); setErr('');
    try {
      const rows = pv.rows.filter((r) => !skip.has(r.sourceRow) && r.start && r.end).map((r) => ({ title: r.title, date: r.date, start: r.start!, end: r.end!, description: r.description }));
      const r = await api<{ created: number }>('/import/confirm', { method: 'POST', body: { rows, defaultDate: date } });
      onDone(r.created); setPv(null); onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import timetable">
      {!pv ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-dim">Upload a CSV or Excel (.xlsx) timetable, or paste rows. You will review everything before anything is added. PDF and photo import are not available yet.</p>
          <input type="file" accept=".csv,.txt,.xlsx" className="input" onChange={(e) => e.target.files?.[0] && preview(e.target.files[0])} />
          <Field label="…or paste CSV text"><textarea className="input h-28 font-mono text-xs" placeholder={'Date,Start,End,Activity\n2030-03-04,08:00,09:00,Physics'} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          <button className="btn-primary w-full" disabled={busy || !text.trim()} onClick={() => preview()}>Preview pasted text</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-warn">Review required. Untick anything that looks wrong; rows without both start and end times are skipped.</p>
          {pv.errors.map((e) => <p key={e} className="text-sm text-bad">{e}</p>)}
          <Field label="Date for rows that have none"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {pv.rows.map((r) => (
              <li key={r.sourceRow} className="flex gap-3 rounded-xl border border-ink-700 p-2.5 text-sm">
                <input type="checkbox" aria-label={`Include ${r.title}`} checked={!skip.has(r.sourceRow)} disabled={!r.start || !r.end} onChange={() => { const s = new Set(skip); s.has(r.sourceRow) ? s.delete(r.sourceRow) : s.add(r.sourceRow); setSkip(s); }} />
                <div className="min-w-0"><div className="truncate font-medium">{r.title}</div><div className="text-xs text-fg-dim">{r.date ?? '(default date)'} · {r.start ?? '?'}–{r.end ?? '?'}</div>{r.warnings.map((w) => <div key={w} className="text-xs text-warn">⚠ {w}</div>)}</div>
              </li>
            ))}
          </ul>
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          <div className="flex justify-between"><button className="btn-ghost" onClick={() => setPv(null)}>Back</button><button className="btn-primary" disabled={busy} onClick={confirm}>Add {pv.rows.filter((r) => !skip.has(r.sourceRow) && r.start && r.end).length} activities</button></div>
        </div>
      )}
    </Modal>
  );
}
export type { Conflict };
