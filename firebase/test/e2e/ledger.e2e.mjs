// الحسابات (المرحلة ٢): الموردين والمشتريات بالآجل، البيع بالدين وتحصيله، والصندوق اليومي — من الكاشير للوحة الإدارة وملف المحاسب
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, own, cash;
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const all = async (path) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDocs(collection(c.firestore(), path))).docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const read = async (path) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), path))).data(); }); return v; };
const led = () => all('accounting/RZ/ledger');
const openShift = async () => (await all('restaurants/RZ/shifts')).find((s) => s.status === 'open');
const digits = (t) => t.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,]/g, '');
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  own = await signUp('ledown@x.com', 'secret123');
  cash = await signUp('ledcash@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RZ', email: 'ledown@x.com', name: 'أبو زيد' });
    await setDoc(doc(db, 'users', cash), { role: 'cashier', restaurantId: 'RZ', email: 'ledcash@x.com', name: 'مرتضى الكاشير', perms: { inventory: true, cancel: true } });
    await setDoc(doc(db, 'restaurants/RZ'), { name: 'مطعم الدفتر', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RZ/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }] }] });
    await setDoc(doc(db, 'accounting/RZ'), { materials: [{ id: 'm1', name: 'لحم', unit: 'كغم', qty: 0, min: 1, cost: 0 }], recipes: {}, costs: {}, moves: [], expenses: [] });
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
async function sell(p, n, name, phone) {
  await p.evaluate(() => goTab('cashier'));
  for (let i = 0; i < n; i++) await p.click('#prods .prod >> nth=0');
  await p.keyboard.press('F9'); await p.waitForSelector('#typeOv.on'); await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on');
  await p.click('#payMethods button[data-m="credit"]');
  await p.fill('#payCrName', name);
  if (phone != null) await p.fill('#payCrPhone', phone);
}

test('cashier: supplier purchase on credit, supplier payment, sales on credit, collection, cancelled debt, bank deposit — all in the shift', async () => {
  const p = await pos('ledcash@x.com');
  await p.waitForSelector('#shiftWarn.on'); await p.click('#shiftWarn');
  await p.fill('#shOpenCash', '50000'); await p.fill('#shCashier', 'مرتضى'); await p.click('button >> text=فتح الوردية');
  const sh = await until(openShift);

  // مورد جديد من «الموردين»
  await p.click('.dnb[data-tab="acc"]');
  await p.click('#acTabs .mtab >> text=الموردين');
  await p.click('button >> text=إضافة مورد');
  await p.fill('#acf_name', 'قصاب الكرادة'); await p.fill('#acf_phone', '07800000001'); await p.click('#acDlgOk');
  const sup = await until(async () => (await all('accounting/RZ/suppliers')).find((s) => s.name === 'قصاب الكرادة'));
  assert.equal(sup.by, 'مرتضى الكاشير'); assert.equal(sup.byUid, cash);

  // وارد لحم ٥ كغم بـ ٦٠ ألف من المورد: دفع ٢٠ ألف من الدرج والباقي آجل
  await p.click('#acTabs .mtab >> text=المخزون');
  await p.click('#acMatList button >> text=وارد');
  await p.fill('#acf_qty', '5'); await p.fill('#acf_total', '60000');
  await p.selectOption('#acf_sid', sup.id); await p.fill('#acf_paid', '20000');
  assert.equal(await p.inputValue('#acf_pm'), 'drawer', 'paid from the open shift drawer by default');
  await p.click('#acDlgOk');
  const mv = await until(async () => ((await read('accounting/RZ')).moves || []).find((m) => m.type === 'purchase'));
  assert.equal(mv.sid, sup.id); assert.equal(mv.value, 60000);
  const inv = await until(async () => (await led()).find((e) => e.id === 'iv_' + mv.id));
  assert.deepEqual([inv.kind, inv.type, inv.party, inv.amount, inv.paid, inv.method, inv.ref], ['sup', 'invoice', sup.id, 60000, 20000, 'drawer', mv.id]);
  await until(async () => ((await read('restaurants/RZ/shifts/' + sh.id)).cashMoves || []).some((m) => m.cat === 'supplier' && m.amount === 20000 && m.ref === mv.id));

  // تسديد ١٥ ألف للمورد من الدرج + فاتورة غاز آجلة (مو للمخزون)
  await p.click('#acTabs .mtab >> text=الموردين');
  await p.click('#acSupList button >> text=تسديد');
  assert.equal(await p.inputValue('#acf_amt'), '40000', 'suggests the full balance');
  await p.fill('#acf_amt', '15000'); await p.click('#acDlgOk');
  await until(async () => (await led()).find((e) => e.type === 'pay' && e.amount === 15000 && e.method === 'drawer'));
  await p.click('#acSupList button >> text=فاتورة');
  await p.fill('#acf_amt', '5000'); await p.selectOption('#acf_cat', 'غاز / وقود'); await p.fill('#acf_paid', '0'); await p.fill('#acf_note', 'قنينة غاز');
  await p.click('#acDlgOk');
  const gas = await until(async () => (await led()).find((e) => e.type === 'invoice' && !e.ref));
  assert.equal(gas.cat, 'غاز / وقود'); assert.equal(gas.paid, 0); assert.equal(gas.method, undefined);
  await p.waitForFunction(() => document.getElementById('acSupList').textContent.replace(/[٬,]/g, '').includes('30000'));

  // بيع بالدين: الزبون باسمه ورقمه، والمرة الثانية باسمه بس ← نفس الحساب
  await sell(p, 1, 'أبو أحمد', '0770 123 4567');
  await p.click('#payOk');
  const o1 = await until(async () => (await all('orders')).find((o) => o.restaurantId === 'RZ' && o.payment && o.payment.method === 'credit'));
  assert.equal(o1.value, 3000); assert.deepEqual(o1.payment.cust, { key: 'p07701234567', name: 'أبو أحمد', phone: '0770 123 4567' });
  const ch1 = await until(async () => (await led()).find((e) => e.id === 'ch_' + o1.id));
  assert.deepEqual([ch1.kind, ch1.type, ch1.party, ch1.amount, ch1.orderId, ch1.shiftId], ['cust', 'charge', 'p07701234567', 3000, o1.id, sh.id]);
  await sell(p, 2, 'أبو أحمد');
  assert.equal(await p.inputValue('#payCrPhone'), '0770 123 4567', 'phone filled from the existing debtor');
  assert.match(await p.textContent('#payCrBal'), /رصيده السابق 3,000/);
  await p.click('#payOk');
  const ch2 = await until(async () => (await led()).find((e) => e.type === 'charge' && e.amount === 6000));
  assert.equal(ch2.party, 'p07701234567');
  // بدون اسم: ما يقبل
  await sell(p, 1, '');
  await p.click('#payOk');
  assert.ok(await p.isVisible('#payOv.on'), 'credit needs a customer name');
  await p.evaluate(() => payClose());

  // تحصيل ٤ آلاف للدرج من «ديون الزبائن»
  await p.click('.dnb[data-tab="acc"]');
  await p.click('#acTabs .mtab >> text=ديون الزبائن');
  await p.waitForFunction(() => document.getElementById('acCustList').textContent.replace(/[٬,]/g, '').includes('9000'));
  await p.click('#acCustList button >> text=تحصيل');
  await p.fill('#acf_amt', '4000'); await p.click('#acDlgOk');
  const col = await until(async () => (await led()).find((e) => e.type === 'collect'));
  assert.deepEqual([col.amount, col.method, col.party, col.shiftId], [4000, 'drawer', 'p07701234567', sh.id]);
  // الكاشير يلغي طلب الدين الأول ← يرجع الدين تلقائياً
  await p.evaluate((id) => ordCancel(id), o1.id);
  await p.waitForSelector('#acOv.on'); await p.click('#acDlgOk');
  const vd = await until(async () => (await led()).find((e) => e.id === 'vd_' + o1.id));
  assert.equal(vd.amount, 3000); assert.equal(vd.type, 'void');
  await p.click('#acTabs .mtab >> text=المخزون'); await p.click('#acTabs .mtab >> text=ديون الزبائن');
  await p.waitForFunction(() => document.getElementById('acCustList').textContent.replace(/[٬,]/g, '').includes('2000'));
  // كشف الحساب: الكاشير يشوف بس (لا تعديل ولا حذف)
  await p.click('#acCustList button >> text=كشف حساب');
  await p.waitForSelector('#viewOv.on');
  const st = await p.textContent('#viewBody');
  for (const s of ['🧾 دين', '💵 تحصيل', '↩️ إلغاء دين', 'مرتضى الكاشير']) assert.ok(st.includes(s), 'statement has ' + s);
  assert.equal(await p.locator('#viewBody button[onclick^="ledDel"]').count(), 0);
  await p.evaluate(() => viewClose());
  const denied = await p.evaluate(async (id) => {
    const f = window._fb, r = [];
    for (const fn of [() => f.deleteDoc(f.doc(f.db, 'accounting', 'RZ', 'ledger', id)), () => f.updateDoc(f.doc(f.db, 'accounting', 'RZ', 'ledger', id), { amount: 1 })]) {
      try { await fn(); r.push('ok'); } catch (err) { r.push(err.code); }
    }
    return r;
  }, col.id);
  assert.deepEqual(denied, ['permission-denied', 'permission-denied']);

  // الصندوق: إيداع ١٠ آلاف بالمصرف من الدرج
  await p.evaluate(() => goTab('shift'));
  await p.click('button >> text=سحب نقدي');
  await p.selectOption('#acf_c', 'bank'); await p.fill('#acf_a', '10000'); await p.click('#acDlgOk');
  const sh2 = await until(async () => { const s = await read('restaurants/RZ/shifts/' + sh.id); return (s.cashMoves || []).some((m) => m.cat === 'bank') ? s : null; });
  assert.deepEqual(sh2.cashMoves.map((m) => [m.type, m.cat, m.amount]), [['out', 'supplier', 20000], ['out', 'supplier', 15000], ['in', 'customer', 4000], ['out', 'bank', 10000]]);
  // المتوقع بالدرج = ٥٠ − ٢٠ − ١٥ + ٤ − ١٠ = ٩ آلاف (الدين ما يدخل الدرج)
  await p.waitForFunction(() => document.getElementById('shiftBody').textContent.replace(/[٬,]/g, '').includes('9000 د.ع'));
  const sb = digits(await p.textContent('#shiftBody'));
  for (const s of ['(−) تسديد موردين- 35000', '(+) تحصيل ديون زبائن4000', '(−) إيداع بالمصرف- 10000', '🧾 دين على زبائن6000', '= المتوقع بالدرج9000'])
    assert.ok(sb.replace(/\s*د\.ع/g, '').includes(s), 'shift shows ' + s);
  await p.screenshot({ path: 'shots/ledger-shift.png', fullPage: true });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('admin: suppliers, customer debts and cash box tabs; accountant Excel journal balances with the new entries; owner deletes an entry', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'ledown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.selectOption('#axRange', '7');
  await p.click('#axTabs button >> text=الموردين');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('قصاب الكرادة'));
  assert.ok((await p.textContent('#axBody')).replace(/[٬,]/g, '').includes('30000'), 'supplier balance');
  await p.click('#axBody tr.ax-row >> text=قصاب الكرادة');
  await p.waitForSelector('#axMo.open');
  const ss = await p.textContent('#axMoBody');
  for (const s of ['🧾 فاتورة — لحم', '💵 مدفوع وقت الشراء (درج الكاشير)', '💵 تسديد (درج الكاشير)', 'قنينة غاز']) assert.ok(ss.includes(s), 'supplier statement has ' + s);
  await p.evaluate(() => axClose());
  await p.click('#axTabs button >> text=ديون الزبائن');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('أبو أحمد'));
  assert.ok((await p.textContent('#axBody')).replace(/[٬,]/g, '').includes('2000'));
  await p.click('#axTabs button >> text=الصندوق');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('مرتضى'));
  const bx = (await p.textContent('#axBody')).replace(/[٬,]/g, '');
  assert.ok(bx.includes('10000') && bx.includes('35000') && bx.includes('4000'), 'cash box: bank 10000, suppliers 35000, collections 4000');
  // الغاز (فاتورة مورد) ينحسب مصروف بقائمة الدخل
  await p.click('#axTabs button >> text=المصروفات');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('فاتورة مورد: قصاب الكرادة'));
  await p.click('#axTabs button >> text=قائمة الدخل');
  await p.waitForFunction(() => { const t = document.getElementById('axBody').textContent; return t.includes('قائمة الدخل') && !t.includes('⏳ جاري'); });
  await p.screenshot({ path: 'shots/ledger-admin-fin.png', fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#axExpBtn')]);
  const fs = await import('node:fs');
  const x = fs.readFileSync(await dl.path()).toString('utf8');
  for (const s of ['الموردين (ذمم دائنة)', 'جاري المالك', 'ذمم الزبائن (آجل ودين)', 'الجزء الآجل من فاتورة المورد قصاب الكرادة', 'فاتورة مورد: قصاب الكرادة — قنينة غاز', 'تسديد للمورد: قصاب الكرادة',
    'تحصيل دين من الزبون: أبو أحمد', 'إيداع نقد بالمصرف (وردية مرتضى)', 'ديون الزبائن', 'حركات الموردين والزبائن', 'الصندوق', 'دين على زبائن', 'مصروف — غاز / وقود'])
    assert.ok(x.includes(s), 'xlsx has: ' + s);
  // القيود: مبيعات دين 6000 (د/ ذمم الزبائن) + مشتريات 60000 + آجل المورد 40000 + غاز 5000 + تسديد 15000 + تحصيل 4000 + إيداع بالمصرف 10000 = 140000
  assert.equal((x.match(/<v>140000<\/v>/g) || []).length, 2, 'journal debit total = credit total = 140000');
  // المالك يحذف حركة التحصيل (غلط) ← الدين يرجع 6000
  await p.click('#axTabs button >> text=ديون الزبائن');
  await p.click('#axBody tr.ax-row >> text=أبو أحمد');
  await p.waitForSelector('#axMo.open');
  await p.click('#axMoBody tr.ax-row >> text=💵 تحصيل');
  await p.click('#axMoBody button >> text=حذف');
  await until(async () => !(await led()).some((e) => e.type === 'collect'));
  // حركة دين الطلب ما تنحذف من الإدارة (تنلغي من الطلب)
  await p.click('#axMoBody tr.ax-row >> text=طلب #');
  assert.equal(await p.locator('#axMoBody button >> text=حذف').count(), 0);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
