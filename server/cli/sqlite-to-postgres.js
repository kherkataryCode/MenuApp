// Copy everything from a SQLite database into an empty PostgreSQL database.
//   DATABASE_URL=postgres://... node server/cli/sqlite-to-postgres.js ./data/hungry-mango.db
// Stop the app first so nothing changes during the copy. Add --force to copy into a non-empty target.
import { loadDotEnv } from '../config.js';
import { openSqlite } from '../db/sqlite.js';
import { openDb } from '../db/index.js';

loadDotEnv();
const src = process.argv.find((a, i) => i > 1 && !a.startsWith('--'));
const target = process.env.DATABASE_URL || '';
if (!src || !/^postgres/.test(target)) { console.error('Usage: DATABASE_URL=postgres://... node server/cli/sqlite-to-postgres.js <path-to-sqlite.db> [--force]'); process.exit(1); }
const TABLES = ['categories', 'images', 'items', 'settings', 'dining_tables', 'table_sessions', 'guests', 'plate_lines', 'orders', 'calls', 'admin_users', 'admin_sessions', 'login_attempts', 'audit_log'];
const from = openSqlite(src); const to = await openDb(target);
if (!process.argv.includes('--force') && (await to.get('SELECT id FROM admin_users LIMIT 1') || await to.get('SELECT id FROM categories LIMIT 1'))) {
  console.error('Target already has data. Use an empty database, or pass --force to add rows into it.'); process.exit(1);
}
await to.tx(async t => {
  for (const table of TABLES) {
    const rows = await from.all(`SELECT * FROM ${table}`); if (!rows.length) { console.log(`${table}: 0`); continue; }
    const cols = Object.keys(rows[0]); const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`;
    for (const r of rows) await t.run(sql, cols.map(c => r[c]));
    console.log(`${table}: ${rows.length}`);
  }
});
await from.close(); await to.close(); console.log('Done. Point DATABASE_URL at PostgreSQL and start the app.');
