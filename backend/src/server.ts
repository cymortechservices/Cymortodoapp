import { config } from './config.js';
import { createApp } from './app.js';
import { connectDb, ensureIndexes } from './db/connection.js';

await connectDb(config.MONGODB_URI);
await ensureIndexes({ skipTtl: ['1', 'true'].includes(config.SKIP_TTL_INDEXES) });
createApp().listen(config.PORT, () => console.log(`CYMOR TO-DO API listening on :${config.PORT}`));
