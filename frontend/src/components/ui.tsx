import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export const statusMeta: Record<string, { label: string; tone: string }> = {
  scheduled: { label: 'Scheduled', tone: 'text-fg-dim border-ink-700' },
  in_progress: { label: 'In progress', tone: 'text-accent-2 border-accent-2/50 bg-accent-2/10' },
  paused: { label: 'Paused', tone: 'text-warn border-warn/50 bg-warn/10' },
  overdue: { label: 'Overdue', tone: 'text-bad border-bad/50 bg-bad/10' },
  completed_on_time: { label: 'On time', tone: 'text-good border-good/50 bg-good/10' },
  completed_early: { label: 'Early', tone: 'text-good border-good/50 bg-good/10' },
  completed_late: { label: 'Late', tone: 'text-warn border-warn/50 bg-warn/10' },
  interrupted: { label: 'Interrupted', tone: 'text-warn border-warn/50 bg-warn/10' },
  missed: { label: 'Missed', tone: 'text-bad border-bad/50 bg-bad/10' },
  cancelled: { label: 'Cancelled', tone: 'text-fg-dim border-ink-700 line-through' },
  unresolved: { label: 'Needs review', tone: 'text-warn border-warn/50 bg-warn/10' },
};

export const StatusChip = ({ status }: { status: string }) => {
  const m = statusMeta[status] ?? { label: status, tone: '' };
  return <span className={`chip ${m.tone}`}>{m.label}</span>;
};

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => <section className={`card p-6 ${className}`}>{children}</section>;

export const PageTitle = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <header className="mb-8 flex flex-wrap items-end justify-between gap-4 rise">
    <div>
      <h1 className="text-3xl font-bold">{title}</h1>
      {sub && <p className="mt-2 text-sm text-fg-dim">{sub}</p>}
    </div>
    {right}
  </header>
);

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-fg-dim">{hint}</span>}
  </label>
);

export const Spinner = () => <div role="status" aria-label="Loading" className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-ink-700 border-t-accent" />;
export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div role="alert" className="card border-bad/40 p-4 text-sm text-bad">{msg}{retry && <button className="ml-3 underline" onClick={retry}>Retry</button>}</div>
);
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-ink-700 p-8 text-center">
    <p className="font-display text-lg">{title}</p>
    {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-dim">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl rise">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button aria-label="Close" className="btn-ghost !px-3 !py-1.5" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

type Toast = { id: number; msg: string; tone: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<(msg: string, tone?: Toast['tone']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={`card rise pointer-events-auto max-w-md px-4 py-3 text-sm ${t.tone === 'err' ? 'border-bad/50 text-bad' : t.tone === 'ok' ? 'border-good/50' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-ink-700'}`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
);
