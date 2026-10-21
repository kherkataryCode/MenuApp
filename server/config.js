// All configuration comes from environment variables. See .env.example and docs/SETUP.md.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadDotEnv(file = '.env') {
  const p = resolve(file); if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue;
    let val = m[2]; if (/^(["']).*\1$/.test(val)) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
const bool = (x, d) => x === undefined || x === '' ? d : /^(1|true|yes|on)$/i.test(x);
const int = (x, d) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : d; };

export function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const cfg = {
    production,
    port: int(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    databaseUrl: env.DATABASE_URL || 'sqlite:./data/hungry-mango.db',
    secret: env.APP_SECRET || '',
    trustProxy: /^(true|yes|on)$/i.test(env.TRUST_PROXY || '') ? 1 : Math.max(0, Math.min(5, int(env.TRUST_PROXY, 0))),
    rateLimitMultiplier: Math.max(1, Math.min(1000, int(env.RATE_LIMIT_MULTIPLIER, 1))),
    tableCount: Math.max(1, Math.min(200, int(env.TABLE_COUNT, 12))),
    restaurantName: env.RESTAURANT_NAME || 'Hungry Mango',
    bootstrapUser: env.ADMIN_BOOTSTRAP_USER || '',
    bootstrapPassword: env.ADMIN_BOOTSTRAP_PASSWORD || '',
    seedOnEmpty: bool(env.SEED_ON_EMPTY, true),
    metricsToken: env.METRICS_TOKEN || '',
    adminSessionHours: int(env.ADMIN_SESSION_HOURS, 12),
    guestSessionHours: int(env.GUEST_SESSION_HOURS, 8),
    orderCooldownSec: int(env.ORDER_COOLDOWN_SECONDS, 15),
    maxUploadKb: int(env.MAX_UPLOAD_KB, 1500),
    secureCookies: bool(env.SECURE_COOKIES, production),
    logLevel: env.LOG_LEVEL || 'info',
  };
  if (!cfg.secret) {
    if (production) throw new Error('APP_SECRET is required in production (at least 32 random characters). Generate one with: openssl rand -base64 48');
    cfg.secret = 'dev-only-secret-change-me-dev-only-secret-change-me';
  }
  if (cfg.secret.length < 32) throw new Error('APP_SECRET must be at least 32 characters long.');
  return cfg;
}
