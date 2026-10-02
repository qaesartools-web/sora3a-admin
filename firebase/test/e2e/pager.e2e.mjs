import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const all = async (col, f, val) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where(f, '==', val))); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const uid = await signUp('pg@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', uid), { role: 'restaurant', restaurantId: 'RG', email: 'pg@x.com' });
    await setDoc(doc(db, 'restaurants/RG'), { name: 'مطعم البيجر', userId: uid, active: true });
    await setDoc(doc(db, 'restaurants/RG/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }, { name: 'زنكر', variants: [{ name: 'وحدة', price: 4000 }] }] }] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('pager: assign 1-10 at checkout → busy → kitchen ready alerts → free after pickup', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'pg@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#appPage.show', { timeout: 15000 });
  await p.waitForSelector('#prods .prod');
  assert.equal(await p.locator('#pagerBar .pg').count(), 10);
  // صالة مع بيجر ٢
  await p.click('#prods .prod >> nth=0');
  await p.click('#pagerBar .pg[data-pg="2"]');
  assert.ok(await p.locator('#pagerBar .pg[data-pg="2"].sel').count());
  await p.click('#sendBtn'); await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on'); await p.click('#payOk');
  const o2 = await until(async () => (await all('orders', 'restaurantId', 'RG')).find((x) => x.pager === 2));
  assert.equal(o2.orderType, 'salon');
  await p.waitForSelector('#pagerBar .pg[data-pg="2"].busy');
  const rc = await p.evaluate(() => document.getElementById('prtFr').srcdoc);
  assert.ok(rc.includes('بيجر رقم 2'));
  // سفري قيد التحضير مع بيجر ٥
  await p.click('#prods .prod >> nth=1');
  await p.click('#pagerBar .pg[data-pg="5"]');
  await p.click('#sendBtn'); await p.keyboard.press('3');
  await p.click('#acDlgOk');
  await until(async () => (await all('orders', 'restaurantId', 'RG')).find((x) => x.pager === 5));
  await p.waitForSelector('#pagerBar .pg[data-pg="5"].busy');
  // المشغول لا يُختار لطلب جديد
  await p.click('#prods .prod >> nth=0');
  await p.click('#pagerBar .pg[data-pg="2"]');
  await p.waitForSelector('#acOv.on'); assert.match(await p.textContent('#acDlgTitle'), /قيد التحضير/);
  // من نافذة البيجر: المطبخ جاهز → أخضر + تنبيه
  await p.evaluate(() => { window.__toasts = []; const t = window.toast; window.toast = (m, ...a) => { window.__toasts.push(m); return t(m, ...a); }; });
  await p.click('#acDlgOk');
  await p.waitForSelector('#pagerBar .pg[data-pg="2"].ready', { timeout: 8000 });
  await p.waitForFunction(() => window.__toasts.some((m) => m.includes('اضغط البيجر رقم 2')), null, { timeout: 5000 });
  await p.evaluate(() => goTab('kitchen'));
  await p.click('.kds-card:has(.kds-pager) .kds-done');
  await p.evaluate(() => goTab('cashier'));
  await p.waitForSelector('#pagerBar .pg[data-pg="5"].ready', { timeout: 8000 });
  await p.screenshot({ path: 'shots/pos-pager.png' });
  // الزبون استلم → يتحرر
  await p.click('#pagerBar .pg[data-pg="2"]'); await p.click('#acDlgOk');
  await p.waitForSelector('#pagerBar .pg[data-pg="2"]:not(.busy):not(.ready)');
  // سفري غير مدفوع: الاستلام يفتح الدفع ثم يتحرر
  await p.click('#pagerBar .pg[data-pg="5"]'); await p.click('#acDlgOk');
  await p.waitForSelector('#payOv.on'); await p.click('#payOk');
  await p.waitForSelector('#pagerBar .pg[data-pg="5"]:not(.busy):not(.ready)');
  const o5 = (await all('orders', 'restaurantId', 'RG')).find((x) => x.pager === 5);
  assert.equal(o5.status, 'delivered'); assert.equal(o5.pagerDone, true);
  // دلفري لا يأخذ بيجر
  await p.click('#pagerBar .pg[data-pg="7"]');
  await p.screenshot({ path: 'shots/pos-pager-sel.png' });
  assert.deepEqual(clean(p), []);
  await p.context().close();
  // موبايل
  const m = await page(B, { w: 390, h: 800 });
  await m.goto('http://localhost:5050/sora3a-rest2/index.html');
  await m.waitForSelector('#appPage.show', { timeout: 15000 }).catch(async () => {
    await m.fill('#inEmail', 'pg@x.com'); await m.fill('#inPass', 'secret123'); await m.click('#loginBtn'); await m.waitForSelector('#appPage.show', { timeout: 15000 });
  });
  await m.waitForSelector('#prods .prod');
  await m.click('#prods .prod >> nth=0'); await m.click('#cartHead');
  await m.waitForTimeout(500);
  await m.screenshot({ path: 'shots/pos-pager-mobile.png' });
  await m.context().close();
});
