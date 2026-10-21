// Drawn illustrations (procedural SVG) used for drinks and desserts, plus icon data.
const I = (e, l) => ({ e, l });
// ---- FOOD ART (procedural SVG cutouts) ----
let __uid = 0; const uid = p => p + (++__uid) + Math.random().toString(36).slice(2, 6);
function rng(seed) { let a = 0; for (const c of seed) a = (a * 31 + c.charCodeAt(0)) | 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const TOP = {
  corn: (x, y, r) => `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="3.2" transform="rotate(${r} ${x} ${y})" fill="#FFD23F" stroke="#D9A100" stroke-width="1"/>`,
  chicken: (x, y, r) => `<g transform="rotate(${r} ${x} ${y})"><rect x="${x - 7}" y="${y - 5}" width="14" height="10" rx="4" fill="#9C4F24"/><rect x="${x - 4}" y="${y - 3}" width="7" height="3" rx="1.5" fill="#C9773D"/><rect x="${x - 6}" y="${y + 1}" width="5" height="2" rx="1" fill="#6E3312"/></g>`,
  paneer: (x, y, r) => `<g transform="rotate(${r} ${x} ${y})"><rect x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" rx="2" fill="#FFF8EC" stroke="#E5CFA6" stroke-width="1"/><path d="M${x - 4} ${y - 1}h8" stroke="#C7833A" stroke-width="1.6" stroke-linecap="round"/></g>`,
  basil: (x, y, r) => `<path d="M${x - 8} ${y}q8 -8 16 0q-8 8 -16 0z" transform="rotate(${r} ${x} ${y})" fill="#2F8F3A"/>`,
  tomato: (x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="#D8322B"/><circle cx="${x}" cy="${y}" r="6.3" fill="#F25B4B"/><circle cx="${x - 2}" cy="${y - 1}" r="1.2" fill="#FFE1A8"/><circle cx="${x + 2.5}" cy="${y + 1.5}" r="1.2" fill="#FFE1A8"/>`,
  capsicum: (x, y, r) => `<path d="M${x - 7} ${y + 3}q7 -11 14 0" transform="rotate(${r} ${x} ${y})" stroke="#23914A" stroke-width="3.4" fill="none" stroke-linecap="round"/>`,
  onion: (x, y, r) => `<path d="M${x - 7} ${y + 2}q7 -9 14 0" transform="rotate(${r} ${x} ${y})" stroke="#A8448F" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  mushroom: (x, y, r) => `<g transform="rotate(${r} ${x} ${y})"><path d="M${x - 8} ${y + 1}q8 -12 16 0z" fill="#CFA987"/><rect x="${x - 2.5}" y="${y}" width="5" height="6" rx="1.5" fill="#F1DEC6"/></g>`,
  olive: (x, y) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#2C2A3A"/><circle cx="${x}" cy="${y}" r="1.8" fill="#6B5D7A"/>`,
  jalapeno: (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="#3FAE4C"/><circle cx="${x}" cy="${y}" r="2.6" fill="#B9E37A"/>`,
};
export function pizzaSVG(item) {
  const id = uid('pz'), R = rng(item.id);
  const sauce = item.sauce || '#D8432E';
  let cheese = '';
  for (let i = 0; i < 16; i++) { const a = R() * 6.283, d = Math.sqrt(R()) * 64; cheese += `<circle cx="${100 + Math.cos(a) * d}" cy="${100 + Math.sin(a) * d}" r="${11 + R() * 11}" fill="#FFE38F" opacity=".85"/>`; }
  let tops = '';
  for (const t of item.toppings || []) { const n = t === 'tomato' ? 6 : t === 'basil' ? 7 : 11; for (let i = 0; i < n; i++) { const a = R() * 6.283, d = 12 + Math.sqrt(R()) * 60; tops += (TOP[t] || TOP.olive)(+(100 + Math.cos(a) * d).toFixed(1), +(100 + Math.sin(a) * d).toFixed(1), Math.round(R() * 360)); } }
  let cuts = ''; for (let k = 0; k < 6; k++) { const a = (k * 60 + 30) * Math.PI / 180; cuts += `<line x1="100" y1="100" x2="${100 + Math.cos(a) * 92}" y2="${100 + Math.sin(a) * 92}" stroke="#7A3A12" stroke-opacity=".28" stroke-width="1.6"/>`; }
  const w1 = (a) => [100 + Math.cos(a * Math.PI / 180) * 110, 100 + Math.sin(a * Math.PI / 180) * 110];
  const [ax, ay] = w1(-30), [bx, by] = w1(30);
  return `<svg viewBox="-14 -14 228 228" class="art pizza" aria-hidden="true"><defs>
<radialGradient id="${id}c" cx="50%" cy="45%" r="55%"><stop offset="70%" stop-color="#F4C072"/><stop offset="100%" stop-color="#C47A2C"/></radialGradient>
<clipPath id="${id}w"><path d="M100 100L${ax} ${ay}L${bx} ${by}z"/></clipPath>
<clipPath id="${id}r"><path d="M100 100L${bx} ${by}L-20 220L-20 -20L${ax} ${ay}z"/></clipPath>
<g id="${id}g"><circle cx="100" cy="100" r="96" fill="url(#${id}c)"/><circle cx="100" cy="100" r="84" fill="${sauce}"/><circle cx="100" cy="100" r="80" fill="#FFD66B" opacity=".55"/>${cheese}${tops}${cuts}</g></defs>
<g class="spin"><use href="#${id}g" clip-path="url(#${id}r)"/><g class="slice"><use href="#${id}g" clip-path="url(#${id}w)"/></g></g></svg>`;
}
export function burgerSVG(item) {
  const R = rng(item.id), id = uid('bg');
  const L = { bunb: 22, patty: 20, crispy: 22, paneer: 18, tikki: 20, cheese: 7, tomato: 8, lettuce: 10, onion: 6, sauce: 5 };
  let y = 178, body = '';
  const layers = [...(item.layers || [])].reverse(); // bottom-up
  body += `<path d="M38 ${y - 22}h124q6 0 6 6v4q0 12-16 12h-104q-16 0-16-12v-4q0-6 6-6z" fill="#E39A45"/>`; y -= 22;
  for (const l of layers) {
    const hgt = L[l] || 8; y -= hgt;
    if (l === 'patty' || l === 'tikki') body += `<rect x="30" y="${y}" width="140" height="${hgt}" rx="${hgt / 2}" fill="${l === 'tikki' ? '#B8742E' : '#5E2E16'}"/><path d="M42 ${y + 6}h30M96 ${y + 11}h40" stroke="${l === 'tikki' ? '#D99A4E' : '#7E4122'}" stroke-width="3" stroke-linecap="round"/>`;
    else if (l === 'crispy') { let b = ''; for (let i = 0; i < 9; i++) b += `<circle cx="${34 + i * 16.5}" cy="${y + (i % 2 ? 4 : 18)}" r="6" fill="#D88A2E"/>`; body += `<rect x="28" y="${y + 2}" width="144" height="${hgt - 4}" rx="9" fill="#E59B3A"/>${b}`; }
    else if (l === 'paneer') body += `<rect x="34" y="${y}" width="132" height="${hgt}" rx="5" fill="#FFF3DC" stroke="#E2C493"/><path d="M50 ${y + 9}h24M92 ${y + 9}h24M132 ${y + 9}h20" stroke="#C7652E" stroke-width="3" stroke-linecap="round"/>`;
    else if (l === 'cheese') body += `<path d="M30 ${y}h140l-14 ${hgt + 9}-10-${hgt + 4}-16 ${hgt + 12}-12-${hgt + 10}-30 ${hgt + 2}-14-${hgt}-20 ${hgt + 10}-10-${hgt + 6}z" fill="#FFC72C"/>`;
    else if (l === 'tomato') body += `<rect x="40" y="${y}" width="56" height="${hgt}" rx="4" fill="#E23B2E"/><rect x="104" y="${y}" width="58" height="${hgt}" rx="4" fill="#E23B2E"/>`;
    else if (l === 'lettuce') { let d = `M26 ${y + hgt}`; for (let i = 0; i <= 12; i++) d += `q6 ${i % 2 ? -12 : 4} 12.4 0`; body += `<path d="${d}v4h-150z" fill="#55B947"/>`; }
    else if (l === 'onion') body += `<rect x="36" y="${y}" width="128" height="${hgt}" rx="3" fill="#F3D7F0" stroke="#B04A9E"/>`;
    else if (l === 'sauce') body += `<rect x="32" y="${y}" width="136" height="${hgt}" rx="2.5" fill="${item.sauceColor || '#E8572F'}"/>`;
  }
  let seeds = ''; for (let i = 0; i < 14; i++) { const sx = 56 + R() * 88, sy = y - 44 + R() * 30; seeds += `<ellipse cx="${sx}" cy="${sy}" rx="3" ry="1.6" transform="rotate(${R() * 60 - 30} ${sx} ${sy})" fill="#FFF1D2"/>`; }
  const top = `<defs><linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7B862"/><stop offset="1" stop-color="#D47F2C"/></linearGradient></defs><path d="M26 ${y}q0-${62} 74-${62}q74 0 74 ${62}q0 6-6 6h-136q-6 0-6-6z" fill="url(#${id}t)"/><path d="M52 ${y - 40}q22-16 46-14" stroke="#FFE2AE" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>${seeds}`;
  return `<svg viewBox="0 0 200 200" class="art burger" aria-hidden="true"><g class="bob">${body}${top}</g></svg>`;
}
export function drinkSVG(item) {
  const id = uid('dr'), c1 = item.c1 || '#FFB627', c2 = item.c2 || '#FF8A00';
  let g = '';
  if (item.garnish === 'lemon') g = `<g transform="translate(138 42)"><circle r="22" fill="#FFE25C"/><circle r="17" fill="#FFF3A8"/><path d="M0 -17V17M-17 0H17M-12 -12L12 12M12 -12L-12 12" stroke="#FFE25C" stroke-width="2.4"/></g><path d="M58 54q8-14 20-12q-4 12-20 12z" fill="#3BAA4E"/>`;
  else if (item.garnish === 'mango') g = `<rect x="128" y="28" width="22" height="22" rx="5" fill="#FF9F1C" transform="rotate(18 139 39)"/><circle cx="96" cy="60" r="3" fill="#7A9A3A"/><circle cx="104" cy="58" r="2.6" fill="#7A9A3A"/>`;
  else if (item.garnish === 'cream') g = `<path d="M62 64q-6-22 18-24q2-18 22-14q16-8 24 10q20 2 14 28z" fill="#FFF7EC"/><circle cx="104" cy="30" r="3" fill="#6B3A1E"/><circle cx="94" cy="40" r="2.4" fill="#6B3A1E"/>`;
  else if (item.garnish === 'berry') g = `<circle cx="140" cy="44" r="10" fill="#C2185B"/><circle cx="128" cy="38" r="8" fill="#8E1E5A"/><path d="M60 54q8-14 20-12q-4 12-20 12z" fill="#3BAA4E"/>`;
  let ice = ''; if (item.ice) ice = `<rect x="74" y="88" width="20" height="20" rx="4" fill="#fff" opacity=".45" transform="rotate(14 84 98)"/><rect x="104" y="100" width="18" height="18" rx="4" fill="#fff" opacity=".38" transform="rotate(-10 113 109)"/>`;
  let fizz = ''; if (item.fizz) { const R = rng(item.id); for (let i = 0; i < 10; i++) fizz += `<circle class="fizz fz${i % 4}" cx="${70 + R() * 60}" cy="${110 + R() * 60}" r="${1.5 + R() * 2.5}" fill="#fff" opacity=".7"/>`; }
  return `<svg viewBox="0 0 200 200" class="art drink" aria-hidden="true"><defs><linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><clipPath id="${id}k"><path d="M56 56h88l-12 128q-1 8-9 8h-46q-8 0-9-8z"/></clipPath></defs>
<path d="M124 14l-22 60" stroke="${item.straw || '#FF4D8D'}" stroke-width="7" stroke-linecap="round"/>
<g clip-path="url(#${id}k)"><rect x="40" y="${item.fill || 66}" width="120" height="140" fill="url(#${id}l)"/>${ice}${fizz}</g>
<path d="M56 56h88l-12 128q-1 8-9 8h-46q-8 0-9-8z" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-opacity=".85" stroke-width="3.5"/>
<path d="M66 70l8 104" stroke="#fff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/>${g}</svg>`;
}
export function friesSVG(item) {
  const R = rng(item.id); let f = '';
  for (let i = 0; i < 13; i++) { const x = 56 + i * 7.3, h = 50 + R() * 40, r = (R() - .5) * 18; f += `<rect x="${x}" y="${120 - h}" width="10" height="${h + 20}" rx="3" fill="${i % 3 ? '#FFC93C' : '#F4B023'}" transform="rotate(${r} ${x + 5} 120)"/>`; if (item.dust) f += `<circle cx="${x + 5}" cy="${120 - h + 10}" r="1.8" fill="#C62828"/>`; }
  return `<svg viewBox="0 0 200 200" class="art fries" aria-hidden="true"><g class="bob">${f}<path d="M46 104h108l-14 84h-80z" fill="#E53935"/><path d="M46 104q54 28 108 0" fill="#C62828"/><path d="M84 140q16 14 32 0" stroke="#FFD23F" stroke-width="7" fill="none" stroke-linecap="round"/></g></svg>`;
}
export function breadSVG() {
  let s = ''; for (let i = 0; i < 4; i++) { const x = 30 + i * 36, y = 70 + (i % 2) * 18; s += `<g transform="rotate(${-14 + i * 9} ${x + 30} ${y + 30})"><rect x="${x}" y="${y}" width="62" height="70" rx="22" fill="#E8A54B"/><rect x="${x + 6}" y="${y + 6}" width="50" height="58" rx="18" fill="#FFE7A6"/><path d="M${x + 14} ${y + 24}q8-6 16 0t18 0M${x + 12} ${y + 42}q10-6 20 0t16 0" stroke="#4E9A3E" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="${x + 22}" cy="${y + 34}" r="3" fill="#FFF8E7"/></g>`; }
  return `<svg viewBox="0 0 200 200" class="art bread" aria-hidden="true"><g class="bob">${s}</g></svg>`;
}
export function lavaSVG() {
  return `<svg viewBox="0 0 200 200" class="art lava" aria-hidden="true"><g class="bob"><ellipse cx="100" cy="166" rx="84" ry="18" fill="#FFF6E6"/><path d="M50 84q0-14 50-14t50 14v62q0 16-50 16t-50-16z" fill="#4A2412"/><ellipse cx="100" cy="84" rx="50" ry="14" fill="#6B3519"/><path d="M92 82q-6 30-2 46q4 12 10 0q2-16 0-26q6 26 14 34q6 4 6-8q-6-28-14-46z" fill="#3A1408" opacity=".9"/><path d="M78 80q22 20 44 0" fill="#2A0E05"/><g fill="#fff">${[64, 80, 98, 116, 132, 88, 108].map((x, i) => `<circle cx="${x}" cy="${78 + (i % 3) * 4}" r="2"/>`).join('')}</g><circle cx="132" cy="64" r="9" fill="#E3253B"/><path d="M132 55q4-12 12-14" stroke="#2F7D32" stroke-width="2.4" fill="none"/></g></svg>`;
}
export function sundaeSVG() {
  return `<svg viewBox="0 0 200 200" class="art sundae" aria-hidden="true"><g class="bob"><circle cx="76" cy="78" r="28" fill="#FFF3D6"/><circle cx="124" cy="78" r="28" fill="#FFB0CF"/><circle cx="100" cy="56" r="28" fill="#8B5232"/><path d="M76 44q24 18 48 0q-4 22-24 26q-20-4-24-26z" fill="#4A2412"/><circle cx="100" cy="24" r="9" fill="#E3253B"/><path d="M48 96h104l-22 50q-30 12-60 0z" fill="#fff" fill-opacity=".25" stroke="#fff" stroke-width="3.5"/><rect x="94" y="146" width="12" height="24" fill="#fff" fill-opacity=".6"/><ellipse cx="100" cy="174" rx="34" ry="8" fill="#fff" fill-opacity=".7"/></g></svg>`;
}
export function artFor(item) {
  return ({ pizza: pizzaSVG, burger: burgerSVG, drink: drinkSVG, fries: friesSVG, bread: breadSVG, lava: lavaSVG, sundae: sundaeSVG }[item.art] || pizzaSVG)(item);
}
// ingredient icons
export const ING = {
  corn: ['🌽', 'Corn'], cheese: ['🧀', 'Cheese'], chicken: ['🍗', 'Chicken'], paneer: ['', 'Paneer'], tomato: ['🍅', 'Tomato'], basil: ['🌿', 'Basil'],
  onion: ['🧅', 'Onion'], capsicum: ['🫑', 'Capsicum'], mushroom: ['🍄', 'Mushroom'], chilli: ['🌶️', 'Chilli'], olive: ['🫒', 'Olives'], jalapeno: ['🌶️', 'Jalapeño'],
  potato: ['🥔', 'Aloo tikki'], lettuce: ['🥬', 'Lettuce'], bun: ['🍞', 'Brioche bun'], mango: ['🥭', 'Alphonso mango'], curd: ['🥛', 'Curd'], cardamom: ['🫛', 'Cardamom'],
  coffee: ['☕', 'Coffee'], milk: ['🥛', 'Milk'], icecream: ['🍨', 'Ice cream'], lemon: ['🍋', 'Lemon'], mint: ['🌿', 'Mint'], masala: ['🧂', 'Chaat masala'], soda: ['🫧', 'Soda'],
  berry: ['🫐', 'Berries'], garlic: ['🧄', 'Garlic'], butter: ['🧈', 'Butter'], chocolate: ['🍫', 'Dark chocolate'], cherry: ['🍒', 'Cherry'], peri: ['🌶️', 'Peri peri'], vanilla: ['🍦', 'Vanilla'], strawberry: ['🍓', 'Strawberry'],
  makhani: ['🍲', 'Makhani sauce'], tikka: ['🔥', 'Tikka spice'],
};
export const PANEER_ICON = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 9l8-4 8 4v7l-8 4-8-4z" fill="#FFF8EC" stroke="#D9B98A" stroke-width="1.3"/><path d="M4 9l8 4 8-4M12 13v7" stroke="#D9B98A" stroke-width="1.3" fill="none"/><path d="M7 11.5l3 1.4" stroke="#C7833A" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export const DRAWN = {
  d1: { id: 'd1', art: 'drink', c1: '#FFD24D', c2: '#FF9F1C', garnish: 'mango', straw: '#3FA34D', fill: 70, label: 'Mango drink' },
  d2: { id: 'd2', art: 'drink', c1: '#C9915E', c2: '#7A4A26', garnish: 'cream', straw: '#FF4D8D', ice: true, fill: 72, label: 'Coffee drink' },
  d3: { id: 'd3', art: 'drink', c1: '#F7F3A1', c2: '#D6E85A', garnish: 'lemon', straw: '#FF4D8D', ice: true, fizz: true, fill: 64, label: 'Lemonade' },
  d4: { id: 'd4', art: 'drink', c1: '#FF7AB6', c2: '#B0186A', garnish: 'berry', straw: '#FFD23F', ice: true, fizz: true, fill: 66, label: 'Berry cooler' },
  d5: { id: 'd5', art: 'drink', c1: '#8FE3FF', c2: '#2F8FD8', garnish: 'lemon', straw: '#FFD23F', ice: true, fizz: true, fill: 62, label: 'Blue soda' },
  x1: { id: 'x1', art: 'lava', label: 'Lava cake' },
  x2: { id: 'x2', art: 'sundae', label: 'Sundae' },
  s1: { id: 's1', art: 'fries', dust: true, label: 'Fries' },
  s2: { id: 's2', art: 'bread', label: 'Garlic bread' },
};
export const ING_LIB = [I('🧀', 'Cheese'), I('🍗', 'Chicken'), I('🌽', 'Corn'), I('🍅', 'Tomato'), I('🧅', 'Onion'), I('🫑', 'Capsicum'), I('🍄', 'Mushroom'), I('🌶️', 'Chilli'), I('🫒', 'Olives'), I('🥬', 'Lettuce'), I('🥔', 'Potato'), I('🧄', 'Garlic'), I('🌿', 'Herbs'), I('🍋', 'Lemon'), I('🥛', 'Milk'), I('🧈', 'Butter'), I('🍚', 'Rice'), I('🥚', 'Egg'), I('🐟', 'Fish'), I('🍤', 'Prawn'), I('🥩', 'Mutton'), I('🍫', 'Chocolate'), I('🥭', 'Mango'), I('🍓', 'Strawberry'), I('paneer', 'Paneer'), I('🫘', 'Beans'), I('🥕', 'Carrot'), I('🥦', 'Broccoli')];
export const CAT_COLORS = ['#FFC531', '#FF7A59', '#3FD1A0', '#FFB48A', '#C6E85A', '#5FD4D8', '#8DBBFF', '#FF9BCB', '#B79CFF', '#F7A1A1'];
