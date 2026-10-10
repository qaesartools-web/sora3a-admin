import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const all = async (col, f, val) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(f ? query(collection(c.firestore(), col), where(f, '==', val)) : collection(c.firestore(), col)); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const URL_ = 'http://localhost:5050/sora3a-rest2/index.html';

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.r = await signUp('pos@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.r), { role: 'restaurant', restaurantId: 'RP', email: 'pos@x.com' });
    await setDoc(doc(db, 'restaurants/RP'), { name: 'مطعم التجربة', area: 'الكرادة', phone: '0780', userId: U.r, active: true });
    await setDoc(doc(db, 'captains/CP'), { restaurantId: 'RP', userId: 'x', name: 'حسن', available: true });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function login(p) {
  await p.goto(URL_);
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'pos@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#appPage.show', { timeout: 15000 });
}
const ordersRP = () => all('orders', 'restaurantId', 'RP');
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker/i.test(e));

test('new restaurant: empty menu, import sample → synced to second device', async () => {
  const a = await page(B, { w: 1280, h: 800 });
  await login(a);
  await a.waitForSelector('.prod-empty');
  await a.click('.prod-empty button >> text=استيراد');
  await a.waitForSelector('#prods .prod');
  const m = await until(() => read('restaurants/RP/menu/main'));
  assert.ok(m && m.cats.length >= 5, 'menu pushed to cloud');
  // device 2
  const b = await page(B, { w: 1280, h: 800 });
  await login(b);
  await b.waitForFunction(() => document.querySelectorAll('#prods .prod').length > 3, null, { timeout: 15000 });
  await b.waitForTimeout(2500);   // ننتظر وصول آخر نسخة من المنيو قبل التعديل (الجهاز الأول قد يرفعها مرتين)
  // edit on device 2 → appears on device 1
  await b.evaluate(() => { menu[0].items.push({ name: 'برغر الشيف', variants: [{ name: 'وحدة', price: 6500 }] }); saveMenu(); });
  await a.waitForFunction(() => menu[0].items.some((i) => i.name === 'برغر الشيف'), null, { timeout: 15000 });
  assert.deepEqual(clean(a), []); assert.deepEqual(clean(b), []);
  await b.context().close(); await a.context().close();
});

test('shift + discount + salon cash payment with change + KDS + Z report', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await login(p);
  await p.waitForSelector('#shiftWarn.on');
  await p.click('#shiftWarn');
  await p.fill('#shOpenCash', '10000'); await p.fill('#shCashier', 'أحمد');
  await p.click('button >> text=فتح الوردية');
  const sh = await until(async () => (await all('restaurants/RP/shifts')).find((s) => s.status === 'open'));
  assert.equal(sh.openingCash, 10000);
  await p.evaluate(() => goTab('cashier'));
  // search + quick add
  await p.fill('#prodSearch', 'برغر الشيف');
  await p.waitForSelector('#prods .prod');
  await p.click('#prods .prod >> nth=0');
  await p.click('#prods .prod >> nth=0');            // qty 2 → 13,000
  await p.click('.cats .cb');                         // clear search
  // discount 10%
  await p.click('#discBtn');
  await p.selectOption('#acf_t', 'pct'); await p.fill('#acf_v', '10'); await p.click('#acDlgOk');
  assert.match(await p.textContent('#cartTotal'), /11,700/);
  // F9 → 1 (salon) → pay 20000
  await p.keyboard.press('F9');
  await p.waitForSelector('#typeOv.on');
  await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on');
  await p.fill('#payRecv', '20000');
  assert.match(await p.textContent('#payChange'), /8,300/);
  await p.keyboard.press('Enter');
  const o = await until(async () => (await ordersRP()).find((x) => x.orderType === 'salon'));
  assert.equal(o.value, 11700); assert.equal(o.subtotal, 13000); assert.equal(o.discount, 1300);
  assert.equal(o.payment.method, 'cash'); assert.equal(o.payment.change, 8300); assert.equal(o.payment.cash, 11700);
  assert.equal(o.kitchen, 'new'); assert.equal(o.shiftId, sh.id);
  assert.equal(o.items[0].qty, 2);
  assert.equal(await p.textContent('#cartTotal').then((t) => /^[0٠]/.test(t.trim())), true, 'cart cleared');
  // kitchen
  await p.evaluate(() => goTab('kitchen'));
  await p.waitForSelector('.kds-card');
  assert.match(await p.textContent('.kds-card'), /برغر الشيف/);
  await p.click('.kds-done');
  await until(async () => (await read('orders/' + o.id)).kitchen === 'ready');
  await p.waitForSelector('.kds-empty');
  // held takeaway → handover with card payment
  await p.evaluate(() => goTab('cashier'));
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('3');
  await p.waitForSelector('#acOv.on'); await p.fill('#acf_name', 'أبو علي'); await p.click('#acDlgOk');
  const h = await until(async () => (await ordersRP()).find((x) => x.held));
  assert.equal(h.status, 'preparing'); assert.equal(h.payment, undefined);
  await p.evaluate((id) => ordHandover(id), h.id);
  await p.waitForSelector('#payOv.on');
  await p.click('#payMethods button[data-m="card"]');
  await p.click('#payOk');
  const h2 = await until(async () => { const d = await read('orders/' + h.id); return d.status === 'delivered' ? d : null; });
  assert.equal(h2.payment.method, 'card'); assert.equal(h2.payment.card, h.value);
  // cash out 2000, then close shift with exact expected cash
  await p.evaluate(() => goTab('shift'));
  await p.click('button >> text=سحب نقدي');
  await p.fill('#acf_a', '2000'); await p.fill('#acf_n', 'خبز'); await p.click('#acDlgOk');
  const expected = 10000 + 11700 - 2000;
  await p.waitForFunction((e) => document.getElementById('shiftBody').textContent.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,]/g, '').includes(String(e)), expected);
  await p.click('button >> text=إغلاق الوردية');
  await p.fill('#acf_c', String(expected)); await p.click('#acDlgOk');
  const closed = await until(async () => { const d = await read('restaurants/RP/shifts/' + sh.id); return d.status === 'closed' ? d : null; });
  assert.equal(closed.expectedCash, expected); assert.equal(closed.diff, 0);
  assert.equal(closed.report.card, h.value); assert.equal(closed.report.disc, 1300);
  await p.waitForSelector('#shOpenCash');
  assert.deepEqual(clean(p), []);
  await p.screenshot({ path: 'shots/pos-shift.png', fullPage: false });
  await p.context().close();
});

test('settings sync + receipt uses restaurant settings + delivery with default fee', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await login(p);
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.fill('#stTitle', 'مطعم <b>الذوق</b>'); await p.fill('#stTax', '5'); await p.fill('#stFee', '4000'); await p.fill('#stTables', '6');
  await p.click('button >> text=حفظ الإعدادات');
  const s = await until(() => read('restaurants/RP/settings/main'));
  assert.equal(s.taxPct, 5); assert.equal(s.defaultFee, 4000); assert.equal(s.tables, 6);
  await p.evaluate(() => goTab('cashier'));
  await p.waitForSelector('#prods .prod');
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('4');
  await p.waitForSelector('#delivOv.on');
  assert.equal(await p.inputValue('#dFee'), '4000');
  await p.fill('#dName', 'زبون'); await p.fill('#dPhone', '0770'); await p.fill('#dAddr', 'زيونة');
  await p.click('#capList .capcard'); await p.click('#confCapBtn');
  const d = await until(async () => (await ordersRP()).find((x) => x.orderType === 'delivery'));
  assert.equal(d.fee, 4000); assert.equal(d.tax, Math.round(d.subtotal * 0.05)); assert.equal(d.payment.method, 'cod');
  const html = await p.evaluate(() => document.getElementById('prtFr').srcdoc);
  assert.ok(html.includes('مطعم &lt;b&gt;الذوق&lt;/b&gt;'), 'receipt title escaped');
  assert.ok(html.includes('ضريبة'));
  // salon with table select
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('1');
  await p.waitForSelector('#payTableSel');
  await p.selectOption('#payTableSel', '3');
  await p.click('#payMethods button[data-m="later"]');
  await p.click('#payOk');
  const t = await until(async () => (await ordersRP()).find((x) => x.tableNo === 3));
  assert.equal(t.payment.method, 'later'); assert.equal(t.customer, 'طاولة 3');
  // collect later from orders screen
  await p.evaluate(() => goTab('orders'));
  await p.click(`button[onclick="ordCollect('${t.id}')"]`);
  await p.click('#payOk');
  const t2 = await until(async () => { const x = await read('orders/' + t.id); return x.payment.method === 'cash' ? x : null; });
  assert.equal(t2.payment.cash, t.value);
  assert.deepEqual(clean(p), []);
  await p.screenshot({ path: 'shots/pos-orders.png', fullPage: false });
  await p.context().close();
});

test('phone layout: cart is a bottom bar that opens on tap', async () => {
  const p = await page(B, { w: 390, h: 844 });
  await login(p);
  await p.waitForSelector('#prods .prod');
  assert.equal(await p.isVisible('#sendBtn'), false);
  await p.click('#prods .prod >> nth=0');
  await p.waitForFunction(() => document.getElementById('cartMini').textContent.length > 0);
  await p.click('#cartHead');
  await p.waitForSelector('#sendBtn', { state: 'visible' });
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'shots/pos-mobile-open.png' });
  await p.click('#sendBtn');
  await p.waitForSelector('#typeOv.on');
  await p.context().close();
});

// تطبيق الأندرويد (قبل تحديث الـ APK) يتجاهل confirm() ويرجّع «لا» — فالخروج ما چان يشتغل. بالتطبيق النافذة داخل الصفحة
test('android app: logout + clear cart use the in-page confirm (native dialogs are ignored there)', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await p.context().addInitScript(() => {
    const ua = navigator.userAgent + ' SoraCashierApp/1.0';
    Object.defineProperty(navigator, 'userAgent', { get: () => ua });
    window.confirm = () => false; window.prompt = () => null; window.alert = () => {};   // مثل الـ WebView القديم
  });
  const native = []; p.on('dialog', (d) => native.push(d.message()));
  await login(p);
  await p.waitForSelector('#prods .prod');
  await p.click('#prods .prod >> nth=0');
  await p.waitForFunction(() => cart.length === 1);
  await p.click('button.cact-b >> text=تفريغ');
  await p.waitForSelector('.ask-ov >> text=تفريغ السلة؟');
  await p.click('.ask-ov .ask-no');
  await p.waitForSelector('.ask-ov', { state: 'detached' });
  assert.equal(await p.evaluate(() => cart.length), 1, '«لا» keeps the cart');
  await p.click('button.cact-b >> text=تفريغ');
  await p.click('.ask-ov .ask-yes');
  await p.waitForFunction(() => cart.length === 0);
  // Esc = لا (وما يوصل لاختصارات الكاشير)
  await p.click('.lout');
  await p.waitForSelector('.ask-ov >> text=تسجيل الخروج؟');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.ask-ov', { state: 'detached' });
  assert.ok(await p.isVisible('#appPage.show'), 'still logged in after Esc');
  await p.click('.lout');
  await p.screenshot({ path: 'shots/pos-app-logout.png' });
  await p.click('.ask-ov .ask-yes');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 10000 });
  assert.deepEqual(native, [], 'no native dialogs in the app');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
