import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const accDoc = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), 'accounting/RR'))).data(); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const DAY = 86400000;

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('rown@x.com', 'secret123'), cash = await signUp('rcash@x.com', 'secret123');
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = d0.getTime() + 3600000;
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RR', email: 'rown@x.com', name: 'المالك' });
    await setDoc(doc(db, 'users', cash), { role: 'cashier', restaurantId: 'RR', email: 'rcash@x.com', name: 'زينب', perms: { inventory: true, menu: true, reports: true } });
    await setDoc(doc(db, 'restaurants/RR'), { name: 'مطعم التقارير', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RR/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 5000 }] }, { name: 'زنكر', variants: [{ name: 'وحدة', price: 6000 }] }] }] });
    await setDoc(doc(db, 'accounting/RR'), { materials: [], recipes: {}, costs: { 'كلاسك|وحدة': 3000 }, moves: [], expenses: [] });
    const o = (id, extra) => setDoc(doc(db, 'orders/' + id), { restaurantId: 'RR', status: 'delivered', createdAtMs: t, items: [{ name: 'كلاسك', variant: 'وحدة', price: 5000, qty: 2, cost: 3000 }], value: 10000, customer: 'أبو سجاد', phone: '07700000000', ...extra });
    await o('A1', { orderType: 'salon', payment: { method: 'cash', cash: 10000, card: 0 } });
    await o('A2', { orderType: 'takeaway', payment: { method: 'card', cash: 0, card: 10000 } });
    await o('A3', { orderType: 'delivery', fee: 3000, status: 'delivered' });
    await o('Y1', { orderType: 'salon', createdAtMs: t - DAY, payment: { method: 'cash', cash: 10000, card: 0 } });
    await setDoc(doc(db, 'accounting/RR/expenses/e1'), { cat: 'غاز / وقود', amount: 4000, note: 'قنينة', ts: t, by: 'زينب', createdAtMs: t });
    await setDoc(doc(db, 'restaurants/RR/shifts/s1'), { status: 'closed', cashier: 'زينب', openedAtMs: t, closedAtMs: t + 7200000, openingCash: 50000, expectedCash: 60000, countedCash: 59000, diff: -1000, report: { orders: 3, sales: 30000, cash: 10000, card: 10000, byType: { salon: { n: 1, v: 10000 } } } });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function pos(email) {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', email); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  return p;
}

test('cashier: no reports/profits, daily receipt from shift tab, expenses by single day', async () => {
  const p = await pos('rcash@x.com');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.dnb[data-tab="reports"]')).display), 'none');
  await p.evaluate(() => goTab('reports'));
  assert.equal(await p.evaluate(() => document.getElementById('reportsScreen').classList.contains('on')), false);
  // تقرير اليوم: أرقام فقط بدون أسماء زبائن
  await p.evaluate(() => goTab('shift'));
  await p.click('button >> text=طباعة تقرير اليوم');
  const rc = await p.evaluate(() => document.getElementById('prtFr').srcdoc);
  assert.ok(rc.includes('التقرير اليومي') && rc.includes('صالة (1)') && rc.includes('سفري (1)') && rc.includes('دلفري (1)') && rc.includes('30,000'));
  assert.ok(!rc.includes('أبو سجاد') && !rc.includes('07700000000'), 'no customer details');
  assert.ok(rc.includes('4,000'), 'today expenses');
  // المخزون والحسابات: المخزون والمصروفات فقط
  await p.evaluate(() => goTab('acc'));
  const tabs = await p.$$eval('#acTabs .mtab', (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(tabs.filter((t) => !t.includes('رجوع')), ['📦 المخزون', '💸 المصروفات']);
  await p.click('#acTabs .mtab >> text=المصروفات');
  assert.equal(await p.locator('#acBody .prow').count(), 0, 'no from/to range for cashier');
  assert.equal(await p.locator('#acBody input[onchange^="acSetExpDay"]').count(), 1, 'single day picker');
  assert.ok((await p.textContent('#acBody')).includes('مصروفات اليوم'));
  // قائمة الأصناف بدون تكلفة وربح
  await p.evaluate(() => { goTab('menu'); showMTab('list'); });
  assert.ok(!(await p.textContent('#mItemsList')).includes('ربح'));
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('owner edits an item with cost and sees the profit', async () => {
  const p = await pos('rown@x.com');
  await p.evaluate(() => { goTab('menu'); showMTab('list'); });
  await p.click('.micard:has-text("زنكر") button[onclick^="editItem"]');
  await p.waitForSelector('#acOv.on');
  await p.fill('#acf_vp0', '7000'); await p.fill('#acf_vc0', '4200');
  await p.waitForFunction(() => document.querySelector('.item-profit').textContent.includes('ربح 2,800 (40%)'));
  await p.screenshot({ path: 'shots/pos-item-cost.png' });
  await p.click('#acDlgOk');
  const a = await until(async () => { const d = await accDoc(); return d.costs['زنكر|وحدة'] === 4200 ? d : null; });
  assert.ok(a);
  assert.equal(await p.evaluate(() => menu[0].items.find((i) => i.name === 'زنكر').variants[0].price), 7000);
  await p.context().close();
});

test('admin: sales report with any date range + print, items & profit, shifts', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'rown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('صالة'));
  let t = await p.textContent('#axBody');
  assert.ok(t.includes('30,000'), 'today total');
  await p.selectOption('#axRange', '7');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('40,000'));
  assert.ok((await p.textContent('#axBody')).includes('حسب اليوم'));
  await p.click('button >> text=طباعة الوصل');
  await p.waitForFunction(() => (document.getElementById('axPrt') || {}).srcdoc && document.getElementById('axPrt').srcdoc.includes('40,000'));
  assert.ok(!(await p.evaluate(() => document.getElementById('axPrt').srcdoc)).includes('أبو سجاد'));
  await p.screenshot({ path: 'shots/admin-report.png', fullPage: true });
  // الأصناف والأرباح + تعديل التكلفة
  await p.click('#axTabs button >> text=الأصناف والأرباح');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('كلاسك'));
  assert.ok((await p.textContent('#axBody')).includes('40%'));
  await p.click('.ax-row:has-text("زنكر")');
  await p.fill('#axIcost', '3600');
  await p.waitForFunction(() => document.getElementById('axIprev').textContent.includes('2,400'));
  await p.click('#axMoBody button >> text=حفظ التكلفة');
  await until(async () => (await accDoc()).costs['زنكر|وحدة'] === 3600);
  await p.screenshot({ path: 'shots/admin-items.png', fullPage: true });
  // الورديات
  await p.click('#axTabs button >> text=الورديات');
  await p.click('.ax-row:has-text("زينب")');
  assert.ok((await p.textContent('#axMoBody')).includes('-1,000'));
  await p.click('#axMoBody button >> text=إغلاق');
  // تاريخ مخصص: أمس فقط
  await p.click('#axTabs button >> text=تقرير المبيعات');
  await p.selectOption('#axRange', 'custom');
  const y = await p.evaluate(() => { const d = new Date(Date.now() - 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await p.fill('#axFrom', y); await p.fill('#axTo', y); await p.dispatchEvent('#axTo', 'change');
  await p.waitForFunction(() => { const t = document.getElementById('axBody').textContent; return t.includes('10,000') && !t.includes('30,000'); });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('orders filter bar stays visible and clickable with a long list', async () => {
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    for (let i = 0; i < 30; i++) await setDoc(doc(db, 'orders/L' + i), { restaurantId: 'RR', status: 'delivered', orderType: i % 3 ? 'delivery' : 'salon', createdAtMs: Date.now() - i * 60000, value: 5000, items: [{ name: 'كلاسك', variant: 'وحدة', price: 5000, qty: 1 }] });
  });
  const p = await pos('rown@x.com');
  await p.evaluate(() => goTab('orders'));
  await p.waitForFunction(() => document.querySelectorAll('#ordersScreen .ocard, #ordersScreen [class*="ord"]').length > 10);
  const h = await p.evaluate(() => document.getElementById('f-all').getBoundingClientRect().height);
  assert.ok(h > 20, 'filter buttons visible, height=' + h);
  await p.click('#f-salon'); await p.click('#f-delivery'); await p.click('#f-all');
  await p.context().close();
});
