# Notifications — how it works, how to test it, and its limits

## Pipeline
1. Creating/editing an activity or reminder writes durable `NotificationJob` rows (per occurrence, 7-day horizon). No browser timers are involved.
2. The **worker** (`npm run start:worker`) polls every 5 s, claims due jobs (fenced, leased), applies the stale policy, checks preconditions at send time (cancelled/deleted/paused → skip; overdue after check-out → skip; overdue text recomputed with the real overrun), and sends Web Push (VAPID) to **every** active device of the user.
3. Status vocabulary: pending → processing → sent_to_provider | retry | failed | expired | skipped. `delivered`/`opened` come **only** from the device's service worker acknowledging (signed per-job token). The Notifications page shows these honestly ("Sent to push service" ≠ "Delivered to device").
4. Dead subscriptions (HTTP 404/410) deactivate only that device. Transient errors retry with exponential backoff (max 5 attempts).
5. Stale defaults: pre-start 5 min grace (never after start), start 10, end 15, overdue 60, reminders 15 (reminder option "send even if late" up to 2 h for critical ones).
6. Notification buttons (Check in / Check out / Snooze) call `/api/notifications/action` with a 6 h signed token embedded in the push, so they work without a login session.

## Spec wording (implemented verbatim)
- Pre-start — **CYMOR REMINDER**: "Your {activity} session starts in {n} minutes. Prepare yourself."
- Start — **YOUR ACTIVITY STARTS NOW**: "{activity}. Time to focus and execute your plan."
- End — **TIME IS UP**: "Your {activity} session has ended. Check out your activity and prepare for your next scheduled event."
- Overdue — **CYMOR ALERT**: "You have exceeded your scheduled {activity} time by {n} minutes. Your next activity remains on schedule."

## Setup
1. `cd backend && npm run generate-vapid` → put the keys in `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` for **both** API and worker; set `VAPID_SUBJECT=mailto:you@yourdomain`.
2. Set `BACKEND_URL` to the API's public HTTPS URL (embedded in pushes for the buttons) and `FRONTEND_URL` to the app origin (CORS).
3. Run the worker as its own always-on service.
4. Push requires **HTTPS** (localhost is allowed for development).

## Test on your phone (never claimed to have been done for you)
1. Open the deployed app over HTTPS; sign in; Settings → Notification centre (Alerts) → **Enable push** → allow.
2. The **System check** must show four green dots (keys, ≥1 device, worker alive, no late unsent jobs).
3. Press **Send test**. Within ~10 s a notification must appear. If not, the check tells you which link is broken.
4. Create an activity starting in 12 minutes: expect heads-up at −10, start, end, and overdue (if you don't check out).
5. Android Chrome: install via "Add to Home screen" for best reliability. **iPhone/iPad: you must add to Home Screen first (iOS 16.4+) and open from there.**

## Limits (cannot be engineered away)
- No push provider guarantees delivery or timing; devices in Doze/Low-Power modes or with notifications muted may delay or drop them.
- A device that is offline/off receives nothing until it reconnects; jobs past their stale window are recorded as `expired`.
- Custom sounds cannot be forced for background pushes; the OS plays its own. In-app sounds (WebAudio) only play while the app is open.
- Browsers can revoke subscriptions; the app detects 410s and shows the device as expired so you can re-enable.
