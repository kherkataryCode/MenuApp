// Create or reset an admin account.
//   npm run create-admin                      (interactive)
//   npm run create-admin -- --user owner --role owner --password '...'   (scripts/CI)
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadDotEnv, getConfig } from '../config.js';
import { openDb } from '../db/index.js';
import { createAuth } from '../services/auth.js';

loadDotEnv(); const cfg = getConfig();
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => { const [k, ...r] = s.trim().split(/\s+/); return [k, r.join(' ').replace(/^['"]|['"]$/g, '')]; }));
const rl = createInterface({ input: stdin, output: stdout });
const username = args.user || (await rl.question('Username (e.g. owner): ')).trim();
const role = args.role || ((await rl.question('Role [owner/staff] (owner): ')).trim() || 'owner');
let password = args.password;
if (!password) { password = await rl.question('Password (min 10 chars, input is visible — clear your terminal after): '); }
rl.close();
const db = await openDb(cfg.databaseUrl); const auth = createAuth({ db, cfg });
const existing = await db.get('SELECT id FROM admin_users WHERE username = ?', [username.toLowerCase()]);
try {
  if (existing) { await auth.setPassword(existing.id, password); await db.run('DELETE FROM login_attempts WHERE key = ?', [`u:${username.toLowerCase()}`]); await db.run('UPDATE admin_users SET role = ?, disabled = 0 WHERE id = ?', [role, existing.id]); console.log(`Updated ${username} (${role}). Existing sessions were signed out.`); }
  else { await auth.createUser(username, password, role); console.log(`Created ${username} (${role}). Sign in at ${cfg.publicUrl || 'http://localhost:' + cfg.port}/admin`); }
} catch (e) { console.error('Error:', e.message); process.exitCode = 1; }
await db.close();
