// Admin passwords (scrypt), admin sessions (random token, hash stored), CSRF tokens,
// login lockout, and signed guest tokens bound to one table seating.
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { rid, token, sha256, hmac, safeEqual } from '../lib/ids.js';
import { unauthorized, forbidden, tooMany, bad } from '../lib/errors.js';
const scrypt = promisify(scryptCb);
const N = 16384, R = 8, P = 1, LEN = 64;

export async function hashPassword(pw) {
  const salt = randomBytes(16); const key = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, s, k] = String(stored).split('$'); if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), LEN, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  const exp = Buffer.from(k, 'base64'); return exp.length === key.length && timingSafeEqual(exp, key);
}
export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw bad('Password must be at least 10 characters.');
  if (pw.length > 200) throw bad('Password is too long.');
  if (/^(.)\1+$/.test(pw) || /^(password|1234567890|qwertyuiop)/i.test(pw)) throw bad('Pick a less guessable password.');
}

export function createAuth({ db, cfg }) {
  // Per-username lock after 5 misses; per-IP lock only after 30 (staff often share one restaurant Wi-Fi IP).
  const LOCK_MS = 15 * 60_000; const limitFor = key => key.startsWith('ip:') ? 30 : 5;
  async function attempt(key) {
    const row = await db.get('SELECT fails, locked_until FROM login_attempts WHERE key = ?', [key]);
    if (row && row.locked_until > Date.now()) throw tooMany(Math.ceil((row.locked_until - Date.now()) / 1000), 'Too many failed sign-ins. Try again in 15 minutes.');
  }
  async function fail(key) {
    const row = await db.get('SELECT fails FROM login_attempts WHERE key = ?', [key]); const fails = (row?.fails || 0) + 1;
    const locked = fails >= limitFor(key) ? Date.now() + LOCK_MS : 0;
    await db.run('INSERT INTO login_attempts (key, fails, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until, updated_at = excluded.updated_at', [key, locked ? 0 : fails, locked, Date.now()]);
  }
  return {
    async login(username, password, ip, ua) {
      const key = `u:${String(username).toLowerCase()}`; await attempt(key); await attempt(`ip:${ip}`);
      const u = await db.get('SELECT * FROM admin_users WHERE username = ?', [String(username).toLowerCase()]);
      const ok = u && !u.disabled && await verifyPassword(password, u.pass_hash);
      if (!u) await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88)); // equalise timing
      if (!ok) { await fail(key); await fail(`ip:${ip}`); throw unauthorized('Wrong username or password.', 'bad_credentials'); }
      await db.run('DELETE FROM login_attempts WHERE key IN (?, ?)', [key, `ip:${ip}`]);
      const t = token(32), csrf = token(24), now = Date.now();
      await db.run('INSERT INTO admin_sessions (token_hash, user_id, csrf, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)', [sha256(t), u.id, csrf, now, now + cfg.adminSessionHours * 3600_000, ip, String(ua || '').slice(0, 200)]);
      return { token: t, csrf, user: { id: u.id, username: u.username, role: u.role } };
    },
    async session(tok) {
      if (!tok) return null;
      const s = await db.get('SELECT s.user_id, s.csrf, s.expires_at, u.username, u.role, u.disabled FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha256(tok)]);
      if (!s || s.expires_at < Date.now() || s.disabled) return null;
      return { user: { id: s.user_id, username: s.username, role: s.role }, csrf: s.csrf };
    },
    logout: tok => db.run('DELETE FROM admin_sessions WHERE token_hash = ?', [sha256(tok || '')]),
    purgeExpired: () => db.run('DELETE FROM admin_sessions WHERE expires_at < ?', [Date.now()]),
    async createUser(username, password, role = 'staff') {
      username = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw bad('Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
      if (!['owner', 'staff'].includes(role)) throw bad('Role must be owner or staff.');
      checkPasswordStrength(password);
      if (await db.get('SELECT id FROM admin_users WHERE username = ?', [username])) throw bad('That username is taken.', 'username_taken');
      const id = rid(12); await db.run('INSERT INTO admin_users (id, username, pass_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)', [id, username, await hashPassword(password), role, Date.now()]);
      return { id, username, role };
    },
    async setPassword(userId, password) { checkPasswordStrength(password); await db.run('UPDATE admin_users SET pass_hash = ? WHERE id = ?', [await hashPassword(password), userId]); await db.run('DELETE FROM admin_sessions WHERE user_id = ?', [userId]); },
    // ---- guests: token = payload.signature, payload = base64url(JSON) ----
    signGuest(payload) { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return body + '.' + hmac(cfg.secret, 'guest:' + body); },
    readGuest(tok) {
      if (!tok || typeof tok !== 'string') return null; const [body, sig] = tok.split('.');
      if (!body || !sig || !safeEqual(sig, hmac(cfg.secret, 'guest:' + body))) return null;
      try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p.exp > Date.now() ? p : null; } catch { return null; }
    },
    requireCsrf(sess, header) { if (!header || !safeEqual(header, sess.csrf)) throw forbidden('Security check failed. Reload the page and try again.', 'csrf'); },
  };
}
