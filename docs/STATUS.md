# QA / Status Report — CYMOR TO-DO V1.0 (2026-11-17)

## What was run, and the result
| Check | Result |
|---|---|
| Backend `tsc --strict` | clean |
| Backend tests | **60 pass / 0 fail** (49 pure-logic + 11 integration against a live MongoDB-compatible server) |
| Frontend `tsc` + `vite build` | clean (JS ≈106 kB gzip) |
| Frontend unit tests (vitest) | 7 pass (timezone formatting, calendar math, offline queue incl. order, original timestamps, conflicts) |
| Real-browser end-to-end (Chromium via Playwright, `frontend/e2e/e2e.py`) | **passed**: intro, register, plan activity, overlap warning (nothing moved), check-in, live timer, pause/resume, **go offline → action queued in IndexedDB with its real timestamp → reconnect → synced**, reminders with live preview, analytics, alerts/system check, habits, settings, service worker registered, mobile viewport (390px) has no horizontal overflow |
| Real `web-push` send path | A subscription was pointed at a local TLS "push service": the worker sent a VAPID-signed (`Authorization: vapid …`), `aes128gcm`-encrypted request and the job reached `sent_to_provider`. |
| Real processes, end to end | API and worker started as **separate processes**; a device subscribed through the API, "Send test" queued a job, the worker claimed it and delivered a VAPID-signed encrypted push to the local TLS push service; `/notifications/diagnostics` then reported `worker.alive: true` and the job `sent_to_provider` |

### What the integration tests prove (real Express + Mongoose + real DB)
Register/login, no account enumeration, single-use verify/reset tokens, refresh rotation with reuse detection (revokes the family), password reset signs out everywhere; activity create plans the 4 spec jobs at the exact UTC instants (Nairobi), edits replace pending jobs without duplicates, delete clears them; tenant isolation (other users get 404 on read/patch/delete/check-in); overlaps are reported, never auto-fixed; spec accounting example (120 planned / 138 active / +18 overrun), pauses; future timestamps rejected; Drink Water = exactly 7 jobs/day, pause removes jobs; worker end-to-end with a mock provider (stale pre-start expires, 410 deactivates only that device, never `delivered` from the server, client ack is the only path to `delivered`/`opened`, overdue skipped after check-out, snooze creates exactly one job, foreign action token rejected); notification action buttons; analytics numbers; CSV import preview → confirm; CSV/ICS/PDF export; share links (unguessable, minimal fields, revocable); account export and deletion cascade; habits/goals/focus/reflection/settings.

## IMPORTANT finding: job claiming and MongoDB
The original core claimed jobs with `findOneAndUpdate`. Run against **FerretDB** (the MongoDB-compatible server available for testing), 3–4 racing workers **double-claimed jobs** (95 claims for 40 jobs); a conditional `updateOne` double-claimed too. Real MongoDB documents these as atomic, but that could not be tested here, so `MongoJobStore` was rewritten to depend only on the weakest primitive any database has: a **unique-key insert**. Each claim inserts `{_id: "<jobId>:<generation>"}` into a claims collection; exactly one insert can win. `tests/mongoStore.test.ts` (4 racing workers, no duplicates, lease recovery) passes repeatedly. This is correct on real MongoDB as well, at the cost of one extra write per claim.

## Other test-environment findings
FerretDB crashed (its bug, not the app's) when a second process re-issued `createIndex` for indexes that already existed. Real MongoDB treats that as a no-op, but startup index creation was made idempotent anyway (`ensureIndexes` creates only missing indexes; `autoIndex` is off), which is also cleaner for repeated deploys with an API and a worker booting together.

## NOT tested (be aware)
- **MongoDB Atlas itself.** Everything ran against FerretDB. TTL indexes (history cleanup) are unsupported by FerretDB, so they were **not exercised** (set `SKIP_TTL_INDEXES=0` on Atlas; run `npm run test:mongo` with `MONGO_TEST_URI` pointing at a throwaway Atlas DB first).
- **Real push to a real phone/browser** (Chrome/Firefox/Android/iOS) and notification sounds, action buttons and the service worker's `push`/`notificationclick` handlers on a device. Written to the Web Push standard but never run on a device. Follow `docs/NOTIFICATIONS.md` §Test on your phone.
- **Real e-mail.** With no `SMTP_URL` the verification/reset mail is only logged. Production needs SMTP.
- **Render/Vercel deployment** (configs validated syntactically only).
- Visual QA only at 1280px and 390px in Chromium; no Safari/Firefox, no screen-reader pass.
- Web fonts load from Google Fonts (blocked in the test sandbox → system fallback was what was screenshot).

## Deliberately NOT built
- PDF-text and photo/OCR timetable import (CSV/XLSX/pasted text only; the API says so with a 415).
- Image/audio uploads and custom uploaded sounds (sounds are built-in WebAudio tones for the open app; background push sounds are OS-controlled). Cloudinary variables were removed from `.env.example`.
- OpenAPI document; frontend component tests; CI config.
- Quiet hours / do-not-disturb.
- Separate `RecurringActivity`/`ActivityOccurrence` collections: weekly series are materialised into ordinary activities (max 366) sharing a `seriesId`.
- Rate limiting only protects auth endpoints.

## Known trade-offs
- Refresh token is stored in `localStorage` (simple and works cross-origin Vercel→Render, but readable by any XSS; the frontend has no CSP configured yet, which would be a sensible hardening step). Access tokens last 15 min; refresh rotation + reuse detection limit the damage of a leaked token.
- A sleeping free Render web service cannot run the worker; the worker needs an always-on (paid) instance.
- Overnight activities are supported via an explicit `endDate`; analytics attribute an activity to the local date it starts.
