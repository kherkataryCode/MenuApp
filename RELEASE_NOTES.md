# Release notes

## v1.0.0 — first production release (21 October 2026)

The first deployable version of Hungry Mango, rebuilt from the hosted demo into a self-hostable application with a real server, database, authentication and tests.

### For guests
- **3D swipe menu.** Dish cutouts pop forward and slowly spin (or float); neighbours tilt away in perspective. Swiping has momentum, a gentle settle and rubber-banding at the ends; the background colour cross-fades by category.
- **Your photos.** The 15 dish images from your PDF are cut out from their checkerboard backgrounds and used throughout the starter menu.
- **Ingredient carousel** under every dish.
- **Funny names.** Everyone who joins gets a unique name like "Midnight Lassi 🥛" with a slot-machine reveal, and can re-roll it.
- **One shared plate per table,** live for everyone, showing who added what; anyone can adjust any line.
- **Bill before ordering:** items, combo and big-plate discounts, free item, GST, and a "spend ₹X more" nudge.
- **Live order tracking** (waiting → cooking → ready → served), call server, ask for the bill.
- Works on any phone browser, no login or app install. On larger screens it shows inside a phone frame.

### For staff (`/admin`)
- Sign-in with **owner** and **staff** roles; staff can run the floor and mark dishes sold out; only owners change the menu, prices, offers and accounts.
- **Live board** New → Cooking → Ready → Served, with sound alerts, per-table filters and today's history.
- **Tables:** open (generates a join code), new code, settle & close (ends every phone's session instantly), see who's seated and the running bill, call alerts.
- **Menu editor:** categories (colour, order, hide), dishes (photo upload with automatic background removal and circle crop, gallery, price, veg/non-veg, description, ingredients, animation, availability, order). Guests see changes instantly.
- **Offers editor:** free item threshold, combo deal between any two categories, big-plate percentage, GST, with a live example bill.
- **Printable QR table cards,** CSV export of a day's orders, activity log, staff account management.

### Platform
- Node.js 22, no framework, no build step, **zero required runtime dependencies** with SQLite.
- SQLite (single server) or PostgreSQL (multiple instances behind a load balancer, live updates via LISTEN/NOTIFY).
- Live updates over Server-Sent Events with automatic reconnect and re-sync.
- Docker image, Compose for single-server (Caddy auto-HTTPS) and load-balanced (nginx + 3 instances + PostgreSQL) setups, Fly.io config for Mumbai, GitHub Actions CI.
- Security: server-side pricing, per-seating codes, signed guest tokens re-validated on every request, scrypt passwords, lockouts, CSRF protection, strict CSP and security headers, rate limits, upload sniffing, audit log. See docs/SECURITY.md.
- Health/readiness endpoints, Prometheus metrics, JSON logs, graceful shutdown, hot SQLite backups, SQLite → PostgreSQL migration tool.

### Verified before release
- 24 unit tests and 6 integration suites pass on SQLite.
- The integration suites also pass through the PostgreSQL driver against a pg-compatible stand-in (adapter plumbing, transactions, LISTEN/NOTIFY fan-out).
- End-to-end browser test passes in Chromium with zero browser errors; longest animation frame under 40 ms.
- Operational commands exercised: start, create-admin, seed --force, backup, sqlite-to-postgres, production start refused without `APP_SECRET`.

### Known limitations — read before going live
1. **Real PostgreSQL not yet run.** The build environment had no network, so the PostgreSQL path was verified against a stand-in driver, not a real server. CI runs the integration suite on real PostgreSQL 16: **push to GitHub and confirm the `test-postgres` job is green before using option B.**
2. **Docker image and k6 load test not executed** in the build environment (no Docker or k6 available). CI builds and boots the image on every push.
3. **No `package-lock.json`** is included (it couldn't be generated offline). Run `npm install` once and commit the lockfile.
4. **Third-party browser resources:** fonts (Google Fonts) and the QR library (cdnjs). If they're blocked, the app still works with fallback fonts and a text link instead of a QR. OPERATIONS.md §8 explains self-hosting.
5. **Payments are not built in.** The bill is settled at the counter; "Ask for the bill" alerts staff.
6. **One restaurant per installation** (not multi-tenant). Run one copy per outlet, or share one PostgreSQL database between instances of the same outlet.
7. **Rate limits are per instance** plus nginx cluster limits; there's no shared limiter (e.g. Redis). This is adequate at restaurant scale.
8. **Photo rights.** The starter photos come from the PDF you supplied. Confirm you may use them commercially or replace them.
9. **Node's built-in SQLite** (`node:sqlite`) is marked experimental in Node 22. It is stable in practice and the warning is suppressed, but pin your Node version in production and run the tests after Node upgrades.
10. Accessibility: keyboard navigation, focus styles, reduced motion and screen-reader labels are in place, but no formal audit has been done.

### Upgrading from the hosted demo
The demo stored data inside the Claude artifact and can't be exported automatically. Recreate any menu changes in the new admin (the starter menu matches the demo's), and print new QR cards from **Orders & tables → Print QR cards**: the URLs have changed to `https://<your-domain>/t/<n>`.
