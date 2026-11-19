import type { NotifyCfg } from './auth';

export interface SessionResult {
  status: string; scheduledMinutes: number; elapsedMinutes: number; pausedMinutes: number; activeMinutes: number;
  overrunMinutes: number; endDelayMinutes: number; timeSavedMinutes: number; interruptionMinutes: number; unexplainedOverrunMinutes: number;
}
export interface Activity {
  id: string; title: string; description?: string; category: string; color: string; location?: string;
  startUtc: number; endUtc: number; cancelled: boolean; notify: NotifyCfg; seriesId?: string; localDate: string;
  checkInAt?: number | null; checkOutAt?: number | null;
  pauses: { start: number; end?: number | null }[]; interruptions: { start: number; end?: number | null; reason?: string }[];
  markedMissed?: boolean; result: SessionResult;
}
export interface Conflict { a: string; b: string; overlapMinutes: number }
export interface ActivitiesResponse { timezone: string; now: number; activities: Activity[]; conflicts: Conflict[] }

export interface Reminder { id: string; title: string; description?: string; spec: ReminderSpec; active: boolean; latePolicy: string; maxLateMinutes: number; next: number | null }
export interface ReminderSpec {
  timezone: string; startDate: string; endDate?: string; startTime: string; endTime?: string; weekdays?: number[];
  repeat: { type: string; every?: number; times?: string[]; days?: number[]; everyDays?: number };
}

export interface Summary {
  scheduled: number; completed: number; missed: number; overdue: number; unresolved: number; inProgress: number; completionPct: number;
  plannedMinutes: number; activeMinutes: number; overrunMinutes: number; timeSavedMinutes: number; interruptionMinutes: number; unexplainedOverrunMinutes: number;
  byCategory: Record<string, { plannedMinutes: number; activeMinutes: number; count: number }>;
}
export interface AnalyticsResponse { timezone: string; summary: Summary; days: { date: string; summary: Summary }[]; heatmap: number[]; streak: { current: number; longest: number }; insights: string[] }

export interface Job { id: string; kind: string; title: string; body: string; fireAt: number; status: string; reason?: string; attempts: number; sentAt?: number; lastError?: string }
