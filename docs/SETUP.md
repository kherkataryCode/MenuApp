# Setup guide

This guide takes you from an empty computer to a running Hungry Mango, then explains every setting and the day-to-day workflow. For putting it on the internet, continue with [DEPLOY.md](DEPLOY.md).

---

## 1. Prerequisites

| Tool | Version | Why | Check |
|---|---|---|---|
| Node.js | **22.13 or newer** (22 LTS) | Runs the server. 22.13+ has the built-in SQLite the app uses. | `node -v` |
| npm | comes with Node | Installs dev tools | `npm -v` |
| Git | any | Version control | `git --version` |
| Docker + Docker Compose v2 | optional locally, needed for Docker deploys | Containers | `docker compose version` |
| OpenSSL | any | Generating secrets | `openssl version` |

Installing Node.js 22:

- **macOS:** `brew install node@22`, or the installer from nodejs.org.
- **Windows:** the LTS installer from nodejs.org. Use PowerShell or Git Bash for the commands below.
- **Ubuntu/Debian:** `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`

> The app has **no required runtime dependencies**. `npm install` only adds the optional PostgreSQL driver (`pg`) and the browser-testing tool (`playwright`). With SQLite you could even run it without `npm install` at all.

---

## 2. Get the code into your repository

```bash
unzip hungry-mango.zip
cd hungry-mango
git init
git add .
git commit -m "Hungry Mango v1.0.0"
git branch -M main
git remote add origin git@github.com:<you>/hungry-mango.git
git push -u origin main
```

Then generate and commit a lockfile once, so every install is identical:

```bash
npm install
git add package-lock.json
git commit -m "Add lockfile"
```

The Dockerfile uses `npm ci` automatically when a lockfile is present.

---

## 3. Configure

```bash
cp .env.example .env
```

For local development, edit `.env` to at least:

```ini
APP_SECRET=<paste output of: openssl rand -base64 48>
NODE_ENV=development
PUBLIC_URL=http://localhost:8080
DATABASE_URL=sqlite:./data/hungry-mango.db
TRUST_PROXY=0
ADMIN_BOOTSTRAP_USER=owner
ADMIN_BOOTSTRAP_PASSWORD=pick-something-10-plus-chars
```

`.env` is git-ignored. Never commit it.

### Environment variables

| Variable | Default | Required | What it does |
|---|---|---|---|
| `APP_SECRET` | dev fallback | **Yes in production** | Signs guest table cookies. 32+ random characters. The app refuses to start in production without it. Changing it signs all guests out of their table (staff stay signed in). |
| `NODE_ENV` | — | Recommended | `production` turns on Secure cookies, HSTS, `upgrade-insecure-requests`, and hides `/metrics` unless `METRICS_TOKEN` is set. |
| `PUBLIC_URL` | empty | Recommended | The address guests use, e.g. `https://menu.hungrymango.in`. Printed into QR codes. No trailing slash. If empty, the admin uses the address in its own browser bar. |
| `DATABASE_URL` | `sqlite:./data/hungry-mango.db` | No | `sqlite:<path>` for one server, or `postgres://user:pass@host:5432/db` for several. Add `?sslmode=require` for managed Postgres. |
| `PORT` | `8080` | No | Port the app listens on. |
| `HOST` | `0.0.0.0` | No | Interface to bind. Use `127.0.0.1` if a proxy on the same machine is the only client. |
| `TRUST_PROXY` | `0` | When behind a proxy | Number of proxies in front of the app: `0` none, `1` Caddy or nginx, `2` Cloudflare + nginx. Used to find the real client IP for rate limits. Setting it too high lets clients fake their IP; too low makes everyone look like the proxy. |
| `TZ` | system | Recommended | Time zone for "today" (sales total, CSV export). Set `Asia/Kolkata` in India; containers default to UTC. |
| `RESTAURANT_NAME` | `Hungry Mango` | No | Shown on the guest app, admin, and table cards. |
| `TABLE_COUNT` | `12` | No | Number of tables (1–200). Raising it adds tables on next start. Lowering it hides tables above the number from URLs but keeps their history. |
| `ADMIN_BOOTSTRAP_USER` | empty | First run | Username of the owner account created on first start. |
| `ADMIN_BOOTSTRAP_PASSWORD` | empty | First run | Password for that account, 10+ characters. Only used when **no** admin exists. Remove it after the first sign-in. |
| `SEED_ON_EMPTY` | `true` | No | Loads the starter menu (8 categories, 21 dishes, your 15 photo cutouts) when the menu is empty. |
| `METRICS_TOKEN` | empty | No | If set, `/metrics` requires `Authorization: Bearer <token>`. In production with no token, `/metrics` returns 404. |
| `ADMIN_SESSION_HOURS` | `12` | No | How long a staff sign-in lasts. |
| `GUEST_SESSION_HOURS` | `8` | No | Maximum life of a guest's table cookie. Closing the table ends it sooner. |
| `ORDER_COOLDOWN_SECONDS` | `15` | No | Minimum gap between two orders from the same table, against accidental double-sends. |
| `MAX_UPLOAD_KB` | `1500` | No | Largest dish photo accepted. The admin compresses photos to about 50–150 KB before upload. |
| `LOG_LEVEL` | `info` | No | `debug` (logs every request), `info`, `warn`, `error`, `silent`. |
| `RATE_LIMIT_MULTIPLIER` | `1` | No | Multiplies every per-IP limit. Raise only on a staging server for load tests. |
| `SECURE_COOKIES` | `true` in production | No | Force `Secure` cookies on or off. Leave it alone unless you know why. |
| `PG_POOL_MAX` | `10` | No | PostgreSQL connections per app instance. |

The app reads `.env` itself. In Docker, Compose passes it with `env_file`. On hosting platforms, set the same names as environment variables or secrets.

---

## 4. Install and run

```bash
npm install
npm run dev
```

You should see:

```
{"level":"info","msg":"migration applied","version":1,...}
{"level":"info","msg":"starter menu seeded","items":21}
{"level":"warn","msg":"bootstrap owner account created — remove ADMIN_BOOTSTRAP_PASSWORD from your environment now",...}
{"level":"info","msg":"Hungry Mango is running","port":8080,"db":"sqlite",...}
```

The database file is created at `data/hungry-mango.db` (plus `-wal` and `-shm` helper files, which are normal).

Pages:

| URL | What |
|---|---|
| `http://localhost:8080/` | Guest landing: "scan the QR", plus a box to type a table number |
| `http://localhost:8080/t/3` | Table 3 |
| `http://localhost:8080/admin` | Admin |
| `http://localhost:8080/readyz` | Health check (database reachable) |

### Testing on your phone during development

1. Find your computer's local IP: macOS `ipconfig getifaddr en0`, Windows `ipconfig`, Linux `hostname -I`.
2. Set `PUBLIC_URL=http://<that-ip>:8080` in `.env` and restart, so QR codes point at your computer.
3. Phone and computer must be on the same Wi-Fi. Open `http://<that-ip>:8080/t/3`.

Live updates and cookies work over plain `http` in development because `NODE_ENV` is not `production`.

---

## 5. Admin accounts

### First owner

Created automatically from `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` on the first start (only while no admin exists). After you sign in:

1. Remove `ADMIN_BOOTSTRAP_PASSWORD` from `.env` (or your host's settings).
2. Optionally change your password under **Staff → Change my password**.

### More accounts

In the admin, **Staff → Add account**. Roles:

| Role | Can do |
|---|---|
| **owner** | Everything: menu, prices, photos, offers, GST, staff accounts, activity log |
| **staff** | Orders and tables (open, close, new code, accept/reject/ready/served), mark dishes sold out, download CSV |

### From the command line (also how you recover a lost password)

```bash
npm run create-admin
# or non-interactive:
npm run create-admin -- --user owner --role owner --password 'new-strong-password'
```

If the username exists, its password and role are replaced and its sessions signed out. In Docker:

```bash
docker compose exec app node --disable-warning=ExperimentalWarning server/cli/create-admin.js --user owner --role owner --password 'new-strong-password'
```

Password rules: 10–200 characters, not one repeated character, not an obvious sequence. Five wrong attempts lock that username for 15 minutes. Thirty wrong attempts from one IP lock that IP for 15 minutes, so one guessing attacker doesn't lock out a whole staff team sharing restaurant Wi-Fi.

---

## 6. The starter menu

On first start with an empty menu, the app loads `seed/menu.json`:

- **Pizzas** Margherita Burrata Bloom, Garden Veggie Supreme
- **Burgers** Classic Smash Cheeseburger
- **Bowls** Teriyaki Chicken Rice Bowl, Protein Buddha Bowl
- **Grills** Herb Chicken & Sweet Potato, Lemon Butter Basa, Crumb-Fried Fish, Grilled Salmon Plate, Peppercorn Steak
- **Pasta** Basil Pesto Tagliatelle, Chicken Bolognese
- **Greens & soup** Greek Garden Salad, Roasted Veggie Medley, Tomato Basil Soup
- **Sips** 4 drinks (drawn illustrations)
- **Sweet** 2 desserts (drawn illustrations)

The 15 photo cutouts in `seed/images/` are the ones from your PDF, with the checkerboard backgrounds removed. Edit or replace anything from the admin. To start over:

```bash
npm run seed -- --force   # replaces categories and dishes; orders and accounts are kept
```

To ship a different default menu, edit `seed/menu.json` before the first start. Images are referenced as `"file:<name>.webp"` (from `seed/images/`) or `"d:<id>"` (drawn: `d1`–`d5`, `x1`, `x2`, `s1`, `s2`).

---

## 7. Daily workflow

**Before service**
1. Print table cards once: **Orders & tables → Print QR cards**. The QR never changes.
2. Check the menu, and mark anything unavailable as sold out.

**When guests sit down**
1. Press **Open table**. A 4-digit join code appears on the table's panel.
2. Tell the guests the code, or write it on the table card (a small whiteboard sticker works well).
3. Everyone scans and types the code. Each person gets a funny name and joins the same plate.

**During service**
- New orders appear under **New** with a chime (press **Sound off** once to turn sound on; browsers need one click before they can play audio).
- **Accept** → Cooking → **Mark ready** → **Mark served**. The guest's phone shows each step.
- "Call server" and "Ask for the bill" make the table card pulse pink. Press **Done** when handled.
- If a code leaks (someone posts a photo of the card), press **New code**. People already at the table stay in.

**When guests leave**
- Press **Settle & close**. This immediately disconnects every phone from that table, settles its orders, clears the plate, and invalidates the code. Pending (not yet accepted) orders become rejected.
- That's the answer to "how do we reset the plate when the table goes empty": closing the table *is* the reset. The next group gets a fresh session and a new code.

**End of day**
- **Today's history → Download CSV** for your accounts.

---

## 8. Customising

| Want to change | Where |
|---|---|
| Restaurant name | `RESTAURANT_NAME` |
| Number of tables | `TABLE_COUNT` |
| Colours, fonts, layout | `web/css/app.css` (brand colours are CSS variables at the top) |
| Funny names | `web/js/shared/names.js` (adjectives and snacks). Used by both browser and server. |
| Ingredient quick-picks in the editor | `ING_LIB` in `web/js/art.js` |
| Category colour choices | `CAT_COLORS` in `web/js/art.js` |
| Offer rules (new kinds of offers) | `web/js/shared/pricing.js`. This one file decides prices in the browser **and** on the server; add a unit test in `tests/unit/pricing.test.js` for any change. |
| Order statuses | `ORDER_FLOW` in `server/services/restaurant.js` plus the board columns in `web/js/admin.js` |

There is no build step. Edit a file, refresh the browser. In production, static files are cached for an hour; restart the server after deploying changes.

---

## 9. Troubleshooting setup

| Symptom | Fix |
|---|---|
| `No such built-in module: node:sqlite` | Node is older than 22.13. Upgrade. |
| `APP_SECRET is required in production` | Set `APP_SECRET`, or `NODE_ENV=development` for local work. |
| `DATABASE_URL points at PostgreSQL but the "pg" package is not installed` | Run `npm install` (not `npm install --omit=optional`). |
| Can't sign in, "Wrong username or password" | Reset with `npm run create-admin -- --user owner --role owner --password '...'`. |
| "Too many failed sign-ins" | Wait 15 minutes, or reset the password with `create-admin`, which also clears that account's lock. |
| Phone shows "Can't reach the restaurant" | Phone not on the same network, or a firewall blocks port 8080. |
| Admin never says **Live** | A proxy is buffering `/api/admin/stream`. See the SSE notes in DEPLOY.md. |
| Fonts look plain | The page couldn't reach Google Fonts. See "Self-hosting fonts" in OPERATIONS.md. |
| QR codes show as a text link | The QR library couldn't load from cdnjs. See "Self-hosting the QR library" in OPERATIONS.md. |
