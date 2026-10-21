import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../../server/http/core.js';
const req = (xff, remote = '10.0.0.5') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
test('without a trusted proxy the socket address is used, headers are ignored', () => assert.equal(clientIp(req('1.2.3.4'), 0), '10.0.0.5'));
test('one proxy: the right-most entry (added by our proxy) wins over a forged left entry', () => assert.equal(clientIp(req('6.6.6.6, 203.0.113.9'), 1), '203.0.113.9'));
test('two proxies (Cloudflare + nginx)', () => assert.equal(clientIp(req('6.6.6.6, 203.0.113.9, 172.68.1.1'), 2), '203.0.113.9'));
