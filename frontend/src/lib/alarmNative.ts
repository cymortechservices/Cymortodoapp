/** Bridge to the Android "true alarm" plugin (android/app/src/main/java/com/cymortech/todo/AlarmPlugin.java). Safe no-ops on the web. */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AlarmStatus {
  ringing: boolean; ringingTitle: string; ringingSource: string; ringingSince: number; scheduled: number;
  notifications: boolean; exactAlarms: boolean; batteryUnrestricted: boolean; fullScreen: boolean;
  alarmVolume: number; dndBlocksAlarms: boolean; manufacturer: string; sdk: number;
}
export interface NativeAlarm { id: number; at: number; title: string; body: string; sourceId: string; repeats: number }

interface Plugin {
  setAlarms(o: { alarms: NativeAlarm[] }): Promise<{ count: number }>;
  cancelAll(): Promise<void>; stop(): Promise<void>; test(): Promise<void>;
  snooze(o: { minutes: number; title: string; sourceId: string }): Promise<void>;
  status(): Promise<AlarmStatus>;
  takeLaunchAction(): Promise<{ action: string; sourceId: string }>;
  openExactAlarmSettings(): Promise<void>; requestBatteryUnrestricted(): Promise<void>; openFullScreenSettings(): Promise<void>;
  openAppSettings(): Promise<void>; openNotificationSettings(): Promise<void>;
  addListener(ev: 'alarmAction', fn: (e: { action: string; sourceId: string }) => void): Promise<{ remove: () => void }>;
}

const plugin = Capacitor.isNativePlatform() ? registerPlugin<Plugin>('CymorAlarm') : null;
export const hasNativeAlarm = () => !!plugin;
const safe = async <T,>(f: (p: Plugin) => Promise<T>, d: T): Promise<T> => { if (!plugin) return d; try { return await f(plugin); } catch { return d; } };

export const alarmNative = {
  /** Returns true if the phone accepted the list (so the caller can skip the weaker notification fallback). */
  setAlarms: async (alarms: NativeAlarm[]) => { if (!plugin) return false; try { await plugin.setAlarms({ alarms }); return true; } catch { return false; } },
  cancelAll: () => safe((p) => p.cancelAll(), undefined),
  stop: () => safe((p) => p.stop(), undefined),
  test: () => safe((p) => p.test(), undefined),
  snooze: (minutes: number, title: string, sourceId: string) => safe((p) => p.snooze({ minutes, title, sourceId }), undefined),
  status: () => safe<AlarmStatus | null>((p) => p.status(), null),
  takeLaunchAction: () => safe((p) => p.takeLaunchAction(), { action: '', sourceId: '' }),
  openExactAlarmSettings: () => safe((p) => p.openExactAlarmSettings(), undefined),
  requestBatteryUnrestricted: () => safe((p) => p.requestBatteryUnrestricted(), undefined),
  openFullScreenSettings: () => safe((p) => p.openFullScreenSettings(), undefined),
  openAppSettings: () => safe((p) => p.openAppSettings(), undefined),
  openNotificationSettings: () => safe((p) => p.openNotificationSettings(), undefined),
  onAction: (fn: (e: { action: string; sourceId: string }) => void) => { if (!plugin) return () => undefined; let off = () => undefined as void; plugin.addListener('alarmAction', fn).then((h) => { off = () => h.remove(); }).catch(() => undefined); return () => off(); },
};

/** Stable positive id for a job's alarm. */
export function alarmIntId(jobId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < jobId.length; i++) { h ^= jobId.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ((h & 0x3fffffff) || 1) * 2; // even, so the native "+1" repeat id never collides with another job
}
