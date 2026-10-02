import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 300)); } };
const all = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), 'orders'), where('restaurantId', '==', 'RO'))); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const uid = await signUp('off@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', uid), { role: 'restaurant', restaurantId: 'RO', email: 'off@x.com' });
    await setDoc(doc(db, 'restaurants/RO'), { name: 'مطعم بدون نت', userId: uid, active: true });
    await setDoc(doc(db, 'restaurants/RO/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }] }] }); });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('cashier keeps selling without internet and syncs when it returns', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'off@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.waitForTimeout(1500);
  // ── انقطاع الإنترنت
  const ctx = p.context();
  await ctx.route(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/, (r) => r.abort());
  await ctx.setOffline(true); await ctx.unroute(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/);
  await ctx.route(/:(8080|9099)\//, (r) => r.abort());
  await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await p.waitForSelector('#offBanner', { state: 'visible' });
  // صالة مدفوعة: لازم تخلص خلال ثواني (ما تعلق بانتظار السيرفر)
  const t0 = Date.now();
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on'); await p.click('#payOk');
  await p.waitForFunction(() => cart.length === 0 && document.getElementById('prtFr').srcdoc.includes('الإجمالي'), null, { timeout: 5000 });
  // سفري قيد التحضير ثم تسليمه (عملية تنتظر تحديث الطلب)
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('3'); await p.click('#acDlgOk');
  await p.waitForFunction(() => orders.some((o) => o.held && o.status === 'preparing'), null, { timeout: 5000 });
  const heldId = await p.evaluate(() => orders.find((o) => o.held).id);
  await p.evaluate((id) => kdsDone(id), heldId);
  await p.waitForFunction((id) => orders.find((o) => o.id === id).status === 'ready', heldId, { timeout: 5000 });
  assert.ok(Date.now() - t0 < 15000, 'offline flow is fast');
  assert.equal((await all()).length, 0, 'nothing reached the server yet');
  // ── رجوع الإنترنت: كل شيء يوصل للسيرفر
  await ctx.unroute(/:(8080|9099)\//); await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  const synced = await until(async () => { const o = await all(); return o.length === 2 && o.find((x) => x.held && x.status === 'ready') ? o : null; }, 30000);
  assert.ok(synced, 'orders synced after reconnect');
  assert.ok(synced.some((o) => o.orderType === 'salon' && o.status === 'delivered'));
  await p.context().close();
});

test('inventory tabs stay reachable after opening stock movement, with a back button', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'off@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.click('.dnb[data-tab="acc"]');
  await p.click('#acTabs .mtab >> text=حركة المخزون');
  await p.click('#acTabs .mtab >> text=المصروفات', { timeout: 3000 });
  await p.click('#acTabs .mtab >> text=قائمة الدخل', { timeout: 3000 });
  assert.equal(await p.evaluate(() => acCur), 'fin');
  await p.click('#acTabs .ac-back'); assert.equal(await p.evaluate(() => acCur), 'exp');
  await p.click('#acTabs .ac-back'); assert.equal(await p.evaluate(() => acCur), 'mov');
  assert.ok((await p.locator('#acTabs').boundingBox()).height > 30);
  await p.context().close();
});
