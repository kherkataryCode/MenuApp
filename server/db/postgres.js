// PostgreSQL driver (optional dependency "pg"). Use this when running several app
// instances behind a load balancer. Queries are written with "?" placeholders and
// converted to $1..$n here so both drivers share the same SQL.
export async function openPostgres(url) {
  let pg;
  try { pg = (await import('pg')).default; } catch { throw new Error('DATABASE_URL points at PostgreSQL but the "pg" package is not installed. Run: npm install pg'); }
  pg.types.setTypeParser(20, v => parseInt(v, 10));   // BIGINT -> number (timestamps in ms fit safely)
  pg.types.setTypeParser(1700, v => parseFloat(v));    // NUMERIC -> number
  const ssl = /sslmode=(require|verify-full)/.test(url) ? { rejectUnauthorized: /verify-full/.test(url) } : undefined;
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10), ssl, idleTimeoutMillis: 30000 });
  const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  const norm = p => (p || []).map(x => typeof x === 'boolean' ? (x ? 1 : 0) : x === undefined ? null : x);
  const mk = c => ({
    all: async (sql, p) => (await c.query(conv(sql), norm(p))).rows,
    get: async (sql, p) => (await c.query(conv(sql), norm(p))).rows[0],
    run: async (sql, p) => ({ changes: (await c.query(conv(sql), norm(p))).rowCount }),
  });
  const base = mk(pool);
  return {
    kind: 'postgres', blobType: 'BYTEA', pool,
    ...base,
    exec: async sql => { await pool.query(sql); },
    tx: async fn => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn(mk(c)); await c.query('COMMIT'); return r; }
      catch (e) { try { await c.query('ROLLBACK'); } catch { } throw e; }
      finally { c.release(); }
    },
    backup: async () => { throw new Error('Use pg_dump for PostgreSQL backups (see docs/OPERATIONS.md).'); },
    ping: async () => { await pool.query('SELECT 1'); return true; },
    close: async () => pool.end(),
  };
}
