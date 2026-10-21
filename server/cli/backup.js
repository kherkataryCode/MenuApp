// Consistent SQLite backup while the app is running: npm run backup [-- ./path/file.db]
// For PostgreSQL use pg_dump (docs/OPERATIONS.md).
import { mkdirSync } from 'node:fs';
import { loadDotEnv, getConfig } from '../config.js';
import { openDb } from '../db/index.js';
loadDotEnv(); const cfg = getConfig();
const db = await openDb(cfg.databaseUrl);
if (db.kind !== 'sqlite') { console.error('This command is for SQLite. For PostgreSQL run: pg_dump "$DATABASE_URL" > backup.sql'); process.exit(1); }
const dest = process.argv[2] || `./data/backups/hungry-mango-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
mkdirSync(dest.replace(/\/[^/]+$/, ''), { recursive: true });
await db.backup(dest); await db.close(); console.log('Backup written to', dest);
