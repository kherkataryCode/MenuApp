import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { setLogLevel } from '../server/lib/log.js';
setLogLevel(process.env.TEST_LOG_LEVEL || 'silent');

export const OWNER = { username: 'owner', password: 'correct-horse-battery-staple' };
export async function startServer(env = {}) {
  const cfg = getConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL || 'sqlite::memory:', ADMIN_BOOTSTRAP_USER: OWNER.username, ADMIN_BOOTSTRAP_PASSWORD: OWNER.password, TABLE_COUNT: '8', ORDER_COOLDOWN_SECONDS: '0', ...env });
  const app = await createApp(cfg); const port = await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${port}`, close: () => app.close() };
}
// Minimal cookie-keeping HTTP client, one per simulated browser.
export function client(base) {
  const jar = new Map(); let csrf = '';
  async function req(method, path, body, headers = {}) {
    const h = { 'x-hm': '1', ...headers }; if (csrf) h['x-csrf-token'] = csrf;
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload = body; if (body !== undefined && !(body instanceof Uint8Array)) { h['content-type'] = h['content-type'] || 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(c) || !v) jar.delete(k); else jar.set(k, v); }
    const ct = res.headers.get('content-type') || ''; const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (p, h) => req('GET', p, undefined, h), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b, h) => req('PUT', p, b, h), patch: (p, b, h) => req('PATCH', p, b, h), del: (p, h) => req('DELETE', p, undefined, h),
    raw: req, jar, setCsrf: t => { csrf = t; },
    async login(u = OWNER) { const r = await req('POST', '/api/admin/login', u); if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.data)); csrf = r.data.csrf; return r.data; },
  };
}
