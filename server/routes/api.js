// All HTTP endpoints. See docs/API.md for the full reference.
import { readJson, readBody, sendJson, setCookie } from '../http/core.js';
import { openStream } from '../http/sse.js';
import { v, check } from '../lib/validate.js';
import { bad, unauthorized, forbidden, notFound } from '../lib/errors.js';
import { rid } from '../lib/ids.js';

const COLOR = /^#[0-9a-fA-F]{6}$/, ID = /^[a-z0-9_-]{1,40}$/i;
const ingSchema = v.obj({ e: v.str({ max: 8 }), l: v.str({ max: 24 }) });
const itemSchema = v.obj({ cat: v.str({ max: 40, pattern: ID }), name: v.str({ max: 48 }), price: v.int({ min: 1, max: 99999 }), veg: v.bool(), desc: v.str({ max: 200, optional: true }), ings: v.arr(ingSchema, { max: 12, optional: true }), image: v.str({ max: 120 }), anim: v.oneOf(['spin', 'float', 'none'], { optional: true, default: 'spin' }), available: v.bool({ optional: true, default: true }), sort: v.int({ min: 0, max: 100000, optional: true, default: 0 }) });
const catSchema = v.obj({ name: v.str({ max: 30 }), color: v.str({ max: 7, pattern: COLOR }), sort: v.int({ min: 0, max: 100000, optional: true, default: 0 }), hidden: v.bool({ optional: true, default: false }) });

export function registerRoutes(r, ctx) {
  const { cfg, svc, auth, limiter, bus, metrics } = ctx;
  const GUEST_COOKIE = 'hm_guest', ADMIN_COOKIE = 'hm_admin';
  const tableNo = p => { const n = Number(p); if (!Number.isInteger(n) || n < 1 || n > cfg.tableCount) throw notFound('No such table'); return n; };

  // ---------- guards ----------
  const guest = async req => {
    const ctxG = await svc.resolveGuest(auth.readGuest(req.cookies[GUEST_COOKIE]));
    if (!ctxG) throw unauthorized('Join the table first.', 'not_joined'); return ctxG;
  };
  // Guest writes need a custom header: browsers can't send it cross-site without a CORS preflight, which we never allow.
  const guestWrite = req => { if (req.headers['x-hm'] !== '1') throw forbidden('Missing request header.', 'csrf'); };
  const admin = async (req, { write = false, role } = {}) => {
    const s = await auth.session(req.cookies[ADMIN_COOKIE]); if (!s) throw unauthorized();
    if (write) auth.requireCsrf(s, req.headers['x-csrf-token']);
    if (role === 'owner' && s.user.role !== 'owner') throw forbidden('Only the owner can do this.');
    return s;
  };
  const actor = s => `admin:${s.user.username}`;

  // ---------- public ----------
  r.get('/api/config', async (req, res) => sendJson(res, 200, { name: cfg.restaurantName, tables: cfg.tableCount, publicUrl: cfg.publicUrl }));
  r.get('/api/menu', async (req, res) => {
    const m = await svc.menu(); const etag = `"m-${m.version}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    sendJson(res, 200, m, { ETag: etag, 'Cache-Control': 'no-cache' });
  });
  r.get('/img/:id', async (req, res, p) => {
    if (!/^[a-f0-9]{32,64}$/.test(p.id)) throw notFound();
    const etag = `"${p.id}"`; if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    const img = await svc.getImage(p.id); if (!img) throw notFound();
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': img.bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag, 'Content-Disposition': 'inline' });
    res.end(req.method === 'HEAD' ? undefined : img.bytes);
  });
  r.get('/api/tables/:n/status', async (req, res, p) => sendJson(res, 200, await svc.tableStatus(tableNo(p.n))));
  r.post('/api/tables/:n/join', async (req, res, p) => {
    guestWrite(req); const n = tableNo(p.n);
    limiter.hit(`join:ip:${req.ip}`, 8, 60_000); limiter.hit(`join:table:${n}`, 20, 60_000);
    const body = check(v.obj({ code: v.str({ max: 4, pattern: /^\d{4}$/ }) }), await readJson(req));
    const { session, guest: g } = await svc.join(n, body.code);
    const exp = Date.now() + cfg.guestSessionHours * 3600_000;
    setCookie(res, GUEST_COOKIE, auth.signGuest({ t: n, s: session.id, g: g.id, exp }), { secure: cfg.secureCookies, sameSite: 'Lax', maxAge: cfg.guestSessionHours * 3600 });
    metrics.inc('guest_joins_total');
    sendJson(res, 200, { guest: g, table: n });
  });

  // ---------- guest ----------
  r.get('/api/session', async (req, res) => sendJson(res, 200, await svc.snapshot(await guest(req))));
  r.post('/api/session/name', async (req, res) => { guestWrite(req); const g = await guest(req); limiter.hit(`reroll:${g.guest.id}`, 10, 60_000); await svc.rerollName(g); sendJson(res, 200, await svc.snapshot(await guest(req))); });
  r.post('/api/session/plate', async (req, res) => {
    guestWrite(req); const g = await guest(req); limiter.hit(`plate:${g.guest.id}`, 60, 60_000);
    const b = check(v.obj({ item: v.str({ max: 40, pattern: ID }), delta: v.int({ min: -50, max: 50 }) }), await readJson(req));
    await svc.addToPlate(g, b.item, b.delta); sendJson(res, 200, await svc.snapshot(g));
  });
  r.put('/api/session/plate/:item/:guest', async (req, res, p) => {
    guestWrite(req); const g = await guest(req); limiter.hit(`plate:${g.guest.id}`, 60, 60_000);
    const b = check(v.obj({ qty: v.int({ min: 0, max: 50 }) }), await readJson(req));
    await svc.setLine(g, p.item, p.guest, b.qty); sendJson(res, 200, await svc.snapshot(g));
  });
  r.post('/api/session/orders', async (req, res) => {
    guestWrite(req); const g = await guest(req); limiter.hit(`order:${g.session.id}`, 6, 60_000);
    const b = check(v.obj({ note: v.str({ max: 140, optional: true }) }), await readJson(req));
    const key = String(req.headers['idempotency-key'] || '').slice(0, 64) || null;
    const order = await svc.placeOrder(g, b.note, key ? `${g.session.id}:${key}` : null);
    metrics.inc('orders_placed_total');
    sendJson(res, 201, { order, session: await svc.snapshot(g) });
  });
  r.get('/api/session/game', async (req, res) => { const g = await guest(req); sendJson(res, 200, svc.gameSnapshot(g.session.id, g.guest.id)); });
  r.post('/api/session/game/vote', async (req, res) => { guestWrite(req); const g = await guest(req); const b = check(v.obj({ choice: v.int({ min: 0, max: 1 }) }), await readJson(req)); sendJson(res, 200, svc.gameVote(g, b.choice)); });
  r.post('/api/session/game/next', async (req, res) => { guestWrite(req); const g = await guest(req); sendJson(res, 200, svc.gameNext(g)); });
  r.post('/api/session/call', async (req, res) => {
    guestWrite(req); const g = await guest(req); limiter.hit(`call:${g.session.id}`, 4, 60_000);
    const b = check(v.obj({ type: v.oneOf(['server', 'bill']) }), await readJson(req));
    await svc.callStaff(g, b.type); sendJson(res, 200, { ok: true });
  });
  r.get('/api/session/stream', async (req, res) => {
    const g = await guest(req); let current = g;
    const s = openStream(req, res, { onClose: () => { off(); metrics.gauge('sse_clients', -1); } }); metrics.gauge('sse_clients', 1);
    const off = bus.subscribe(async e => {
      if (e.topic === 'menu') s.send('menu');
      else if (e.session === current.session.id) {
        if (e.topic === 'closed') { s.send('closed'); s.end(); }
        else if (['plate', 'guests', 'orders', 'game'].includes(e.topic)) s.send(e.topic);
      }
    });
    s.send('hello', { table: g.table });
  });

  // ---------- admin: auth ----------
  r.post('/api/admin/login', async (req, res) => {
    limiter.hit(`login:${req.ip}`, 10, 60_000);
    const b = check(v.obj({ username: v.str({ max: 32 }), password: v.str({ max: 200, trim: false }) }), await readJson(req));
    const s = await auth.login(b.username, b.password, req.ip, req.headers['user-agent']);
    setCookie(res, ADMIN_COOKIE, s.token, { secure: cfg.secureCookies, sameSite: 'Strict', maxAge: cfg.adminSessionHours * 3600 });
    svc.audit(`admin:${s.user.username}`, 'auth.login', { ip: req.ip });
    sendJson(res, 200, { user: s.user, csrf: s.csrf });
  });
  r.post('/api/admin/logout', async (req, res) => { const s = await admin(req, { write: true }); await auth.logout(req.cookies[ADMIN_COOKIE]); setCookie(res, ADMIN_COOKIE, '', { secure: cfg.secureCookies, sameSite: 'Strict', maxAge: 0 }); svc.audit(actor(s), 'auth.logout'); sendJson(res, 200, { ok: true }); });
  r.get('/api/admin/me', async (req, res) => { const s = await admin(req); sendJson(res, 200, { user: s.user, csrf: s.csrf, config: { name: cfg.restaurantName, tables: cfg.tableCount, publicUrl: cfg.publicUrl } }); });
  r.post('/api/admin/password', async (req, res) => {
    const s = await admin(req, { write: true });
    const b = check(v.obj({ current: v.str({ max: 200, trim: false }), next: v.str({ max: 200, trim: false }) }), await readJson(req));
    await auth.login(s.user.username, b.current, req.ip, '').then(x => auth.logout(x.token));
    await auth.setPassword(s.user.id, b.next); svc.audit(actor(s), 'auth.password_change');
    setCookie(res, ADMIN_COOKIE, '', { secure: cfg.secureCookies, sameSite: 'Strict', maxAge: 0 }); sendJson(res, 200, { ok: true });
  });

  // ---------- admin: floor ----------
  r.get('/api/admin/overview', async (req, res) => { await admin(req); sendJson(res, 200, await svc.overview()); });
  r.post('/api/admin/tables/:n/open', async (req, res, p) => { const s = await admin(req, { write: true }); sendJson(res, 200, await svc.openTable(actor(s), tableNo(p.n))); });
  r.post('/api/admin/tables/:n/code', async (req, res, p) => { const s = await admin(req, { write: true }); sendJson(res, 200, await svc.rotateCode(actor(s), tableNo(p.n))); });
  r.post('/api/admin/tables/:n/close', async (req, res, p) => { const s = await admin(req, { write: true }); await svc.closeTable(actor(s), tableNo(p.n)); sendJson(res, 200, { ok: true }); });
  r.del('/api/admin/tables/:n/call', async (req, res, p) => { const s = await admin(req, { write: true }); await svc.clearCall(actor(s), tableNo(p.n)); sendJson(res, 200, { ok: true }); });
  r.patch('/api/admin/orders/:id', async (req, res, p) => {
    const s = await admin(req, { write: true }); const b = check(v.obj({ status: v.oneOf(['cooking', 'ready', 'served', 'rejected']) }), await readJson(req));
    sendJson(res, 200, await svc.setOrderStatus(actor(s), p.id, b.status));
  });
  r.get('/api/admin/orders.csv', async (req, res) => {
    await admin(req); const u = new URL(req.url, 'http://x'); const day = u.searchParams.get('day');
    const from = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day + 'T00:00:00').getTime() : new Date(new Date().toDateString()).getTime();
    const csv = await svc.exportCsv(from, from + 86400_000);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="orders-${new Date(from).toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' }); res.end(csv);
  });
  r.get('/api/admin/stream', async (req, res) => {
    await admin(req);
    const s = openStream(req, res, { onClose: () => { off(); metrics.gauge('sse_clients', -1); } }); metrics.gauge('sse_clients', 1);
    const off = bus.subscribe(e => { if (['table', 'orders', 'calls', 'guests', 'closed'].includes(e.topic)) s.send('floor', { topic: e.topic, table: e.table, created: !!e.created }); else if (e.topic === 'menu') s.send('menu'); });
    s.send('hello');
  });

  // ---------- admin: menu (owner) ----------
  r.get('/api/admin/menu', async (req, res) => { await admin(req); sendJson(res, 200, await svc.menu({ includeHidden: true })); });
  r.put('/api/admin/categories/:id', async (req, res, p) => { const s = await admin(req, { write: true, role: 'owner' }); if (!ID.test(p.id)) throw bad('Bad id'); sendJson(res, 200, await svc.saveCategory(actor(s), { id: p.id, ...check(catSchema, await readJson(req)) })); });
  r.del('/api/admin/categories/:id', async (req, res, p) => { const s = await admin(req, { write: true, role: 'owner' }); await svc.deleteCategory(actor(s), p.id); sendJson(res, 200, { ok: true }); });
  r.put('/api/admin/items/:id', async (req, res, p) => { const s = await admin(req, { write: true, role: 'owner' }); if (!ID.test(p.id)) throw bad('Bad id'); sendJson(res, 200, await svc.saveItem(actor(s), { id: p.id, ...check(itemSchema, await readJson(req)) })); });
  // Staff may mark dishes sold out during service; everything else on the menu is owner-only.
  r.post('/api/admin/items/:id/availability', async (req, res, p) => { const s = await admin(req, { write: true }); const b = check(v.obj({ available: v.bool() }), await readJson(req)); await svc.setAvailability(actor(s), p.id, b.available); sendJson(res, 200, { ok: true }); });
  r.del('/api/admin/items/:id', async (req, res, p) => { const s = await admin(req, { write: true, role: 'owner' }); await svc.deleteItem(actor(s), p.id); sendJson(res, 200, { ok: true }); });
  r.post('/api/admin/reorder', async (req, res) => { const s = await admin(req, { write: true, role: 'owner' }); const b = check(v.obj({ kind: v.oneOf(['cats', 'items']), ids: v.arr(v.str({ max: 40, pattern: ID }), { max: 500 }) }), await readJson(req)); await svc.reorder(actor(s), b.kind, b.ids); sendJson(res, 200, { ok: true }); });
  r.put('/api/admin/offers', async (req, res) => { const s = await admin(req, { write: true, role: 'owner' }); sendJson(res, 200, await svc.saveOffers(actor(s), await readJson(req))); });
  r.post('/api/admin/images', async (req, res) => {
    const s = await admin(req, { write: true, role: 'owner' }); limiter.hit(`upload:${s.user.id}`, 30, 60_000);
    if (!/^image\/(webp|png|jpeg)$/.test(String(req.headers['content-type']))) throw bad('Send the image bytes with Content-Type image/webp, image/png or image/jpeg.');
    sendJson(res, 201, await svc.saveImage(actor(s), await readBody(req, cfg.maxUploadKb * 1024)));
  });

  // ---------- admin: staff accounts (owner) ----------
  r.get('/api/admin/users', async (req, res) => { await admin(req, { role: 'owner' }); sendJson(res, 200, { users: await ctx.db.all('SELECT id, username, role, disabled, created_at FROM admin_users ORDER BY created_at') }); });
  r.post('/api/admin/users', async (req, res) => {
    const s = await admin(req, { write: true, role: 'owner' });
    const b = check(v.obj({ username: v.str({ max: 32 }), password: v.str({ max: 200, trim: false }), role: v.oneOf(['owner', 'staff']) }), await readJson(req));
    const u = await auth.createUser(b.username, b.password, b.role); svc.audit(actor(s), 'user.create', { username: u.username, role: u.role }); sendJson(res, 201, u);
  });
  r.patch('/api/admin/users/:id', async (req, res, p) => {
    const s = await admin(req, { write: true, role: 'owner' }); if (p.id === s.user.id) throw bad('You cannot change your own account here.');
    const b = check(v.obj({ disabled: v.bool({ optional: true }), password: v.str({ max: 200, trim: false, optional: true }) }), await readJson(req));
    if (!await ctx.db.get('SELECT id FROM admin_users WHERE id = ?', [p.id])) throw notFound('User not found');
    if (b.disabled !== undefined) { await ctx.db.run('UPDATE admin_users SET disabled = ? WHERE id = ?', [b.disabled, p.id]); if (b.disabled) await ctx.db.run('DELETE FROM admin_sessions WHERE user_id = ?', [p.id]); }
    if (b.password) await auth.setPassword(p.id, b.password);
    svc.audit(actor(s), 'user.update', { id: p.id, disabled: b.disabled, passwordReset: !!b.password }); sendJson(res, 200, { ok: true });
  });
  r.get('/api/admin/audit', async (req, res) => { await admin(req, { role: 'owner' }); sendJson(res, 200, { entries: await ctx.db.all('SELECT at, actor, action, detail FROM audit_log ORDER BY at DESC LIMIT 200') }); });

  // ---------- ops ----------
  r.get('/healthz', async (req, res) => sendJson(res, 200, { ok: true }));
  r.get('/readyz', async (req, res) => { try { await ctx.db.ping(); sendJson(res, 200, { ok: true, db: ctx.db.kind }); } catch { sendJson(res, 503, { ok: false }); } });
  r.get('/metrics', async (req, res) => {
    if (cfg.metricsToken && req.headers.authorization !== `Bearer ${cfg.metricsToken}`) throw unauthorized('Metrics token required');
    if (!cfg.metricsToken && cfg.production) throw notFound();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }); res.end(metrics.render());
  });
  return { rid };
}
