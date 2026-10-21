// Renders a dish picture: uploaded photo (/img/...) or a drawn illustration (d:...).
import { h } from './lib.js';
import { artFor, DRAWN } from './art.js';
export function imgUrl(src) {
  if (!src) return '';
  if (/^\/img\/[a-f0-9]{32,64}$/.test(src)) return src;
  if (/^blob:/.test(src) || /^data:image\/(png|jpeg|webp);base64,/.test(src)) return src;
  return '';
}
export function visualEl(item, extra = '') {
  const w = h('div', { class: `vis anim-${item.anim || 'none'} ${extra}` }); const src = item.image || '';
  if (src.startsWith('d:')) { w.innerHTML = artFor(DRAWN[src.slice(2)] || DRAWN.d3); w.classList.add('drawn'); }
  else { const u = imgUrl(src); if (u) { const im = new Image(); im.alt = ''; im.decoding = 'async'; im.draggable = false; im.src = u; w.append(im); } else { w.classList.add('noimg'); w.append(h('span', { text: '🍽️' })); } }
  return w;
}
export const ingIcon = x => x.e === 'paneer' ? h('span', { class: 'ing-ic', html: PANEER }) : h('span', { class: 'ing-ic', text: x.e });
const PANEER = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 9l8-4 8 4v7l-8 4-8-4z" fill="#FFF8EC" stroke="#D9B98A" stroke-width="1.3"/><path d="M4 9l8 4 8-4M12 13v7" stroke="#D9B98A" stroke-width="1.3" fill="none"/><path d="M7 11.5l3 1.4" stroke="#C7833A" stroke-width="1.6" stroke-linecap="round"/></svg>';
