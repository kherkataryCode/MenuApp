# Testing

| Suite | Command | What it covers | Time |
|---|---|---|---|
| Unit | `npm run test:unit` | Pricing engine (offers, GST, thresholds, clamping), funny-name uniqueness, password hashing, guest-token signing and tampering, rate limiter, input validation, client-IP handling behind proxies | ~1 s |
| Integration | `npm run test:integration` | The real server on a random port, driven over HTTP: every critical flow below | ~3 s |
| End-to-end | `npm run test:e2e` | Real Chromium: an admin and a phone-sized guest running a full service side by side | ~20 s |
| Load | `npm run test:load` | k6 "dinner rush" against a staging server | 5 min |

`npm test` runs unit + integration. CI (`.github/workflows/ci.yml`) runs unit, integration and e2e on SQLite, integration again on a real PostgreSQL 16, then builds the Docker image and checks it boots.

## What the integration suite proves

- Health and readiness, pages, security headers, menu ETag/304, immutable photo caching, path traversal refused.
- Staff sign-in: wrong password refused, cookie flags (HttpOnly, SameSite=Strict), forged CSRF token refused, weak passwords refused, owner vs staff permissions, lockout after 5 misses, other staff on the same IP not locked out.
- Full guest flow: wrong code refused, missing anti-CSRF header refused, two guests join with different funny names, both add to one plate, one edits the other's line, combo applied, injected prices ignored, totals computed on the server, plate cleared after ordering, retry with the same idempotency key returns the same order, invalid kitchen transitions refused, valid ones accepted, call-for-bill shown to staff, empty plate refused.
- Closing a table: every guest cookie stops working instantly (410), orders settle, the old code fails after reopening, the old cookie doesn't carry into the new seating, CSV export contains the order.
- Prank protection: closed tables refuse joins, rotated codes invalidate old ones, join brute-force gets rate limited, forged cookies rejected.
- Menu: owner creates categories and dishes, invalid colours/prices/image references rejected, non-image uploads (e.g. SVG with script) rejected, hidden categories not public, non-empty categories can't be deleted, sold-out dishes can't be added or ordered, offer changes alter the server-side bill, audit log records changes.
- Live updates: admin event stream receives a "new order" event.

## What the end-to-end suite proves

Admin signs in through the form and opens a table; the guest (390×844, touch) enters a wrong code then the right one, sees the name reveal, swipes the menu (asserting it moved), and the animation's longest frame stays under 40 ms. The guest adds two dishes, opens the plate and orders. The admin board shows the order live with the guest's name and **exactly the total the guest saw**; staff accept and the guest gets "Cooking". The owner creates a category and dish from the gallery; the guest's menu shows it without a refresh. Staff settle & close; the guest's screen shows "Thanks for eating with us". The test fails on any browser error.

## Running against PostgreSQL locally

```bash
docker run -d --name hm-pg -e POSTGRES_PASSWORD=hm -e POSTGRES_USER=hm -e POSTGRES_DB=hm_test -p 5432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://hm:hm@localhost:5432/hm_test npm run test:integration
docker rm -f hm-pg      # start from a fresh database for each run
```

## End-to-end setup

```bash
npm install
npx playwright install chromium          # once (add --with-deps on Linux CI)
npm run test:e2e
```

## Load testing

Use a **staging** copy, never production. All virtual users share your IP, so raise limits on staging only:

```bash
# on the staging server's .env
RATE_LIMIT_MULTIPLIER=100
# from your machine (install k6: https://k6.io/docs/get-started/installation/)
k6 run -e BASE=https://staging.example.com -e ADMIN_USER=owner -e ADMIN_PASS='…' -e TABLES=10 tests/load/guest-flow.k6.js
```

Thresholds: under 1% failed requests and p95 under 300 ms with 60 concurrent guests. The script opens tables, joins guests, adds dishes, polls the plate and places some orders.

## Writing tests

- Tests use Node's built-in runner (`node:test`) and `assert`. No extra framework.
- `tests/helpers.js` starts a server on an in-memory SQLite database (`startServer()`) and gives you a cookie-keeping HTTP client (`client(base)`, with `.login()`).
- Any change to `web/js/shared/pricing.js` needs a unit test: that file decides what guests are charged.
