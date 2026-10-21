// Small browser helpers shared by the guest app and the admin app.
export const $ = (s, r = document) => r.querySelector(s);
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (k === 'class') e.className = val; else if (k === 'text') e.textContent = val; else if (k === 'html') e.innerHTML = val;
    else if (k === 'style') e.style.cssText = val;                     // CSSOM: allowed under our strict CSP
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), val);
    else if (k === 'value') e.value = val; else if (k === 'checked') e.checked = !!val;
    else e.setAttribute(k, val === true ? '' : val);
  }
  for (const k of kids.flat(3)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
export const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000 | 0); return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
export const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function toast(msg, kind) {
  const host = document.querySelector('#app') || document.body;
  const t = h('div', { class: 'toast ' + (kind || ''), role: 'status', text: msg }); host.append(t);
  setTimeout(() => t.classList.add('out'), 2800); setTimeout(() => t.remove(), 3300);
}

let csrf = '';
export const setCsrf = t => { csrf = t || ''; };
export class ApiError extends Error { constructor(status, data) { super(data.message || `Request failed (${status})`); this.status = status; this.code = data.error; this.retryAfter = data.retryAfter; } }
export async function api(method, url, body, { raw, headers = {} } = {}) {
  const hd = { 'x-hm': '1', ...headers };
  if (csrf) hd['x-csrf-token'] = csrf;
  let payload = body;
  if (body !== undefined && !raw) { hd['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, { method, credentials: 'same-origin', headers: hd, body: payload }); }
  catch { throw new ApiError(0, { error: 'offline', message: "You're offline. Check your connection and try again." }); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) throw new ApiError(res.status, data || {});
  return data ?? res;
}

// Live updates over Server-Sent Events. The browser reconnects by itself; if the
// server refuses the stream (session ended / signed out) we call onFail instead.
export function live(url, handlers) {
  let es, closed = false, backoff = 1000, timer;
  const connect = () => {
    if (closed) return; es = new EventSource(url, { withCredentials: true });
    es.addEventListener('hello', () => { backoff = 1000; handlers.open?.(); });
    for (const [name, fn] of Object.entries(handlers)) if (!['open', 'fail', 'resync'].includes(name)) es.addEventListener(name, ev => { let d = {}; try { d = JSON.parse(ev.data || '{}'); } catch { } fn(d); });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) { es.close(); handlers.fail?.(); clearTimeout(timer); timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); } };
  };
  const vis = () => { if (document.visibilityState === 'visible') handlers.resync?.(); };
  document.addEventListener('visibilitychange', vis); connect();
  return { close() { closed = true; clearTimeout(timer); es?.close(); document.removeEventListener('visibilitychange', vis); } };
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
