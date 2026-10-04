import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { utimes } from 'node:fs/promises';
import { doc, setDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

let srv, E, B;
let bump = 0;
const touch = (f) => { bump += 120; const t = new Date(Date.now() + bump * 1000); return utimes(f, t, t); };
before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const uid = await signUp('au@x.com', 'secret123');
  const cap = await signUp('aucap@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', uid), { role: 'restaurant', restaurantId: 'RU', email: 'au@x.com' });
    await setDoc(doc(db, 'users', cap), { role: 'captain', restaurantId: 'RU', captainId: 'CU', email: 'aucap@x.com' });
    await setDoc(doc(db, 'restaurants/RU'), { name: 'مطعم التحديث', userId: uid, active: true });
    await setDoc(doc(db, 'captains/CU'), { restaurantId: 'RU', userId: cap, name: 'علي', available: true });
    await setDoc(doc(db, 'restaurants/RU/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }] }] }); });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('cashier updates itself silently only when idle, and returns to the same tab', async () => {
  const f = ROOTS['sora3a-rest2'] + '/index.html';
  const p = await page(B, { w: 1280, h: 800 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'au@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.waitForTimeout(2500);                                 // أول فحص يسجّل الإصدار الحالي
  // سلة فيها طلب: ممنوع التحديث
  await p.click('#prods .prod >> nth=0');
  await p.evaluate(() => { window.__mark = 1; });
  await touch(f);
  await p.waitForTimeout(13000);
  assert.equal(await p.evaluate(() => window.__mark), 1, 'no reload while cart has items');
  // السلة فارغة لكن الشاشة أمام المستخدم: ما نحدّث أبداً
  await p.evaluate(() => { cart.length = 0; renderCart(); goTab('kitchen'); });
  await p.waitForTimeout(8000);
  assert.equal(await p.evaluate(() => window.__mark), 1, 'no reload while the app is on screen');
  // التطبيق صار بالخلفية: يتحدث ويرجع لنفس التبويب
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => window.__mark === undefined, null, { timeout: 15000 });
  await p.waitForSelector('#prods .prod, #kitchenScreen.on', { timeout: 15000 });
  await p.waitForFunction(() => document.getElementById('kitchenScreen').classList.contains('on'), null, { timeout: 8000 });
  assert.deepEqual(p.errors.filter((e) => !/favicon|Failed to load|AudioContext|messaging|serviceWorker/i.test(e)), []);
  await p.context().close();
});

test('admin and captain update silently and keep their screen', async () => {
  const a = await page(B, { w: 1280, h: 800 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html');
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'au@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#appPage', { state: 'visible' });
  await a.click('.dnav-btn[data-screen="scTimes"]');
  await a.waitForTimeout(2500);
  await a.evaluate(() => { window.__mark = 1; });
  await touch(ROOTS['sora3a-admin'] + '/index.html');
  await a.waitForTimeout(11000);
  assert.equal(await a.evaluate(() => window.__mark), 1);
  await a.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await a.waitForFunction(() => window.__mark === undefined, null, { timeout: 20000 });
  await a.waitForFunction(() => document.getElementById('scTimes').classList.contains('on'), null, { timeout: 15000 });
  await a.context().close();

  const c = await page(B, { notif: true });
  await c.goto('http://localhost:5050/sora3a-captain/captain.html');
  await c.fill('#email', 'aucap@x.com'); await c.fill('#password', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  await c.click('.nav button[data-tab="history"]');
  await c.evaluate(() => { document.querySelectorAll('.overlay.show').forEach((o) => o.classList.remove('show')); window.__mark = 1; });
  await c.waitForTimeout(2500);
  await touch(ROOTS['sora3a-captain'] + '/captain.html');
  await c.waitForTimeout(11000);
  // الكابتن بوضع الاستلام (لمس الشاشة وهو متاح): ما نعيد التحميل حتى ما ينطفي الرنين
  assert.equal(await c.evaluate(() => window.__stby().standby), true);
  await c.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await c.waitForTimeout(8000);
  assert.equal(await c.evaluate(() => window.__mark), 1, 'no reload during standby');
  // بعد ما يصير غير متاح: التحديث ينزل بصمت بالخلفية
  await c.evaluate(() => document.getElementById('availBtn').click());
  await c.waitForFunction(() => !window.__stby().standby, null, { timeout: 5000 });
  await c.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await c.waitForFunction(() => window.__mark === undefined, null, { timeout: 20000 });
  await c.waitForFunction(() => document.querySelector('.nav button[data-tab="history"]').classList.contains('on'), null, { timeout: 15000 });
  await c.context().close();
});
