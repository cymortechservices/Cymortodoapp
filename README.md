# CYMOR TO-DO — Own your time. Master your day.
CYMOR TECH SERVICES · Founder & developer: Legendary Smiley Cymor

A timezone-correct planner with reliable background reminders, live time accounting (check-in / pause / interruption / check-out), analytics, offline-tolerant check-ins and an installable PWA.

**V1.0 — full application** (core engine + API + worker + React PWA). Read `docs/STATUS.md` for exactly what was tested and what was not (notably: real-phone push and Atlas were not tested).

## Layout
| Path | What |
|---|---|
| `backend/src/core` | Pure, unit-tested engine: time/DST, recurrence, notification planning, queue + worker logic, accounting, analytics, overlap, timetable import |
| `backend/src/routes`, `services`, `db` | Express API, Zod validation, Mongoose models, JWT auth, web-push, planners |
| `backend/src/server.ts` / `workerMain.ts` | API process and the **separate always-on worker** that sends scheduled notifications |
| `frontend/` | React + Vite + TypeScript + Tailwind PWA (service worker, IndexedDB offline queue, Web Push) |
| `render.yaml`, `frontend/vercel.json` | Deploy config (Render API + worker, Vercel frontend) |
| `docs/` | `STATUS.md` (QA report), `ARCHITECTURE.md`, `NOTIFICATIONS.md`, `DEPLOYMENT.md` |

## Run locally (Windows PowerShell; Node 20+)
```powershell
# 1) backend
cd backend
npm install
copy ..\.env.example .env        # then fill MONGODB_URI, JWT secrets, VAPID keys (npm run generate-vapid)
npm run typecheck
npm test                         # 49 pure tests; 11 more run when MONGO_TEST_URI is set
npm run dev                      # API on :4000
npm run worker                   # in a 2nd terminal: sends scheduled notifications
npm run seed                     # optional demo data: demo@cymor.test / demo-pass-123

# 2) frontend (new terminal)
cd frontend
npm install
npm run dev                      # http://localhost:5173 (proxies /api to :4000)
npm test ; npm run build
```
Integration tests: `set MONGO_TEST_URI=mongodb://localhost:27017` then `npm test` (use a throwaway database server; tests create and drop their own databases).

## Honest limits (short version)
Push delivery is never guaranteed by any provider; iOS needs a Home-Screen install; background sounds can't be forced; the worker must run on an always-on instance. Details in `docs/NOTIFICATIONS.md`.
