// Admin app (/admin): sign-in, orders & tables, menu editor, offers, staff, audit.
import { $, h, inr, ago, clock, toast, api, live, debounce, setCsrf, ApiError } from './lib.js';
import { visualEl, ingIcon } from './visual.js';
import { DRAWN, ING_LIB, CAT_COLORS } from './art.js';
import { priceBill, normOffers } from './shared/pricing.js';
import { nickColor } from './shared/names.js';

const app = $('#app');
const K = { me: null, cfg: null, tab: 'orders', filter: 'all', ov: null, menu: null, sound: false, modals: 0 };
const errMsg = e => e instanceof ApiError ? e.message : 'Something went wrong.';
const isOwner = () => K.me?.role === 'owner';
const avatar = (g, cls = '') => h('span', { class: 'av ' + cls, style: `background:${nickColor(g.nick)}`, title: g.nick, text: g.emoji || '?' });
const tableUrl = n => `${K.cfg.publicUrl || location.origin}/t/${n}`;
async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r ?? true; } catch (e) { if (e.status === 401) return showLogin(); toast(errMsg(e), 'bad'); return false; } }

// ---------- auth ----------
async function boot() {
  try { const r = await api('GET', '/api/admin/me'); setCsrf(r.csrf); K.me = r.user; K.cfg = r.config; start(); }
  catch (e) { if (e.status === 401) showLogin(); else app.replaceChildren(h('div', { class: 'k-denied' }, h('h2', { class: 'display', text: "Can't reach the server" }), h('p', { text: errMsg(e) }), h('button', { class: 'btn-big', onclick: () => location.reload(), text: 'Try again' }))); }
}
function showLogin() {
  K.stream?.close(); setCsrf('');
  const u = h('input', { class: 'f-in', autocomplete: 'username', 'aria-label': 'Username' }), p = h('input', { class: 'f-in', type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' }), err = h('p', { class: 'f-err', 'aria-live': 'polite' });
  const submit = async e => { e.preventDefault(); err.textContent = ''; try { const r = await api('POST', '/api/admin/login', { username: u.value, password: p.value }); setCsrf(r.csrf); K.me = r.user; const me = await api('GET', '/api/admin/me'); K.cfg = me.config; start(); } catch (x) { err.textContent = errMsg(x); p.value = ''; p.focus(); } };
  app.replaceChildren(h('div', { class: 'k-login' }, h('form', { class: 'f-card sm', onsubmit: submit },
    h('div', { class: 'logo', text: 'Hungry Mango' }), h('h3', { class: 'display', text: 'Staff sign in' }),
    h('label', { class: 'f-l' }, 'Username', u), h('label', { class: 'f-l' }, 'Password', p), err,
    h('button', { class: 'k-btn primary big', type: 'submit', text: 'Sign in' }),
    h('p', { class: 'f-hint', text: 'No account yet? Run "npm run create-admin" on the server (see docs/SETUP.md).' }))));
  setTimeout(() => u.focus(), 50);
}
async function logout() { await act(() => api('POST', '/api/admin/logout', {})); location.reload(); }

// ---------- shell ----------
function start() {
  K.tab = (location.hash.slice(1) || 'orders'); if (!['orders', 'menu', 'offers', 'staff'].includes(K.tab) || (!isOwner() && ['offers', 'staff'].includes(K.tab))) K.tab = 'orders';
  const tab = (id, label) => h('button', { class: 'k-tab' + (K.tab === id ? ' on' : ''), 'aria-current': K.tab === id ? 'page' : null, onclick: () => { location.hash = id; }, text: label });
  K.body = h('div', { class: 'k-body' });
  app.replaceChildren(h('div', { class: 'k' },
    h('header', { class: 'k-head' },
      h('div', { class: 'k-brand' }, h('span', { class: 'logo', text: K.cfg.name }), h('span', { class: 'k-sub', text: 'Admin' })),
      h('nav', { class: 'k-tabs', 'aria-label': 'Sections' }, tab('orders', 'Orders & tables'), tab('menu', 'Menu'), isOwner() ? tab('offers', 'Offers') : null, isOwner() ? tab('staff', 'Staff') : null),
      h('div', { class: 'k-tools' }, K.liveEl = h('span', { class: 'live off', text: 'Connecting' }), K.soundBtn = h('button', { class: 'k-btn', onclick: toggleSound, text: K.sound ? 'Sound on' : 'Sound off' }),
        h('span', { class: 'k-user', text: `${K.me.username} (${K.me.role})` }), h('button', { class: 'k-btn', onclick: logout, text: 'Sign out' }))),
    K.body));
  if (!K.stream) {
    K.stream = live('/api/admin/stream', {
      open: () => { K.liveEl.textContent = 'Live'; K.liveEl.classList.remove('off'); refresh(); },
      floor: d => { if (d.created) chime(); refreshFloor(); },
      menu: debounce(() => loadMenu().then(render), 250),
      resync: () => refresh(), fail: () => { K.liveEl.textContent = 'Reconnecting'; K.liveEl.classList.add('off'); boot(); },
    });
    addEventListener('hashchange', () => start());
    setInterval(() => K.tab === 'orders' && render(), 30000);
  }
  refresh();
}
const refreshFloor = debounce(async () => { const ov = await act(() => api('GET', '/api/admin/overview')); if (ov) { K.ov = ov; if (K.tab === 'orders') render(); } }, 150);
async function loadMenu() { const m = await act(() => api('GET', '/api/admin/menu')); if (m) K.menu = m; }
async function refresh() { await Promise.all([refreshFloorNow(), loadMenu()]); render(); }
async function refreshFloorNow() { const ov = await act(() => api('GET', '/api/admin/overview')); if (ov) K.ov = ov; }
function render() { if (!K.body || K.modals) return; if (!K.ov || !K.menu) { K.body.replaceChildren(h('div', { class: 'loader dark' })); return; } ({ orders: renderOrders, menu: renderMenu, offers: renderOffers, staff: renderStaff })[K.tab](); }
let actx; function toggleSound() { K.sound = !K.sound; K.soundBtn.textContent = K.sound ? 'Sound on' : 'Sound off'; if (K.sound) { try { actx = actx || new AudioContext(); actx.resume(); chime(); } catch { } } }
function chime() { if (!K.sound || !actx) return; [660, 990].forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.14; o.frequency.value = f; o.type = 'triangle'; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35); o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.4); }); }
function modal(content, onClose) {
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
  m.close = () => { m.remove(); K.modals = Math.max(0, K.modals - 1); onClose?.(); render(); };
  m.addEventListener('pointerdown', e => { if (e.target === m) m.close(); }); m.addEventListener('keydown', e => { if (e.key === 'Escape') m.close(); });
  K.modals++; document.body.append(m); setTimeout(() => m.querySelector('input,select,button')?.focus(), 30); return m;
}

// ---------- orders & tables ----------
const COLS = [['pending', 'New'], ['cooking', 'Cooking'], ['ready', 'Ready'], ['served', 'Served']];
function renderOrders() {
  const { tables, orders, stats } = K.ov; const active = orders.filter(o => o.status !== 'settled');
  const stat = (n, l) => h('div', { class: 'k-stat' }, h('b', { text: n }), h('span', { text: l }));
  const countFor = n => active.filter(o => o.table === n && ['pending', 'cooking', 'ready'].includes(o.status)).length;
  const chips = [h('button', { class: 'k-chip' + (K.filter === 'all' ? ' on' : ''), onclick: () => { K.filter = 'all'; render(); }, text: 'All tables' })]
    .concat(tables.filter(t => t.open || countFor(t.no)).map(t => { const c = countFor(t.no); return h('button', { class: 'k-chip' + (K.filter === t.no ? ' on' : ''), onclick: () => { K.filter = t.no; render(); } }, `Table ${t.no}`, c ? h('i', { text: String(c) }) : null); }));
  const hist = orders.filter(o => ['settled', 'rejected', 'served'].includes(o.status) && (K.filter === 'all' || o.table === K.filter)).sort((a, b) => b.createdAt - a.createdAt);
  K.body.replaceChildren(
    h('div', { class: 'k-stats' }, stat(`${stats.seated}/${stats.tables}`, 'tables seated'), stat(String(stats.pending), 'waiting for you'), stat(String(stats.inKitchen), 'in the kitchen'), stat(inr(stats.salesToday), 'sales today')),
    h('div', { class: 'k-main' },
      h('aside', { class: 'k-tables' }, h('div', { class: 'm-h' }, h('h2', { text: 'Tables' }), h('button', { class: 'k-btn', onclick: printCards, text: 'Print QR cards' })), h('div', { class: 'k-tgrid' }, tables.map(tableCard))),
      h('section', { class: 'k-board' },
        h('div', { class: 'k-board-h' }, h('h2', { text: K.filter === 'all' ? 'Orders' : `Table ${K.filter}` }), h('div', { class: 'k-chips' }, chips)),
        h('div', { class: 'k-cols' }, COLS.map(([st, label]) => {
          const list = active.filter(o => o.status === st && (K.filter === 'all' || o.table === K.filter)).sort((a, b) => st === 'served' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt).slice(0, st === 'served' ? 12 : 200);
          return h('div', { class: 'k-col k-' + st }, h('h3', {}, label, h('span', { text: String(list.length) })), list.length ? list.map(orderCard) : h('p', { class: 'k-empty', text: st === 'pending' ? 'New orders land here. Turn sound on to hear them.' : 'Nothing here.' }));
        })),
        h('details', { class: 'k-hist' }, h('summary', {}, `Today's history (${hist.length})`, h('a', { class: 'k-btn sm', href: '/api/admin/orders.csv', download: '', text: 'Download CSV' })),
          hist.length ? h('div', { class: 'k-hist-t' }, hist.map(o => h('div', { class: 'k-hist-r' }, h('span', { text: clock(o.createdAt) }), h('span', { text: `T${o.table}` }), h('span', { text: `${o.byEmoji || ''} ${o.by}` }), h('span', { text: o.items.map(i => `${i.qty}× ${i.name}`).join(', ') }), h('span', { class: 'k-st ' + o.status, text: o.status }), h('b', { text: inr(o.bill.total) })))) : h('p', { class: 'k-empty', text: 'Finished and settled orders from today show here.' })))));
}
function tableCard(t) {
  const n = t.no;
  const doIt = (path, ok, confirmMsg) => async () => { if (confirmMsg && !confirm(confirmMsg)) return; if (await act(() => api('POST', `/api/admin/tables/${n}/${path}`, {}), ok)) refreshFloor(); };
  const active = K.ov.orders.filter(o => o.session === t.session?.id && ['pending', 'cooking', 'ready'].includes(o.status)).length;
  return h('div', { class: 'k-t' + (t.open ? ' open' : '') + (t.call ? ' calling' : '') + (K.filter === n ? ' sel' : '') },
    h('div', { class: 'k-t-top' }, h('button', { class: 'k-tn', onclick: () => { K.filter = K.filter === n ? 'all' : n; render(); }, 'aria-label': `Show table ${n} orders`, text: String(n) }), h('span', { class: 'k-ts', text: t.open ? 'Seated' : 'Free' })),
    t.open ? h('div', { class: 'k-t-mid' },
      h('div', { class: 'k-code' }, h('small', { text: 'Join code' }), h('b', { text: t.session.code })),
      h('div', { class: 'k-meta' }, h('span', { text: `Bill ${inr(t.bill)}` }), h('span', { text: `Since ${clock(t.session.openedAt)}` })),
      t.guests.length ? h('div', { class: 'k-guests' }, t.guests.map(g => h('span', { class: 'k-g' }, avatar(g, 'sm'), g.nick))) : h('p', { class: 'k-free', text: 'Nobody has joined yet.' }),
      t.call ? h('div', { class: 'k-call' }, h('span', { text: t.call.type === 'bill' ? `${t.call.by} asked for the bill` : `${t.call.by} is calling a server` }), h('button', { class: 'k-mini', onclick: async () => { if (await act(() => api('DELETE', `/api/admin/tables/${n}/call`))) refreshFloor(); }, text: 'Done' })) : null)
      : h('p', { class: 'k-free', text: 'Open it when guests sit down. They need the code to order.' }),
    h('div', { class: 'k-t-act' }, t.open
      ? [h('button', { class: 'k-btn', onclick: () => showCard(n, t.session.code), text: 'Table card' }), h('button', { class: 'k-btn', onclick: doIt('code', 'New code issued'), text: 'New code' }), h('button', { class: 'k-btn danger', onclick: doIt('close', `Table ${n} settled and reset. Old links no longer work.`, active ? `Table ${n} still has ${active} order(s) in progress. Settle and close anyway?` : null), text: 'Settle & close' })]
      : [h('button', { class: 'k-btn primary', onclick: doIt('open', `Table ${n} is open`), text: 'Open table' }), h('button', { class: 'k-btn', onclick: () => showCard(n), text: 'QR' })]));
}
function orderCard(o) {
  const set = status => async () => { if (await act(() => api('PATCH', `/api/admin/orders/${o.id}`, { status }))) refreshFloor(); };
  const acts = { pending: [h('button', { class: 'k-btn', onclick: set('rejected'), text: 'Reject' }), h('button', { class: 'k-btn primary', onclick: set('cooking'), text: 'Accept' })], cooking: [h('button', { class: 'k-btn primary', onclick: set('ready'), text: 'Mark ready' })], ready: [h('button', { class: 'k-btn primary', onclick: set('served'), text: 'Mark served' })] }[o.status] || [];
  return h('article', { class: 'k-o' },
    h('div', { class: 'k-o-top' }, h('b', { class: 'k-o-t', text: `Table ${o.table}` }), h('span', { text: ago(o.createdAt) })),
    h('p', { class: 'k-o-by', text: `by ${o.byEmoji || ''} ${o.by}` }),
    h('ul', {}, o.items.map(i => h('li', {}, h('b', { text: `${i.qty}×` }), ` ${i.name}`, i.free ? h('em', { text: ' free' }) : null))),
    o.note ? h('p', { class: 'k-note', text: o.note }) : null,
    h('div', { class: 'k-o-foot' }, h('span', { text: inr(o.bill.total) }), h('div', {}, acts)));
}
function qrInto(el, url) { try { new window.QRCode(el, { text: url, width: 200, height: 200, colorDark: '#1E1646', colorLight: '#FFFFFF', correctLevel: window.QRCode.CorrectLevel.M }); } catch { el.append(h('p', { class: 'k-free', text: url })); } }
function showCard(n, code) {
  const box = h('div', { class: 'qr' });
  const m = modal(h('div', { class: 'tent' }, h('div', { class: 'logo', text: K.cfg.name }), h('div', { class: 'tent-n', text: `Table ${n}` }), box, h('p', { text: 'Scan to see the menu and order from your phone.' }),
    code ? h('div', { class: 'tent-code' }, h('small', { text: "Today's table code" }), h('b', { text: code })) : h('p', { class: 'k-free', text: 'Open the table to generate a join code.' }),
    h('p', { class: 'k-free', text: tableUrl(n) }), h('button', { class: 'k-btn', onclick: () => m.close(), text: 'Close' })));
  qrInto(box, tableUrl(n));
}
function printCards() {
  const sheet = h('div', { class: 'print-sheet' }, K.ov.tables.map(t => { const box = h('div', { class: 'qr' }); qrInto(box, tableUrl(t.no)); return h('div', { class: 'tent print' }, h('div', { class: 'logo', text: K.cfg.name }), h('div', { class: 'tent-n', text: `Table ${t.no}` }), box, h('p', { text: 'Scan to order. Ask your server for today’s table code.' })); }));
  const m = modal(h('div', { class: 'f-card' }, h('div', { class: 'f-top no-print' }, h('h3', { class: 'display', text: 'QR table cards' }), h('div', {}, h('button', { class: 'k-btn primary', onclick: () => window.print(), text: 'Print' }), ' ', h('button', { class: 'k-btn', onclick: () => m.close(), text: 'Close' }))),
    h('p', { class: 'f-hint no-print', text: 'Print once and stand them on the tables. The QR never changes; the 4-digit code changes for every new group and is shown on the Tables panel.' }), sheet));
  m.classList.add('printing');
}

// ---------- menu ----------
const strip = it => ({ cat: it.cat, name: it.name, price: it.price, veg: it.veg, desc: it.desc, ings: it.ings, image: it.image, anim: it.anim, available: it.available, sort: it.sort });
function renderMenu() {
  const cats = K.menu.cats; if (!K.selCat || !cats.find(c => c.id === K.selCat)) K.selCat = cats[0]?.id;
  const sel = cats.find(c => c.id === K.selCat); const items = K.menu.items.filter(m => m.cat === K.selCat); const owner = isOwner();
  const move = async (list, i, dir, kind) => { const ids = list.map(x => x.id); [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]; if (await act(() => api('POST', '/api/admin/reorder', { kind, ids }))) { await loadMenu(); render(); } };
  const catRow = (c, i) => h('div', { class: 'm-cat' + (c.id === K.selCat ? ' on' : '') + (c.hidden ? ' hidden' : '') },
    h('button', { class: 'm-cat-main', onclick: () => { K.selCat = c.id; render(); } }, h('span', { class: 'sw', style: `background:${c.color}` }), h('span', { class: 'm-cat-n', text: c.name }), h('span', { class: 'm-cat-c', text: `${K.menu.items.filter(m => m.cat === c.id).length}${c.hidden ? ', hidden' : ''}` })),
    owner ? h('div', { class: 'm-cat-act' }, h('button', { class: 'k-ico', 'aria-label': 'Move up', disabled: !i, onclick: () => move(cats, i, -1, 'cats'), text: '↑' }), h('button', { class: 'k-ico', 'aria-label': 'Move down', disabled: i === cats.length - 1, onclick: () => move(cats, i, 1, 'cats'), text: '↓' }), h('button', { class: 'k-ico', 'aria-label': 'Edit category', onclick: () => catEditor(c), text: '✎' })) : null);
  const itemCard = (m, i) => h('div', { class: 'm-item' + (m.available ? '' : ' off') },
    h('div', { class: 'm-vis', style: `background:${sel.color}` }, visualEl({ ...m, anim: 'none' }), m.available ? null : h('span', { class: 'm-sold', text: 'Sold out' })),
    h('div', { class: 'm-info' }, h('div', { class: 'm-name' }, h('span', { class: 'vegmark sm ' + (m.veg ? 'veg' : 'nonveg') }), h('b', { text: m.name })), h('span', { class: 'm-price', text: inr(m.price) }),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: m.available, onchange: async e => { if (await act(() => api('POST', `/api/admin/items/${m.id}/availability`, { available: e.target.checked }), e.target.checked ? `${m.name} is back on the menu` : `${m.name} marked sold out`)) { await loadMenu(); render(); } else e.target.checked = !e.target.checked; } }), h('span', { text: 'Available' }))),
    owner ? h('div', { class: 'm-act' }, h('button', { class: 'k-ico', 'aria-label': 'Move earlier', disabled: !i, onclick: () => move(items, i, -1, 'items'), text: '←' }), h('button', { class: 'k-ico', 'aria-label': 'Move later', disabled: i === items.length - 1, onclick: () => move(items, i, 1, 'items'), text: '→' }), h('button', { class: 'k-btn', onclick: () => itemEditor(m), text: 'Edit' })) : null);
  K.body.replaceChildren(...[
    !owner ? h('div', { class: 'm-banner' }, h('p', { text: 'Staff can mark dishes sold out. Only the owner can change prices and dishes.' })) : null,
    h('div', { class: 'm-wrap' },
      h('aside', { class: 'm-cats' }, h('div', { class: 'm-h' }, h('h2', { text: 'Categories' }), owner ? h('button', { class: 'k-btn primary', onclick: () => catEditor(null), text: 'Add category' }) : null), cats.map(catRow)),
      h('section', { class: 'm-items' }, sel ? [h('div', { class: 'm-h' }, h('h2', { text: sel.name }), h('div', { class: 'm-h-act' }, h('a', { class: 'k-btn', href: '/t/1', target: '_blank', rel: 'noopener', text: 'Open guest view' }), owner ? h('button', { class: 'k-btn primary', onclick: () => itemEditor(null), text: 'Add item' }) : null)),
        items.length ? h('div', { class: 'm-grid' }, items.map(itemCard)) : h('div', { class: 'm-empty' }, h('p', { text: `No dishes in ${sel.name} yet.` }), owner ? h('button', { class: 'k-btn primary', onclick: () => itemEditor(null), text: 'Add the first dish' }) : null)]
        : h('p', { class: 'k-empty', text: 'Add a category to start your menu.' })))].filter(Boolean));
}
const slug = s => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x') + '-' + Math.random().toString(36).slice(2, 6);
function catEditor(c) {
  const isNew = !c; const d = c ? { ...c } : { id: null, name: '', color: CAT_COLORS[K.menu.cats.length % CAT_COLORS.length], sort: K.menu.cats.length + 1, hidden: false };
  const name = h('input', { class: 'f-in', value: d.name, maxlength: '30', placeholder: 'e.g. Biryani', 'aria-label': 'Category name' }), err = h('p', { class: 'f-err' });
  const sw = h('div', { class: 'f-sw' }, CAT_COLORS.map(col => h('button', { class: 'swb' + (col === d.color ? ' on' : ''), style: `background:${col}`, 'aria-label': 'Colour ' + col, onclick: e => { d.color = col; sw.querySelectorAll('.swb').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const hidden = h('input', { type: 'checkbox', checked: d.hidden });
  const m = modal(h('div', { class: 'f-card sm' }, h('h3', { class: 'display', text: isNew ? 'New category' : 'Edit category' }),
    h('label', { class: 'f-l' }, 'Name', name), h('div', { class: 'f-l' }, 'Background colour', sw), h('label', { class: 'switch' }, hidden, h('span', { text: 'Hide from guests' })), err,
    h('div', { class: 'f-foot' }, !isNew ? h('button', { class: 'k-btn danger', onclick: async () => { if (!confirm(`Delete ${d.name}?`)) return; try { await api('DELETE', `/api/admin/categories/${d.id}`); await loadMenu(); m.close(); toast('Category deleted'); } catch (e) { err.textContent = errMsg(e); } }, text: 'Delete' }) : h('span'),
      h('div', {}, h('button', { class: 'k-btn', onclick: () => m.close(), text: 'Cancel' }), h('button', { class: 'k-btn primary', onclick: async () => {
        const nm = name.value.trim(); if (!nm) { err.textContent = 'Give the category a name.'; return; } const id = d.id || slug(nm);
        try { await api('PUT', `/api/admin/categories/${id}`, { name: nm, color: d.color, sort: d.sort, hidden: hidden.checked }); await loadMenu(); K.selCat = id; m.close(); toast(isNew ? `${nm} added` : 'Category saved'); } catch (e) { err.textContent = errMsg(e); } }, text: isNew ? 'Add category' : 'Save' })))));
}
function itemEditor(item) {
  const isNew = !item; const cat = K.menu.cats.find(c => c.id === (item?.cat || K.selCat)) || K.menu.cats[0];
  const d = item ? JSON.parse(JSON.stringify(item)) : { id: null, cat: cat.id, name: '', price: '', veg: true, desc: '', ings: [], image: '', anim: 'spin', available: true, sort: K.menu.items.length + 1 };
  const pv = h('div', { class: 'pv' }), err = h('p', { class: 'f-err' }), imgStatus = h('p', { class: 'f-hint' });
  const renderPv = () => { const c = K.menu.cats.find(x => x.id === d.cat) || cat; pv.style.background = c.color;
    pv.replaceChildren(h('div', { class: 'pv-stage' }, h('div', { class: 'pv-card' }, h('div', { class: 'shadow' }), h('div', { class: 'lift' }, visualEl(d)))),
      h('div', { class: 'pv-info' }, h('span', { class: 'vegmark ' + (d.veg ? 'veg' : 'nonveg') }), h('div', { class: 'name', text: d.name || 'Dish name' }), h('p', { class: 'desc', text: d.desc || 'A short, tasty description.' }),
        h('div', { class: 'ings' }, d.ings.map(x => h('div', { class: 'ing' }, ingIcon(x), h('span', { class: 'ing-l', text: x.l })))), h('div', { class: 'pv-price', text: inr(d.price || 0) }))); };
  const inp = (key, props, tag = 'input') => { const el = h(tag, { class: 'f-in', ...props, value: d[key] ?? '' }); el.addEventListener('input', () => { d[key] = el.value; renderPv(); }); return el; };
  const catSel = h('select', { class: 'f-in', 'aria-label': 'Category' }, K.menu.cats.map(c => h('option', { value: c.id, text: c.name }))); catSel.value = d.cat; catSel.onchange = () => { d.cat = catSel.value; renderPv(); };
  const seg = (opts, key) => { const w = h('div', { class: 'seg', role: 'radiogroup' }); const draw = () => w.replaceChildren(...opts.map(([val, l]) => h('button', { class: d[key] === val ? 'on' : '', role: 'radio', 'aria-checked': String(d[key] === val), onclick: () => { d[key] = val; draw(); renderPv(); }, text: l }))); draw(); return w; };
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr' }), optBg = h('input', { type: 'checkbox', checked: true }), optCircle = h('input', { type: 'checkbox' }); let lastFile = null;
  const runImg = async () => {
    if (!lastFile) return; imgStatus.textContent = 'Cutting out your photo…';
    try { const out = await processImage(lastFile, { removeBg: optBg.checked, circle: optCircle.checked });
      imgStatus.textContent = 'Uploading…'; const r = await api('POST', '/api/admin/images', out.blob, { raw: true, headers: { 'Content-Type': out.blob.type } }); d.image = r.url; imgStatus.textContent = 'Photo ready. Check the preview.'; renderPv(); }
    catch (e) { imgStatus.textContent = e instanceof ApiError ? e.message : "That image couldn't be processed. Try a PNG or JPG under 10 MB."; }
  };
  fileIn.onchange = () => { const f = fileIn.files[0]; if (!f) return; if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 10 * 1024 * 1024) { imgStatus.textContent = 'Use a PNG, JPG or WebP under 10 MB.'; return; } lastFile = f; runImg(); };
  optBg.onchange = runImg; optCircle.onchange = runImg;
  const ingWrap = h('div', { class: 'f-ings' });
  const drawIngs = () => ingWrap.replaceChildren(...d.ings.map((x, i) => h('span', { class: 'f-ing' }, ingIcon(x), x.l, h('button', { 'aria-label': 'Remove ' + x.l, onclick: () => { d.ings.splice(i, 1); drawIngs(); renderPv(); }, text: '×' }))));
  const addIng = x => { if (d.ings.length >= 12 || !x.l || d.ings.some(y => y.l.toLowerCase() === x.l.toLowerCase())) return; d.ings.push(x); drawIngs(); renderPv(); };
  const eIn = h('input', { class: 'f-in emo', maxlength: '4', placeholder: '🥕', 'aria-label': 'Ingredient emoji' }), lIn = h('input', { class: 'f-in', maxlength: '24', placeholder: 'Ingredient name', 'aria-label': 'Ingredient name' });
  const addCustom = () => { addIng({ e: eIn.value.trim() || '•', l: lIn.value.trim() }); eIn.value = lIn.value = ''; lIn.focus(); };
  lIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
  const avail = h('input', { type: 'checkbox', checked: d.available }); avail.onchange = () => { d.available = avail.checked; };
  const save = async () => {
    const nm = String(d.name).trim(), pr = Math.round(Number(d.price));
    if (!nm) return err.textContent = 'Give the dish a name.'; if (!(pr >= 1 && pr <= 99999)) return err.textContent = 'Set a price between ₹1 and ₹99,999.'; if (!d.image) return err.textContent = 'Add a photo or pick one from the gallery.';
    const id = d.id || slug(nm);
    try { await api('PUT', `/api/admin/items/${id}`, strip({ ...d, name: nm, price: pr, desc: String(d.desc || '').trim() })); await loadMenu(); K.selCat = d.cat; m.close(); toast(isNew ? `${nm} added to the menu` : 'Dish saved'); } catch (e) { err.textContent = errMsg(e); }
  };
  const del = async () => { if (!confirm(`Delete ${d.name} from the menu?`)) return; try { await api('DELETE', `/api/admin/items/${d.id}`); await loadMenu(); m.close(); toast('Dish deleted'); } catch (e) { err.textContent = errMsg(e); } };
  drawIngs(); renderPv();
  const m = modal(h('div', { class: 'f-card' },
    h('div', { class: 'f-top' }, h('h3', { class: 'display', text: isNew ? 'New dish' : 'Edit dish' }), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => m.close(), text: '×' })),
    h('div', { class: 'f-grid' }, pv, h('div', { class: 'f-form' },
      h('div', { class: 'f-l' }, 'Photo', h('div', { class: 'f-img' }, h('label', { class: 'k-btn primary' }, 'Upload photo', fileIn), h('button', { class: 'k-btn', onclick: () => galleryPicker(val => { d.image = val; lastFile = null; imgStatus.textContent = ''; renderPv(); }), text: 'Choose from gallery' })),
        h('div', { class: 'f-opts' }, h('label', { class: 'switch' }, optBg, h('span', { text: 'Remove plain background' })), h('label', { class: 'switch' }, optCircle, h('span', { text: 'Crop to a circle (plates)' }))), imgStatus),
      h('label', { class: 'f-l' }, 'Name', inp('name', { maxlength: '48', placeholder: 'e.g. Paneer Tikka Pizza' })),
      h('div', { class: 'f-row' }, h('label', { class: 'f-l' }, 'Price (₹)', inp('price', { type: 'number', min: '1', max: '99999', inputmode: 'numeric' })), h('label', { class: 'f-l' }, 'Category', catSel)),
      h('div', { class: 'f-l' }, 'Food type', seg([[true, 'Veg'], [false, 'Non-veg']], 'veg')),
      h('label', { class: 'f-l' }, 'Description', inp('desc', { rows: '2', maxlength: '200', placeholder: 'One line that makes people hungry' }, 'textarea')),
      h('div', { class: 'f-l' }, 'Main ingredients (shown in the carousel)', ingWrap, h('div', { class: 'f-row tight' }, eIn, lIn, h('button', { class: 'k-btn', onclick: addCustom, text: 'Add' })), h('div', { class: 'f-lib' }, ING_LIB.map(x => h('button', { class: 'f-libb', onclick: () => addIng({ ...x }), title: 'Add ' + x.l }, ingIcon(x), x.l)))),
      h('div', { class: 'f-l' }, 'Animation on the menu', seg([['spin', 'Slow spin'], ['float', 'Float'], ['none', 'Still']], 'anim')),
      h('label', { class: 'switch' }, avail, h('span', { text: 'Available to order' })), err)),
    h('div', { class: 'f-foot' }, !isNew ? h('button', { class: 'k-btn danger', onclick: del, text: 'Delete dish' }) : h('span'), h('div', {}, h('button', { class: 'k-btn', onclick: () => m.close(), text: 'Cancel' }), h('button', { class: 'k-btn primary', onclick: save, text: isNew ? 'Add to menu' : 'Save dish' })))));
}
function galleryPicker(onPick) {
  const photos = [...new Map(K.menu.items.filter(i => i.image.startsWith('/img/')).map(i => [i.image, i.name])).entries()];
  const tile = (val, label) => h('button', { class: 'g-tile', onclick: () => { onPick(val); m.close(); }, 'aria-label': label }, visualEl({ image: val, anim: 'none' }), h('span', { text: label }));
  const m = modal(h('div', { class: 'f-card' }, h('div', { class: 'f-top' }, h('h3', { class: 'display', text: 'Gallery' }), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => m.close(), text: '×' })),
    h('p', { class: 'f-hint', text: 'Photos already used on your menu, plus drawn drinks and desserts.' }),
    h('div', { class: 'g-grid' }, photos.map(([url, name]) => tile(url, name)), Object.keys(DRAWN).map(k => tile('d:' + k, DRAWN[k].label)))));
}
// Client-side cutout: remove a plain/checkerboard background by flood fill, optional circle crop, trim, square, WebP.
async function processImage(file, { removeBg, circle }, max = 640) {
  const bmp = await createImageBitmap(file); const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  let w = Math.max(1, Math.round(bmp.width * sc)), hh = Math.max(1, Math.round(bmp.height * sc));
  let cv = document.createElement('canvas'); cv.width = w; cv.height = hh; cv.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, w, hh);
  if (removeBg) {
    const cx = cv.getContext('2d', { willReadFrequently: true }); const id = cx.getImageData(0, 0, w, hh), p = id.data, N = w * hh;
    const corner = [0, w - 1, (hh - 1) * w, N - 1].map(i => [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]]);
    const isBg = i => { const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2]; if (p[i * 4 + 3] < 20) return true; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn <= 18 && (r + g + b) / 3 >= 200) return true; return corner.some(c => Math.abs(c[0] - r) + Math.abs(c[1] - g) + Math.abs(c[2] - b) < 36); };
    const seen = new Uint8Array(N), stack = new Int32Array(N); let sp = 0; const push = i => { if (!seen[i] && isBg(i)) { seen[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((hh - 1) * w + x); } for (let y = 0; y < hh; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) { const i = stack[--sp], x = i % w, y = (i / w) | 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < hh - 1) push(i + w); }
    for (let i = 0; i < N; i++) if (seen[i]) p[i * 4 + 3] = 0; else { const x = i % w, y = (i / w) | 0; if ((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (y > 0 && seen[i - w]) || (y < hh - 1 && seen[i + w])) p[i * 4 + 3] = 140; }
    cx.putImageData(id, 0, 0);
  }
  if (circle) { const r = Math.min(w, hh) / 2, c2 = document.createElement('canvas'); c2.width = c2.height = Math.round(r * 2); const x2 = c2.getContext('2d'); x2.beginPath(); x2.arc(r, r, r - 1, 0, Math.PI * 2); x2.clip(); x2.drawImage(cv, -(w / 2 - r), -(hh / 2 - r)); cv = c2; w = hh = c2.width; }
  const d2 = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data; let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d2[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = hh - 1; }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, side = Math.max(bw, bh), out = document.createElement('canvas'); out.width = out.height = side;
  out.getContext('2d').drawImage(cv, x0, y0, bw, bh, (side - bw) / 2, (side - bh) / 2, bw, bh);
  let blob = await new Promise(r => out.toBlob(r, 'image/webp', 0.86)); if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => out.toBlob(r, 'image/png'));
  return { blob };
}

// ---------- offers ----------
function renderOffers() {
  const o = JSON.parse(JSON.stringify(K.menu.offers)); const err = h('p', { class: 'f-err' });
  const byId = Object.fromEntries(K.menu.items.map(i => [i.id, i]));
  const num = (obj, key, props) => { const el = h('input', { class: 'f-in', type: 'number', value: obj[key], ...props }); el.oninput = () => { obj[key] = el.value; drawEx(); }; return el; };
  const tog = obj => { const el = h('input', { type: 'checkbox', checked: obj.on }); el.onchange = () => { obj.on = el.checked; drawEx(); }; return el; };
  const sel = (obj, key, opts) => { const el = h('select', { class: 'f-in' }, opts.map(([val, l]) => h('option', { value: val, text: l }))); el.value = obj[key]; el.onchange = () => { obj[key] = el.value; drawEx(); }; return el; };
  const catOpts = K.menu.cats.map(c => [c.id, c.name]), itemOpts = K.menu.items.map(m => [m.id, `${m.name} (${inr(m.price)})`]); const ex = h('div', { class: 'o-ex' });
  const drawEx = () => { const sample = K.menu.items.filter(m => m.available).slice(0, 4).map(m => ({ item: m.id, qty: 2 })); const b = priceBill(sample, byId, normOffers(o));
    ex.replaceChildren(h('h3', { text: 'Example plate' }), h('ul', {}, sample.map(l => h('li', {}, h('span', { text: `2× ${byId[l.item].name}` }), h('span', { text: inr(byId[l.item].price * 2) })))),
      h('div', { class: 'bill' }, h('div', {}, h('span', { text: 'Items' }), h('span', { text: inr(b.subtotal) })), b.offers.map(x => h('div', { class: 'disc' }, h('span', { text: x.label }), h('span', { text: x.amount ? '−' + inr(-x.amount) : 'Free' }))), h('div', {}, h('span', { text: `GST ${b.offersUsed.gst}%` }), h('span', { text: inr(b.gst) })), h('div', { class: 'tot' }, h('span', { text: 'Total' }), h('span', { text: inr(b.total) })))); };
  const block = (title, toggle, ...kids) => h('div', { class: 'o-block' }, h('div', { class: 'o-bh' }, h('h3', { text: title }), toggle ? h('label', { class: 'switch' }, toggle, h('span', { text: 'On' })) : null), h('div', { class: 'o-fields' }, kids));
  drawEx();
  K.body.replaceChildren(h('div', { class: 'o-wrap' }, h('div', { class: 'o-form' },
    h('h2', { text: 'Offers & tax' }), h('p', { class: 'f-hint', text: 'Guests see these on their plate before ordering. The server applies the same rules when it charges.' }),
    block('Free item on big plates', tog(o.free), h('label', { class: 'f-l' }, 'Plate value from (₹)', num(o.free, 'at', { min: 0 })), h('label', { class: 'f-l' }, 'Free item', sel(o.free, 'item', itemOpts))),
    block('Combo deal', tog(o.combo), h('label', { class: 'f-l' }, 'Pair this category', sel(o.combo, 'a', catOpts)), h('label', { class: 'f-l' }, 'with', sel(o.combo, 'b', catOpts)), h('label', { class: 'f-l' }, 'Discount per pair (₹)', num(o.combo, 'off', { min: 0 }))),
    block('Big plate discount', tog(o.big), h('label', { class: 'f-l' }, 'Plate value from (₹)', num(o.big, 'at', { min: 0 })), h('label', { class: 'f-l' }, 'Discount (%)', num(o.big, 'pct', { min: 0, max: 90 }))),
    block('Tax', null, h('label', { class: 'f-l' }, 'GST (%)', num(o, 'gst', { min: 0, max: 28 }))), err,
    h('button', { class: 'k-btn primary big', onclick: async () => { err.textContent = ''; try { await api('PUT', '/api/admin/offers', normOffers(o)); toast('Offers saved. Guests see them now.'); await loadMenu(); } catch (e) { err.textContent = errMsg(e); } }, text: 'Save offers' })), ex));
}

// ---------- staff ----------
async function renderStaff() {
  const [{ users }, { entries }] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/audit')]).catch(e => { toast(errMsg(e), 'bad'); return [{ users: [] }, { entries: [] }]; });
  const un = h('input', { class: 'f-in', placeholder: 'username', maxlength: '32', autocomplete: 'off' }), pw = h('input', { class: 'f-in', type: 'password', placeholder: 'temporary password (10+ chars)', autocomplete: 'new-password' });
  const role = h('select', { class: 'f-in' }, h('option', { value: 'staff', text: 'Staff (orders, tables, sold-out)' }), h('option', { value: 'owner', text: 'Owner (everything)' })); const err = h('p', { class: 'f-err' });
  const cur = h('input', { class: 'f-in', type: 'password', autocomplete: 'current-password', placeholder: 'current password' }), nxt = h('input', { class: 'f-in', type: 'password', autocomplete: 'new-password', placeholder: 'new password (10+ chars)' }), perr = h('p', { class: 'f-err' });
  K.body.replaceChildren(h('div', { class: 's-wrap' },
    h('section', { class: 'o-block' }, h('h3', { text: 'Staff accounts' }),
      h('div', { class: 's-list' }, users.map(u => h('div', { class: 's-row' + (u.disabled ? ' off' : '') }, h('b', { text: u.username }), h('span', { class: 'k-st', text: u.role }), u.disabled ? h('span', { class: 'k-st rejected', text: 'disabled' }) : null,
        u.id === K.me.id ? h('span', { class: 'f-hint', text: 'you' }) : h('span', { class: 's-act' },
          h('button', { class: 'k-btn sm', onclick: async () => { const np = prompt(`New temporary password for ${u.username} (10+ characters):`); if (np && await act(() => api('PATCH', `/api/admin/users/${u.id}`, { password: np }), 'Password reset. They have been signed out.')) render(); }, text: 'Reset password' }),
          h('button', { class: 'k-btn sm ' + (u.disabled ? '' : 'danger'), onclick: async () => { if (await act(() => api('PATCH', `/api/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'Account enabled' : 'Account disabled and signed out')) render(); }, text: u.disabled ? 'Enable' : 'Disable' }))))),
      h('div', { class: 'o-fields' }, h('label', { class: 'f-l' }, 'Username', un), h('label', { class: 'f-l' }, 'Password', pw), h('label', { class: 'f-l' }, 'Role', role)), err,
      h('button', { class: 'k-btn primary', onclick: async () => { err.textContent = ''; try { await api('POST', '/api/admin/users', { username: un.value, password: pw.value, role: role.value }); toast('Account created'); render(); } catch (e) { err.textContent = errMsg(e); } }, text: 'Add account' })),
    h('section', { class: 'o-block' }, h('h3', { text: 'Change my password' }), h('div', { class: 'o-fields' }, cur, nxt), perr,
      h('button', { class: 'k-btn primary', onclick: async () => { perr.textContent = ''; try { await api('POST', '/api/admin/password', { current: cur.value, next: nxt.value }); alert('Password changed. Sign in again.'); location.reload(); } catch (e) { perr.textContent = errMsg(e); } }, text: 'Change password' })),
    h('section', { class: 'o-block wide' }, h('h3', { text: 'Activity log' }), h('p', { class: 'f-hint', text: 'Every admin change, newest first (last 200).' }),
      h('div', { class: 'k-hist-t' }, entries.map(e => h('div', { class: 'a-row' }, h('span', { text: new Date(e.at).toLocaleString() }), h('b', { text: e.actor }), h('span', { text: e.action }), h('code', { text: e.detail })))))));
}
boot();
