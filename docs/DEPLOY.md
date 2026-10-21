# Deployment guide

Four ways to put Hungry Mango online, from simplest to most scalable. All of them end with HTTPS on your own domain. Read **Choosing an option** first, then follow one section start to finish, then work through the **Go-live checklist** at the end.

---

## Choosing an option

| | A. One server + Docker | B. Load-balanced cluster | C. Fly.io | D. Render / Railway |
|---|---|---|---|---|
| You manage a server | Yes (a small VPS) | Yes | No | No |
| Database | SQLite (a file) | PostgreSQL | SQLite on a volume | SQLite on a disk, or their Postgres |
| HTTPS | Automatic (Caddy) | Cloudflare or your certs | Automatic | Automatic |
| Handles | One restaurant, hundreds of guests at once | Many outlets, thousands at once, rolling updates | One restaurant | One restaurant |
| Rough cost | ₹500–1,000/month VPS | 2–3× option A, or managed Postgres | Small machine + 1 GB volume | Paid tier needed for a persistent disk |
| Recommended for | **Starting out** | Growth | Not wanting a server | Already using these platforms |

A single small server (1 vCPU, 1 GB RAM) comfortably handles a busy restaurant. Start with **A**. You can move to **B** later by switching `DATABASE_URL` to PostgreSQL and moving the data (see OPERATIONS.md → "Moving from SQLite to PostgreSQL").

---

## Before any option: domain and secrets

1. **Domain.** Buy one (GoDaddy, Namecheap, Cloudflare, Hostinger...). Pick a subdomain for the menu, e.g. `menu.hungrymango.in`.
2. **Secret.** Generate and keep somewhere safe (a password manager):
   ```bash
   openssl rand -base64 48
   ```
3. **Owner password.** 10+ characters, unique to this app.

---

## Option A — One server with Docker (recommended)

### A1. Create the server

Any Linux VPS with a public IP. Close to your guests is better; for Mumbai:

- AWS Lightsail (Mumbai `ap-south-1`), DigitalOcean (Bangalore `blr1`), Linode/Akamai (Mumbai), Hetzner (nearest is Singapore), or any Indian VPS provider.
- Size: 1 vCPU, 1 GB RAM, 25 GB disk is plenty.
- OS: Ubuntu 24.04 LTS.

Firewall: allow inbound **22** (SSH), **80** and **443** (web). Nothing else.

### A2. Point your domain at it

At your DNS provider, add an **A record**: name `menu`, value = the server's public IP. If your provider shows a proxy toggle (Cloudflare's orange cloud), turn it **off** for option A so Caddy can get its certificate. Check it resolves:

```bash
dig +short menu.hungrymango.in    # should print your server IP (may take a few minutes)
```

### A3. Prepare the server

```bash
ssh root@<server-ip>

# Create a non-root user and give it Docker access
adduser deploy && usermod -aG sudo deploy
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Basic hardening
apt-get update && apt-get -y upgrade
apt-get install -y ufw unattended-upgrades
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades
exit
ssh deploy@<server-ip>
```

Optional but wise: disable password SSH logins after adding your SSH key (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `sudo systemctl restart ssh`).

### A4. Get the code onto the server

```bash
git clone https://github.com/<you>/hungry-mango.git
cd hungry-mango
cp .env.example .env
nano .env
```

Set at least:

```ini
APP_SECRET=<your generated secret>
NODE_ENV=production
PUBLIC_URL=https://menu.hungrymango.in
TZ=Asia/Kolkata
RESTAURANT_NAME=Hungry Mango
TABLE_COUNT=12
ADMIN_BOOTSTRAP_USER=owner
ADMIN_BOOTSTRAP_PASSWORD=<your owner password>
```

`DATABASE_URL` and `TRUST_PROXY` are set by `docker-compose.yml`; you don't need them in `.env` for this option.

### A5. Start it

```bash
DOMAIN=menu.hungrymango.in docker compose up -d --build
docker compose logs -f app       # wait for "Hungry Mango is running", then Ctrl+C
```

To avoid typing `DOMAIN=` every time, add `DOMAIN=menu.hungrymango.in` to `.env` (Compose reads `.env` for variable substitution).

Caddy fetches a Let's Encrypt certificate within about a minute. Open `https://menu.hungrymango.in/admin` and sign in.

### A6. Remove the bootstrap password

```bash
nano .env      # delete the ADMIN_BOOTSTRAP_PASSWORD value
docker compose up -d
```

### A7. Backups (do this now, not later)

```bash
# Nightly SQLite backup at 03:30, keep 14 days
sudo mkdir -p /var/backups/hungry-mango && sudo chown deploy /var/backups/hungry-mango
crontab -e
```

Add:

```cron
30 3 * * * cd /home/deploy/hungry-mango && docker compose exec -T app node --disable-warning=ExperimentalWarning server/cli/backup.js /app/data/backups/nightly.db && docker compose cp app:/app/data/backups/nightly.db /var/backups/hungry-mango/hm-$(date +\%F).db && find /var/backups/hungry-mango -name 'hm-*.db' -mtime +14 -delete
```

Then copy `/var/backups/hungry-mango` off the server regularly (rclone to Google Drive/S3, or your provider's snapshot feature). A backup on the same disk doesn't survive the disk dying. Restore steps are in OPERATIONS.md.

### A8. Updating later

```bash
cd ~/hungry-mango
git pull
docker compose up -d --build
```

Database migrations run automatically on start. Downtime is a few seconds while the container restarts; guests' phones reconnect by themselves.

---

## Option B — Load-balanced cluster with PostgreSQL

```
                 ┌──────────────── nginx (load balancer, rate limits) ─────────────────┐
 guests ─HTTPS─▶ │  least-connections across app replicas, SSE unbuffered               │
                 └──────────┬───────────────────┬───────────────────┬───────────────────┘
                         app #1              app #2              app #3      (stateless)
                            └──────── PostgreSQL 16 (data + LISTEN/NOTIFY) ───────┘
```

Every app instance is stateless. Data, photos and live-update events all go through PostgreSQL, so an order placed on instance #2 appears instantly on an admin screen connected to instance #3.

### B1. Server(s) and DNS

Same as A1–A3, with a larger server (2 vCPU, 4 GB). For real redundancy use a managed PostgreSQL (AWS RDS Mumbai, DigitalOcean Managed Postgres Bangalore, Supabase, Neon) instead of the bundled container, and run app instances on two servers behind a cloud load balancer.

### B2. Configure

```bash
cp .env.example .env
nano .env
```

```ini
APP_SECRET=<secret>                 # identical on every instance
NODE_ENV=production
PUBLIC_URL=https://menu.hungrymango.in
TZ=Asia/Kolkata
POSTGRES_PASSWORD=<another long random value>
ADMIN_BOOTSTRAP_USER=owner
ADMIN_BOOTSTRAP_PASSWORD=<owner password>
TRUST_PROXY=2                        # Cloudflare + nginx. Use 1 if nginx terminates TLS itself.
```

`APP_SECRET` **must be the same on all instances**, or a guest who lands on a different instance will look signed out of their table.

### B3. TLS

Pick one:

- **Cloudflare (simplest).** Add your domain to Cloudflare, create the `menu` A record pointing at the server with the orange-cloud proxy **on**, set SSL/TLS mode to **Full**. Cloudflare serves HTTPS to guests; nginx listens on port 80. Keep `TRUST_PROXY=2`. Lock port 80 to Cloudflare's IP ranges in your firewall so nobody bypasses it.
- **Your own certificates.** Get certificates with certbot (`sudo certbot certonly --standalone -d menu.hungrymango.in` before starting nginx), copy `fullchain.pem` and `privkey.pem` into `deploy/nginx/certs/`, uncomment the HTTPS server block in `deploy/nginx/nginx.conf`, enable the HTTP→HTTPS redirect, set `TRUST_PROXY=1`.

### B4. Start

```bash
docker compose -f docker-compose.scale.yml up -d --build
docker compose -f docker-compose.scale.yml ps        # db healthy, 3 × app, lb up
docker compose -f docker-compose.scale.yml logs -f app
```

The first instance to start creates the tables, seeds the menu and creates the owner. Instances starting at the same moment wait on a PostgreSQL advisory lock, so migrations never run twice.

### B5. Scale up or down

```bash
docker compose -f docker-compose.scale.yml up -d --scale app=5
```

nginx re-resolves the replica list every 10 seconds, so new instances start receiving traffic on their own.

### B6. Updating

```bash
git pull
docker compose -f docker-compose.scale.yml up -d --build app
```

Compose recreates the app containers with the new image. Expect a few seconds where some requests are retried: nginx retries a failed request on another instance (`proxy_next_upstream`), and phones reconnect their live connection within ~3 seconds and re-sync. In practice guests don't notice.

If you need strictly zero-downtime deploys, run the same image under Docker Swarm (`docker stack deploy` with `update_config: { order: start-first, parallelism: 1 }`) or Kubernetes with a rolling update and `/readyz` as the readiness probe. The app is ready for both: it's stateless, shuts down gracefully on SIGTERM, and exposes `/healthz` and `/readyz`.

### B7. Backups

```bash
docker compose -f docker-compose.scale.yml exec -T db pg_dump -U hm -Fc hungrymango > hm-$(date +%F).dump
```

Schedule it in cron as in A7. With managed Postgres, turn on the provider's automatic backups and point-in-time recovery.

### B8. Things to know about the cluster

- **Rate limits** are enforced twice: nginx limits per IP across the whole cluster (`deploy/nginx/nginx.conf`), and each app instance limits per IP on its own. A Redis-backed shared limiter is not needed at restaurant scale.
- **Live updates** use one long-lived PostgreSQL connection per instance for LISTEN, plus the pool (`PG_POOL_MAX`, default 10). Size Postgres `max_connections` ≥ instances × 11 + headroom.
- **Sticky sessions are not required.**

---

## Option C — Fly.io (managed, Mumbai region)

Fly runs the Docker image for you with automatic HTTPS. `fly.toml` is ready, set to region `bom` (Mumbai).

```bash
# Install: https://fly.io/docs/flyctl/install/
fly auth signup                       # or: fly auth login
fly launch --no-deploy --copy-config  # pick a unique app name when asked; keep region bom
fly volumes create hm_data --region bom --size 1
fly secrets set APP_SECRET="$(openssl rand -base64 48)" \
  ADMIN_BOOTSTRAP_PASSWORD='<owner password>' \
  PUBLIC_URL=https://<your-app>.fly.dev \
  RESTAURANT_NAME='Hungry Mango'
fly deploy
fly logs                               # wait for "Hungry Mango is running"
```

Then:

1. Sign in at `https://<your-app>.fly.dev/admin`.
2. Remove the bootstrap password: `fly secrets unset ADMIN_BOOTSTRAP_PASSWORD`.
3. Custom domain: `fly certs add menu.hungrymango.in`, then add the DNS records it prints. Update `PUBLIC_URL` with `fly secrets set PUBLIC_URL=https://menu.hungrymango.in`.
4. Backups: `fly ssh console -C "node --disable-warning=ExperimentalWarning server/cli/backup.js /app/data/backups/manual.db"` then `fly ssh sftp get /app/data/backups/manual.db`. Also enable volume snapshots in the Fly dashboard.

Keep **one** machine with SQLite (`fly scale count 1`). For more machines, attach Postgres (`fly postgres create`, then `fly postgres attach`, which sets `DATABASE_URL`) and remove the volume mount.

---

## Option D — Render or Railway

Both build from the `Dockerfile` in your GitHub repo.

**Render**
1. New → Web Service → connect your repo → Runtime: **Docker**. Region: Singapore (closest to India).
2. Instance type: a paid plan (persistent disks aren't available on free).
3. Add a **Disk**: mount path `/app/data`, 1 GB.
4. Environment: `APP_SECRET`, `NODE_ENV=production`, `PUBLIC_URL=https://<service>.onrender.com`, `DATABASE_URL=sqlite:/app/data/hungry-mango.db`, `TRUST_PROXY=1`, `TZ=Asia/Kolkata`, `ADMIN_BOOTSTRAP_USER=owner`, `ADMIN_BOOTSTRAP_PASSWORD=...`.
5. Health check path: `/readyz`.
6. Deploy, sign in, remove `ADMIN_BOOTSTRAP_PASSWORD`, add your custom domain under Settings.

**Railway**
1. New Project → Deploy from GitHub repo (it detects the Dockerfile).
2. Add a **Volume** mounted at `/app/data`.
3. Variables: same list as Render. Or add a Railway PostgreSQL and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` (then the volume isn't needed).
4. Settings → Networking → Generate Domain (or add yours). Health check `/readyz`.

Both platforms put one proxy in front of your app, so `TRUST_PROXY=1`. Both support Server-Sent Events without extra configuration.

---

## Running without Docker (systemd)

If you prefer plain Node on a VPS:

```bash
sudo apt-get install -y nodejs   # 22.x from NodeSource, see SETUP.md
sudo useradd --system --home /opt/hungry-mango hm
sudo git clone https://github.com/<you>/hungry-mango.git /opt/hungry-mango
cd /opt/hungry-mango && sudo npm ci --omit=dev && sudo cp .env.example .env && sudo nano .env
sudo chown -R hm:hm /opt/hungry-mango
```

`/etc/systemd/system/hungry-mango.service`:

```ini
[Unit]
Description=Hungry Mango
After=network.target

[Service]
User=hm
WorkingDirectory=/opt/hungry-mango
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/hungry-mango/data
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now hungry-mango
journalctl -u hungry-mango -f
```

Put Caddy in front (`sudo apt install caddy`, then a Caddyfile like `deploy/Caddyfile` with `reverse_proxy 127.0.0.1:8080`), set `HOST=127.0.0.1` and `TRUST_PROXY=1`.

---

## Reverse proxy requirements (any setup)

If you use a proxy other than the ones provided, it must:

1. **Not buffer** `/api/session/stream` and `/api/admin/stream` (Server-Sent Events). nginx: `proxy_buffering off`. Caddy: `flush_interval -1`. The app also sends `X-Accel-Buffering: no`.
2. **Allow long-lived responses** on those two paths (read timeout ≥ 1 hour). The server sends a heartbeat every 20 seconds.
3. **Append** the client IP to `X-Forwarded-For` and set `X-Forwarded-Proto`.
4. Allow request bodies up to `MAX_UPLOAD_KB` (default 1.5 MB) for photo uploads.

---

## Go-live checklist

**Configuration**
- [ ] `NODE_ENV=production`
- [ ] `APP_SECRET` is long, random, stored in a password manager, identical across instances
- [ ] `PUBLIC_URL` is your final `https://` address
- [ ] `TZ=Asia/Kolkata`
- [ ] `TRUST_PROXY` matches the number of proxies (1 for Caddy/nginx, 2 for Cloudflare + nginx)
- [ ] `ADMIN_BOOTSTRAP_PASSWORD` removed after the first sign-in

**Security**
- [ ] `https://` works and `http://` redirects to it
- [ ] Only ports 22, 80, 443 are open; SSH uses keys
- [ ] Owner password is strong; each staff member has their own account (no sharing)
- [ ] `https://<domain>/metrics` returns 404 (or needs your token)
- [ ] Test at https://securityheaders.com: expect an A

**Content**
- [ ] Menu, prices and GST checked in the admin
- [ ] Offers set the way you want
- [ ] You have the right to use every dish photo
- [ ] QR table cards printed from **Print QR cards**, each scanned once with a phone to confirm it opens the right table

**Operations**
- [ ] Nightly backups running, and copied off the server
- [ ] You have restored a backup once on a test machine (see OPERATIONS.md)
- [ ] Uptime monitor on `https://<domain>/readyz` (UptimeRobot, Better Stack, etc.)
- [ ] CI passing on GitHub (both SQLite and PostgreSQL jobs)

**Dry run**
- [ ] Open a table, join from two phones, both see the same plate, place an order
- [ ] Accept → ready → served on the admin; the phones show each step
- [ ] Settle & close; the phones show "Thanks for eating with us"
- [ ] Re-open the table: the old code no longer works
