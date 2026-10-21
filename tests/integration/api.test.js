import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from '../helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });
let adminClient; const admin = async () => { if (!adminClient) { const c = client(srv.base); await c.login(); adminClient = c; } return adminClient; };
async function openTable(a, n) { const r = await a.post(`/api/admin/tables/${n}/open`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.code; }
async function joinAs(n, code) { const g = client(srv.base); const r = await g.post(`/api/tables/${n}/join`, { code }); assert.equal(r.status, 200, JSON.stringify(r.data)); return g; }

test('health, readiness, public pages and menu', async () => {
  const c = client(srv.base);
  assert.equal((await c.get('/healthz')).status, 200);
  assert.equal((await c.get('/readyz')).data.ok, true);
  for (const p of ['/', '/t/3', '/admin']) { const r = await c.get(p); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/); }
  const m = await c.get('/api/menu'); assert.equal(m.status, 200); assert.ok(m.data.items.length >= 20); assert.ok(m.headers.get('etag'));
  assert.equal((await c.get('/api/menu', { 'if-none-match': m.headers.get('etag') })).status, 304);
  const img = await fetch(srv.base + m.data.items[0].image); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/webp'); assert.match(img.headers.get('cache-control'), /immutable/);
  assert.equal((await c.get('/api/nope')).status, 404); assert.equal((await c.get('/t/999')).status, 200); assert.equal((await c.get('/t/9999')).status, 404);
  assert.equal((await c.get('/../../etc/passwd')).status, 404);
});

test('admin sign-in, CSRF, lockout and roles', async () => {
  const c = client(srv.base);
  assert.equal((await c.get('/api/admin/overview')).status, 401);
  assert.equal((await c.post('/api/admin/login', { username: 'owner', password: 'wrong-password-1' })).status, 401);
  const cookie = (await c.raw('POST', '/api/admin/login', OWNER)).headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const me = await c.login(); assert.equal(me.user.role, 'owner');
  c.setCsrf('forged'); assert.equal((await c.post('/api/admin/tables/1/open')).status, 403); c.setCsrf(me.csrf);
  // staff account: can run the floor, cannot edit the menu
  assert.equal((await c.post('/api/admin/users', { username: 'kitchen', password: 'short', role: 'staff' })).status, 400);
  assert.equal((await c.post('/api/admin/users', { username: 'kitchen', password: 'tandoor-hot-2026', role: 'staff' })).status, 201);
  const s = client(srv.base); await s.login({ username: 'kitchen', password: 'tandoor-hot-2026' });
  assert.equal((await s.get('/api/admin/overview')).status, 200);
  assert.equal((await s.put('/api/admin/offers', { gst: 0 })).status, 403);
  assert.equal((await s.post('/api/admin/items/p1/availability', { available: true })).status, 200);
  // lockout after 5 bad passwords
  const x = client(srv.base); for (let i = 0; i < 5; i++) await x.post('/api/admin/login', { username: 'kitchen', password: 'nope-nope-nope' });
  assert.equal((await x.post('/api/admin/login', { username: 'kitchen', password: 'tandoor-hot-2026' })).status, 429);
  srv.app.ctx.limiter.reset();   // clear the per-minute request limiter; the per-account lockout stays
  assert.equal((await client(srv.base).post('/api/admin/login', OWNER)).status, 200, 'other staff on the same Wi-Fi are not locked out');
});

test('full guest flow: join, shared plate, server-side bill, order, kitchen states, close', async () => {
  const a = await admin(); const code = await openTable(a, 2);
  const g1 = client(srv.base);
  assert.equal((await g1.post('/api/tables/2/join', { code: code === '1111' ? '2222' : '1111' })).status, 403, 'wrong code refused');
  assert.equal((await g1.post('/api/tables/2/join', { code }, { 'x-hm': '' })).status, 403, 'missing anti-CSRF header refused');
  assert.equal((await g1.post('/api/tables/2/join', { code })).status, 200);
  const g2 = await joinAs(2, code);
  const s1 = (await g1.get('/api/session')).data, s2 = (await g2.get('/api/session')).data;
  assert.equal(s1.guests.length, 2); assert.notEqual(s1.me.nick, s2.me.nick, 'funny names are unique at a table');
  assert.match(g1.jar.get('hm_guest'), /\./);
  // both add to the same plate
  await g1.post('/api/session/plate', { item: 'b1', delta: 2 });
  const r = await g2.post('/api/session/plate', { item: 'd1', delta: 1 });
  assert.equal(r.data.plate.length, 2); assert.equal(r.data.bill.subtotal, 329 * 2 + 149); assert.equal(r.data.bill.combo, 40);
  // g2 edits g1's line (shared plate)
  const r2 = await g2.put(`/api/session/plate/b1/${s1.me.id}`, { qty: 1 }); assert.equal(r2.data.plate.find(l => l.item === 'b1').qty, 1);
  // client can't inject prices: unknown fields ignored, totals come from the server
  const ord = await g1.post('/api/session/orders', { note: 'less spicy', total: 1, price: 0 }, { 'idempotency-key': 'k1' });
  assert.equal(ord.status, 201); const o = ord.data.order;
  assert.equal(o.bill.subtotal, 329 + 149); assert.equal(o.bill.discount, 40); assert.equal(o.bill.total, Math.round((329 + 149 - 40) * 1.05));
  assert.equal(ord.data.session.plate.length, 0, 'plate cleared after ordering');
  const again = await g1.post('/api/session/orders', { note: 'x' }, { 'idempotency-key': 'k1' }); assert.equal(again.data.order.id, o.id, 'retry with same key returns same order');
  // kitchen state machine
  assert.equal((await a.patch(`/api/admin/orders/${o.id}`, { status: 'served' })).status, 409);
  assert.equal((await a.patch(`/api/admin/orders/${o.id}`, { status: 'cooking' })).status, 200);
  assert.equal((await a.patch(`/api/admin/orders/${o.id}`, { status: 'ready' })).status, 200);
  const ov = (await a.get('/api/admin/overview')).data; const t2 = ov.tables.find(t => t.no === 2);
  assert.equal(t2.guests.length, 2); assert.equal(t2.bill, o.bill.total);
  assert.equal((await a.patch(`/api/admin/orders/${o.id}`, { status: 'served' })).status, 200);
  assert.equal((await g1.get('/api/session')).data.orders.find(x => x.id === o.id).status, 'served', 'customer snapshot exposes served state for the itemized bill');
  // call staff
  await g2.post('/api/session/call', { type: 'bill' }); assert.equal((await a.get('/api/admin/overview')).data.tables.find(t => t.no === 2).call.type, 'bill');
  // empty plate can't be ordered
  assert.equal((await g1.post('/api/session/orders', {})).status, 400);
  // close: every guest cookie dies instantly, order settled
  assert.equal((await a.post('/api/admin/tables/2/close')).status, 200);
  assert.equal((await g1.get('/api/session')).status, 410);
  assert.equal((await g2.post('/api/session/plate', { item: 'p1', delta: 1 })).status, 410);
  assert.equal((await a.get('/api/admin/overview')).data.orders.find(x => x.id === o.id).status, 'settled');
  // old code no longer works after reopening
  const code2 = await openTable(a, 2); const stale = client(srv.base);
  if (code2 !== code) assert.equal((await stale.post('/api/tables/2/join', { code })).status, 403);
  assert.equal((await g1.get('/api/session')).status, 410, 'old cookie does not carry into the new seating');
  const csv = await a.get('/api/admin/orders.csv'); assert.equal(csv.status, 200); assert.match(csv.data, /less spicy/);
});

test('table-scoped Would You Rather game shares votes and advances rounds', async () => {
  const a = await admin(); const code = await openTable(a, 8); const g1 = await joinAs(8, code); const g2 = await joinAs(8, code);
  const before = (await g1.get('/api/session/game')).data;
  assert.equal(before.question.length, 2); assert.deepEqual(before.counts, [0, 0]); assert.equal(before.mine, null);
  const vote = await g1.post('/api/session/game/vote', { choice: 1 }); assert.equal(vote.status, 200); assert.equal(vote.data.counts[1], 1); assert.equal(vote.data.mine, 1);
  const seenByOther = (await g2.get('/api/session/game')).data; assert.equal(seenByOther.counts[1], 1); assert.equal(seenByOther.mine, null);
  const next = await g2.post('/api/session/game/next', {}); assert.equal(next.status, 200); assert.equal(next.data.index, before.index + 1); assert.deepEqual(next.data.counts, [0, 0]);
});

test('prank protection: closed tables, rotated codes, brute force', async () => {
  const a = await admin(); const g = client(srv.base);
  assert.equal((await g.post('/api/tables/5/join', { code: '1234' })).status, 409, 'closed table refuses joins');
  const code = await openTable(a, 5); const rot = (await a.post('/api/admin/tables/5/code')).data.code;
  if (rot !== code) assert.equal((await g.post('/api/tables/5/join', { code })).status, 403, 'rotated code invalidates the old one');
  let limited = false; for (let i = 0; i < 25 && !limited; i++) { const r = await g.post('/api/tables/5/join', { code: String(1000 + i) }); if (r.status === 429) limited = true; }
  assert.ok(limited, 'join attempts are rate limited'); srv.app.ctx.limiter.reset();
  assert.equal((await g.post('/api/tables/99/join', { code: '1234' })).status, 404);
  const forged = client(srv.base); forged.jar.set('hm_guest', 'eyJ0IjoxfQ.bad'); assert.equal((await forged.get('/api/session')).status, 401);
});

test('menu editing by owner reaches guests; sold-out items cannot be ordered', async () => {
  const a = await admin();
  assert.equal((await a.put('/api/admin/categories/biryani', { name: 'Biryani', color: '#B79CFF' })).status, 200);
  assert.equal((await a.put('/api/admin/categories/bad', { name: 'X', color: 'red' })).status, 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const up = await a.raw('POST', '/api/admin/images', new Uint8Array(png), { 'content-type': 'image/png' }); assert.equal(up.status, 201);
  const html = await a.raw('POST', '/api/admin/images', new Uint8Array(Buffer.from('<svg onload=alert(1)>')), { 'content-type': 'image/png' }); assert.equal(html.status, 400, 'non-image bytes refused');
  const item = { cat: 'biryani', name: 'Hyderabadi Dum Biryani', price: 399, veg: false, desc: 'Slow cooked', ings: [{ e: '🍚', l: 'Rice' }], image: up.data.url, anim: 'spin', available: true };
  assert.equal((await a.put('/api/admin/items/biryani-1', item)).status, 200);
  assert.equal((await a.put('/api/admin/items/biryani-2', { ...item, price: -5 })).status, 400);
  assert.equal((await a.put('/api/admin/items/biryani-3', { ...item, image: 'javascript:alert(1)' })).status, 400);
  const menu = (await client(srv.base).get('/api/menu')).data; assert.ok(menu.items.find(i => i.id === 'biryani-1'));
  assert.equal((await a.put('/api/admin/categories/biryani', { name: 'Biryani', color: '#B79CFF', hidden: true })).status, 200);
  assert.ok(!(await client(srv.base).get('/api/menu')).data.items.find(i => i.id === 'biryani-1'), 'hidden category is not public');
  assert.equal((await a.del('/api/admin/categories/biryani')).status, 409, 'non-empty category cannot be deleted');
  // sold out
  const code = await openTable(a, 6); const g = await joinAs(6, code);
  await g.post('/api/session/plate', { item: 'p2', delta: 1 });
  await a.post('/api/admin/items/p2/availability', { available: false });
  assert.equal((await g.post('/api/session/plate', { item: 'p2', delta: 1 })).status, 409);
  const o = await g.post('/api/session/orders', {}); assert.equal(o.status, 409); assert.match(o.data.message, /Sold out/);
  await a.post('/api/admin/items/p2/availability', { available: true });
  // offers change the server-side bill
  await a.put('/api/admin/offers', { gst: 18, free: { on: false }, combo: { on: false }, big: { on: false } });
  const snap = (await g.get('/api/session')).data; assert.equal(snap.bill.gst, Math.round(449 * 0.18));
  await a.put('/api/admin/offers', { gst: 5, free: { on: true, at: 1000, item: 'd3' }, combo: { on: true, a: 'burgers', b: 'sips', off: 40 }, big: { on: true, at: 2000, pct: 10 } });
  const audit = (await a.get('/api/admin/audit')).data.entries; assert.ok(audit.some(e => e.action === 'offers.update'));
});

test('live updates over Server-Sent Events', async () => {
  const a = await admin(); const code = await openTable(a, 7); const g = await joinAs(7, code);
  const ctrl = new AbortController(); const events = [];
  const res = await fetch(srv.base + '/api/admin/stream', { headers: { cookie: [...a.jar].map(([k, v]) => `${k}=${v}`).join('; ') }, signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader(); const dec = new TextDecoder();
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(dec.decode(value)); } } catch { } })();
  await new Promise(r => setTimeout(r, 50));
  await g.post('/api/session/plate', { item: 'd1', delta: 1 }); await g.post('/api/session/orders', {});
  await new Promise(r => setTimeout(r, 100)); ctrl.abort(); await pump;
  const all = events.join(''); assert.match(all, /event: hello/); assert.match(all, /event: floor\ndata: \{"topic":"orders","table":7,"created":true\}/);
});
