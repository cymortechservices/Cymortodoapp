/**
 * Native (Capacitor) bridge: phone-side local notifications + FCM registration.
 * On the web every export is a safe no-op. The phone schedules the nearest 60 reminders itself (works offline,
 * survives the server being down); the server only pushes what the phone could not schedule.
 */
import { Capacitor } from '@capacitor/core';
import { api, tokens } from './api';
import { sessionAction } from './offline';
import { ACTIONS_BY_KIND, ALARM_REPEAT_MIN, alarmId, notifId, planLocal, type UpcomingJob } from './nativeSchedule';

export const isNative = () => Capacitor.isNativePlatform();
const CHANNEL = 'reminders';
const ALARM_CHANNEL = 'alarm_v1'; // channel settings can't be changed after creation, so bump the id if the sound ever changes
const K_TOKEN = 'cymor.fcm', K_UNTIL = 'cymor.localUntil';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let inited = false, timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> | null = null;

export async function initNative(): Promise<void> {
  if (!isNative() || inited) return;
  inited = true;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const { App } = await import('@capacitor/app');
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  StatusBar.setBackgroundColor({ color: '#0a0907' }).catch(() => undefined);

  await LocalNotifications.createChannel({ id: CHANNEL, name: 'Reminders', description: 'Activity reminders and alerts', importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#D4AF37' }).catch(() => undefined);
  await LocalNotifications.createChannel({ id: ALARM_CHANNEL, name: 'Activity alarm', description: 'Loud alarm when an activity starts', importance: 5, visibility: 1, sound: 'cymor_alarm.wav', vibration: true, lights: true, lightColor: '#D4AF37' }).catch(() => undefined);
  await LocalNotifications.registerActionTypes({
    types: Object.entries(ACTIONS_BY_KIND).map(([id, actions]) => ({ id, actions: actions.map((a) => ({ id: a.id, title: a.title, foreground: false })) })),
  }).catch(() => undefined);

  LocalNotifications.addListener('localNotificationActionPerformed', async (e) => {
    const x = (e.notification.extra ?? {}) as { kind?: string; sourceId?: string; jobId?: string; title?: string; body?: string };
    try {
      if (e.actionId === 'snooze') {
        const mins = x.kind === 'reminder' ? 10 : 5;
        const isAlarm = x.kind === 'alarm';
        if (isAlarm && x.jobId) await LocalNotifications.cancel({ notifications: ALARM_REPEAT_MIN.map((n) => ({ id: alarmId(x.jobId!, n) })) }).catch(() => undefined);
        await LocalNotifications.schedule({ notifications: [{ id: notifId(`snooze-${x.jobId}-${Date.now()}`), title: e.notification.title ?? 'CYMOR TO-DO', body: e.notification.body ?? '', schedule: { at: new Date(Date.now() + mins * 60_000), allowWhileIdle: true }, channelId: isAlarm ? ALARM_CHANNEL : CHANNEL, sound: isAlarm ? 'cymor_alarm.wav' : undefined, smallIcon: 'ic_stat_cymor', actionTypeId: x.kind, extra: x }] });
      } else if ((e.actionId === 'check-in' || e.actionId === 'check-out') && x.sourceId) {
        await sessionAction(x.sourceId, e.actionId); // works offline: saved on the phone with the real time
        if (x.kind === 'alarm' && x.jobId) await LocalNotifications.cancel({ notifications: ALARM_REPEAT_MIN.map((n) => ({ id: alarmId(x.jobId!, n) })) }).catch(() => undefined);
        window.dispatchEvent(new Event('cymor:refresh'));
      } else if (e.actionId === 'tap') window.dispatchEvent(new Event('cymor:refresh'));
    } catch { /* never crash the notification handler */ }
  }).catch(() => undefined);

  PushNotifications.addListener('registration', async (t) => {
    store.set(K_TOKEN, t.value);
    if (!tokens.get()) return;
    await api('/notifications/native/register', { method: 'POST', body: { token: t.value, platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android', localUntil: Number(store.get(K_UNTIL) ?? 0) } }).catch(() => undefined);
  }).catch(() => undefined);
  PushNotifications.addListener('registrationError', () => undefined).catch(() => undefined);
  PushNotifications.addListener('pushNotificationReceived', () => window.dispatchEvent(new Event('cymor:refresh'))).catch(() => undefined);

  App.addListener('resume', () => { void syncNative(); window.dispatchEvent(new Event('cymor:refresh')); }).catch(() => undefined);
  window.addEventListener('cymor:changed', () => { clearTimeout(timer); timer = setTimeout(() => void syncNative(), 2500); });
}

export interface NativeHealth {
  native: boolean; permission: 'granted' | 'denied' | 'prompt' | 'unknown'; exactAlarm: 'granted' | 'denied' | 'unknown';
  pending: number; nextFireAt: number | null; localUntil: number; fcmToken: boolean; lastError?: string;
}

/** Rebuild the phone's schedule from the server's view of the future. Safe to call often. */
export function syncNative(): Promise<void> {
  if (!isNative() || !tokens.get()) return Promise.resolve();
  running ??= doSync().catch((e) => { store.set('cymor.syncErr', String(e?.message ?? e)); }).finally(() => { running = null; });
  return running;
}
async function doSync() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return;
  const r = await api<{ now: number; horizon: number; jobs: UpcomingJob[] }>('/notifications/upcoming?hours=168&limit=60');
  const plan = planLocal(r.jobs, Date.now(), r.horizon);
  const pend = await LocalNotifications.getPending();
  if (pend.notifications.length) await LocalNotifications.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
  if (plan.items.length) {
    const notifications = plan.items.flatMap((j) => {
      const at = (ms: number) => ({ at: new Date(ms), allowWhileIdle: true });
      const extra = { jobId: j.id, kind: j.kind, sourceId: j.sourceId, url: j.url };
      if (j.alarm) {
        // Loud alarm: rings at the start time and repeats twice until the user checks in.
        return ALARM_REPEAT_MIN.map((m) => ({ id: alarmId(j.id, m), title: m === 0 ? 'TIME TO START' : 'YOU HAVE NOT STARTED YET', body: j.body, channelId: ALARM_CHANNEL, sound: 'cymor_alarm.wav', smallIcon: 'ic_stat_cymor', actionTypeId: 'alarm', autoCancel: false, schedule: at(j.fireAt + m * 60_000), extra: { ...extra, kind: 'alarm' } }));
      }
      return [{ id: notifId(j.id), title: j.title, body: j.body, channelId: CHANNEL, smallIcon: 'ic_stat_cymor', actionTypeId: j.kind in ACTIONS_BY_KIND ? j.kind : undefined, schedule: at(j.fireAt), extra }];
    });
    await LocalNotifications.schedule({ notifications });
  }
  store.set(K_UNTIL, String(plan.localUntil)); store.set('cymor.syncErr', null);
  const t = store.get(K_TOKEN);
  if (t) await api('/notifications/native/sync', { method: 'POST', body: { token: t, localUntil: plan.localUntil } }).catch(async (e) => { if (e?.status === 404) await api('/notifications/native/register', { method: 'POST', body: { token: t, platform: 'android', localUntil: plan.localUntil } }).catch(() => undefined); });
}

/** Ask for permissions (Android 13+ notification permission, exact alarms) and register for server push. */
export async function enableNative(): Promise<NativeHealth> {
  if (!isNative()) return nativeHealth();
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await initNative();
  const p = await LocalNotifications.requestPermissions();
  if (p.display === 'granted') {
    try { const ex = await LocalNotifications.checkExactNotificationSetting(); if (ex.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting(); } catch { /* older Android */ }
    try { const pp = await PushNotifications.requestPermissions(); if (pp.receive === 'granted') await PushNotifications.register(); } catch { /* FCM not configured in this build */ }
    await syncNative();
  }
  return nativeHealth();
}

export async function nativeHealth(): Promise<NativeHealth> {
  const h: NativeHealth = { native: isNative(), permission: 'unknown', exactAlarm: 'unknown', pending: 0, nextFireAt: null, localUntil: Number(store.get(K_UNTIL) ?? 0), fcmToken: !!store.get(K_TOKEN), lastError: store.get('cymor.syncErr') ?? undefined };
  if (!isNative()) return h;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  try { h.permission = (await LocalNotifications.checkPermissions()).display === 'granted' ? 'granted' : (await LocalNotifications.checkPermissions()).display === 'denied' ? 'denied' : 'prompt'; } catch { /* */ }
  try { h.exactAlarm = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted' ? 'granted' : 'denied'; } catch { /* */ }
  try {
    const pend = (await LocalNotifications.getPending()).notifications;
    h.pending = pend.length;
    const times = pend.map((n) => (n.schedule?.at ? new Date(n.schedule.at).getTime() : 0)).filter((t) => t > 0);
    h.nextFireAt = times.length ? Math.min(...times) : null;
  } catch { /* */ }
  return h;
}

/** Called before tokens are cleared on logout: stop this phone alerting for the old account. */
export async function nativeLogout(): Promise<void> {
  if (!isNative()) return;
  const t = store.get(K_TOKEN);
  if (t && tokens.get()) await api('/notifications/native', { method: 'DELETE', body: { token: t } }).catch(() => undefined);
  try { const { LocalNotifications } = await import('@capacitor/local-notifications'); const p = await LocalNotifications.getPending(); if (p.notifications.length) await LocalNotifications.cancel({ notifications: p.notifications }); } catch { /* */ }
  store.set(K_UNTIL, null);
}

/** "Test the alarm": rings the real alarm channel in 5 seconds so the user can check volume and that the phone allows it. */
export async function testAlarm(): Promise<void> {
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await initNative();
  await LocalNotifications.schedule({ notifications: [{ id: notifId(`test-alarm-${Date.now()}`), title: 'TIME TO START', body: 'This is how your activity alarm will sound.', channelId: ALARM_CHANNEL, sound: 'cymor_alarm.wav', smallIcon: 'ic_stat_cymor', autoCancel: false, schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
}
