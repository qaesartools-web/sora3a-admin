import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

// الكاشير ينزّل بس الطلبات الجديدة (من بداية أمس) + المفتوحة والآجلة من أي يوم — مو كل تاريخ المطعم
let srv, E, B;
const DAY = 86400000;
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('lown@x.com', 'secret123');
  const now = Date.now();
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RL', email: 'lown@x.com', name: 'المالك' });
    await setDoc(doc(db, 'restaurants/RL'), { name: 'مطعم التحميل', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RL/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 5000 }] }] }] });
    const o = (id, extra) => setDoc(doc(db, 'orders/' + id), { restaurantId: 'RL', status: 'delivered', orderType: 'takeaway', value: 5000, items: [{ name: 'كلاسك', variant: 'وحدة', price: 5000, qty: 1 }], ...extra });
    for (let i = 0; i < 30; i++) await o('OLD' + i, { createdAtMs: now - (10 + i) * DAY });                       // تاريخ قديم: ما ينزل
    await o('OPEN1', { orderType: 'delivery', status: 'pending', createdAtMs: now - 5 * DAY, customer: 'طلب معلّق' });   // مفتوح من أيام: ينزل
    await o('LATER1', { orderType: 'salon', createdAtMs: now - 4 * DAY, payment: { method: 'later', cash: 0, card: 0 } }); // آجل: ينزل
    await o('TODAY1', { createdAtMs: now - 60000 });
    // وردية مفتوحة من ٣ أيام (أقدم من النافذة) بيها طلب نقدي
    await setDoc(doc(db, 'restaurants/RL/shifts/S3'), { status: 'open', openedAtMs: now - 3 * DAY, openingCash: 0, cashier: 'علي', uid: own, cashMoves: [] });
    await o('SH1', { createdAtMs: now - 3 * DAY + 3600000, shiftId: 'S3', value: 7000, payment: { method: 'cash', cash: 7000, card: 0, shiftId: 'S3', atMs: now - 3 * DAY + 3600000 } });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function pos(init) {
  const p = await page(B, { w: 1280, h: 860 });
  if (init) await p.addInitScript(init);
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'lown@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  return p;
}

test('cashier loads only recent + open + unpaid orders; old ones on demand; old open shift still complete', async () => {
  const p = await pos();
  await p.waitForFunction(() => orders.some((o) => o.id === 'TODAY1'));
  await p.waitForTimeout(800);
  const ids = await p.evaluate(() => orders.map((o) => o.id).sort());
  assert.deepEqual(ids, ['LATER1', 'OPEN1', 'TODAY1']);
  // طلب جديد يوصل مباشرة
  await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'orders/NEW1'), { restaurantId: 'RL', status: 'pending', orderType: 'takeaway', value: 3000, createdAtMs: Date.now() }); });
  await p.waitForFunction(() => orders.some((o) => o.id === 'NEW1'));
  // المعلّق القديم ينسد → يختفي من الجهاز
  await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'orders/OPEN1'), { status: 'delivered' }, { merge: true }); });
  await p.waitForFunction(() => !orders.some((o) => o.id === 'OPEN1'));
  // فترة قديمة (للتقارير): تنجاب من السيرفر وقت الطلب
  const old = await p.evaluate(() => new Promise((res) => {
    const from = Date.now() - 45 * 86400000, to = Infinity;
    const first = posOrdersIn(from, to, () => res({ loading: first.loading, n: posOrdersIn(from, to).list.length }));
    if (!first.loading) res({ loading: false, n: first.list.length });
  }));
  assert.equal(old.loading, true);
  assert.equal(old.n, 30 + 1 + 1 + 1 + 1 + 1);   // القديمة + المعلّق + الآجل + الوردية + اليوم + الجديد
  // الوردية المفتوحة من ٣ أيام: تقريرها فيه طلبها القديم
  await p.evaluate(() => goTab('shift'));
  await p.waitForFunction(() => /7,000|٧٬٠٠٠|7000/.test(document.getElementById('shiftScreen').textContent), null, { timeout: 10000 });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('without the orders index the cashier falls back to loading everything (nothing breaks)', async () => {
  const p = await pos(() => { window.__ordLegacy = true; });
  await p.waitForFunction(() => orders.length >= 33, null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => posOrdersSince()), 0);
  assert.equal(await p.evaluate(() => posOrdersIn(0, Infinity).loading), false);
  await p.context().close();
});
