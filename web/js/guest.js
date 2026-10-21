// Guest app: landing (/), table join, name reveal, 3D menu, shared plate, orders.
import { $, h, inr, ago, toast, api, live, debounce, reduceMotion, ApiError } from './lib.js';
import { visualEl, ingIcon } from './visual.js';
import { priceBill } from './shared/pricing.js';
import { funnyName, nickColor } from './shared/names.js';

const app = $('#app');
const S = { table: null, view: null, snap: null, menu: null, byId: {}, catById: {}, stream: null, poll: null };
const G = {};
const avatar = (g, cls = '') => h('span', { class: 'av ' + cls, style: `background:${nickColor(g.nick)}`, title: g.nick, text: g.emoji || (g.nick || '?')[0] });
const screen = (cls, ...kids) => app.replaceChildren(h('div', { class: 'center-screen ' + cls }, ...kids));
const errMsg = e => e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

async function loadMenu() {
  const m = await api('GET', '/api/menu'); S.menu = m;
  S.byId = Object.fromEntries(m.items.map(i => [i.id, i])); S.catById = Object.fromEntries(m.cats.map(c => [c.id, c]));
  app.style.setProperty('--stage', m.cats[0]?.color || '#FFC531');
}
const items = () => S.menu.cats.flatMap(c => S.menu.items.filter(i => i.cat === c.id));

// ---------- routing ----------
async function boot() {
  const m = /^\/t\/(\d{1,3})\/?$/.exec(location.pathname);
  try { const cfg = await api('GET', '/api/config'); document.title = cfg.name; S.name = cfg.name; } catch { S.name = 'Hungry Mango'; }
  fillBackdrop();
  if (!m) return landing();
  S.table = Number(m[1]); screen('', h('div', { class: 'loader', 'aria-label': 'Loading' }));
  try { await loadMenu(); } catch (e) { return screen('', h('h2', { class: 'display', text: 'Menu unavailable' }), h('p', { text: errMsg(e) }), h('button', { class: 'btn-big', onclick: () => location.reload(), text: 'Try again' })); }
  await enterTable();
}
async function fillBackdrop() {
  try { const m = S.menu || await api('GET', '/api/menu'); const pics = m.items.filter(i => i.image.startsWith('/img/')); const bd = $('.backdrop'); if (!bd || pics.length < 2) return;
    bd.append(h('div', { class: 'blob p' }, visualEl({ ...pics[pics.length > 2 ? 2 : 0], anim: 'none' })), h('div', { class: 'blob q' }, visualEl({ ...pics[1], anim: 'none' }))); } catch { }
}
async function enterTable() {
  try { const snap = await api('GET', '/api/session'); if (snap.table === S.table) { S.snap = snap; startStream(); return renderMenu(); } } catch (e) { if (!(e instanceof ApiError) || ![401, 410].includes(e.status)) { /* fall through */ } }
  try { const st = await api('GET', `/api/tables/${S.table}/status`); st.open ? renderJoin() : renderClosed(); }
  catch (e) { screen('', h('h2', { class: 'display', text: e.status === 404 ? 'No such table' : 'Can\'t reach the restaurant' }), h('p', { text: e.status === 404 ? 'Check the number on your table card.' : errMsg(e) }), h('button', { class: 'btn-big', onclick: () => location.reload(), text: 'Try again' })); }
}

function landing() {
  S.view = 'landing';
  const input = h('input', { class: 'code-box wide', inputmode: 'numeric', maxlength: '3', placeholder: 'No.', 'aria-label': 'Table number' });
  const goTable = () => { const n = parseInt(input.value, 10); if (n > 0) location.href = `/t/${n}`; };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') goTable(); });
  app.replaceChildren(h('div', { class: 'landing' },
    h('div', { class: 'land-hero' }, visualEl({ image: 'd:x2', anim: 'float' }, 'land-vis')),
    h('h1', { class: 'brand-big', text: S.name }),
    h('p', { class: 'land-sub', text: 'Scan the QR code on your table to see the menu and order from your phone.' }),
    h('p', { class: 'land-small', text: 'QR not working? Type your table number.' }),
    h('div', { class: 'land-go' }, input, h('button', { class: 'btn-big', onclick: goTable, text: 'Go' })),
    h('a', { class: 'land-staff', href: '/admin', text: 'Staff sign in' })));
}
function renderClosed() {
  S.view = 'closed'; const v = visualEl({ image: firstPhoto(), anim: 'float' }, 'big-vis');
  screen('closed', h('button', { class: 'screen-back', onclick: () => { clearInterval(S.poll); location.href = '/'; }, text: '← Back' }), v, h('h2', { class: 'display', text: `Table ${S.table} isn't open yet` }), h('p', { text: 'Your server opens the table when you sit down. This page checks again by itself.' }));
  clearInterval(S.poll); S.poll = setInterval(async () => { try { const st = await api('GET', `/api/tables/${S.table}/status`); if (st.open) { clearInterval(S.poll); renderJoin(); } } catch { } }, 8000);
}
const firstPhoto = () => (S.menu?.items.find(i => i.image.startsWith('/img/')) || {}).image || 'd:x1';
function renderEnded() {
  S.view = 'ended'; S.stream?.close(); S.stream = null; clearInterval(S.livePoll); closeSheets();
  screen('ended', visualEl({ image: 'd:x1', anim: 'float' }, 'big-vis'), h('h2', { class: 'display', text: 'Thanks for eating with us' }),
    h('p', { text: `The session at table ${S.table} has closed, so this link can't place orders any more. Scan the table again on your next visit.` }),
    h('button', { class: 'btn-big', onclick: () => enterTable(), text: 'Done' }));
}
function renderJoin() {
  S.view = 'join'; clearInterval(S.poll);
  const boxes = [0, 1, 2, 3].map(i => h('input', { class: 'code-box', inputmode: 'numeric', maxlength: '1', autocomplete: 'one-time-code', 'aria-label': 'Digit ' + (i + 1) }));
  const msg = h('p', { class: 'join-msg', 'aria-live': 'polite' }); const row = h('div', { class: 'code-row' }, boxes); let busy = false;
  const check = async () => {
    const code = boxes.map(b => b.value).join(''); if (code.length < 4 || busy) return; busy = true;
    try { const r = await api('POST', `/api/tables/${S.table}/join`, { code }); S.snap = await api('GET', '/api/session'); startStream(); renderReveal(r.guest); }
    catch (e) {
      row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
      msg.textContent = e.code === 'rate_limited' ? `Too many tries. Wait ${e.retryAfter || 60} seconds or ask your server.` : e.code === 'table_closed' ? 'This table was just closed. Ask your server.' : errMsg(e);
      boxes.forEach(b => b.value = ''); boxes[0].focus();
    } finally { busy = false; }
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => { b.value = b.value.replace(/\D/g, '').slice(-1); if (b.value && i < 3) boxes[i + 1].focus(); check(); });
    b.addEventListener('keydown', e => { if (e.key === 'Backspace' && !b.value && i) boxes[i - 1].focus(); });
    b.addEventListener('paste', e => { const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4); if (d.length) { e.preventDefault(); d.split('').forEach((c, k) => boxes[k] && (boxes[k].value = c)); check(); } });
  });
  screen('join', h('button', { class: 'screen-back', onclick: () => { location.href = '/'; }, text: '← Back' }), h('div', { class: 'join-badge', text: String(S.table) }), h('h2', { class: 'display', text: `Welcome to table ${S.table}` }),
    h('p', { text: 'Type the 4-digit code printed on the card at your table. It changes for every new group.' }), row, msg,
    h('p', { class: 'join-foot', text: "No account needed. You'll get a funny name, and your plate is shared with everyone at this table." }));
  setTimeout(() => boxes[0].focus(), 50);
}
function renderReveal(me) {
  S.view = 'reveal';
  const emo = h('div', { class: 'rv-emoji', 'aria-hidden': 'true' }), nm = h('div', { class: 'rv-name display', 'aria-live': 'polite' });
  const spin = h('button', { class: 'btn-ghost', text: 'Spin again' }), go = h('button', { class: 'btn-big', text: "Let's eat" });
  const roll = final => {
    spin.disabled = go.disabled = true; nm.classList.remove('land'); emo.classList.remove('land');
    const steps = reduceMotion ? 0 : 14; let k = 0;
    const tick = () => {
      if (k < steps) { const r = funnyName([]); nm.textContent = r.nick; emo.textContent = r.emoji; k++; setTimeout(tick, 35 + k * k * 1.1); return; }
      nm.textContent = final.nick; emo.textContent = final.emoji; emo.style.background = nickColor(final.nick);
      void nm.offsetWidth; nm.classList.add('land'); emo.classList.add('land'); spin.disabled = go.disabled = false;
    };
    tick();
  };
  spin.onclick = async () => { try { S.snap = await api('POST', '/api/session/name', {}); roll(S.snap.me); } catch (e) { toast(errMsg(e), 'bad'); } };
  go.onclick = () => { renderMenu(); setTimeout(() => toast(`Everyone at table ${S.table} shares this plate.`), 500); };
  screen('reveal', h('button', { class: 'screen-back', onclick: () => { location.href = '/'; }, text: '← Back' }), h('p', { class: 'rv-k', text: `Table ${S.table}, meet your alter ego` }), emo, nm,
    h('p', { text: 'This name shows up on the shared plate so your table knows who added what.' }), h('div', { class: 'rv-btns' }, spin, go));
  roll(me);
}

// ---------- live updates ----------
const resync = debounce(async () => {
  try { S.snap = await api('GET', '/api/session'); onSnap(); }
  catch (e) { if (e.status === 410 || e.status === 401) renderEnded(); }
}, 120);
function startStream() {
  S.stream?.close();
  S.stream = live('/api/session/stream', {
    plate: resync, guests: resync, orders: resync, resync,
    menu: debounce(async () => { await loadMenu(); if (S.view === 'menu') rebuildStage(); resync(); }, 200),
    game: debounce(async () => { if (S.view === 'game') renderGame(); }, 120),
    closed: () => renderEnded(),
    fail: () => resync(),
  });
  clearInterval(S.livePoll); S.livePoll = setInterval(() => { if (['menu','list','item','game','bill'].includes(S.view)) { resync(); if (S.view === 'game') renderGame(); } }, 5000);
}
function onSnap() {
  if (S.view === 'list') return;
  if (S.view === 'item') return;
  if (S.view === 'bill') return renderBillPage();
  if (S.view !== 'menu') return;
  if (S.snap.me) { /* name may have changed */ }
  updatePlateBar(); updateWho(); updateOrdersBadge();
  if (G.sheetPlate.classList.contains('open')) renderPlateSheet();
  if (G.sheetOrders.classList.contains('open')) renderOrdersSheet();
  G.seen = G.seen || {};
  for (const o of S.snap.orders) { const p = G.seen[o.id]; if (p && p !== o.status) toast(({ cooking: 'The kitchen accepted your order. Cooking now.', ready: 'Your food is ready. Coming to your table.', served: 'Served. Enjoy!', rejected: "The kitchen couldn't take that order. Your server will come over." })[o.status] || 'Order updated', o.status === 'rejected' ? 'bad' : ''); G.seen[o.id] = o.status; }
}

// ---------- menu stage ----------
function renderMenu() {
  S.view = 'menu'; app.replaceChildren();
  G.seen = Object.fromEntries(S.snap.orders.map(o => [o.id, o.status]));
  G.bgWrap = h('div', { class: 'bgs', 'aria-hidden': 'true' });
  G.tabsWrap = h('nav', { class: 'cats', 'aria-label': 'Categories' });
  G.track = h('div', { class: 'track' });
  G.stage = h('div', { class: 'stage', tabindex: '0', role: 'region', 'aria-label': 'Menu. Swipe or use arrow keys.' }, h('div', { class: 'glow' }), G.track,
    h('button', { class: 'nav prev', 'aria-label': 'Previous dish', onclick: () => snapTo(G.target - 1), html: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>' }),
    h('button', { class: 'nav next', 'aria-label': 'Next dish', onclick: () => snapTo(G.target + 1), html: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>' }));
  G.info = h('section', { class: 'info', 'aria-live': 'polite' });
  G.plateBtn = h('button', { class: 'platebar', onclick: () => openSheet('plate') });
  G.listBtn = h('button', { class: 'top-link', onclick: renderListView, text: '☰ Menu list' });
  G.gameBtn = h('button', { class: 'top-link', onclick: renderGame, text: '🎲 Play' });
  G.ordersBtn = h('button', { class: 'icon-btn', 'aria-label': 'Your orders', onclick: () => openSheet('orders'), html: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/></svg>' });
  G.who = h('button', { class: 'who', onclick: () => openSheet('plate') });
  app.append(G.bgWrap, h('header', { class: 'top' }, h('div', { class: 'logo', text: S.name }), h('div', { class: 'top-r' }, G.listBtn, G.gameBtn, G.who, G.ordersBtn)),
    G.tabsWrap, G.stage, G.info, G.plateBtn, h('div', { class: 'scrim', onclick: closeSheets }),
    G.sheetPlate = h('section', { class: 'sheet', 'aria-label': 'Your plate', role: 'dialog' }),
    G.sheetOrders = h('section', { class: 'sheet', 'aria-label': 'Your orders', role: 'dialog' }));
  bindStage(); rebuildStage();
  G.ro?.disconnect(); G.ro = new ResizeObserver(() => { measure(); layout(true); }); G.ro.observe(G.stage);
  updatePlateBar(); updateWho(); updateOrdersBadge();
}
// ---------- menu list, item details and table game ----------
function pageHeader(title, back, actions = []) {
  return h('header', { class: 'page-head' }, h('button', { class: 'back-btn', onclick: back, text: '← Back' }), h('h2', { class: 'display', text: title }), h('div', { class: 'page-actions' }, ...actions));
}
function renderListView() {
  S.view = 'list'; closeSheets();
  const content = h('div', { class: 'list-page-body' });
  for (const c of S.menu.cats) {
    const available = S.menu.items.filter(m => m.cat === c.id);
    if (!available.length) continue;
    content.append(h('h3', { class: 'list-category', style: `--cat:${c.color}`, text: c.name }));
    for (const m of available) {
      const ingredients = (m.ings || []).map(x => x.l).filter(Boolean).join(', ') || m.desc || 'Ask our team for ingredients.';
      content.append(h('button', { class: 'menu-row', disabled: false, onclick: () => renderItemDetail(m.id) },
        h('span', { class: 'menu-row-copy' }, h('b', { text: m.name }), h('small', { text: ingredients }), !m.available ? h('em', { text: 'Currently unavailable' }) : null),
        h('strong', { class: 'menu-row-price', text: inr(m.price) }), h('span', { class: 'menu-row-arrow', text: '›' })));
    }
  }
  app.replaceChildren(pageHeader('Full menu', renderMenu, [h('button', { class: 'top-link', onclick: renderGame, text: '🎲 Play' })]), content,
    h('footer', { class: 'list-footer' }, h('button', { class: 'btn-ghost', onclick: () => { renderMenu(); openSheet('plate'); }, text: 'View plate' }), h('button', { class: 'btn-big', onclick: renderBillPage, text: 'Orders & bill' })));
}
function renderItemDetail(id) {
  S.view = 'item'; G.detailId = id; const m = S.byId[id]; if (!m) return renderListView();
  const photo = visualEl({ ...m, anim: 'float' }, 'detail-photo');
  const add = h('button', { class: 'btn-big wide', disabled: !m.available, onclick: async () => { await addToPlate(m, 1); toast(`${m.name} added to the table plate.`); } }, m.available ? `Add to plate · ${inr(m.price)}` : 'Sold out today');
  app.replaceChildren(pageHeader('Dish details', renderListView), h('div', { class: 'item-detail-page' }, photo,
    h('div', { class: 'detail-meta' }, h('span', { class: 'vegmark ' + (m.veg ? 'veg' : 'nonveg'), 'aria-label': m.veg ? 'Vegetarian' : 'Non-vegetarian' }), h('span', { class: 'detail-price', text: inr(m.price) })),
    h('h2', { class: 'display', text: m.name }), h('p', { class: 'detail-desc', text: m.desc || '' }),
    h('h3', { text: 'Ingredients' }), h('p', { class: 'detail-ings', text: (m.ings || []).map(x => x.l).filter(Boolean).join(', ') || 'Ask our team for ingredient details.' }), add,
    h('button', { class: 'btn-ghost wide', onclick: renderListView, text: '← Back to menu list' })));
}
async function renderGame() {
  S.view = 'game'; closeSheets();
  let state; try { state = await api('GET', '/api/session/game'); } catch (e) { return toast(errMsg(e), 'bad'); }
  if (S.view !== 'game') return;
  const total = state.counts[0] + state.counts[1];
  const choices = state.question.map((q, i) => h('button', { class: 'would-card' + (state.mine === i ? ' picked' : ''), onclick: async () => { try { await api('POST', '/api/session/game/vote', { choice: i }); await renderGame(); } catch (e) { toast(errMsg(e), 'bad'); } } },
    h('span', { class: 'would-label', text: i === 0 ? 'OPTION A' : 'OPTION B' }), h('b', { text: q }), h('span', { class: 'would-count', text: `${state.counts[i]} vote${state.counts[i] === 1 ? '' : 's'} · ${total ? Math.round(state.counts[i] / total * 100) : 0}%` }),
    h('span', { class: 'would-bar' }, h('i', { style: `width:${total ? state.counts[i] / total * 100 : 0}%` }))));
  app.replaceChildren(pageHeader('Would You Rather?', renderMenu, [h('button', { class: 'top-link', onclick: renderListView, text: '☰ Menu list' })]),
    h('div', { class: 'game-page' }, h('p', { class: 'game-kicker', text: `TABLE ${S.table} · ROUND ${(state.index % state.total) + 1}` }),
      h('h2', { class: 'display game-title', text: 'Pick your side!' }), h('p', { class: 'game-sub', text: 'Everyone at your table can vote from their own phone.' }),
      h('div', { class: 'would-grid' }, ...choices), h('p', { class: 'game-votes', text: `${total} vote${total === 1 ? '' : 's'} from your table` }),
      h('button', { class: 'btn-big wide', onclick: async () => { try { await api('POST', '/api/session/game/next', {}); await renderGame(); } catch (e) { toast(errMsg(e), 'bad'); } }, text: 'Next question →' }),
      h('button', { class: 'btn-ghost wide', onclick: renderMenu, text: '← Back to ordering' })));
}
function renderBillPage() {
  S.view = 'bill'; closeSheets();
  const os = S.snap.orders.filter(o => !['rejected','settled'].includes(o.status));
  const total = os.reduce((sum, o) => sum + o.bill.total, 0);
  const allServed = os.length > 0 && os.every(o => o.status === 'served');
  const lines = h('div', { class: 'bill-page-lines' });
  for (const o of os) {
    lines.append(h('section', { class: 'bill-order' }, h('div', { class: 'bill-order-head' }, h('b', { text: `Order · ${o.byEmoji || ''} ${o.by}` }), h('span', { class: 'status-pill ' + o.status, text: ({pending:'Waiting',cooking:'Cooking',ready:'Ready',served:'Served'})[o.status] || o.status })),
      ...o.items.map(it => h('div', { class: 'bill-item' }, h('span', { text: `${it.qty} × ${it.name}${it.free ? ' (free)' : ''}` }), h('span', { text: it.free ? 'Free' : inr(it.price * it.qty) }))),
      h('div', { class: 'bill-order-total' }, h('span', { text: 'Order total' }), h('b', { text: inr(o.bill.total) }))));
  }
  app.replaceChildren(pageHeader('Your table bill', renderMenu), h('div', { class: 'bill-page' },
    h('p', { class: 'bill-status-note', text: allServed ? 'Everything has been served. Enjoy!' : 'This bill updates as your orders progress.' }),
    lines, h('div', { class: 'bill-grand-total' }, h('span', { text: 'Total including taxes' }), h('strong', { text: inr(total) })),
    h('button', { class: 'btn-big wide', onclick: async () => { try { await api('POST', '/api/session/call', { type: 'bill' }); toast('Your server has been asked to bring the bill.'); } catch (e) { toast(errMsg(e), 'bad'); } }, text: 'Ask staff for payment bill' }),
    h('button', { class: 'btn-ghost wide', onclick: renderMenu, text: '← Back to menu' })));
}

function rebuildStage() {
  const keep = G.list?.[G.target]?.id;
  G.list = items(); G.cards = []; G.last = []; G.bgs = {};
  G.bgWrap.replaceChildren(...S.menu.cats.map(c => { const d = h('div', { class: 'bg', style: `background:${c.color}` }); G.bgs[c.id] = d; return d; }));
  G.tabs = S.menu.cats.filter(c => G.list.some(m => m.cat === c.id)).map(c => h('button', { class: 'cat', 'data-cat': c.id, onclick: () => snapTo(G.list.findIndex(m => m.cat === c.id)), text: c.name }));
  G.tabsWrap.replaceChildren(...G.tabs);
  G.track.replaceChildren(...G.list.map((m, i) => { const c = h('div', { class: 'card' + (m.available ? '' : ' soldout'), 'data-i': i }, h('div', { class: 'shadow' }), h('div', { class: 'lift' }, visualEl(m))); G.cards.push(c); return c; }));
  if (!G.list.length) { G.info.replaceChildren(h('p', { class: 'desc', text: 'The menu is being updated. Check back in a minute.' })); return; }
  let idx = keep ? G.list.findIndex(m => m.id === keep) : -1; if (idx < 0) idx = Math.min(G.list.length - 1, Math.max(0, Math.round(G.f || 0)));
  G.f = G.target = idx; G.v = 0; G.anim = false; G.preview = G.committed = null;
  measure(); layout(true); preview(idx); commit(idx); settle();
}
function measure() { const r = G.stage.getBoundingClientRect(); G.W = r.width || 340; G.stage.style.setProperty('--cw', Math.min(r.height * 0.9, r.width * 0.64).toFixed(0) + 'px'); }
function bindStage() {
  const st = G.stage; let d = null;
  st.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('.nav')) return;
    d = { x0: e.clientX, f0: G.f, moved: false, lx: e.clientX, lt: performance.now(), v: 0 }; G.anim = false; G.v = 0;
    st.setPointerCapture(e.pointerId); st.classList.add('dragging'); G.cards.forEach(c => c.classList.remove('pop'));
  });
  st.addEventListener('pointermove', e => {
    if (!d) return; const dx = e.clientX - d.x0; if (Math.abs(dx) > 5) d.moved = true;
    const now = performance.now(), dt = Math.max(8, now - d.lt); const inst = -((e.clientX - d.lx) / (G.W * 0.5)) / (dt / 1000);
    d.v = d.v * 0.55 + inst * 0.45; d.lx = e.clientX; d.lt = now;
    let f = d.f0 - dx / (G.W * 0.5); const max = G.list.length - 1;
    if (f < 0) f *= 0.32; if (f > max) f = max + (f - max) * 0.32; G.f = f; frameReq();
  });
  const end = e => {
    if (!d) return; const dd = d; d = null; st.classList.remove('dragging');
    if (!dd.moved) { const c = e.target.closest && e.target.closest('.card'); if (c) { const i = +c.dataset.i; if (i !== G.target) return snapTo(i); wiggle(); } return snapTo(G.target, 0); }
    if (performance.now() - dd.lt > 90) dd.v = 0;
    const vel = Math.max(-14, Math.min(14, dd.v)); snapTo(Math.round(G.f + vel * 0.2), vel);
  };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  st.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { snapTo(G.target + 1); e.preventDefault(); } if (e.key === 'ArrowLeft') { snapTo(G.target - 1); e.preventDefault(); } });
  st.addEventListener('wheel', e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 10) { e.preventDefault(); if (G.wl && performance.now() - G.wl < 320) return; G.wl = performance.now(); snapTo(G.target + Math.sign(e.deltaX)); } }, { passive: false });
}
let raf = 0; const frameReq = () => { if (!raf) raf = requestAnimationFrame(frame); };
function frame(t) {
  raf = 0;
  if (G.anim) {   // critically-damped spring, time-based so it feels the same at 60 Hz and 120 Hz
    const dt = Math.min(0.032, Math.max(0.004, (t - G.lastT) / 1000)); G.lastT = t;
    const k = 190, c = 2 * Math.sqrt(k) * 0.86, x = G.f - G.target; G.v += (-k * x - c * G.v) * dt; G.f += G.v * dt;
    if (Math.abs(x) < 0.001 && Math.abs(G.v) < 0.02) { G.f = G.target; G.v = 0; G.anim = false; }
  }
  layout(); track();
  if (G.anim) frameReq(); else if (!G.stage.classList.contains('dragging')) settle();
}
window.__snapTo = i => snapTo(i);   // used by the e2e suite
function snapTo(i, vel) {
  if (!G.list?.length) return; i = Math.max(0, Math.min(G.list.length - 1, i)); G.target = i;
  if (vel !== undefined) G.v = vel; if (reduceMotion) { G.f = i; G.v = 0; layout(); track(); return settle(); }
  G.cards.forEach(c => c.classList.remove('pop')); G.anim = true; G.lastT = performance.now(); frameReq();
}
function settle() { G.cards.forEach((c, k) => c.classList.toggle('pop', k === G.target)); commit(G.target); }
function wiggle() { const c = G.cards[G.target]; if (!c) return; c.classList.remove('wig'); void c.offsetWidth; c.classList.add('wig'); }
function layout(force) {   // transforms and opacity only: stays on the compositor
  const W = G.W; for (let i = 0; i < G.cards.length; i++) {
    const c = G.cards[i], d = i - G.f, ad = Math.abs(d);
    if (ad > 2.6) { if (G.last[i] !== 'h') { c.style.visibility = 'hidden'; G.last[i] = 'h'; } continue; }
    const x = Math.sign(d) * (Math.min(ad, 1) * W * 0.47 + Math.max(0, ad - 1) * W * 0.2);
    const s = 1 - Math.min(ad, 1) * 0.4 - Math.max(0, ad - 1) * 0.1, rot = -Math.max(-1.5, Math.min(1.5, d)) * 32;
    const tf = `translate3d(${x.toFixed(1)}px,0,${(-ad * 170).toFixed(0)}px) rotateY(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`;
    if (force || G.last[i] !== tf) { c.style.visibility = ''; c.style.transform = tf; c.style.opacity = (ad < 0.7 ? 1 : Math.max(0, 1 - (ad - 0.7) * 0.6)).toFixed(2); c.style.zIndex = String(100 - Math.round(ad * 10)); G.last[i] = tf; }
  }
}
function track() { const r = Math.round(Math.max(0, Math.min(G.list.length - 1, G.f))); if (r !== G.preview) { preview(r); clearTimeout(G.ct); G.ct = setTimeout(() => { if (G.preview === r) commit(r); }, 170); } }
function preview(i) {
  G.preview = i; const m = G.list[i]; if (!m) return;
  for (const [cid, el] of Object.entries(G.bgs)) el.classList.toggle('on', cid === m.cat);
  G.tabs.forEach(t => { const on = t.dataset.cat === m.cat; t.classList.toggle('on', on); on ? t.setAttribute('aria-current', 'true') : t.removeAttribute('aria-current'); });
}
function commit(i) {
  const m = G.list[i]; if (!m || G.committed === m.id + ':' + i + ':' + m.available) return; G.committed = m.id + ':' + i + ':' + m.available; G.qty = 1;
  app.style.setProperty('--stage', S.catById[m.cat]?.color || '#FFC531');
  const on = G.tabs.find(t => t.dataset.cat === m.cat); if (on) G.tabsWrap.scrollTo({ left: on.offsetLeft - (G.tabsWrap.clientWidth - on.offsetWidth) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
  const qtyEl = h('span', { class: 'qn', text: '1' }); const addBtn = h('button', { class: 'add', disabled: !m.available, onclick: () => addToPlate(m, G.qty) });
  const upd = () => { qtyEl.textContent = G.qty; addBtn.replaceChildren(h('span', { text: m.available ? 'Add to plate' : 'Sold out today' }), m.available ? h('b', { text: inr(m.price * G.qty) }) : null); };
  G.info.replaceChildren(h('div', { class: 'swap' },
    h('div', { class: 'row1' }, h('span', { class: 'vegmark ' + (m.veg ? 'veg' : 'nonveg'), role: 'img', 'aria-label': m.veg ? 'Vegetarian' : 'Non-vegetarian' }), h('span', { class: 'count', text: `${i + 1} of ${G.list.length}` })),
    h('h2', { class: 'name', text: m.name }), h('p', { class: 'desc', text: m.desc }),
    h('div', { class: 'ings', role: 'list', 'aria-label': 'Main ingredients' }, m.ings.map((x, j) => h('div', { class: 'ing', role: 'listitem', style: `animation-delay:${j * 45}ms` }, ingIcon(x), h('span', { class: 'ing-l', text: x.l })))),
    h('div', { class: 'act' }, h('div', { class: 'stepper' }, h('button', { 'aria-label': 'Less', disabled: !m.available, onclick: () => { G.qty = Math.max(1, G.qty - 1); upd(); }, text: '−' }), qtyEl, h('button', { 'aria-label': 'More', disabled: !m.available, onclick: () => { G.qty = Math.min(20, G.qty + 1); upd(); }, text: '+' })), addBtn)));
  upd();
}
async function addToPlate(m, qty) {
  if (!m.available) return; flyToPlate(m);
  try { S.snap = await api('POST', '/api/session/plate', { item: m.id, delta: qty }); onSnap(); }
  catch (e) { if (e.status === 410) return renderEnded(); toast(errMsg(e), 'bad'); }
}
function flyToPlate(m) {
  const card = G.cards[G.target]; if (!card) return; const ar = app.getBoundingClientRect();
  const from = card.querySelector('.lift').getBoundingClientRect(), to = G.plateBtn.getBoundingClientRect();
  if (reduceMotion || !from.width) return bump();
  const f = visualEl({ ...m, anim: 'none' }, 'fly'); app.append(f);
  const sz = Math.min(from.width, 170), x0 = from.left - ar.left + from.width / 2 - sz / 2, y0 = from.top - ar.top + from.height / 2 - sz / 2, x1 = to.left - ar.left + 32 - sz / 2, y1 = to.top - ar.top + to.height / 2 - sz / 2;
  f.style.width = f.style.height = sz + 'px';
  f.animate([{ transform: `translate3d(${x0}px,${y0}px,0) scale(1) rotate(0)` }, { transform: `translate3d(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 70}px,0) scale(.62) rotate(-140deg)`, offset: 0.45 }, { transform: `translate3d(${x1}px,${y1}px,0) scale(.16) rotate(-320deg)`, opacity: 0.7 }], { duration: 700, easing: 'cubic-bezier(.45,0,.55,1)' }).onfinish = () => { f.remove(); bump(); };
}
function bump() { G.plateBtn.classList.remove('bump'); void G.plateBtn.offsetWidth; G.plateBtn.classList.add('bump'); }
function updatePlateBar() {
  const b = S.snap.bill, count = b.lines.reduce((a, l) => a + l.qty, 0);
  G.plateBtn.replaceChildren(h('span', { class: 'pb-ic', html: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="20" rx="14" ry="6"/><ellipse cx="16" cy="18.5" rx="9" ry="3.4"/></svg>' }, count ? h('i', { text: String(count) }) : null),
    h('span', { class: 'pb-t' }, h('b', { text: 'Table plate' }), h('small', { text: count ? `${count} item${count > 1 ? 's' : ''}, shared with ${Math.max(1, S.snap.guests.length)}` : 'Empty. Add something tasty.' })),
    h('span', { class: 'pb-total', text: count ? inr(b.total) : '' }));
}
function updateWho() { const gs = S.snap.guests; G.who.replaceChildren(h('span', { class: 'avs' }, gs.slice(0, 3).map(g => avatar(g))), h('span', { text: `Table ${S.table}` })); G.who.setAttribute('aria-label', `Table ${S.table}, ${gs.length} ${gs.length === 1 ? 'person' : 'people'} joined`); }
function updateOrdersBadge() { const n = S.snap.orders.filter(o => ['pending', 'cooking', 'ready'].includes(o.status)).length; G.ordersBtn.querySelector('i')?.remove(); if (n) G.ordersBtn.append(h('i', { text: String(n) })); }
function openSheet(w) { const sh = w === 'plate' ? G.sheetPlate : G.sheetOrders; closeSheets(); w === 'plate' ? renderPlateSheet() : renderOrdersSheet(); sh.classList.add('open'); app.classList.add('sheet-open'); setTimeout(() => sh.querySelector('.x')?.focus(), 320); }
function closeSheets() { G.sheetPlate?.classList.remove('open'); G.sheetOrders?.classList.remove('open'); app.classList.remove('sheet-open'); }
const sheetHead = (title, sub) => h('div', { class: 'sh-head' }, h('div', { class: 'grab' }), h('div', { class: 'sh-row' }, h('div', {}, h('h3', { class: 'display', text: title }), sub ? h('p', { class: 'sh-sub', text: sub }) : null), h('button', { class: 'x', 'aria-label': 'Close', onclick: closeSheets, text: '×' })));
function renderPlateSheet() {
  const snap = S.snap, b = snap.bill, me = snap.me; const guestOf = id => snap.guests.find(g => g.id === id) || { nick: 'Someone' };
  const people = snap.guests.map(g => g.id === me.id
    ? h('button', { class: 'chip-p me', title: 'Spin a new name', onclick: async () => { try { S.snap = await api('POST', '/api/session/name', {}); toast(`You're now ${S.snap.me.nick} ${S.snap.me.emoji}`); onSnap(); } catch (e) { toast(errMsg(e), 'bad'); } } }, avatar(g), g.nick + ' (you)', h('span', { class: 'reroll', 'aria-hidden': 'true', text: '↻' }))
    : h('span', { class: 'chip-p' }, avatar(g), g.nick));
  const rows = snap.plate.filter(l => S.byId[l.item]).map(l => {
    const m = S.byId[l.item], who = guestOf(l.guest);
    const set = async q => { try { S.snap = await api('PUT', `/api/session/plate/${encodeURIComponent(l.item)}/${encodeURIComponent(l.guest)}`, { qty: q }); onSnap(); } catch (e) { if (e.status === 410) return renderEnded(); toast(errMsg(e), 'bad'); } };
    return h('div', { class: 'line' }, h('div', { class: 'thumb', style: `background:${S.catById[m.cat]?.color || '#FFC531'}` }, visualEl({ ...m, anim: 'none' })),
      h('div', { class: 'l-mid' }, h('b', { text: m.name }), h('small', {}, h('span', { class: 'dot', style: `background:${nickColor(who.nick)}` }), `added by ${l.guest === me.id ? 'you' : who.nick}`), h('span', { class: 'l-price', text: inr(m.price * l.qty) })),
      h('div', { class: 'stepper sm' }, h('button', { 'aria-label': 'Less ' + m.name, onclick: () => set(l.qty - 1), text: '−' }), h('span', { class: 'qn', text: String(l.qty) }), h('button', { 'aria-label': 'More ' + m.name, onclick: () => set(l.qty + 1), text: '+' })));
  });
  const body = h('div', { class: 'sh-body' });
  if (!rows.length) body.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, visualEl({ image: firstPhoto(), anim: 'none' })), h('p', { text: 'Your plate is empty. Swipe the menu and tap “Add to plate”.' })));
  else {
    body.append(...rows);
    for (const fr of b.freebies) { const m = S.byId[fr.item]; if (m) body.append(h('div', { class: 'line free' }, h('div', { class: 'thumb', style: `background:${S.catById[m.cat]?.color || '#8DBBFF'}` }, visualEl({ ...m, anim: 'none' })), h('div', { class: 'l-mid' }, h('b', { text: m.name }), h('small', { text: 'On the house, for a plate over ' + inr(b.offersUsed.free.at) }), h('span', { class: 'l-price', text: 'Free' })))); }
    if (b.nudge) body.append(h('div', { class: 'nudge' }, h('p', {}, 'Add ', h('b', { text: inr(b.nudge.need) }), ` more for ${b.nudge.reward}.`), h('div', { class: 'bar' }, h('span', { style: `width:${Math.min(100, b.subtotal / b.nudge.at * 100).toFixed(1)}%` }))));
    const bl = h('div', { class: 'bill' }, h('div', {}, h('span', { text: 'Items' }), h('span', { text: inr(b.subtotal) })));
    for (const o of b.offers.filter(o => o.amount)) bl.append(h('div', { class: 'disc' }, h('span', { text: o.label }), h('span', { text: '−' + inr(-o.amount) })));
    bl.append(h('div', {}, h('span', { text: `GST ${b.offersUsed.gst}%` }), h('span', { text: inr(b.gst) })), h('div', { class: 'tot' }, h('span', { text: "You'll pay" }), h('span', { text: inr(b.total) })));
    const note = h('textarea', { class: 'note', maxlength: '140', rows: '2', placeholder: 'Cooking note for the kitchen (less spicy, no onion…)' }); note.value = G.noteVal || ''; note.addEventListener('input', () => G.noteVal = note.value);
    body.append(bl, note);
  }
  const place = h('button', { class: 'btn-big wide', disabled: !rows.length, onclick: placeOrder }, rows.length ? `Place order  ${inr(b.total)}` : 'Place order');
  G.sheetPlate.replaceChildren(sheetHead(`Table ${S.table}'s plate`, 'Everyone at this table sees and edits the same plate. Tap your name to spin a new one.'), h('div', { class: 'people' }, people), body, h('div', { class: 'sh-foot' }, place));
}
async function placeOrder() {
  const btn = G.sheetPlate.querySelector('.sh-foot button'); btn.disabled = true; btn.textContent = 'Sending…';
  G.idem = G.idem || crypto.randomUUID();   // same key if the request is retried, so it can never be placed twice
  try { const r = await api('POST', '/api/session/orders', { note: G.noteVal || '' }, { headers: { 'Idempotency-Key': G.idem } }); G.idem = null; G.noteVal = ''; S.snap = r.session; G.seen[r.order.id] = r.order.status; closeSheets(); onSnap(); celebrate(); }
  catch (e) { if (e.status === 410) return renderEnded(); if (e.status !== 0) G.idem = null; toast(errMsg(e), 'bad'); renderPlateSheet(); }
}
function celebrate() {
  const c = h('div', { class: 'sent', role: 'status' }, visualEl({ image: firstPhoto(), anim: 'spin' }, 'sent-vis'), h('h3', { class: 'display', text: 'Sent to the kitchen' }), h('p', { text: 'A staff member confirms it in a moment. Track it under your orders.' }));
  app.append(c); setTimeout(() => c.classList.add('out'), 2400); setTimeout(() => c.remove(), 2900);
}
const STEPS = [['pending', 'Waiting for staff'], ['cooking', 'Cooking'], ['ready', 'Ready'], ['served', 'Served']];
function renderOrdersSheet() {
  const os = S.snap.orders, body = h('div', { class: 'sh-body' });
  if (!os.length) body.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, visualEl({ image: 'd:s1', anim: 'none' })), h('p', { text: "No orders yet. Your table's orders show up here with live status." })));
  for (const o of os) {
    const idx = STEPS.findIndex(s => s[0] === o.status);
    body.append(h('div', { class: 'ocard' + (o.status === 'rejected' ? ' rej' : '') },
      h('div', { class: 'o-top' }, h('b', { text: `${o.byEmoji || ''} ${o.by}`.trim() }), h('span', { text: ago(o.createdAt) })),
      h('ul', {}, o.items.map(it => h('li', {}, h('span', { text: `${it.qty}× ${it.name}` }), h('span', { text: it.free ? 'Free' : inr(it.price * it.qty) })))),
      o.status === 'rejected' ? h('p', { class: 'rej-t', text: 'Not accepted by the kitchen. Your server will come over.' }) : h('ol', { class: 'track-steps' }, STEPS.map((s, k) => h('li', { class: k < idx ? 'done' : k === idx ? 'now' : '' }, h('span', { text: s[1] })))),
      h('div', { class: 'o-tot' }, h('span', { text: 'Total' }), h('b', { text: inr(o.bill.total) }))));
  }
  const running = os.filter(o => o.status !== 'rejected').reduce((a, o) => a + o.bill.total, 0);
  const call = async type => { try { await api('POST', '/api/session/call', { type }); toast(type === 'bill' ? 'Your server is bringing the bill.' : 'Your server is on the way.'); } catch (e) { toast(errMsg(e), 'bad'); } };
  G.sheetOrders.replaceChildren(sheetHead('Your orders', `Running bill for table ${S.table}: ${inr(running)}`), body,
    h('div', { class: 'sh-foot two' }, h('button', { class: 'btn-ghost', onclick: renderBillPage, text: 'View bill' }), h('button', { class: 'btn-big', onclick: () => call('bill'), text: 'Ask for bill' })));
}
// Exposed for tests: preview the bill the same way the server computes it.
window.__previewBill = lines => priceBill(lines, S.byId, S.menu?.offers);
boot();
