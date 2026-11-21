import { config } from './config.js';
import { createApp } from './app.js';
import { connectDb, ensureIndexes } from './db/connection.js';

// Bind the port FIRST so hosts such as Render see an open port immediately (and /health answers),
// then connect to the database. A database failure is logged clearly and exits so the host restarts it.
const server = createApp().listen(config.PORT, '0.0.0.0', () => console.log(`CYMOR TO-DO API listening on 0.0.0.0:${config.PORT}`));
server.on('error', (e) => { console.error('Could not bind port:', e); process.exit(1); });

try {
  await connectDb(config.MONGODB_URI);
  console.log('Database connected');
  // An index problem must never keep the API down; log it loudly and carry on.
  await ensureIndexes({ skipTtl: ['1', 'true'].includes(config.SKIP_TTL_INDEXES) })
    .then(() => console.log('Indexes ready'))
    .catch((e) => console.error('INDEX SETUP FAILED (API keeps running):', e));
} catch (e) {
  console.error('DATABASE CONNECTION FAILED. Check MONGODB_URI, the Atlas user/password, and Atlas Network Access (allow 0.0.0.0/0 for Render).\n', e);
  process.exit(1);
}
