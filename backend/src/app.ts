import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { activitiesRouter } from './routes/activities.js';
import { remindersRouter } from './routes/reminders.js';
import { notificationsRouter } from './routes/notifications.js';
import { analyticsRouter } from './routes/analytics.js';
import { dataRouter } from './routes/data.js';
import { lifeRouter } from './routes/life.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  const origins = config.FRONTEND_URL.split(',').map((s) => s.trim());
  app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o) || config.NODE_ENV !== 'production'), credentials: false }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
  app.use('/api/auth', authRouter());
  app.use('/api/activities', activitiesRouter());
  app.use('/api/reminders', remindersRouter());
  app.use('/api/notifications', notificationsRouter());
  app.use('/api/analytics', analyticsRouter());
  app.use('/api', dataRouter());
  app.use('/api', lifeRouter());
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'No such route' }));
  app.use(errorHandler);
  return app;
}
