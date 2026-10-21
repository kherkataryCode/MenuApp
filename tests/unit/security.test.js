import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, checkPasswordStrength, createAuth } from '../../server/services/auth.js';
import { createLimiter } from '../../server/http/ratelimit.js';
import { v, check } from '../../server/lib/validate.js';
import { safeEqual } from '../../server/lib/ids.js';
test('scrypt hashes verify and differ per salt', async () => { const a = await hashPassword('a-very-long-password'), b = await hashPassword('a-very-long-password'); assert.notEqual(a, b); assert.ok(await verifyPassword('a-very-long-password', a)); assert.ok(!await verifyPassword('wrong-password-xx', a)); });
test('weak passwords are refused', () => { assert.throws(() => checkPasswordStrength('short')); assert.throws(() => checkPasswordStrength('aaaaaaaaaaaa')); assert.doesNotThrow(() => checkPasswordStrength('mango-lassi-2026!')); });
test('guest tokens are signed, tamper-evident and expire', () => {
  const auth = createAuth({ db: null, cfg: { secret: 'x'.repeat(40) } });
  const t = auth.signGuest({ t: 3, s: 'sess', g: 'g1', exp: Date.now() + 60000 }); assert.equal(auth.readGuest(t).t, 3);
  const [body, sig] = t.split('.'); const forged = Buffer.from(JSON.stringify({ t: 4, s: 'sess', g: 'g1', exp: Date.now() + 60000 })).toString('base64url') + '.' + sig; assert.equal(auth.readGuest(forged), null);
  assert.equal(auth.readGuest(auth.signGuest({ t: 3, s: 's', g: 'g', exp: Date.now() - 1 })), null);
  const other = createAuth({ db: null, cfg: { secret: 'y'.repeat(40) } }); assert.equal(other.readGuest(t), null); void body;
});
test('rate limiter blocks after capacity and reports retry time', () => { const l = createLimiter(); for (let i = 0; i < 3; i++) l.hit('k', 3, 60000); assert.throws(() => l.hit('k', 3, 60000), e => e.status === 429 && e.extra.retryAfter > 0); l.close(); });
test('validator rejects bad input with readable messages', () => {
  const s = v.obj({ name: v.str({ max: 5 }), qty: v.int({ min: 0, max: 50 }), kind: v.oneOf(['a', 'b']) });
  assert.deepEqual(check(s, { name: ' hi ', qty: '3', kind: 'a' }), { name: 'hi', qty: 3, kind: 'a' });
  assert.throws(() => check(s, { name: 'toolong', qty: 1, kind: 'a' }), /too long/); assert.throws(() => check(s, { name: 'x', qty: 99, kind: 'a' }), /between/); assert.throws(() => check(s, { name: 'x', qty: 1, kind: 'c' }), /one of/); assert.throws(() => check(s, []), /object/);
});
test('constant-time compare', () => { assert.ok(safeEqual('1234', '1234')); assert.ok(!safeEqual('1234', '1235')); assert.ok(!safeEqual('1234', '12345')); });
