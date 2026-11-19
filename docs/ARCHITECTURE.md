# Architecture

```
Browser (React PWA, service worker, IndexedDB queue)
   │  HTTPS JSON (Bearer access token, refresh rotation)
   ▼
API (Express + Zod)  ──►  MongoDB  ◄──  Worker (separate process, claims due jobs, sends Web Push)
                                              │
                                              ▼
                                   Push service (FCM / Mozilla / Apple) ──► device service worker
```

## Design rules enforced in code
- All instants are UTC ms; the user's timezone is an IANA string; recurrence generates local wall-clock times (DST-stable). The server owns time: clients only format.
- Jobs are created per occurrence on a rolling 7-day horizon (reminders are topped up by the worker every 10 min), never all future jobs.
- `idempotencyKey = kind:sourceId:fireAt` has a UNIQUE index, so re-planning can't duplicate.
- Claiming is fenced by a unique-key insert (`notificationjobclaims`), then leases recover crashed workers. See STATUS.md.
- Stale jobs become `expired` with a log row; they are never silently dropped. The server never sets `delivered`/`opened`; only the device's service worker acknowledgement (signed per-job token) can.
- Accounting is per-activity and pure; an overrun never moves another activity. Overlaps are detected and shown, never auto-resolved.
- Offline actions carry their original timestamp (`at`); the server rejects future times and invalid state transitions, and the client reports such conflicts.

## Collections (Mongoose models)
User, UserSettings, Activity (with embedded session: checkInAt/checkOutAt/pauses/interruptions), Reminder (stores the validated recurrence spec), NotificationSubscription (unique endpoint hash), DeviceSession (hashed refresh tokens, TTL), AuthToken (hashed verify/reset tokens), Habit, HabitCompletion (unique habit+date), Goal, FocusSession, DailyReflection (unique user+date), SharedSchedule (token stored only as a hash; revocable; optional expiry).
Raw collections: `notificationjobs` (indexes in `infra/mongoJobStore.ts`), `notificationlogs`, `notificationjobclaims`, `workerheartbeats`.

## API (all under `/api`, JSON; auth = `Authorization: Bearer`)
- `auth/` register · login · refresh · logout · logout-all · verify-email · request-reset · reset-password · change-password · me (GET/PATCH/DELETE) · sessions · export
- `activities/` GET ?from&to · POST · POST series · PATCH/DELETE :id · POST :id/{check-in,pause,resume,interrupt,end-interruption,check-out,miss,cancel,uncancel}
- `reminders/` GET · POST · POST preview · PATCH/DELETE :id
- `notifications/` vapid-key · subscribe (POST/DELETE) · subscriptions · test · jobs · jobs/:id/snooze · action (token auth, used by notification buttons) · diagnostics
- `analytics?from&to` · `import/preview` · `import/confirm` · `export/schedule.{csv,ics,pdf}` · `shares` (GET/POST/DELETE) · `public/shared/:token`
- `settings` · `habits` · `goals` · `focus` · `reflections/:date`

## Security notes
bcrypt (cost 11), JWT access 15 min, hashed refresh/verify/reset tokens, helmet, CORS allow-list from `FRONTEND_URL`, Zod on every body/query, per-user scoping on every query (ownership tested), generic login/reset responses, CSV export neutralises spreadsheet formulas, share tokens are 256-bit and stored hashed, `JWT_*` defaults refused in production.
