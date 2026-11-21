import { useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/hooks';
import { enableNative, isNative, nativeHealth, syncNative, type NativeHealth } from '../lib/native';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { playSound } from '../lib/sound';
import { hhmm, prettyDate, ymdOf } from '../lib/time';
import type { Job } from '../lib/types';
import { Card, ErrorBox, PageTitle, Spinner, useToast } from '../components/ui';

interface Diag { vapidConfigured: boolean; activeDevices: number; expiredDevices: number; worker: { alive: boolean; lastSeenMsAgo: number | null }; queue: { pending: number; lateUnsent: number }; limits: string[] }

const STATUS_TEXT: Record<string, [string, string]> = {
  pending: ['Scheduled', 'text-fg-dim'], processing: ['Sending…', 'text-accent-2'], retry: ['Retrying', 'text-warn'],
  sent_to_provider: ['Sent to push service', 'text-accent-2'], delivered: ['Delivered to device', 'text-good'], opened: ['Opened', 'text-good'],
  expired: ['Expired (too late to be useful)', 'text-warn'], skipped: ['Skipped', 'text-fg-dim'], failed: ['Failed', 'text-bad'],
};
const PUSH_HELP: Record<PushState, string> = {
  unsupported: 'This browser does not support Web Push. Try Chrome, Edge or Firefox, or install the app.',
  'ios-needs-install': 'On iPhone/iPad, add CYMOR TO-DO to your Home Screen first (Share → Add to Home Screen, iOS 16.4+), then open it from there.',
  denied: 'Notifications are blocked for this site. Allow them in your browser/site settings, then reload.',
  'not-configured': 'The server has no push keys configured.',
  off: 'Push is off on this device.', on: 'Push is on for this device.',
};

export default function Notifications() {
  const { user, settings } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const toast = useToast();
  const [ps, setPs] = useState<PushState>('off'); const [busy, setBusy] = useState(false);
  const diag = useAsync(() => api<Diag>('/notifications/diagnostics'), []);
  const jobs = useAsync(() => api<{ jobs: Job[] }>('/notifications/jobs?limit=40'), []);
  const native = isNative();
  const [nh, setNh] = useState<NativeHealth | null>(null);
  const refreshNative = async () => setNh(await nativeHealth());
  useEffect(() => { if (native) void refreshNative(); else void pushState().then(setPs); }, [native]);
  useEffect(() => { if (diag.data && !diag.data.vapidConfigured && ps === 'off') setPs('not-configured'); }, [diag.data, ps]);

  const toggle = async () => {
    setBusy(true);
    try { if (ps === 'on') await disablePush(); else await enablePush(); setPs(await pushState()); void diag.reload(); } catch (e) { toast(errMsg(e), 'err'); setPs(await pushState()); } finally { setBusy(false); }
  };
  const fixNative = async () => { setBusy(true); try { await enableNative(); await syncNative(); await refreshNative(); void diag.reload(); } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); } };
  const test = async () => { try { await api('/notifications/test', { method: 'POST', body: {} }); toast('Test queued. It arrives only if the worker is running and this device is subscribed.', 'info'); setTimeout(() => { void jobs.reload(); void diag.reload(); }, 8000); } catch (e) { toast(errMsg(e), 'err'); } };
  const snooze = async (j: Job) => { try { await api(`/notifications/jobs/${j.id}/snooze`, { method: 'POST', body: { minutes: 10 } }); toast('Snoozed 10 minutes', 'ok'); void jobs.reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const d = diag.data;

  return (
    <>
      <PageTitle title="Notifications" sub="What was sent, when, and whether it can be trusted." />
      {native && nh && (
        <section className="card-gold mb-4 p-5">
          <div className="flex items-start justify-between gap-3"><div><div className="font-display text-lg font-semibold">Phone alerts</div><p className="mt-0.5 text-sm text-fg-dim">Your phone rings reminders itself, even offline.</p></div>
            <span className={`chip ${nh.permission === 'granted' && nh.pending >= 0 ? 'border-good/50 text-good' : 'border-warn/50 text-warn'}`}>{nh.permission === 'granted' ? 'Ready' : 'Needs attention'}</span></div>
          <table className="tbl mt-3"><tbody>
            {([
              ['Notification permission', nh.permission === 'granted' ? 'Allowed' : nh.permission === 'denied' ? 'Blocked in Android settings' : 'Not asked yet', nh.permission === 'granted'],
              ['Exact alarms', nh.exactAlarm === 'granted' ? 'Allowed' : nh.exactAlarm === 'denied' ? 'Off: reminders may arrive a few minutes late' : 'Unknown', nh.exactAlarm !== 'denied'],
              ['Scheduled on this phone', `${nh.pending} reminder${nh.pending === 1 ? '' : 's'}`, true],
              ['Next one', nh.nextFireAt ? `${prettyDate(ymdOf(nh.nextFireAt, tz))} ${hhmm(nh.nextFireAt, tz)}` : 'None scheduled', true],
              ['Backup push (FCM)', nh.fcmToken ? 'Connected' : 'Not connected', nh.fcmToken],
            ] as [string, string, boolean][]).map(([k, v, ok]) => <tr key={k}><td className="text-fg-dim">{k}</td><td className={`text-right ${ok ? '' : 'text-warn'}`}>{v}</td></tr>)}
          </tbody></table>
          {nh.lastError && <p className="mt-2 text-xs text-bad">Last sync problem: {nh.lastError}</p>}
          <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary btn-sm" disabled={busy} onClick={fixNative}>{nh.permission === 'granted' ? 'Re-sync reminders' : 'Allow notifications'}</button></div>
          <p className="mt-3 text-xs text-fg-dim">Tip: on some phones (Xiaomi, Oppo, Samsung) set CYMOR TO-DO battery use to “Unrestricted”, otherwise the system may delay alerts.</p>
        </section>
      )}

      {!native && <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-medium">This device</div><p className="mt-0.5 max-w-md text-sm text-fg-dim">{PUSH_HELP[ps]}</p></div>
          <div className="flex gap-2">{(ps === 'on' || ps === 'off') && <button className={ps === 'on' ? 'btn-ghost' : 'btn-primary'} disabled={busy} onClick={toggle}>{ps === 'on' ? 'Turn off' : 'Enable push'}</button>}
            <button className="btn-ghost" onClick={() => playSound(settings?.sound, true)}>Play sound</button>
            {ps === 'on' && <button className="btn-ghost" onClick={test}>Send test</button>}</div>
        </div>
      </Card>}

      <Card className="mt-4">
        <h2 className="mb-3 text-lg font-semibold">System check</h2>
        {diag.loading && !d ? <Spinner /> : diag.error ? <ErrorBox msg={diag.error} retry={diag.reload} /> : d && (
          <>
            <ul className="space-y-2 text-sm">
              {([
                [d.vapidConfigured, 'Server push keys configured', 'Server push keys are missing: no push can be sent.'],
                [d.activeDevices > 0, `${d.activeDevices} active device(s) subscribed${d.expiredDevices ? ` · ${d.expiredDevices} expired` : ''}`, 'No device is subscribed yet.'],
                [d.worker.alive, 'Background worker is running', d.worker.lastSeenMsAgo === null ? 'Background worker has never reported in. Scheduled notifications will NOT be sent until it runs.' : `Background worker last seen ${Math.round(d.worker.lastSeenMsAgo / 1000)}s ago. Notifications are delayed or not sent.`],
                [d.queue.lateUnsent === 0, `${d.queue.pending} notification(s) scheduled`, `${d.queue.lateUnsent} notification(s) are overdue and unsent (worker behind or offline).`],
              ] as [boolean, string, string][]).map(([ok, good, bad], i) => <li key={i} className="flex gap-2"><span className={ok ? 'text-good' : 'text-bad'}>{ok ? '●' : '▲'}</span><span className={ok ? '' : 'text-bad'}>{ok ? good : bad}</span></li>)}
            </ul>
            <details className="mt-4 text-sm text-fg-dim"><summary className="cursor-pointer">Limits you should know about</summary><ul className="mt-2 list-disc space-y-1 pl-5">{d.limits.map((l) => <li key={l}>{l}</li>)}</ul></details>
          </>
        )}
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">History</h2>
      {jobs.loading && !jobs.data ? <Spinner /> : jobs.error ? <ErrorBox msg={jobs.error} retry={jobs.reload} /> : !jobs.data?.jobs.length ? <p className="text-sm text-fg-dim">Nothing yet.</p> : (
        <ul className="space-y-2">{jobs.data.jobs.map((j) => { const [t, c] = STATUS_TEXT[j.status] ?? [j.status, '']; return (
          <li key={j.id} className="card flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{j.title}</div><div className="truncate text-xs text-fg-dim">{j.body}</div>
              <div className="mt-0.5 text-xs"><span className={c}>{t}</span>{j.reason && <span className="text-fg-dim"> · {j.reason}</span>}{j.lastError && <span className="text-bad"> · {j.lastError}</span>}</div></div>
            <div className="shrink-0 text-right text-xs text-fg-dim">{prettyDate(ymdOf(j.fireAt, tz))}<br />{hhmm(j.fireAt, tz)}</div>
            {(j.status === 'pending' || j.status === 'sent_to_provider' || j.status === 'delivered') && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => snooze(j)}>Snooze</button>}
          </li>); })}</ul>
      )}
    </>
  );
}
