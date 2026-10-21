// Minimal HTTP toolkit: router, JSON/body parsing, cookies, responses.
import { HttpError, bad } from '../lib/errors.js';

export function createRouter() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  const match = (method, path) => {
    let allowed = false;
    for (const r of routes) { const m = r.re.exec(path); if (!m) continue; if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { allowed = true; continue; }
      const params = {}; r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } }); return { route: r, params }; }
    return allowed ? { methodNotAllowed: true } : null;
  };
  return { get: (p, ...h) => add('GET', p, ...h), post: (p, ...h) => add('POST', p, ...h), put: (p, ...h) => add('PUT', p, ...h), patch: (p, ...h) => add('PATCH', p, ...h), del: (p, ...h) => add('DELETE', p, ...h), match };
}

export function parseCookies(header) {
  const out = {}; if (!header) return out;
  for (const part of header.split(';')) { const i = part.indexOf('='); if (i < 0) continue; const k = part.slice(0, i).trim(); const val = part.slice(i + 1).trim(); try { out[k] = decodeURIComponent(val); } catch { out[k] = val; } }
  return out;
}
export function setCookie(res, name, value, o = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${o.path || '/'}; SameSite=${o.sameSite || 'Lax'}`;
  if (o.httpOnly !== false) c += '; HttpOnly'; if (o.secure) c += '; Secure';
  if (o.maxAge != null) c += `; Max-Age=${Math.floor(o.maxAge)}`;
  const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

export async function readBody(req, limitBytes) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limitBytes) throw new HttpError(413, 'too_large', `Request body is larger than ${Math.round(limitBytes / 1024)} KB`); chunks.push(c); }
  return Buffer.concat(chunks);
}
export async function readJson(req, limitBytes = 64 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json');
  const buf = await readBody(req, limitBytes); if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('Body is not valid JSON'); }
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
// TRUST_PROXY = number of proxies in front of the app (Caddy/nginx = 1, Cloudflare + nginx = 2).
// We read X-Forwarded-For from the right: the left-most entries can be forged by the client.
export function clientIp(req, hops) {
  if (hops > 0) { const list = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (list.length) return list[Math.max(0, list.length - hops)]; }
  return req.socket.remoteAddress || 'unknown';
}
