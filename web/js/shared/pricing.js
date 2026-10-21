// Pricing engine shared by the browser (bill preview) and the server (the amount
// actually charged). The server never trusts prices or totals sent by a phone.
export const DEFAULT_OFFERS = Object.freeze({ gst: 5, free: { on: true, at: 1000, item: 'd3' }, combo: { on: true, a: 'burgers', b: 'sips', off: 40 }, big: { on: true, at: 2000, pct: 10 } });

export function normOffers(o) {
  const d = DEFAULT_OFFERS; o = o || {};
  const n = (val, lo, hi, def) => { val = Number(val); return Number.isFinite(val) ? Math.max(lo, Math.min(hi, Math.round(val))) : def; };
  return {
    gst: n(o.gst, 0, 28, d.gst),
    free: { on: o.free ? !!o.free.on : d.free.on, at: n(o.free?.at, 0, 1e6, d.free.at), item: String(o.free?.item ?? d.free.item) },
    combo: { on: o.combo ? !!o.combo.on : d.combo.on, a: String(o.combo?.a ?? d.combo.a), b: String(o.combo?.b ?? d.combo.b), off: n(o.combo?.off, 0, 1e5, d.combo.off) },
    big: { on: o.big ? !!o.big.on : d.big.on, at: n(o.big?.at, 0, 1e7, d.big.at), pct: n(o.big?.pct, 0, 90, d.big.pct) },
  };
}

/** @param lines [{item, qty}]  @param byId {id: {id,name,price,cat}}  @param offersIn offers config */
export function priceBill(lines, byId, offersIn) {
  const O = normOffers(offersIn);
  let subtotal = 0, ca = 0, cb = 0; const clean = [];
  for (const l of lines || []) {
    const m = byId[l.item]; const q = Math.max(0, Math.min(50, Math.floor(Number(l.qty) || 0)));
    if (!m || !q) continue;
    const price = Math.max(0, Math.round(Number(m.price) || 0));
    subtotal += price * q; if (m.cat === O.combo.a) ca += q; if (m.cat === O.combo.b) cb += q;
    clean.push({ item: l.item, qty: q });
  }
  const offers = [];
  const pairs = O.combo.on && O.combo.a !== O.combo.b ? Math.min(ca, cb) : 0;
  const combo = Math.min(subtotal, pairs * O.combo.off);
  if (combo) offers.push({ id: 'combo', label: `Combo deal ×${pairs}`, amount: -combo });
  let big = 0;
  if (O.big.on && O.big.pct && subtotal >= O.big.at) { big = Math.round((subtotal - combo) * O.big.pct / 100); offers.push({ id: 'big', label: `Big plate ${O.big.pct}% off`, amount: -big }); }
  const freebies = []; const fItem = byId[O.free.item];
  if (O.free.on && fItem && subtotal > 0 && subtotal >= O.free.at) { freebies.push({ item: fItem.id, qty: 1 }); offers.push({ id: 'free', label: `Free ${fItem.name}`, amount: 0 }); }
  const taxable = Math.max(0, subtotal - combo - big), gst = Math.round(taxable * O.gst / 100), total = taxable + gst;
  const goals = [];
  if (O.free.on && fItem) goals.push({ at: O.free.at, reward: 'a free ' + fItem.name });
  if (O.big.on && O.big.pct) goals.push({ at: O.big.at, reward: `${O.big.pct}% off the whole plate` });
  goals.sort((a, b) => a.at - b.at);
  const next = subtotal > 0 ? goals.find(g => subtotal < g.at) : null;
  return { lines: clean, subtotal, combo, big, offers, freebies, taxable, gst, total, nudge: next ? { need: next.at - subtotal, reward: next.reward, at: next.at } : null, offersUsed: O };
}
