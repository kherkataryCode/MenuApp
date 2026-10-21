# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [1.0.0] — 2026-10-21
### Added
- Self-hostable Node.js server with SQLite and PostgreSQL support, migrations, Docker, Compose (single and load-balanced), nginx and Caddy configs, Fly.io config, CI.
- Staff authentication with roles, lockouts, CSRF protection, audit log, staff management.
- Server-side enforcement of prices, totals, order state machine and table seatings.
- Printable QR table cards, CSV export, Prometheus metrics, health checks, backup and SQLite → PostgreSQL tools.
- Full documentation set under `docs/`.
### Changed
- Guest and admin apps moved from the hosted demo's artifact storage to a REST API with Server-Sent Events.
- Join codes are now verified only on the server (the demo checked a hash in the browser).
- Funny names are generated and kept unique by the server.
### Fixed during release testing
- Creating a category in the menu editor could leave the next new dish in the previously selected category.
- Per-IP sign-in lockout was strict enough to lock out every staff member sharing the restaurant's Wi-Fi; it now locks per username after 5 misses and per IP only after 30.
- Client IP behind a proxy was read from the left of `X-Forwarded-For`, which clients can forge; it's now read from the right using `TRUST_PROXY` hops.
- Several instances starting at once on an empty PostgreSQL could race on migrations; now serialised with an advisory lock.
- nginx kept stale replica addresses after app containers were recreated; it now re-resolves them every 10 s.

## [0.2.0] — 2026-10-21 (hosted demo)
- Admin page with menu, category, photo and offers editing; funny names on join; smoother physics-based carousel; PDF food cutouts.

## [0.1.0] — 2026-10-21 (hosted demo)
- First demo: 3D swipe menu, shared plate, bill preview with offers, kitchen dashboard, join codes.

## Unreleased — table games, menu list, service and bill UX
- Added table-shared Would You Rather voting with live vote counts and round advancement. Game rounds/votes are in-memory demo state and reset on server restart or redeploy.
- Added a category-grouped full menu list, ingredient descriptions, item detail/photo view, add-to-plate action, and back navigation.
- Added customer-facing itemized bill view with order status and total, plus direct request for staff to bring the payment bill.
- Added periodic guest/admin refresh fallbacks so order status changes recover if a live event is missed; admin status actions now confirm the selected transition.
- Kept new screens on the existing Hungry Mango theme variables.
