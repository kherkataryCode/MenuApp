// Builds the HTTP server. Used by server/index.js and by the test suite.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRouter, parseCookies, sendJson, clientIp } from './http/core.js';
import { securityHeaders } from './http/security.js';
import { createLimiter } from './http/ratelimit.js';
import { createStatic } from './http/static.js';
import { openDb } from './db/index.js';
import { createBus } from './bus/index.js';
import { createAuth } from './services/auth.js';
import { createRestaurant } from './services/restaurant.js';
import { registerRoutes } from './routes/api.js';
import { HttpError } from './lib/errors.js';
import { rid } from './lib/ids.js';
import { log } from './lib/log.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function createMetrics() {
  const counters = new Map(), gauges = new Map(), hist = new Map(); const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];
  return {
    inc: (k, n = 1) => counters.set(k, (counters.get(k) || 0) + n),
    gauge: (k, d) => gauges.set(k, (gauges.get(k) || 0) + d),
    observe(route, status, secs) { const k = `${route}|${status}`; let h = hist.get(k); if (!h) { h = { b: buckets.map(() => 0), sum: 0, n: 0 }; hist.set(k, h); } buckets.forEach((b, i) => { if (secs <= b) h.b[i]++; }); h.sum += secs; h.n++; },
    render() {
      const out = [];
      for (const [k, val] of counters) out.push(`# TYPE hm_${k} counter`, `hm_${k} ${val}`);
      for (const [k, val] of gauges) out.push(`# TYPE hm_${k} gauge`, `hm_${k} ${val}`);
      out.push('# TYPE hm_http_request_duration_seconds histogram');
      for (const [k, h] of hist) { const [route, status] = k.split('|'); const l = `route="${route}",status="${status}"`; buckets.forEach((b, i) => out.push(`hm_http_request_duration_seconds_bucket{${l},le="${b}"} ${h.b[i]}`)); out.push(`hm_http_request_duration_seconds_bucket{${l},le="+Inf"} ${h.n}`, `hm_http_request_duration_seconds_sum{${l}} ${h.sum}`, `hm_http_request_duration_seconds_count{${l}} ${h.n}`); }
      out.push(`hm_process_resident_memory_bytes ${process.memoryUsage().rss}`); return out.join('\n') + '\n';
    },
  };
}

export async function createApp(cfg) {
  const db = await openDb(cfg.databaseUrl);
  const bus = await createBus(db);
  const auth = createAuth({ db, cfg });
  const svc = createRestaurant({ db, bus, cfg });
  const limiter = createLimiter(cfg.rateLimitMultiplier);
  const metrics = createMetrics();
  await svc.ensureTables();

  // Seeding and bootstrap are idempotent; if a parallel instance got there first, carry on.
  try {
    if (cfg.seedOnEmpty && await svc.isMenuEmpty()) {
      const menuJson = JSON.parse(await readFile(join(ROOT, 'seed', 'menu.json'), 'utf8'));
      await svc.seed(menuJson, f => readFile(join(ROOT, 'seed', 'images', f)));
      log.info('starter menu seeded', { items: menuJson.items.length });
    }
  } catch (e) { log.warn('starter menu not seeded (another instance may have done it)', { err: String(e.message || e) }); }
  try {
    if (cfg.bootstrapUser && cfg.bootstrapPassword && !(await db.get('SELECT id FROM admin_users LIMIT 1'))) {
      await auth.createUser(cfg.bootstrapUser, cfg.bootstrapPassword, 'owner');
      log.warn('bootstrap owner account created — remove ADMIN_BOOTSTRAP_PASSWORD from your environment now', { username: cfg.bootstrapUser });
    }
  } catch (e) { log.warn('bootstrap owner not created', { err: String(e.message || e) }); }

  const router = createRouter();
  const ctx = { cfg, db, bus, auth, svc, limiter, metrics };
  registerRoutes(router, ctx);
  const serveStatic = createStatic(join(ROOT, 'web'), cfg);
  const purge = setInterval(() => auth.purgeExpired().catch(() => {}), 3600_000); purge.unref();

  const server = createServer(async (req, res) => {
    const started = process.hrtime.bigint(); const reqId = rid(10);
    res.req = req; req.id = reqId; req.ip = clientIp(req, cfg.trustProxy); req.cookies = parseCookies(req.headers.cookie);
    securityHeaders(res, cfg); res.setHeader('X-Request-Id', reqId);
    let routeName = 'static';
    res.on('finish', () => {
      const secs = Number(process.hrtime.bigint() - started) / 1e9; metrics.observe(routeName, res.statusCode, secs);
      if (res.statusCode >= 500) log.error('request', { id: reqId, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Math.round(secs * 1000) });
      else log.debug('request', { id: reqId, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Math.round(secs * 1000) });
    });
    try {
      let path; try { path = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { throw new HttpError(400, 'bad_request', 'Bad URL'); }
      const m = router.match(req.method, path);
      if (m?.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
      if (m) { routeName = m.route.re.source; for (const h of m.route.handlers) await h(req, res, m.params); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(404, 'not_found', 'Not found');
      if (path.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Not found');
      // Pages: / (landing), /t/:n (table), /admin
      if (path === '/' || /^\/t\/\d{1,3}\/?$/.test(path)) { if (await serveStatic(req, res, '/index.html')) return; }
      if (path === '/admin' || path === '/admin/') { if (await serveStatic(req, res, '/admin.html')) return; }
      if (path.endsWith('.html')) throw new HttpError(404, 'not_found', 'Not found');
      if (await serveStatic(req, res, path)) return;
      throw new HttpError(404, 'not_found', 'Not found');
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) {
        const headers = e.extra?.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
        if (e.status === 404 && !req.url.startsWith('/api/') && !req.url.startsWith('/img/')) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:sans-serif;padding:40px">Page not found. <a href="/">Go home</a></p>'); }
        return sendJson(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) }, headers);
      }
      log.error('unhandled error', { id: reqId, err: String(e?.stack || e) });
      sendJson(res, 500, { error: 'server_error', message: 'Something went wrong. Please try again.', requestId: reqId });
    }
  });
  server.headersTimeout = 15_000; server.requestTimeout = 0; server.keepAliveTimeout = 65_000;

  return {
    server, ctx,
    async listen(port = cfg.port, host = cfg.host) { await new Promise(r => server.listen(port, host, r)); return server.address().port; },
    async close() { clearInterval(purge); limiter.close(); server.closeAllConnections?.(); await new Promise(r => server.close(r)); await bus.close(); await db.close(); },
  };
}
