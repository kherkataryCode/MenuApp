# Operations guide

Running Hungry Mango day to day: backups, restores, monitoring, logs, updates, secrets, data growth, and fixing problems.

In the commands below, `dc` means your Compose command:
- Option A: `docker compose`
- Option B: `docker compose -f docker-compose.scale.yml`

---

## 1. Backups

### SQLite (options A, C, D)

The app can take a consistent copy while it is running (`VACUUM INTO`), so there's no need to stop service.

```bash
# Without Docker
npm run backup                              # → data/backups/hungry-mango-<timestamp>.db
npm run backup -- /some/path/backup.db

# With Docker (option A)
dc exec -T app node --disable-warning=ExperimentalWarning server/cli/backup.js /app/data/backups/manual.db
dc cp app:/app/data/backups/manual.db ./hm-$(date +%F).db
```

Nightly cron: see DEPLOY.md step A7.

### PostgreSQL (option B)

```bash
dc exec -T db pg_dump -U hm -Fc hungrymango > hm-$(date +%F).dump
```

With managed PostgreSQL, enable automatic daily backups and point-in-time recovery in your provider's console.

### Off-site copies

A backup on the same disk as the database isn't a backup. Copy them elsewhere daily, for example with rclone:

```bash
rclone copy /var/backups/hungry-mango remote:hungry-mango-backups --max-age 48h
```

Backups contain staff password hashes. Store them encrypted (most cloud storage encrypts at rest; for extra safety, `gpg -c` the file before upload).

### What's in a backup

Everything: menu, photos (stored in the database), offers, tables, orders, staff accounts, audit log. Your `.env` (especially `APP_SECRET`) is **not** in the backup. Keep it in your password manager.

---

## 2. Restoring

### SQLite with Docker (option A)

```bash
dc stop app
docker run --rm -v hungry-mango_app-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/hungry-mango.db-wal /data/hungry-mango.db-shm && cp /backup/hm-2026-10-21.db /data/hungry-mango.db && chown 1000:1000 /data/hungry-mango.db"
dc start app
```

The volume name is `<folder>_app-data`; check with `docker volume ls`.

### SQLite without Docker

```bash
sudo systemctl stop hungry-mango
rm -f data/hungry-mango.db-wal data/hungry-mango.db-shm
cp /path/to/backup.db data/hungry-mango.db
sudo systemctl start hungry-mango
```

### PostgreSQL

```bash
dc stop app
dc exec -T db dropdb -U hm hungrymango
dc exec -T db createdb -U hm hungrymango
dc exec -T db pg_restore -U hm -d hungrymango < hm-2026-10-21.dump
dc start app
```

**Practise a restore once** on a spare machine before you rely on it.

---

## 3. Moving from SQLite to PostgreSQL

When you outgrow one server:

```bash
# 1. Stop the app and take a fresh SQLite backup
dc stop app
npm run backup -- ./final.db            # or copy it out of the Docker volume

# 2. Create an empty PostgreSQL database, then copy everything into it
npm install                               # makes sure "pg" is installed
DATABASE_URL='postgres://hm:<password>@<host>:5432/hungrymango' npm run sqlite-to-postgres -- ./final.db

# 3. Set DATABASE_URL to PostgreSQL in .env and start (option B compose file, or your platform)
```

The script copies every table (menu, photos, orders, accounts, audit log) in one transaction and refuses to write into a database that already has data unless you pass `--force`.

---

## 4. Monitoring

### Uptime
Point an uptime monitor (UptimeRobot, Better Stack, Pingdom, Healthchecks) at `https://<domain>/readyz` every minute. It returns `200 {"ok":true}` when the app *and* database are healthy, `503` otherwise. `/healthz` only checks the process.

### Metrics (Prometheus)
Set `METRICS_TOKEN`, then scrape:

```yaml
scrape_configs:
  - job_name: hungry-mango
    scheme: https
    metrics_path: /metrics
    authorization: { credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["menu.hungrymango.in"] }]
```

Useful queries:
- p95 latency: `histogram_quantile(0.95, sum by (le) (rate(hm_http_request_duration_seconds_bucket[5m])))`
- Error rate: `sum(rate(hm_http_request_duration_seconds_count{status=~"5.."}[5m]))`
- Connected phones and screens: `hm_sse_clients`
- Orders per hour: `increase(hm_orders_placed_total[1h])`

Suggested alerts: `/readyz` failing for 2 minutes; 5xx rate above 1% for 5 minutes; p95 above 1 s.

In the cluster setup, nginx only lets private networks reach `/metrics`; scrape each app instance from inside the Docker network, or set `METRICS_TOKEN`.

### Logs
One JSON object per line on stdout/stderr:

```json
{"t":"2026-10-21T19:04:11.201Z","level":"error","msg":"request","id":"k3m9…","method":"POST","path":"/api/session/orders","status":500,"ms":12}
```

```bash
dc logs -f app                                   # follow
dc logs --since 1h app | grep '"level":"error"'  # errors in the last hour
dc logs app | jq -r 'select(.status>=500) | [.t,.path,.id] | @tsv'
```

Every response has an `X-Request-Id` header, and 500 responses include `requestId` in the body. Ask staff for it when they report a problem, then search the logs for it. Set `LOG_LEVEL=debug` temporarily to log every request.

Docker keeps logs forever by default. Cap them in `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
```

---

## 5. Updating the app

```bash
git pull
dc up -d --build
dc logs -f app       # look for "migration applied" lines and "Hungry Mango is running"
```

Database migrations run automatically at start. Take a backup before upgrading across versions. Read RELEASE_NOTES.md for anything version-specific.

Rolling back: `git checkout <previous-tag> && dc up -d --build`. Migrations only add things in 1.x, so the older version keeps working; if a release notes otherwise, restore the pre-upgrade backup.

Keep the base images patched: rebuild monthly with `dc build --pull && dc up -d`.

---

## 6. Secrets and accounts

| Task | How | Effect |
|---|---|---|
| Rotate `APP_SECRET` | Change it in `.env` / platform secrets, restart | All guests are dropped from their tables and must re-enter the code. Staff stay signed in. Do it between services. |
| Staff member leaves | Admin → Staff → **Disable** | Immediately signed out everywhere; can't sign in |
| Forgotten password | Owner: Staff → **Reset password**. Lost the owner account: `npm run create-admin -- --user owner --role owner --password '...'` on the server | Old sessions signed out, lockout cleared |
| Suspected compromise | Rotate `APP_SECRET`, reset all staff passwords, review Staff → Activity log, check `docker compose logs` | |

---

## 7. Data growth and housekeeping

At restaurant scale data stays small: an order is about 1 KB, so 500 orders a day is roughly 180 MB a year. Photos are 50–150 KB each.

Optional clean-ups (run in `sqlite3 data/hungry-mango.db` or `psql`):

```sql
-- Audit entries older than a year
DELETE FROM audit_log WHERE at < (strftime('%s','now') - 365*86400) * 1000;           -- SQLite
DELETE FROM audit_log WHERE at < (extract(epoch from now()) - 365*86400) * 1000;      -- PostgreSQL

-- Photos no longer used by any dish
DELETE FROM images WHERE 'img:' || id NOT IN (SELECT image FROM items);

-- Closed seatings older than 90 days (orders are kept)
DELETE FROM table_sessions WHERE status = 'closed' AND closed_at < <ms-timestamp>;
```

Expired staff sessions are purged automatically every hour. SQLite reclaims space with `VACUUM;` (run while the app is stopped).

---

## 8. Self-hosting fonts and the QR library

By default the browser loads two things from third parties: fonts from Google Fonts and the QR code library from cdnjs. To serve everything yourself (faster in some networks, and a stricter security policy):

**Fonts**
1. Download WOFF2 files for *Bagel Fat One* and *Bricolage Grotesque* (e.g. from fonts.google.com, or the google-webfonts-helper tool) into `web/fonts/`.
2. Add `@font-face` rules at the top of `web/css/app.css`, for example:
   ```css
   @font-face { font-family: 'Bagel Fat One'; src: url(/fonts/bagel-fat-one.woff2) format('woff2'); font-display: swap; }
   @font-face { font-family: 'Bricolage Grotesque'; src: url(/fonts/bricolage-grotesque.woff2) format('woff2'); font-weight: 400 800; font-display: swap; }
   ```
3. Remove the three Google Fonts `<link>` tags from `web/index.html` and `web/admin.html`.
4. Add `'.woff2': 'font/woff2'` to the `TYPES` map in `server/http/static.js`.

**QR library**
1. `curl -o web/vendor/qrcode.min.js https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js` (create `web/vendor/` first).
2. In `web/admin.html`, change the script `src` to `/vendor/qrcode.min.js`.

Then tighten the policy in `server/http/security.js`: remove `https://cdnjs.cloudflare.com`, `https://fonts.googleapis.com` and `https://fonts.gstatic.com`. If you keep the CDN instead, add an `integrity="sha384-…"` attribute to the QR script tag (compute it with `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`).

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Admin shows **Reconnecting** forever, or orders appear only after refresh | Proxy buffers Server-Sent Events | nginx: `proxy_buffering off` on `/api/*/stream`; Caddy: `flush_interval -1`; Cloudflare: works by default, but don't enable "Rocket Loader" for the admin |
| Live updates stop after ~60 s behind a load balancer | LB idle timeout shorter than the 20 s heartbeat allows | Raise the LB idle/read timeout to ≥ 1 hour for the stream paths |
| Everyone gets "Too many requests" | `TRUST_PROXY` is 0 behind a proxy, so every guest appears to have the proxy's IP | Set `TRUST_PROXY` to the number of proxies |
| Guests seem to share an IP and get rate-limited when a big group joins | A large table on one restaurant Wi-Fi | Defaults allow 20 joins per table per minute. Raise in `server/routes/api.js` and `deploy/nginx/nginx.conf` if needed |
| Guest: "This table session has ended" right after joining | Several app instances with different `APP_SECRET` | Use the same secret everywhere |
| Guest: "That code doesn't match" with the right code | Staff pressed **New code**, or the table was closed and reopened | Read the current code from the Tables panel |
| QR cards open the wrong address | `PUBLIC_URL` not set or wrong | Set it and reprint |
| "Sales today" resets at 5:30 am | Server in UTC | Set `TZ=Asia/Kolkata` |
| Photos don't upload | Over `MAX_UPLOAD_KB`, or a proxy body limit | Raise both (nginx `client_max_body_size`) |
| `SQLITE_BUSY` / "database is locked" in logs | Two processes using the same SQLite file | Run one instance with SQLite; use PostgreSQL for more |
| `pg` connection errors | Wrong `DATABASE_URL`, firewall, or SSL required | Add `?sslmode=require` for managed Postgres; check the host allows your server's IP |
| Container restarts in a loop | Usually config | `dc logs app` shows the reason: missing `APP_SECRET` in production, bad `DATABASE_URL` |
| Fonts plain / QR shows as a link | Third-party resources blocked by the network | Self-host them (section 8) |

Still stuck: run with `LOG_LEVEL=debug`, reproduce, and look up the `X-Request-Id` in the logs.
