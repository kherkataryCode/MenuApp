// SQLite driver using Node's built-in node:sqlite (no native add-ons, no npm install).
// Single-process only: use PostgreSQL when you run more than one app instance.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openSqlite(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  const norm = p => (p || []).map(x => typeof x === 'boolean' ? (x ? 1 : 0) : x === undefined ? null : x);
  const fix = r => { if (!r) return r; const o = {}; for (const [k, val] of Object.entries(r)) o[k] = val instanceof Uint8Array ? Buffer.from(val) : val; return o; };
  const q = {
    all: async (sql, p) => stmt(sql).all(...norm(p)).map(fix),
    get: async (sql, p) => fix(stmt(sql).get(...norm(p))),
    run: async (sql, p) => { const r = stmt(sql).run(...norm(p)); return { changes: Number(r.changes) }; },
  };
  // Writes are serialised so an awaiting transaction can never interleave with another request's write.
  let chain = Promise.resolve();
  const locked = fn => { const next = chain.then(fn, fn); chain = next.catch(() => {}); return next; };
  return {
    kind: 'sqlite',
    blobType: 'BLOB',
    all: q.all, get: q.get,
    run: (sql, p) => locked(() => q.run(sql, p)),
    exec: async sql => db.exec(sql),
    tx: fn => locked(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const r = await fn(q); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { } throw e; }
    }),
    backup: async (dest) => { db.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`); },
    ping: async () => { stmt('SELECT 1 AS ok').get(); return true; },
    close: async () => db.close(),
  };
}
