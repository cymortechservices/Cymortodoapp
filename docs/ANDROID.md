# Android app — build & test

## How it works
The React app is wrapped by Capacitor (`frontend/android/`). App id: `com.cymortech.todo`.
Notifications: the phone fetches `/notifications/upcoming` and schedules the nearest 60 reminders locally (so they ring offline / with the server asleep). It tells the server how far it covers (`localUntil`); the worker sends FCM pushes only for jobs beyond that.

## Build the APK with GitHub Actions
1. Repo → Settings → Secrets and variables → Actions. Add `VITE_API_URL` (your deployed backend URL, no trailing slash).
2. Optional for server push: add `GOOGLE_SERVICES_JSON_BASE64` = `base64 -w0 google-services.json`.
3. Actions → "Build Android APK" → Run workflow → download artifact `CYMOR-TO-DO-debug-apk` → install on your phone (allow "install unknown apps").
4. Backend env: The app origin (`https://localhost`) is already allowed by CORS. Set `FIREBASE_SERVICE_ACCOUNT` (service-account JSON, one line) on both API and worker.

## Build locally
`cd frontend && npm i && VITE_API_URL=https://your-api npm run cap:sync && npm run cap:open` (Android Studio), or `cd android && ./gradlew assembleDebug`.

## Phone checklist
Open app → Alerts → "Phone alerts" card → Allow notifications → allow exact alarms → set battery to Unrestricted → create an activity 3 minutes ahead → lock the phone.
