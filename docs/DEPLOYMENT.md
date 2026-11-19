# Deployment (MongoDB Atlas + Render + Vercel)

1. **Atlas**: create a cluster (free tier is fine for development), a DB user, and allow Render's egress IPs (or 0.0.0.0/0 while testing). Copy the connection string into `MONGODB_URI`.
2. **VAPID keys**: `cd backend && npm install && npm run generate-vapid`.
3. **Render**: New → Blueprint → select the repo (`render.yaml`). It creates the API (web) and the **worker** (always-on, paid `starter`). Fill the shared env group (see `.env.example`): `MONGODB_URI`, `VAPID_*`, `FRONTEND_URL`, `BACKEND_URL`, `SMTP_URL` + `MAIL_FROM`. JWT secrets are generated. The API refuses to boot in production with default secrets.
4. **Vercel**: import the repo, root directory `frontend`, env `VITE_API_URL=https://<your-api>.onrender.com`. `vercel.json` handles SPA rewrites and the service-worker headers.
5. Set Render's `FRONTEND_URL` to the Vercel URL (and any custom domain, comma-separated), redeploy the API + worker.
6. Smoke test: register → verify email → plan an activity 12 minutes ahead → enable push → follow `docs/NOTIFICATIONS.md` §Test on your phone.
7. Before relying on it: run `npm run test:mongo` against a throwaway Atlas database (STATUS.md explains why).
