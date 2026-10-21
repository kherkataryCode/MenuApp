# Security

## What we protect, and from whom

| Asset | Threat | Main defences |
|---|---|---|
| Kitchen time and food | Prank or fake orders, especially from outside the restaurant | Per-seating join codes, seating ends on close, staff accept every order, rate limits |
| Revenue | Guests paying less than menu price | Server computes every price and total; phone-sent prices are ignored |
| The menu, prices, offers | Unauthorised changes | Staff sign-in, owner-only roles, CSRF protection, audit log |
| Staff accounts | Password guessing, stolen sessions | scrypt, lockouts, HttpOnly/Secure/SameSite=Strict cookies, server-side sessions, sign-out on password change |
| Guests | Cross-site scripting, clickjacking, tracking | Strict CSP, no inline scripts, text-only rendering of user content, frame-ancestors none, no accounts or personal data |
| Availability | Floods, abuse | Per-IP and per-session rate limits in the app and in nginx, body size limits, timeouts |

## The anti-prank design ("what stops someone ordering after they've left?")

The QR on the table is permanent, so on its own it proves nothing: anyone can photograph it and open the link from home. The protection comes from the **seating**:

1. **Tables start closed.** A link to a closed table can't join or order. Staff press **Open table** when people sit down.
2. **A 4-digit code per seating.** Opening a table generates a new code. Guests must type it to join. Without it, the QR link is useless.
3. **The code is checked only on the server,** with a constant-time comparison, and never sent to guests' phones.
4. **Brute force is impractical.** Joins are limited to 8 attempts per minute per IP and 20 per minute per table (plus nginx limits in the cluster setup). Guessing one of 9,000 codes at 20 a minute takes hours on average, and the code changes as soon as the table closes, or immediately when staff press **New code**.
5. **Joining issues a signed cookie** bound to *table + seating + guest*. It's HMAC-SHA256 signed with `APP_SECRET`, HttpOnly, SameSite=Lax, Secure in production, and expires after `GUEST_SESSION_HOURS`.
6. **Every guest request re-checks the database:** is this seating still the table's current one, and is this guest part of it? If not, the server answers `410 Gone`.
7. **Settle & close ends everything at once.** The seating is closed; plate, guests and calls are deleted; pending orders are rejected; every phone gets a live "session ended" message. A guest who walks out and tries to order from the car gets "This table session has ended."
8. **Staff accept every order.** Nothing reaches the kitchen line until someone taps **Accept** on the New column, so even a valid but unexpected order gets a human look.
9. **Leaked code?** Press **New code**. Guests already seated stay in; the old code stops working.

Optional extra hardening you can add later: restrict joining to the restaurant Wi-Fi's public IP, or NFC tags instead of printed codes. GPS checks were deliberately left out: indoor GPS is unreliable and would block real guests.

## Controls in detail

### Pricing integrity
- Guests send only *which dish* and *how many* (`{item, delta}`). Unknown fields (`price`, `total`) are ignored.
- The bill is computed by `priceBill()` on the server, using prices and offers from the database at the moment of ordering. The browser runs the same function for the preview, so the numbers match.
- Quantities are integers clamped to 0–50 per line; a plate holds at most 60 lines.
- Sold-out dishes can't be added or ordered.
- The integration and end-to-end tests assert that the kitchen total equals the guest's preview, and that injected prices are ignored.

### Staff authentication
- Passwords: scrypt (N=16384, r=8, p=1, 64-byte key, random 16-byte salt), compared in constant time. 10–200 characters, obvious patterns refused.
- Unknown usernames still run a full scrypt check, so response time doesn't reveal which usernames exist.
- Lockout: 5 wrong passwords lock that username for 15 minutes; 30 from one IP lock that IP. The per-IP threshold is high on purpose: staff usually share one restaurant IP, and one attacker shouldn't lock them all out.
- Sessions: a 256-bit random token in an HttpOnly, SameSite=Strict, Secure cookie. Only its SHA-256 hash is stored, so a database leak doesn't hand out live sessions. Sessions expire after `ADMIN_SESSION_HOURS`, and are deleted on sign-out, password change, password reset, or account disable.
- Roles: `owner` (everything) and `staff` (floor, orders, sold-out switch). Enforced on the server for every endpoint.

### CSRF and cross-site requests
- Admin writes require an `x-csrf-token` header equal to the session's CSRF token. Cookies alone are not enough.
- Guest writes require an `x-hm: 1` header. Browsers can't add custom headers to cross-site requests without a CORS preflight, and the server never answers preflights with permission. Together with SameSite cookies, other websites can't act as a guest.
- JSON endpoints require `Content-Type: application/json`, which blocks plain HTML form posts.

### Browser hardening (headers on every response)
- `Content-Security-Policy`: scripts only from this site and `cdnjs.cloudflare.com` (QR library); styles from this site and Google Fonts; images from this site, `data:` and `blob:`; `connect-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `upgrade-insecure-requests` in production.
- No inline scripts or inline style attributes in the HTML. Dynamic styles are set through the CSSOM, which CSP permits.
- All user-supplied text (dish names, notes, nicknames) is inserted with `textContent`, never as HTML.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy` denying camera, microphone, geolocation, payment, USB.
- `Strict-Transport-Security` (1 year) in production.

### Uploads
- Owner only. Max `MAX_UPLOAD_KB` (1.5 MB).
- The file's first bytes must be a real WebP, PNG or JPEG. The declared type is not trusted. SVG is refused (it can carry scripts).
- Stored under a SHA-256 content hash; served with the sniffed type, `nosniff`, `Content-Disposition: inline`.
- Image references in dishes must match `/img/<hash>` or a built-in drawing id; anything else (e.g. `javascript:`) is rejected.

### Input handling
- Every request body is validated against a schema: types, lengths, ranges, allowed values, patterns (colours, ids, 4-digit codes).
- JSON bodies are capped at 64 KB. Header timeout 15 s.
- All SQL uses bound parameters; no string-built queries with user input.
- URL paths are normalised; static file serving can't escape `web/`. `.html` files are only reachable via their routes.
- CSV export neutralises spreadsheet formulas (cells starting with `= + - @`).

### Rate limits

| What | Limit (per instance) |
|---|---|
| Join a table | 8/min per IP, 20/min per table |
| Staff sign-in | 10/min per IP, plus lockouts |
| Plate changes | 60/min per guest |
| Place order | 6/min per seating, plus cooldown and idempotency |
| Call staff | 4/min per seating |
| Name re-rolls | 10/min per guest |
| Photo uploads | 30/min per staff account |

In the cluster setup nginx adds cluster-wide limits (`deploy/nginx/nginx.conf`). Limited responses return `429` with `Retry-After`.

**Client IP:** behind a proxy, set `TRUST_PROXY` to the number of proxies. The app reads `X-Forwarded-For` from the right, because entries on the left can be forged by the client.

### Secrets and data
- `APP_SECRET` signs guest cookies. Required in production (32+ characters). Rotating it signs all guests out of their tables; staff sessions are unaffected.
- No guest personal data is collected: no names, phone numbers, emails or locations. Nicknames are random and deleted when the table closes.
- Staff password hashes and hashed session tokens are the only credentials stored.
- The audit log records every admin change (menu, prices, offers, tables, orders, accounts, sign-ins).

### Supply chain
- Zero required runtime npm packages with SQLite; one well-known package (`pg`) with PostgreSQL.
- Two browser resources load from third parties: Google Fonts and the QR library from cdnjs. To remove them, self-host both (OPERATIONS.md explains how), then tighten the CSP in `server/http/security.js` to `'self'` only.
- The Docker image runs as the unprivileged `node` user.

## Operational security checklist
- [ ] `NODE_ENV=production`, long random `APP_SECRET`, HTTPS only
- [ ] `ADMIN_BOOTSTRAP_PASSWORD` removed after first sign-in
- [ ] One account per staff member; disable accounts when people leave (Staff → Disable)
- [ ] Only ports 80/443 (and SSH with keys) open
- [ ] `/metrics` unreachable from the internet, or protected by `METRICS_TOKEN`
- [ ] Backups encrypted at rest and stored off the server
- [ ] OS security updates automatic (`unattended-upgrades`)
- [ ] Review **Staff → Activity log** weekly

## Reporting a vulnerability
If you find a security issue, don't open a public issue. Email the project owner with steps to reproduce. Rotate `APP_SECRET` and reset staff passwords if you suspect a compromise.
