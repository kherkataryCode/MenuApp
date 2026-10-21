// Real-browser test: admin and a phone-sized guest side by side.
// Needs: npm install && npx playwright install chromium
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, OWNER } from '../helpers.js';

let srv, browser; const errors = [];
const watch = (page, who) => { page.on('pageerror', e => errors.push(`${who}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|cdnjs|ERR_|net::|Failed to load resource/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
before(async () => { srv = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

test('admin and guest complete a full service', async () => {
  const actx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); const a = await actx.newPage(); watch(a, 'admin');
  await a.goto(srv.base + '/admin');
  await a.fill('input[autocomplete=username]', OWNER.username); await a.fill('input[type=password]', OWNER.password); await a.click('button[type=submit]');
  await a.waitForSelector('.k-t'); await a.locator('.k-t').nth(2).locator('.k-btn.primary').click();
  await a.waitForSelector('.k-t.open .k-code b'); const code = (await a.locator('.k-t.open .k-code b').first().innerText()).trim(); assert.match(code, /^\d{4}$/);

  const gctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); const g = await gctx.newPage(); watch(g, 'guest');
  await g.goto(srv.base + '/t/3'); await g.waitForSelector('.code-box');
  await g.locator('.code-box').first().click(); await g.keyboard.type('0000'); await g.waitForFunction(() => /match/.test(document.querySelector('.join-msg')?.textContent || ''));
  await g.locator('.code-box').first().click(); await g.keyboard.type(code);
  await g.waitForSelector('.rv-name.land', { timeout: 8000 }); const nick = await g.innerText('.rv-name'); assert.ok(nick.length > 3);
  await g.click("text=Let's eat"); await g.waitForSelector('.card.pop');
  const first = await g.innerText('.info .name');
  const box = await g.locator('.stage').boundingBox(); const y = box.y + box.height / 2;
  await g.mouse.move(box.x + 300, y); await g.mouse.down(); for (let i = 0; i < 10; i++) { await g.mouse.move(box.x + 300 - i * 20, y); await g.waitForTimeout(16); } await g.mouse.up();
  await g.waitForTimeout(1200); assert.notEqual(await g.innerText('.info .name'), first, 'swipe moves to another dish');
  // smoothness: frame intervals while the spring animates
  const ft = await g.evaluate(async () => { const ts = []; let run = true; const f = t => { ts.push(t); if (run) requestAnimationFrame(f); }; requestAnimationFrame(f); window.__snapTo(0); await new Promise(r => setTimeout(r, 900)); run = false; const d = ts.slice(1).map((t, i) => t - ts[i]); return Math.max(...d); });
  assert.ok(ft < 40, `longest frame ${ft}ms`);
  await g.waitForTimeout(400); await g.click('.add'); await g.waitForFunction(() => /1 item/.test(document.querySelector('.platebar')?.textContent || ''));
  await g.click('.cat[data-cat=sips]'); await g.waitForTimeout(1000); await g.click('.add'); await g.waitForFunction(() => /2 items/.test(document.querySelector('.platebar')?.textContent || ''));
  await g.click('.platebar'); await g.waitForSelector('.sheet.open .bill .tot');
  const shown = await g.innerText('.sheet.open .bill .tot'); await g.click('.sheet.open .sh-foot .btn-big'); await g.waitForSelector('.sent');

  // admin sees it live, accepts; guest is told
  await a.waitForSelector('.k-pending .k-o', { timeout: 5000 }); assert.match(await a.innerText('.k-pending .k-o'), new RegExp(nick.split(' ')[0]));
  assert.equal((await a.innerText('.k-pending .k-o-foot span')).trim(), shown.split('\n').pop().trim(), 'kitchen total equals what the guest saw');
  await a.click('.k-pending .k-btn.primary'); await g.waitForSelector('.toast >> text=Cooking', { timeout: 5000 });

  // owner adds a dish; guest's menu updates live
  await a.click('text=Menu'); await a.waitForSelector('.m-cat'); await a.click('text=Add category');
  await a.fill('.f-card input.f-in', 'Biryani'); await a.click('.f-card .k-btn.primary'); await a.waitForSelector('.m-cat-n >> text=Biryani');
  await a.click('.m-h-act .k-btn.primary'); await a.fill('input[placeholder^="e.g. Paneer"]', 'Hyderabadi Dum Biryani'); await a.fill('.f-card input[type=number]', '399');
  await a.click('text=Choose from gallery'); await a.locator('.g-tile').first().click(); await a.click('.f-libb >> text=Rice');
  await a.click('.f-foot .k-btn.primary'); await a.waitForSelector('.m-item >> text=Hyderabadi Dum Biryani');
  await g.waitForSelector('.cat >> text=Biryani', { timeout: 5000 });

  // closing the table ends the guest's session immediately
  await a.click('text=Orders & tables'); a.once('dialog', d => d.accept());
  await a.locator('.k-t.open .k-btn.danger').click(); await g.waitForSelector('text=Thanks for eating with us', { timeout: 5000 });
  assert.deepEqual(errors, []);
});
