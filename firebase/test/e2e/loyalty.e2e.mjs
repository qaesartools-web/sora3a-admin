// خصم الزبون الدائم (الدلفري) + أجرة التوصيل المجانية
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const put = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); }); };
const orders = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDocs(query(collection(c.firestore(), 'orders'), where('restaurantId', '==', 'RL')))).docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.owner = await signUp('owner@loy.iq', 'secret123');
  U.cash = await signUp('cash@loy.iq', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RL', email: 'owner@loy.iq', name: 'مطعم الولاء' });
    await setDoc(doc(db, 'users', U.cash), { role: 'cashier', restaurantId: 'RL', email: 'cash@loy.iq', name: 'علي', perms: { discount: false, cancel: false, inventory: false, menu: false, settings: false } });
    await setDoc(doc(db, 'restaurants/RL'), { name: 'مطعم الولاء', userId: U.owner, active: true });
    await setDoc(doc(db, 'captains/CL'), { restaurantId: 'RL', userId: 'z', name: 'كرار', available: true });
    await setDoc(doc(db, 'restaurants/RL/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'زنكر', variants: [{ name: 'وحدة', price: 10000 }] }] }] });
    // زبون عنده 4 طلبات دلفري → طلبه الخامس يستحق الخصم
    await setDoc(doc(db, 'restaurants/RL/customers/07701112222'), { phone: '07701112222', name: 'أبو حسين', address: 'المنصور', orders: 4, dOrders: 4 });
    // زبون قديم بدون عدّاد دلفري (يعتمد على orders) — 9 طلبات → العاشر يستحق
    await setDoc(doc(db, 'restaurants/RL/customers/07809998877'), { phone: '07809998877', name: 'أم علي', address: 'زيونة', orders: 9 });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function posLogin(p) {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'cash@loy.iq'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.waitForTimeout(1200);
}
async function startDelivery(p, phone) {
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('4');
  await p.waitForSelector('#delivOv.on');
  await p.fill('#dPhone', phone);
}

test('owner turns on the loyalty discount from the admin app', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'owner@loy.iq'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('.dnav-btn[data-screen="scMyRest"]', { timeout: 15000 });
  await p.click('.dnav-btn[data-screen="scMyRest"]');
  await p.waitForSelector('#lyCard');
  await p.waitForTimeout(800);
  await p.fill('#lyEvery', '5'); await p.selectOption('#lyType', 'pct'); await p.fill('#lyValue', '40'); await p.fill('#lyCap', '');
  await p.click('#lyCard .tgl');
  const ly = await until(async () => { const d = await read('restaurants/RL/loyalty/main'); return d && d.on ? d : null; });
  assert.deepEqual({ on: ly.on, every: ly.every, type: ly.type, value: ly.value }, { on: true, every: 5, type: 'pct', value: 40 });
  await p.waitForFunction(() => document.getElementById('lyStatus').textContent.includes('مفعّلة'));
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('cashier (no discount permission) sees the reward, tells the customer, applies it; free delivery works', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await posLogin(p);
  await startDelivery(p, '07701112222');
  await p.waitForSelector('#loyHint .loy-hint', { timeout: 8000 });
  const hint = await p.textContent('#loyHint');
  assert.match(hint, /يستحق خصم/); assert.match(hint, /40/); assert.match(hint, /بلّغت الزبون/);
  await p.screenshot({ path: 'shots/loyalty-hint.png' });
  await p.click('#loyHint button');
  await p.waitForSelector('#loyHint .loy-hint.done');
  // أزرار الأجرة الجديدة: مجاني لحد 4000
  const fees = await p.$$eval('#feePresets .fee-p', (b) => b.map((x) => x.textContent));
  assert.deepEqual(fees, ['مجاني', '500', '1,000', '1,500', '2,000', '2,500', '3,000', '3,500', '4,000']);
  await p.click('#feePresets .fee-p.free');
  assert.equal(await p.inputValue('#dFee'), '0');
  await p.screenshot({ path: 'shots/loyalty-applied.png' });
  await p.click('#capList .capcard'); await p.click('#confCapBtn');
  const o = await until(async () => (await orders())[0]);
  assert.equal(o.subtotal, 10000); assert.equal(o.discount, 4000); assert.equal(o.value, 6000);
  assert.equal(o.discountInfo.loyalty, true); assert.equal(o.discountInfo.reason, 'خصم الزبون الدائم');
  assert.equal(o.loyalty.n, 5); assert.equal(o.fee, 0);
  const cust = await until(async () => { const d = await read('restaurants/RL/customers/07701112222'); return d.dOrders === 5 ? d : null; });
  assert.equal(cust.loyaltyGiven, 1);
  // الطلب الجاي لنفس الزبون (السادس) ما يستحق
  await startDelivery(p, '07701112222');
  await p.waitForTimeout(1200);
  assert.equal(await p.$('#loyHint .loy-hint'), null);
  await p.click('#delivOv', { position: { x: 5, y: 5 } });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('legacy customer counts from orders; turning the service off removes it immediately', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await posLogin(p);
  await startDelivery(p, '07809998877');
  await p.waitForSelector('#loyHint .loy-hint', { timeout: 8000 });
  assert.match(await p.textContent('#loyHint'), /رقم 10/);
  await p.click('#loyHint button');
  await p.waitForSelector('#loyHint .loy-hint.done');
  // الإدارة توقف الخدمة → يختفي الشريط ويُزال الخصم من السلة
  await put('restaurants/RL/loyalty/main', { on: false, every: 5, type: 'pct', value: 40, cap: 0 });
  await p.waitForFunction(() => !document.querySelector('#loyHint .loy-hint'), null, { timeout: 8000 });
  await p.click('#capList .capcard'); await p.click('#confCapBtn');
  const o = await until(async () => (await orders()).find((x) => x.phone === '07809998877'));
  assert.equal(o.discount, 0); assert.equal(o.loyalty, undefined);
  const cust = await until(async () => { const d = await read('restaurants/RL/customers/07809998877'); return d.dOrders === 10 ? d : null; });
  assert.equal(cust.loyaltyGiven, undefined);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
