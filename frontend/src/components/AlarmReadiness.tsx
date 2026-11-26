import { useCallback, useEffect, useState } from 'react';
import { alarmNative, hasNativeAlarm, type AlarmStatus } from '../lib/alarmNative';
import { enableNative, testAlarm } from '../lib/native';
import { useToast } from './ui';

const OEM_TIP: Record<string, string> = {
  tecno: 'Tecno / Infinix / itel phones stop apps aggressively. Open App settings, then allow Auto-start and set Battery to No restrictions. Also lock CYMOR in the recent-apps screen.',
  infinix: 'Tecno / Infinix / itel phones stop apps aggressively. Open App settings, then allow Auto-start and set Battery to No restrictions. Also lock CYMOR in the recent-apps screen.',
  itel: 'Tecno / Infinix / itel phones stop apps aggressively. Open App settings, then allow Auto-start and set Battery to No restrictions. Also lock CYMOR in the recent-apps screen.',
  xiaomi: 'On Xiaomi / Redmi / POCO turn on Autostart and set Battery saver to No restrictions for CYMOR.',
  redmi: 'On Xiaomi / Redmi / POCO turn on Autostart and set Battery saver to No restrictions for CYMOR.',
  poco: 'On Xiaomi / Redmi / POCO turn on Autostart and set Battery saver to No restrictions for CYMOR.',
  samsung: 'On Samsung open Battery, choose Unrestricted for CYMOR and remove it from “Sleeping apps”.',
  oppo: 'On Oppo / Realme / OnePlus allow Auto-launch and set battery usage to Allow background activity for CYMOR.',
  realme: 'On Oppo / Realme / OnePlus allow Auto-launch and set battery usage to Allow background activity for CYMOR.',
  oneplus: 'On Oppo / Realme / OnePlus allow Auto-launch and set battery usage to Allow background activity for CYMOR.',
  vivo: 'On Vivo allow Autostart and High background power consumption for CYMOR.',
  huawei: 'On Huawei / Honor open App launch, switch CYMOR to Manage manually and allow all three options.',
  honor: 'On Huawei / Honor open App launch, switch CYMOR to Manage manually and allow all three options.',
};

interface Item { key: string; label: string; ok: boolean; hint: string; fix?: { label: string; run: () => Promise<void> } }

/** Checklist that makes sure the phone will actually let the alarm ring. Native app only. */
export default function AlarmReadiness({ onAllGood }: { onAllGood?: (ok: boolean) => void }) {
  const [st, setSt] = useState<AlarmStatus | null>(null);
  const toast = useToast();
  const refresh = useCallback(async () => { setSt(await alarmNative.status()); }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    const vis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh]);

  const items: Item[] = st ? [
    { key: 'notif', label: 'Notifications allowed', ok: st.notifications, hint: 'Needed to show the alarm and its buttons.',
      fix: { label: 'Allow', run: async () => { await enableNative(); const s = await alarmNative.status(); if (!s?.notifications) await alarmNative.openNotificationSettings(); } } },
    ...(st.sdk >= 34 ? [{ key: 'fs', label: 'Alarm can open over the lock screen', ok: st.fullScreen, hint: 'Lets the alarm screen wake the phone while it is locked.', fix: { label: 'Allow', run: () => alarmNative.openFullScreenSettings() } }] : []),
    { key: 'batt', label: 'Battery set to Unrestricted', ok: st.batteryUnrestricted, hint: 'Stops the phone from putting CYMOR to sleep before the alarm.', fix: { label: 'Allow', run: () => alarmNative.requestBatteryUnrestricted() } },
    ...(st.sdk >= 31 && !st.exactAlarms ? [{ key: 'exact', label: 'Exact alarms allowed', ok: false, hint: 'Helps reminders fire on the exact minute.', fix: { label: 'Allow', run: () => alarmNative.openExactAlarmSettings() } }] : []),
    ...(st.dndBlocksAlarms ? [{ key: 'dnd', label: 'Do Not Disturb is set to Total silence', ok: false, hint: 'This blocks every alarm. Switch it to “Alarms only” or off.', fix: { label: 'Open settings', run: () => alarmNative.openNotificationSettings() } }] : []),
  ] : [];
  const good = !!st && items.every((i) => i.ok);
  useEffect(() => { if (st) onAllGood?.(good); }, [good, st]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasNativeAlarm()) return <p className="rounded-2xl bg-ink-800/50 p-4 text-sm leading-relaxed text-fg-dim">The true alarm (rings on alarm volume, wakes the screen, works when the phone is locked) is part of the installed Android app. In the browser you only get the in-app alarm screen.</p>;
  if (!st) return <p className="text-sm text-fg-dim">Checking your phone…</p>;
  const tip = OEM_TIP[st.manufacturer.toLowerCase()];
  return (
    <div className="space-y-3">
      <div className={`rounded-2xl p-4 text-[15px] font-semibold ${good ? 'bg-good/10 text-good' : 'bg-warn/10 text-warn'}`}>{good ? '✓ Your phone is ready to ring the alarm.' : 'A few phone settings still need your OK so the alarm cannot be missed.'}</div>
      <ul className="space-y-2.5">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-3.5 rounded-2xl bg-ink-800/50 p-4">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${i.ok ? 'bg-good/20 text-good' : 'bg-warn/20 text-warn'}`} aria-hidden>{i.ok ? '✓' : '!'}</span>
            <div className="min-w-0 flex-1"><div className="text-[15px] font-medium">{i.label}</div><div className="mt-1 text-xs leading-relaxed text-fg-dim">{i.hint}</div></div>
            {!i.ok && i.fix && <button className="btn-primary btn-sm shrink-0" onClick={async () => { await i.fix!.run(); setTimeout(refresh, 800); }}>{i.fix.label}</button>}
          </li>
        ))}
      </ul>
      <p className="rounded-2xl bg-ink-800/50 p-4 text-xs leading-relaxed text-fg-dim">Alarm volume is {st.alarmVolume}%. CYMOR raises it to about 85% while the alarm rings and puts it back afterwards, so it is loud even if you normally keep the phone quiet.</p>
      {tip && <div className="rounded-2xl bg-ink-800/50 p-4 text-xs leading-relaxed text-fg-dim">{tip}<div className="mt-3"><button className="btn-ghost btn-sm" onClick={() => alarmNative.openAppSettings()}>Open App settings</button></div></div>}
      <button className="btn-ghost w-full" onClick={() => { void testAlarm(); toast('Alarm will ring in 5 seconds. Lock the phone to test the lock screen too.', 'ok'); }}>Test the alarm now</button>
    </div>
  );
}
