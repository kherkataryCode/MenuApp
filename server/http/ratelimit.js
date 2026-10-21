// Token-bucket rate limiter (per instance). Put nginx limit_req in front for a
// cluster-wide ceiling — see deploy/nginx/nginx.conf.
import { tooMany } from '../lib/errors.js';
export function createLimiter(multiplier = 1) {
  const buckets = new Map();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 15 * 60_000) buckets.delete(k); }, 60_000); sweep.unref();
  return {
    // capacity tokens, refilled at capacity per windowMs
    hit(key, capacity, windowMs) {
      capacity *= multiplier;
      const now = Date.now(); let b = buckets.get(key);
      if (!b) { b = { tokens: capacity, t: now }; buckets.set(key, b); }
      b.tokens = Math.min(capacity, b.tokens + ((now - b.t) / windowMs) * capacity); b.t = now;
      if (b.tokens < 1) throw tooMany(Math.ceil(((1 - b.tokens) / capacity) * windowMs / 1000));
      b.tokens -= 1;
    },
    reset: () => buckets.clear(),
    close: () => clearInterval(sweep),
  };
}
