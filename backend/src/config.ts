import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/cymor-todo'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  BACKEND_URL: z.string().default('http://localhost:4000'),
  DEFAULT_TIMEZONE: z.string().default('Africa/Nairobi'),
  SMTP_URL: z.string().default(''), // e.g. smtps://user:pass@smtp.example.com ; empty => emails are logged
  MAIL_FROM: z.string().default('CYMOR TO-DO <no-reply@example.com>'),
  SKIP_TTL_INDEXES: z.enum(['0', '1', 'true', 'false']).default('0'), // only for MongoDB-compatible stand-ins without TTL support
  UPLOAD_LIMIT_MB: z.coerce.number().default(10),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production') {
    const weak = [cfg.JWT_ACCESS_SECRET, cfg.JWT_REFRESH_SECRET].some((s) => s.startsWith('dev-'));
    if (weak) throw new Error('Refusing to start in production with default JWT secrets. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.');
  }
  return cfg;
}

export const config = loadConfig();
