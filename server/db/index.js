import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { openSqlite } from './sqlite.js';
import { openPostgres } from './postgres.js';
import { log } from '../lib/log.js';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function openDb(url) {
  let db;
  if (/^postgres(ql)?:\/\//.test(url)) db = await openPostgres(url);
  else if (url.startsWith('sqlite:')) db = openSqlite(url.slice(7) || ':memory:');
  else throw new Error(`Unsupported DATABASE_URL "${url}". Use sqlite:./data/app.db or postgres://user:pass@host/db`);
  await migrate(db);
  return db;
}

export async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)');
  const files = readdirSync(MIG_DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  // One transaction for the whole run. On PostgreSQL an advisory lock makes other
  // instances starting at the same moment wait here instead of racing.
  await db.tx(async t => {
    if (db.kind === 'postgres') await t.get('SELECT pg_advisory_xact_lock(727274)');
    const done = new Set((await t.all('SELECT version FROM schema_migrations')).map(r => Number(r.version)));
    for (const f of files) {
      const version = parseInt(f, 10); if (done.has(version)) continue;
      const sql = readFileSync(join(MIG_DIR, f), 'utf8').replaceAll('{{BLOB}}', db.blobType);
      for (const statement of sql.split(/;\s*$/m).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await t.run(statement);
      await t.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, Date.now()]);
      log.info('migration applied', { version, file: f });
    }
  });
}
