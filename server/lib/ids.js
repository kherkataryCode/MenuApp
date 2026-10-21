import { randomBytes, randomInt, createHash, createHmac, timingSafeEqual } from 'node:crypto';
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
export function rid(n = 16) { const b = randomBytes(n); let s = ''; for (const x of b) s += ALPHA[x % 32]; return s; }
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const code4 = () => String(randomInt(1000, 10000));
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const hmac = (key, data) => createHmac('sha256', key).update(data).digest('base64url');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}
