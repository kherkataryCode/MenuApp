// k6 load test: a dinner rush. Run against STAGING, never production.
//   Staging server needs RATE_LIMIT_MULTIPLIER=100 (all virtual users share your IP).
//   k6 run -e BASE=https://staging.example.com -e ADMIN_USER=owner -e ADMIN_PASS=... tests/load/guest-flow.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: { rush: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: 60 }, { duration: '3m', target: 60 }, { duration: '30s', target: 0 }] } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<300'] },
};
const BASE = __ENV.BASE || 'http://localhost:8080';
const TABLES = Number(__ENV.TABLES || 10);

export function setup() {
  const jar = http.cookieJar();
  const login = http.post(`${BASE}/api/admin/login`, JSON.stringify({ username: __ENV.ADMIN_USER, password: __ENV.ADMIN_PASS }), { headers: { 'Content-Type': 'application/json' } });
  check(login, { 'admin login': r => r.status === 200 });
  const csrf = login.json('csrf'); const codes = {};
  for (let n = 1; n <= TABLES; n++) {
    http.post(`${BASE}/api/admin/tables/${n}/close`, '{}', { headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf } });
    const r = http.post(`${BASE}/api/admin/tables/${n}/open`, '{}', { headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf } });
    codes[n] = r.json('code');
  }
  void jar; return { codes, items: http.get(`${BASE}/api/menu`).json('items').filter(i => i.available).map(i => i.id) };
}

const H = { 'Content-Type': 'application/json', 'x-hm': '1' };
export default function (data) {
  const table = 1 + (__VU % TABLES);
  http.get(`${BASE}/api/menu`);
  const j = http.post(`${BASE}/api/tables/${table}/join`, JSON.stringify({ code: data.codes[table] }), { headers: H });
  check(j, { joined: r => r.status === 200 });
  for (let i = 0; i < 3; i++) {
    const item = data.items[Math.floor(Math.random() * data.items.length)];
    check(http.post(`${BASE}/api/session/plate`, JSON.stringify({ item, delta: 1 }), { headers: H }), { 'added to plate': r => r.status === 200 });
    sleep(1 + Math.random() * 2);
  }
  check(http.get(`${BASE}/api/session`), { 'session ok': r => r.status === 200 });
  if (Math.random() < 0.3) http.post(`${BASE}/api/session/orders`, '{}', { headers: { ...H, 'Idempotency-Key': `${__VU}-${__ITER}` } });
  sleep(2);
}
