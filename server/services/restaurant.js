// Core business rules. Everything a phone sends is re-checked here: prices, totals,
// which table session is live, and which order transitions are allowed.
import { rid, code4, sha256, safeEqual } from '../lib/ids.js';
import { bad, notFound, conflict, forbidden, gone, tooMany } from '../lib/errors.js';
import { priceBill, normOffers, DEFAULT_OFFERS } from '../../web/js/shared/pricing.js';
import { funnyName } from '../../web/js/shared/names.js';

const ANIMS = ['spin', 'float', 'none'];
export const ORDER_FLOW = { pending: ['cooking', 'rejected'], cooking: ['ready'], ready: ['served'], served: [], rejected: [], settled: [] };
const ACTIVE = ['pending', 'cooking', 'ready'];
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function createRestaurant({ db, bus, cfg }) {
  const pub = evt => bus.publish(evt).catch(() => {});
  // Lightweight table-scoped game state; deliberately ephemeral on the free SQLite demo.
  const games = new Map();
  const gameQuestions = [
    ['Eat only pizza for a year 🍕', 'Eat only burgers for a year 🍔'],
    ['Always get free dessert 🍰', 'Always get free starters 🥟'],
    ['Give up fries forever 🍟', 'Give up ice cream forever 🍦'],
    ['Only spicy food 🌶️', 'Only sweet food 🍫'],
    ['Have a personal chef 👨‍🍳', 'Have a personal food critic ⭐'],
    ['Unlimited biryani 🍛', 'Unlimited momos 🥟'],
    ['Never wait for food ⚡', 'Every meal is free 💸'],
    ['Breakfast for every meal 🥞', 'Dinner for every meal 🍜'],
    ['Only eat with chopsticks 🥢', 'Only eat with a spoon 🥄'],
    ['Share every snack 🤝', 'Never share your dessert 😈'],
  ];
  function gameSnapshot(sessionId, guestId) {
    let g = games.get(sessionId); if (!g) { g = { index: 0, votes: {} }; games.set(sessionId, g); }
    const q = gameQuestions[g.index % gameQuestions.length], votes = Object.values(g.votes);
    return { index: g.index, total: gameQuestions.length, question: q, counts: [votes.filter(v => v === 0).length, votes.filter(v => v === 1).length], mine: g.votes[guestId] ?? null };
  }
  function gameVote(ctx, choice) { const g = games.get(ctx.session.id) || { index: 0, votes: {} }; games.set(ctx.session.id, g); g.votes[ctx.guest.id] = choice; pub({ topic: 'game', session: ctx.session.id, table: ctx.table }); return gameSnapshot(ctx.session.id, ctx.guest.id); }
  function gameNext(ctx) { const g = games.get(ctx.session.id) || { index: 0, votes: {} }; g.index = (g.index + 1) % gameQuestions.length; g.votes = {}; games.set(ctx.session.id, g); pub({ topic: 'game', session: ctx.session.id, table: ctx.table }); return gameSnapshot(ctx.session.id, ctx.guest.id); }
  const audit = (actor, action, detail) => db.run('INSERT INTO audit_log (id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)', [rid(16), Date.now(), actor || 'system', action, typeof detail === 'string' ? detail : JSON.stringify(detail || {})]).catch(() => {});

  // ---------- menu ----------
  const imageUrl = ref => ref.startsWith('img:') ? `/img/${ref.slice(4)}` : ref;
  const toCat = r => ({ id: r.id, name: r.name, color: r.color, sort: r.sort, hidden: !!r.hidden });
  const toItem = r => ({ id: r.id, cat: r.category_id, name: r.name, price: r.price, veg: !!r.veg, desc: r.description, ings: safeJson(r.ingredients, []), image: imageUrl(r.image), anim: r.anim, available: !!r.available, sort: r.sort });
  let menuCache = null;
  async function menu({ includeHidden = false } = {}) {
    if (!menuCache) {
      const cats = (await db.all('SELECT * FROM categories ORDER BY sort, name')).map(toCat);
      const items = (await db.all('SELECT * FROM items ORDER BY sort, name')).map(toItem);
      const offers = normOffers(safeJson((await db.get("SELECT value FROM settings WHERE key = 'offers'"))?.value, DEFAULT_OFFERS));
      const version = sha256(JSON.stringify([cats, items, offers])).slice(0, 16);
      menuCache = { cats, items, offers, version };
    }
    if (includeHidden) return menuCache;
    const visible = new Set(menuCache.cats.filter(c => !c.hidden).map(c => c.id));
    return { cats: menuCache.cats.filter(c => visible.has(c.id)), items: menuCache.items.filter(i => visible.has(i.cat)), offers: menuCache.offers, version: menuCache.version };
  }
  const menuChanged = () => { menuCache = null; pub({ topic: 'menu' }); };
  bus.subscribe(e => { if (e.topic === 'menu') menuCache = null; });   // other instances changed it
  async function pricingIndex() { const m = await menu({ includeHidden: true }); return { byId: Object.fromEntries(m.items.map(i => [i.id, { id: i.id, name: i.name, price: i.price, cat: i.cat, available: i.available }])), offers: m.offers }; }

  async function saveCategory(actor, c) {
    const now = Date.now(); const exists = await db.get('SELECT id FROM categories WHERE id = ?', [c.id]);
    if (exists) await db.run('UPDATE categories SET name = ?, color = ?, sort = ?, hidden = ?, updated_at = ? WHERE id = ?', [c.name, c.color, c.sort, c.hidden, now, c.id]);
    else await db.run('INSERT INTO categories (id, name, color, sort, hidden, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [c.id, c.name, c.color, c.sort, c.hidden, now]);
    audit(actor, exists ? 'category.update' : 'category.create', { id: c.id, name: c.name }); menuChanged(); return c;
  }
  async function deleteCategory(actor, id) {
    const n = (await db.get('SELECT COUNT(*) AS n FROM items WHERE category_id = ?', [id]))?.n || 0;
    if (Number(n) > 0) throw conflict(`Move or delete the ${n} item(s) in this category first.`, 'category_not_empty');
    const r = await db.run('DELETE FROM categories WHERE id = ?', [id]); if (!r.changes) throw notFound('Category not found');
    audit(actor, 'category.delete', { id }); menuChanged();
  }
  async function saveItem(actor, it) {
    if (!await db.get('SELECT id FROM categories WHERE id = ?', [it.cat])) throw bad('That category does not exist.');
    const ref = imageRef(it.image); if (ref.startsWith('img:') && !await db.get('SELECT id FROM images WHERE id = ?', [ref.slice(4)])) throw bad('That photo was not found. Upload it again.');
    const now = Date.now(); const exists = await db.get('SELECT id FROM items WHERE id = ?', [it.id]);
    const vals = [it.cat, it.name, it.price, it.veg, it.desc, JSON.stringify(it.ings), ref, it.anim, it.available, it.sort, now];
    if (exists) await db.run('UPDATE items SET category_id = ?, name = ?, price = ?, veg = ?, description = ?, ingredients = ?, image = ?, anim = ?, available = ?, sort = ?, updated_at = ? WHERE id = ?', [...vals, it.id]);
    else await db.run('INSERT INTO items (category_id, name, price, veg, description, ingredients, image, anim, available, sort, updated_at, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...vals, it.id]);
    audit(actor, exists ? 'item.update' : 'item.create', { id: it.id, name: it.name, price: it.price, available: it.available }); menuChanged(); return it;
  }
  async function setAvailability(actor, id, available) { const r = await db.run('UPDATE items SET available = ?, updated_at = ? WHERE id = ?', [available, Date.now(), id]); if (!r.changes) throw notFound('Item not found'); audit(actor, 'item.availability', { id, available }); menuChanged(); }
  async function deleteItem(actor, id) { const r = await db.run('DELETE FROM items WHERE id = ?', [id]); if (!r.changes) throw notFound('Item not found'); audit(actor, 'item.delete', { id }); menuChanged(); }
  async function reorder(actor, kind, ids) {
    const table = kind === 'cats' ? 'categories' : 'items';
    await db.tx(async t => { for (let i = 0; i < ids.length; i++) await t.run(`UPDATE ${table} SET sort = ?, updated_at = ? WHERE id = ?`, [i + 1, Date.now(), ids[i]]); });
    audit(actor, `${kind}.reorder`, { count: ids.length }); menuChanged();
  }
  async function saveOffers(actor, o) {
    const val = normOffers(o); if (val.combo.on && val.combo.a === val.combo.b) throw bad('Pick two different categories for the combo.');
    await db.run("INSERT INTO settings (key, value, updated_at) VALUES ('offers', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [JSON.stringify(val), Date.now()]);
    audit(actor, 'offers.update', val); menuChanged(); return val;
  }
  function imageRef(url) {
    if (!url) throw bad('Add a photo or pick one from the gallery.');
    let m = /^\/img\/([a-f0-9]{32,64})$/.exec(url); if (m) return 'img:' + m[1];
    m = /^img:([a-f0-9]{32,64})$/.exec(url); if (m) return url;
    if (/^d:[a-z0-9]{1,8}$/.test(url)) return url;
    throw bad('Unsupported image reference.');
  }
  function sniff(buf) {
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    return null;
  }
  async function saveImage(actor, buf) {
    const mime = sniff(buf); if (!mime) throw bad('Upload a WebP, PNG or JPEG image.', 'bad_image');
    const id = sha256(buf).slice(0, 40);
    await db.run('INSERT INTO images (id, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [id, mime, buf, buf.length, Date.now()]);
    audit(actor, 'image.upload', { id, size: buf.length }); return { id, url: `/img/${id}` };
  }
  const getImage = id => db.get('SELECT mime, bytes FROM images WHERE id = ?', [id]);

  // ---------- tables & seatings ----------
  async function ensureTables() {
    for (let n = 1; n <= cfg.tableCount; n++) await db.run('INSERT INTO dining_tables (no, current_session) VALUES (?, NULL) ON CONFLICT (no) DO NOTHING', [n]);
  }
  async function liveSession(tableNo) {
    const t = await db.get('SELECT current_session FROM dining_tables WHERE no = ?', [tableNo]); if (!t) throw notFound('No such table');
    if (!t.current_session) return null;
    return db.get("SELECT * FROM table_sessions WHERE id = ? AND status = 'open'", [t.current_session]);
  }
  async function tableStatus(tableNo) { const s = await liveSession(tableNo); return { table: tableNo, open: !!s }; }
  async function openTable(actor, tableNo) {
    const s = await liveSession(tableNo); if (s) throw conflict(`Table ${tableNo} is already open.`, 'already_open');
    const id = rid(16), code = code4(), now = Date.now();
    await db.tx(async t => {
      await t.run("INSERT INTO table_sessions (id, table_no, code, status, opened_at, opened_by) VALUES (?, ?, ?, 'open', ?, ?)", [id, tableNo, code, now, actor]);
      await t.run('UPDATE dining_tables SET current_session = ? WHERE no = ?', [id, tableNo]);
    });
    audit(actor, 'table.open', { tableNo }); pub({ topic: 'table', table: tableNo }); return { session: id, code };
  }
  async function rotateCode(actor, tableNo) {
    const s = await liveSession(tableNo); if (!s) throw conflict(`Table ${tableNo} is not open.`, 'not_open');
    const code = code4(); await db.run('UPDATE table_sessions SET code = ? WHERE id = ?', [code, s.id]);
    audit(actor, 'table.rotate_code', { tableNo }); pub({ topic: 'table', table: tableNo }); return { code };
  }
  async function closeTable(actor, tableNo) {
    const s = await liveSession(tableNo); if (!s) throw conflict(`Table ${tableNo} is not open.`, 'not_open');
    const now = Date.now();
    await db.tx(async t => {
      await t.run("UPDATE table_sessions SET status = 'closed', closed_at = ? WHERE id = ?", [now, s.id]);
      await t.run('UPDATE dining_tables SET current_session = NULL WHERE no = ?', [tableNo]);
      await t.run("UPDATE orders SET status = 'rejected', updated_at = ? WHERE session_id = ? AND status = 'pending'", [now, s.id]);
      await t.run("UPDATE orders SET status = 'settled', updated_at = ? WHERE session_id = ? AND status IN ('cooking', 'ready', 'served')", [now, s.id]);
      await t.run('DELETE FROM plate_lines WHERE session_id = ?', [s.id]);
      await t.run('DELETE FROM guests WHERE session_id = ?', [s.id]);
      await t.run('DELETE FROM calls WHERE table_no = ?', [tableNo]);
    });
    audit(actor, 'table.close', { tableNo }); pub({ topic: 'closed', session: s.id, table: tableNo }); pub({ topic: 'table', table: tableNo }); pub({ topic: 'orders', table: tableNo, session: s.id });
  }

  // ---------- guests ----------
  async function join(tableNo, code) {
    const s = await liveSession(tableNo);
    if (!s) throw conflict(`Table ${tableNo} isn't open yet. Your server opens it when you sit down.`, 'table_closed');
    if (!safeEqual(String(code), s.code)) throw forbidden("That code doesn't match. Check the card on your table.", 'wrong_code');
    const guest = await addGuest(s.id);
    pub({ topic: 'guests', session: s.id, table: tableNo });
    return { session: s, guest };
  }
  async function addGuest(sessionId) {
    for (let i = 0; i < 5; i++) {
      const taken = (await db.all('SELECT nick FROM guests WHERE session_id = ?', [sessionId])).map(r => r.nick);
      const n = funnyName(taken); const g = { id: rid(12), nick: n.nick, emoji: n.emoji };
      try { await db.run('INSERT INTO guests (id, session_id, nick, emoji, joined_at) VALUES (?, ?, ?, ?, ?)', [g.id, sessionId, g.nick, g.emoji, Date.now()]); return g; } catch { /* name collision: retry */ }
    }
    throw conflict('Could not pick a name. Try again.');
  }
  // Validates a guest token against the database on every request: closing the table
  // ends every link and cookie for that seating immediately.
  async function resolveGuest(p) {
    if (!p) return null;
    const s = await liveSession(p.t).catch(() => null);
    if (!s || s.id !== p.s) throw gone('This table session has ended. Scan the table again on your next visit.', 'session_closed');
    const g = await db.get('SELECT id, nick, emoji FROM guests WHERE id = ? AND session_id = ?', [p.g, s.id]);
    if (!g) throw gone('This table session has ended.', 'session_closed');
    return { table: p.t, session: s, guest: g };
  }
  async function rerollName(ctx) {
    const taken = (await db.all('SELECT nick FROM guests WHERE session_id = ?', [ctx.session.id])).map(r => r.nick);
    const n = funnyName(taken); await db.run('UPDATE guests SET nick = ?, emoji = ? WHERE id = ?', [n.nick, n.emoji, ctx.guest.id]);
    pub({ topic: 'guests', session: ctx.session.id, table: ctx.table }); return n;
  }

  // ---------- plate ----------
  async function addToPlate(ctx, itemId, delta) {
    const { byId } = await pricingIndex(); const item = byId[itemId]; if (!item) throw notFound('That dish is no longer on the menu.');
    if (delta > 0 && !item.available) throw conflict(`${item.name} is sold out right now.`, 'sold_out');
    await db.tx(async t => {
      const row = await t.get('SELECT qty FROM plate_lines WHERE session_id = ? AND item_id = ? AND guest_id = ?', [ctx.session.id, itemId, ctx.guest.id]);
      const qty = Math.max(0, Math.min(50, (row?.qty || 0) + delta));
      if (!row && delta > 0) {
        const lines = await t.get('SELECT COUNT(*) AS n FROM plate_lines WHERE session_id = ?', [ctx.session.id]); if (Number(lines.n) >= 60) throw conflict('This plate is full. Place an order first.');
        await t.run('INSERT INTO plate_lines (session_id, item_id, guest_id, qty, added_at) VALUES (?, ?, ?, ?, ?)', [ctx.session.id, itemId, ctx.guest.id, qty, Date.now()]);
      } else if (row && qty === 0) await t.run('DELETE FROM plate_lines WHERE session_id = ? AND item_id = ? AND guest_id = ?', [ctx.session.id, itemId, ctx.guest.id]);
      else if (row) await t.run('UPDATE plate_lines SET qty = ? WHERE session_id = ? AND item_id = ? AND guest_id = ?', [qty, ctx.session.id, itemId, ctx.guest.id]);
    });
    pub({ topic: 'plate', session: ctx.session.id });
  }
  async function setLine(ctx, itemId, guestId, qty) {
    const r = qty <= 0
      ? await db.run('DELETE FROM plate_lines WHERE session_id = ? AND item_id = ? AND guest_id = ?', [ctx.session.id, itemId, guestId])
      : await db.run('UPDATE plate_lines SET qty = ? WHERE session_id = ? AND item_id = ? AND guest_id = ?', [Math.min(50, qty), ctx.session.id, itemId, guestId]);
    if (!r.changes) throw notFound('That line is no longer on the plate.');
    pub({ topic: 'plate', session: ctx.session.id });
  }
  async function snapshot(ctx) {
    const [guests, plate, orders, idx] = await Promise.all([
      db.all('SELECT id, nick, emoji, joined_at FROM guests WHERE session_id = ? ORDER BY joined_at', [ctx.session.id]),
      db.all('SELECT item_id, guest_id, qty, added_at FROM plate_lines WHERE session_id = ? ORDER BY added_at', [ctx.session.id]),
      db.all('SELECT * FROM orders WHERE session_id = ? ORDER BY created_at DESC', [ctx.session.id]),
      pricingIndex(),
    ]);
    const agg = {}; for (const l of plate) if (idx.byId[l.item_id]) agg[l.item_id] = (agg[l.item_id] || 0) + l.qty;
    return {
      table: ctx.table, me: ctx.guest, guests,
      plate: plate.filter(l => idx.byId[l.item_id]).map(l => ({ item: l.item_id, guest: l.guest_id, qty: l.qty })),
      bill: priceBill(Object.entries(agg).map(([item, qty]) => ({ item, qty })), idx.byId, idx.offers),
      orders: orders.map(toOrder),
    };
  }

  // ---------- orders ----------
  const toOrder = r => ({ id: r.id, table: r.table_no, session: r.session_id, status: r.status, items: safeJson(r.items, []), bill: { subtotal: r.subtotal, discount: r.discount, gst: r.gst, total: r.total }, note: r.note, by: r.placed_by, byEmoji: r.placed_emoji, createdAt: r.created_at, updatedAt: r.updated_at });
  async function placeOrder(ctx, note, idemKey) {
    if (idemKey) { const prev = await db.get('SELECT * FROM orders WHERE idempotency_key = ?', [idemKey]); if (prev) { if (prev.session_id !== ctx.session.id) throw conflict('Duplicate request key.'); return toOrder(prev); } }
    const last = await db.get('SELECT created_at FROM orders WHERE session_id = ? ORDER BY created_at DESC LIMIT 1', [ctx.session.id]);
    if (last && Date.now() - last.created_at < cfg.orderCooldownSec * 1000) throw tooMany(Math.ceil((cfg.orderCooldownSec * 1000 - (Date.now() - last.created_at)) / 1000), 'Hang on a few seconds before sending another order.');
    const idx = await pricingIndex();
    const order = await db.tx(async t => {
      const live = await t.get('SELECT current_session FROM dining_tables WHERE no = ?', [ctx.table]);
      if (live?.current_session !== ctx.session.id) throw gone('This table session has ended.', 'session_closed');
      const lines = await t.all('SELECT item_id, qty FROM plate_lines WHERE session_id = ?', [ctx.session.id]);
      const agg = {}; for (const l of lines) agg[l.item_id] = (agg[l.item_id] || 0) + l.qty;
      const entries = Object.entries(agg).filter(([id]) => idx.byId[id]);
      if (!entries.length) throw bad('Your plate is empty.', 'empty_plate');
      const soldOut = entries.filter(([id]) => !idx.byId[id].available).map(([id]) => idx.byId[id].name);
      if (soldOut.length) throw conflict(`Sold out right now: ${soldOut.join(', ')}. Remove it from the plate and try again.`, 'sold_out');
      const b = priceBill(entries.map(([item, qty]) => ({ item, qty })), idx.byId, idx.offers);
      const items = b.lines.map(l => ({ item: l.item, name: idx.byId[l.item].name, qty: l.qty, price: idx.byId[l.item].price }))
        .concat(b.freebies.map(f => ({ item: f.item, name: idx.byId[f.item].name, qty: f.qty, price: 0, free: true })));
      const now = Date.now(); const o = { id: rid(14), now };
      await t.run('INSERT INTO orders (id, session_id, table_no, status, items, subtotal, discount, gst, total, note, placed_by, placed_emoji, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [o.id, ctx.session.id, ctx.table, 'pending', JSON.stringify(items), b.subtotal, b.combo + b.big, b.gst, b.total, note || '', ctx.guest.nick, ctx.guest.emoji, idemKey || null, now, now]);
      await t.run('DELETE FROM plate_lines WHERE session_id = ?', [ctx.session.id]);
      return t.get('SELECT * FROM orders WHERE id = ?', [o.id]);
    });
    pub({ topic: 'orders', session: ctx.session.id, table: ctx.table, created: true }); pub({ topic: 'plate', session: ctx.session.id });
    return toOrder(order);
  }
  async function setOrderStatus(actor, id, status) {
    const o = await db.get('SELECT * FROM orders WHERE id = ?', [id]); if (!o) throw notFound('Order not found');
    if (!(ORDER_FLOW[o.status] || []).includes(status)) throw conflict(`An order that is ${o.status} can't become ${status}.`, 'bad_transition');
    const r = await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?', [status, Date.now(), id, o.status]);
    if (!r.changes) throw conflict('Someone else just updated this order. Refresh and try again.', 'stale');
    audit(actor, 'order.status', { id, from: o.status, to: status });
    pub({ topic: 'orders', session: o.session_id, table: o.table_no }); return { ...toOrder(o), status };
  }
  async function callStaff(ctx, type) {
    await db.run('INSERT INTO calls (table_no, session_id, type, by_nick, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (table_no) DO UPDATE SET session_id = excluded.session_id, type = excluded.type, by_nick = excluded.by_nick, at = excluded.at', [ctx.table, ctx.session.id, type, ctx.guest.nick, Date.now()]);
    pub({ topic: 'calls', table: ctx.table });
  }
  async function clearCall(actor, tableNo) { await db.run('DELETE FROM calls WHERE table_no = ?', [tableNo]); pub({ topic: 'calls', table: tableNo }); }

  // ---------- admin overview ----------
  async function overview() {
    const since = startOfDay();
    const [tables, sessions, guests, orders, calls] = await Promise.all([
      db.all('SELECT no, current_session FROM dining_tables ORDER BY no'),
      db.all("SELECT id, table_no, code, opened_at FROM table_sessions WHERE status = 'open'"),
      db.all("SELECT g.session_id, g.id, g.nick, g.emoji FROM guests g JOIN table_sessions s ON s.id = g.session_id WHERE s.status = 'open' ORDER BY g.joined_at"),
      db.all("SELECT * FROM orders WHERE created_at >= ? OR status IN ('pending', 'cooking', 'ready') ORDER BY created_at", [since]),
      db.all('SELECT * FROM calls'),
    ]);
    const sById = Object.fromEntries(sessions.map(s => [s.id, s]));
    const os = orders.map(toOrder);
    return {
      tables: tables.map(t => { const s = t.current_session && sById[t.current_session]; const c = calls.find(x => x.table_no === t.no && s && x.session_id === s.id);
        return { no: t.no, open: !!s, session: s ? { id: s.id, code: s.code, openedAt: s.opened_at } : null, guests: s ? guests.filter(g => g.session_id === s.id).map(g => ({ id: g.id, nick: g.nick, emoji: g.emoji })) : [],
          bill: s ? os.filter(o => o.session === s.id && o.status !== 'rejected').reduce((a, o) => a + o.bill.total, 0) : 0, call: c ? { type: c.type, by: c.by_nick, at: c.at } : null }; }),
      orders: os,
      stats: { seated: sessions.length, tables: tables.length, pending: os.filter(o => o.status === 'pending').length, inKitchen: os.filter(o => ['cooking', 'ready'].includes(o.status)).length,
        salesToday: os.filter(o => o.createdAt >= since && !['rejected', 'pending'].includes(o.status)).reduce((a, o) => a + o.bill.total, 0) },
    };
  }
  async function exportCsv(fromMs, toMs) {
    const rows = await db.all("SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at", [fromMs, toMs]);
    const esc = x => { const s = String(x ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s; };
    const out = [['order_id', 'created_at', 'table', 'status', 'placed_by', 'items', 'subtotal', 'discount', 'gst', 'total', 'note'].join(',')];
    for (const r of rows) out.push([r.id, new Date(r.created_at).toISOString(), r.table_no, r.status, r.placed_by, safeJson(r.items, []).map(i => `${i.qty}x ${i.name}${i.free ? ' (free)' : ''}`).join('; '), r.subtotal, r.discount, r.gst, r.total, r.note].map(esc).join(','));
    return out.join('\n') + '\n';
  }

  // ---------- seeding ----------
  async function isMenuEmpty() { return !(await db.get('SELECT id FROM categories LIMIT 1')); }
  async function seed(menuJson, readImage) {
    const imgIds = {};
    for (const it of menuJson.items) if (it.image.startsWith('file:')) { const f = it.image.slice(5); if (!imgIds[f]) imgIds[f] = (await saveImage('seed', await readImage(f))).url; }
    for (const [i, c] of menuJson.categories.entries()) await saveCategory('seed', { id: c.id, name: c.name, color: c.color, sort: i + 1, hidden: false });
    for (const [i, it] of menuJson.items.entries()) await saveItem('seed', { id: it.id, cat: it.cat, name: it.name, price: it.price, veg: it.veg, desc: it.desc, ings: it.ings, image: it.image.startsWith('file:') ? imgIds[it.image.slice(5)] : it.image, anim: it.anim || 'spin', available: true, sort: i + 1 });
    if (menuJson.offers) await saveOffers('seed', menuJson.offers);
  }

  return { menu, pricingIndex, gameSnapshot, gameVote, gameNext, saveCategory, deleteCategory, saveItem, setAvailability, deleteItem, reorder, saveOffers, saveImage, getImage, ensureTables, tableStatus, openTable, rotateCode, closeTable, join, resolveGuest, rerollName, addToPlate, setLine, snapshot, placeOrder, setOrderStatus, callStaff, clearCall, overview, exportCsv, isMenuEmpty, seed, audit, ANIMS };
}
function safeJson(s, d) { try { return s == null ? d : JSON.parse(s); } catch { return d; } }
