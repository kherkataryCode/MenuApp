# Hungry Mango — QR table ordering

Guests scan the QR on their table, swipe through a 3D menu of dish cutouts, build **one shared plate** with everyone at the table, see the exact bill (offers and GST included) and place the order. The kitchen and floor staff run everything from a live admin dashboard.

**Version 1.0.0** · Node.js 22 · zero required runtime dependencies · SQLite or PostgreSQL

---

## What's inside

| For guests (phone) | For staff (`/admin`) |
|---|---|
| 3D swipe menu with momentum, dish cutouts that pop and spin | Live board: New → Cooking → Ready → Served, with sound alerts |
| Ingredient carousel under every dish | Tables: open, show join code, issue a new code, settle & close |
| One shared plate per table, live for everyone | See who is at each table (by funny name) and their running bill |
| Random funny names ("Midnight Lassi 🥛"), re-rollable | "Call server" and "Ask for the bill" alerts |
| Bill preview with offers, GST and a "spend ₹X more" nudge | Menu editor: categories, dishes, prices, photos with automatic background removal, ingredients, animation, sold-out switch |
| Live order tracking | Offers editor: free item, combo deal, big-plate discount, GST |
| No login, no app install | Staff accounts with roles (owner / staff), activity log, CSV export, printable QR table cards |

On a laptop or tablet, the guest screen opens inside a phone frame on a styled background.

## Quick start (local, 2 minutes)

```bash
# Requires Node.js 22.13 or newer:  node -v
cp .env.example .env
# Edit .env:  set APP_SECRET (openssl rand -base64 48), NODE_ENV=development,
#             PUBLIC_URL=http://localhost:8080, ADMIN_BOOTSTRAP_PASSWORD=<10+ chars>
npm install          # installs dev tools (Playwright) and the optional PostgreSQL driver
npm run dev          # http://localhost:8080
```

1. Open **http://localhost:8080/admin**, sign in as `owner` with your bootstrap password.
2. Click **Open table** on table 3. Note the 4-digit join code.
3. On your phone (same Wi-Fi), open `http://<your-computer-ip>:8080/t/3` and enter the code.

Full walkthrough: **[docs/SETUP.md](docs/SETUP.md)**.

## Deploy

| Option | Best for | Guide |
|---|---|---|
| **A. One server + Docker + Caddy (auto HTTPS)** | One restaurant. Recommended start. | [docs/DEPLOY.md#option-a](docs/DEPLOY.md#option-a--one-server-with-docker-recommended) |
| **B. Load-balanced: nginx → 3 app instances → PostgreSQL** | High traffic, several outlets, zero-downtime updates | [docs/DEPLOY.md#option-b](docs/DEPLOY.md#option-b--load-balanced-cluster-with-postgresql) |
| **C. Fly.io (Mumbai region)** | No server to manage | [docs/DEPLOY.md#option-c](docs/DEPLOY.md#option-c--flyio-managed-mumbai-region) |
| **D. Render / Railway** | Click-ops hosting | [docs/DEPLOY.md#option-d](docs/DEPLOY.md#option-d--render-or-railway) |

## Documentation

| Document | What it covers |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Local setup, every environment variable, first admin, starter menu, using it day to day |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Step-by-step production deployment for each option, DNS, HTTPS, go-live checklist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works: components, data model, live updates, scaling |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, anti-prank design, every security control |
| [docs/API.md](docs/API.md) | Every HTTP endpoint with request/response shapes |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Backups, restores, monitoring, logs, upgrades, troubleshooting |
| [docs/TESTING.md](docs/TESTING.md) | Unit, integration, end-to-end and load tests |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | v1.0.0 features, known limitations, upgrade notes |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Project layout

```
server/            Node.js HTTP server (no framework)
  index.js         entry point, graceful shutdown
  app.js           wiring: DB, event bus, routes, static files, metrics
  config.js        environment variables
  http/            router, cookies, security headers, rate limiter, static files, SSE
  db/              SQLite + PostgreSQL drivers, migrations
  bus/             live-update fan-out (in-memory or PostgreSQL LISTEN/NOTIFY)
  services/        auth (passwords, sessions, guest tokens) and restaurant rules
  routes/api.js    every endpoint
  cli/             create-admin, seed, backup
web/               browser app (plain ES modules, no build step)
  index.html       guest app (/ and /t/:n)
  admin.html       admin app (/admin)
  js/shared/       pricing + names, shared by browser AND server
seed/              starter menu + your 15 food cutouts
tests/             unit, integration, e2e (Playwright), load (k6)
deploy/            Caddyfile, nginx load balancer config
Dockerfile, docker-compose.yml, docker-compose.scale.yml, fly.toml, .github/workflows/ci.yml
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on file changes |
| `npm start` | Start for production |
| `npm run create-admin` | Create or reset an admin account (interactive) |
| `npm run seed` / `npm run seed -- --force` | Load the starter menu (only if empty / replace menu) |
| `npm run backup` | Hot backup of the SQLite database to `data/backups/` |
| `npm test` | Unit + integration tests |
| `npm run test:e2e` | Browser tests (run `npx playwright install chromium` once) |
| `npm run test:load` | k6 load test (staging only) |

## Licence and content

All rights reserved by the project owner. The dish photos in `seed/images/` came from the PDF you supplied; make sure you hold the rights to use them commercially, or replace them with your own photos from the admin.
