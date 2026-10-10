import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const exps = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDocs(collection(c.firestore(), 'accounting/RX/expenses'))).docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const accDoc = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), 'accounting/RX'))).data(); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('accown@x.com', 'secret123');
  const cash = await signUp('acccash@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RX', email: 'accown@x.com', name: 'أبو علي' });
    await setDoc(doc(db, 'users', cash), { role: 'cashier', restaurantId: 'RX', email: 'acccash@x.com', name: 'حسين الكاشير', perms: { inventory: true } });
    await setDoc(doc(db, 'restaurants/RX'), { name: 'مطعم الحسابات', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RX/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }] }] });
    await setDoc(doc(db, 'accounting/RX'), { materials: [{ id: 'm1', name: 'لحم', unit: 'كغم', qty: 10, min: 2, cost: 12000 }], recipes: {}, costs: {},
      moves: [{ id: 'v1', mid: 'm1', name: 'لحم', unit: 'كغم', type: 'purchase', qty: 10, cost: 12000, value: 120000, ts: Date.now() - 3600000, note: 'من مورد الكرادة', by: 'أبو علي' }],
      expenses: [{ id: 'old1', cat: 'كهرباء وماء', amount: 25000, note: 'فاتورة قديمة', ts: Date.now() - 86400000 }] });
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

test('owner login migrates old expenses into separate records', async () => {
  const p = await pos('accown@x.com');
  const list = await until(async () => { const l = await exps(); return l.some((e) => e.id === 'old1') ? l : null; });
  assert.equal(list.find((e) => e.id === 'old1').note, 'فاتورة قديمة');
  assert.deepEqual((await until(async () => { const d = await accDoc(); return d.expenses.length === 0 ? d : null; })).expenses, []);
  await p.context().close();
});

test('cashier adds an expense, cannot delete or edit materials', async () => {
  const p = await pos('acccash@x.com');
  await p.click('.dnb[data-tab="acc"]');
  await p.click('#acTabs .mtab >> text=المصروفات');
  await p.selectOption('#exCat', 'صيانة'); await p.fill('#exAmt', '15000'); await p.fill('#exNote', 'تصليح الثلاجة — فني أحمد');
  await p.click('button >> text=حفظ المصروف');
  const e = await until(async () => (await exps()).find((x) => x.cat === 'صيانة'));
  assert.equal(e.amount, 15000); assert.equal(e.by, 'حسين الكاشير'); assert.equal(e.note, 'تصليح الثلاجة — فني أحمد');
  await p.waitForFunction(() => document.getElementById('acBody').textContent.includes('تصليح الثلاجة'));
  assert.equal(await p.locator('#acBody button[onclick^="expDel"]').count(), 0, 'no delete button for cashier');
  // حتى لو حاول من الكود: ممنوع
  await p.evaluate((id) => expDel(id), e.id);
  await p.waitForTimeout(800);
  assert.ok((await exps()).some((x) => x.id === e.id));
  const denied = await p.evaluate(async (id) => { try { await window._fb.deleteDoc(window._fb.doc(window._fb.db, 'accounting', 'RX', 'expenses', id)); return 'ok'; } catch (err) { return err.code; } }, e.id);
  assert.equal(denied, 'permission-denied');
  // المواد: لا تعديل ولا حذف، والأدوات مخفية
  await p.click('#acTabs .mtab >> text=المخزون');
  assert.equal(await p.locator('#acBody button[onclick^="matDel"]').count(), 0);
  assert.equal(await p.locator('#acTabs .mtab >> text=أدوات').count(), 0);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('admin app reads every number and detail; owner edits and deletes expenses', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'accown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.selectOption('#axRange', '30');
  await p.click('#axTabs button >> text=المصروفات');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('تصليح الثلاجة'));
  const t = await p.textContent('#axBody');
  assert.ok(t.includes('40,000') && t.includes('حسين الكاشير') && t.includes('فاتورة قديمة'));
  await p.screenshot({ path: 'shots/admin-acc-exp.png', fullPage: true });
  // تفاصيل المصروف مع الملاحظة
  await p.click('.ax-row >> text=صيانة');
  await p.waitForSelector('#axMo.open');
  assert.ok((await p.textContent('#axMoBody')).includes('تصليح الثلاجة — فني أحمد'));
  await p.screenshot({ path: 'shots/admin-acc-detail.png' });
  await p.fill('#axEamt', '18000'); await p.click('button >> text=حفظ التعديل');
  const ed = await until(async () => (await exps()).find((x) => x.cat === 'صيانة' && x.amount === 18000));
  assert.ok(ed.editedBy);
  // حذف
  await p.click('.ax-row >> text=كهرباء وماء');
  await p.click('#axMoBody button >> text=حذف');
  await until(async () => !(await exps()).some((x) => x.id === 'old1'));
  // المخزون وكارت المادة والحركات والقائمة
  await p.click('#axTabs button >> text=المخزون');
  await p.click('.ax-row >> text=لحم');
  await p.waitForFunction(() => document.getElementById('axMoBody').textContent.includes('من مورد الكرادة'));
  await p.click('#axMoBody button >> text=إغلاق');
  await p.click('#axTabs button >> text=حركات المخزون');
  assert.ok((await p.textContent('#axBody')).includes('من مورد الكرادة'));
  await p.click('#axTabs button >> text=قائمة الدخل');
  assert.ok((await p.textContent('#axBody')).includes('صافي الربح'));
  // تحديث مباشر: الكاشير يضيف مصروف والشاشة تتحدث بدون إعادة تحميل
  await p.click('#axTabs button >> text=المصروفات');
  await p.evaluate(() => { window.__mark = 1; });
  await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'accounting/RX/expenses/live1'), { cat: 'غاز / وقود', amount: 7000, note: 'قنينة غاز', ts: Date.now(), by: 'حسين الكاشير', createdAtMs: Date.now() }); });
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('قنينة غاز'), null, { timeout: 10000 });
  assert.equal(await p.evaluate(() => window.__mark), 1);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('item sales report: each item with price, count and total; unsold items; today / yesterday / from–to; printable with a grand total', async () => {
  const own = await signUp('salesown@x.com', 'secret123');
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const today = Math.max(Date.now() - 60000, d0.getTime() + 1000), yest = d0.getTime() - 7200000;
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RZ', email: 'salesown@x.com', name: 'صاحب مطعم المبيعات' });
    await setDoc(doc(db, 'restaurants/RZ'), { name: 'مطعم المبيعات', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RZ/menu/main'), { updatedAtMs: 1, device: 's', cats: [
      { cat: 'برغر', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 5500 }] }, { name: 'زنكر', variants: [{ name: 'وحدة', price: 6000 }, { name: 'دبل', price: 7000 }] }] },
      { cat: 'مقبلات', items: [{ name: 'بطاطا', variants: [{ name: 'وحدة', price: 2000 }] }, { name: 'شوربة', variants: [{ name: 'وحدة', price: 3000 }] }] }] });
    const o = (id, status, at, items) => setDoc(doc(db, 'orders', id), { restaurantId: 'RZ', status, orderType: 'takeaway', createdAtMs: at, value: items.reduce((s, i) => s + i.price * i.qty, 0), items });
    await o('S1', 'delivered', today, [{ name: 'كلاسك', variant: 'وحدة', price: 5500, qty: 2 }, { name: 'زنكر', variant: 'دبل', price: 7000, qty: 1 }]);
    await o('S2', 'pending', today, [{ name: 'كلاسك', variant: 'وحدة', price: 5500, qty: 3 }]);
    await o('S3', 'cancelled', today, [{ name: 'بطاطا', variant: 'وحدة', price: 2000, qty: 5 }]);
    await o('S4', 'delivered', yest, [{ name: 'بطاطا', variant: 'وحدة', price: 2000, qty: 4 }]);
  });
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'salesown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.click('#axTabs button >> text=مبيعات الأصناف');
  const rows = (sel) => p.$$eval(sel + ' tr', (trs) => trs.slice(1).map((tr) => Array.from(tr.cells, (td) => td.innerText.replace(/\s+/g, ' ').trim())));
  // اليوم: الكلاسك ٥ × ٥٥٠٠ = ٢٧٥٠٠، الزنكر دبل ١ × ٧٠٠٠، والملغي ما ينحسب
  await p.waitForFunction(() => (document.getElementById('axSalesTbl') || {}).textContent?.includes('34,500'), null, { timeout: 10000 });
  let r = await rows('#axSalesTbl');
  assert.deepEqual(r[0].slice(1), ['كلاسك برغر', '5,500', '5', '27,500']);
  assert.deepEqual(r[1].slice(1), ['زنكر (دبل) برغر', '7,000', '1', '7,000']);
  assert.deepEqual(r.at(-1).slice(1), ['المجموع الكلي', '', '6', '34,500 د.ع']);
  const unsold = (await rows('#axUnsoldTbl')).map((x) => x[0]);
  assert.deepEqual(unsold, ['زنكر برغر', 'بطاطا مقبلات', 'شوربة مقبلات']);
  await p.screenshot({ path: 'shots/admin-item-sales.png', fullPage: true });
  // الطباعة: قائمة بكل صنف والمجموع الكلي
  await p.click('button >> text=طباعة القائمة');
  const printed = await p.evaluate(() => document.getElementById('axPrt').srcdoc);
  assert.ok(printed.includes('مبيعات الأصناف') && printed.includes('كلاسك') && printed.includes('27,500') && printed.includes('المجموع الكلي (6 صنف)') && printed.includes('34,500') && printed.includes('شوربة'));
  // أمس
  await p.selectOption('#axRange', 'yesterday');
  await p.waitForFunction(() => document.getElementById('axSalesTbl').textContent.includes('8,000'));
  r = await rows('#axSalesTbl');
  assert.deepEqual(r[0].slice(1), ['بطاطا مقبلات', '2,000', '4', '8,000']);
  assert.equal((await rows('#axUnsoldTbl')).length, 4);
  // من تاريخ إلى تاريخ (أمس ← اليوم)
  const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  await p.selectOption('#axRange', 'custom');
  await p.fill('#axFrom', ymd(yest)); await p.dispatchEvent('#axFrom', 'change');
  await p.fill('#axTo', ymd(today)); await p.dispatchEvent('#axTo', 'change');
  await p.waitForFunction(() => document.getElementById('axSalesTbl').textContent.includes('42,500'));
  r = await rows('#axSalesTbl');
  assert.deepEqual(r.at(-1).slice(1), ['المجموع الكلي', '', '10', '42,500 د.ع']);
  assert.deepEqual((await rows('#axUnsoldTbl')).map((x) => x[0]), ['زنكر برغر', 'شوربة مقبلات']);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
