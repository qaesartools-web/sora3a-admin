// الحسابات بلوحة الإدارة: تكلفة الأصناف ووصفاتها من هنا بس، وربح كل صنف = المبيعات − تكلفة المباع
//  نفس اللي صار بمطعم حقيقي: كلاسك انباع بتكلفة يوم البيع غلط (4,545) فربحه طلع بالسالب، وفشاج انباع بدون تكلفة فربحه = مبيعاته
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const num = (s) => Number(String(s).replace(/[^\d-]/g, ''));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('cown@x.com', 'secret123');
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = d0.getTime() + 3600000;
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RC', email: 'cown@x.com', name: 'المالك' });
    await setDoc(doc(db, 'restaurants/RC'), { name: 'مطعم الحسابات', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RC/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [
      { name: 'كلاسك برغر', variants: [{ name: 'وحدة', price: 3000 }] },
      { name: 'فشاج برغر', variants: [{ name: 'وحدة', price: 2500 }] },
      { name: 'ايت برغر', variants: [{ name: 'وحدة', price: 4500 }] },
      { name: 'كابوي برغر', variants: [{ name: 'وحدة', price: 4500 }] }] }] });
    await setDoc(doc(db, 'accounting/RC'), {
      materials: [{ id: 'bun', name: 'صمون', unit: 'حبة', qty: 100, cost: 300 }, { id: 'pat', name: 'لحم', unit: 'كغم', qty: 10, cost: 15000 }],
      recipes: { 'ايت برغر|وحدة': [{ mid: 'bun', q: 1 }, { mid: 'pat', q: 0.1 }] },   // 300 + 1,500 = 1,800
      costs: { 'كلاسك برغر|وحدة': 1, 'كابوي برغر|وحدة': 2250 }, moves: [], expenses: [] });
    const o = (id, items) => setDoc(doc(db, 'orders/' + id), { restaurantId: 'RC', status: 'delivered', createdAtMs: t, orderType: 'salon', items,
      value: items.reduce((s, i) => s + i.price * i.qty, 0), payment: { method: 'cash', cash: 0, card: 0 } });
    await o('C1', [{ name: 'كلاسك برغر', variant: 'وحدة', price: 3000, qty: 2, cost: 4545 }]);   // تكلفة يوم البيع غلط
    await o('F1', [{ name: 'فشاج برغر', variant: 'وحدة', price: 2500, qty: 3 }]);                  // انباع قبل ما تنحط تكلفته
    await o('E1', [{ name: 'ايت برغر', variant: 'وحدة', price: 4500, qty: 2, cost: 1800 }]);
    await o('K1', [{ name: 'كابوي برغر', variant: 'وحدة', price: 4500, qty: 1 }]);                 // بدون تكلفة يوم البيع ← تكلفته الحالية (تقديري)
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

const rowOf = (p, name) => p.evaluate((n) => { const tr = [...document.querySelectorAll('#axBody tr.ax-row')].find((r) => r.querySelector('b')?.textContent === n);
  return tr ? [...tr.children].map((td) => td.textContent.trim()) : null; }, name);

test('profit per item = sales − cost of goods sold, the audit shows what is wrong, costs and recipes are fixed from the admin panel only', async () => {
  const p = await page(B, { w: 1366, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'cown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.click('#axTabs button >> text=الأصناف والأرباح');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('فحص الحسابات'));
  // [الصنف، السعر، التكلفة، الربح للحبة، النسبة، المباع، المبيعات، تكلفة المباع، الربح]
  let c = await rowOf(p, 'كلاسك برغر');
  assert.equal(num(c[7]), 9090, 'classic COGS at the (wrong) sale-day cost'); assert.equal(num(c[8]), -3090);
  assert.match(c[0], /انباع بتكلفة 4,545/); assert.match(c[0], /قليلة جداً/);
  let f = await rowOf(p, 'فشاج برغر');
  assert.equal(num(f[8]), 7500); assert.match(f[0], /بدون تكلفة/);
  const e = await rowOf(p, 'ايت برغر');
  assert.equal(num(e[2]), 1800, 'cost from the recipe'); assert.equal(num(e[8]), 5400);
  const k = await rowOf(p, 'كابوي برغر');
  assert.equal(num(k[7]), 2250, 'no sale-day cost → current cost'); assert.equal(num(k[8]), 2250); assert.match(k[0], /انحسبت بتكلفته الحالية/);
  await p.locator('#axBody').screenshot({ path: 'shots/admin-costs-before.png' }).catch(() => {});
  const aud = await p.textContent('#axBody .ax-aud');
  assert.match(aud, /صنف انباع بتكلفة غير تكلفته الهسه/); assert.match(aud, /تكلفته غير منطقية/); assert.match(aud, /انباع وما إله تكلفة/);
  // قائمة الدخل بنفس الحساب: تكلفة البضاعة = مجموع عمود «تكلفة المباع»
  await p.click('#axTabs button >> text=قائمة الدخل');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('تكلفة البضاعة المباعة'));
  const cogs = await p.evaluate(() => { const tr = [...document.querySelectorAll('#axBody tr')].find((r) => r.textContent.includes('تكلفة البضاعة المباعة')); return tr.children[1].textContent; });
  assert.equal(num(cogs), 9090 + 0 + 3600 + 2250);
  assert.match(await p.textContent('#axBody'), /بدون تكلفة/);

  // كلاسك: تكلفة صحيحة 1,200 + «صحّح مبيعاته القديمة» (مختار وحده لأن تكلفة يوم البيع تختلف)
  await p.click('#axTabs button >> text=الأصناف والأرباح');
  await p.waitForFunction(() => document.getElementById('axBody').textContent.includes('فحص الحسابات'));
  await p.click('#axBody tr.ax-row:has(b:text-is("كلاسك برغر"))');
  await p.waitForSelector('#axIcost');
  assert.equal(await p.isChecked('#axMoBody .ax-chk input'), true, 'fix old sales is pre-selected');
  await p.fill('#axIcost', '1200');
  await p.waitForFunction(() => document.getElementById('axDp').textContent.includes('1,800'));
  await p.click('#axIsave');
  await until(async () => ((await read('accounting/RC')).costs || {})['كلاسك برغر|وحدة'] === 1200);
  const fx = await until(async () => { const d = await read('accounting/RC/meta/recost'); return d && d.items && d.items['كلاسك برغر|وحدة']; });
  assert.equal(fx.cost, 1200);
  await p.waitForFunction(() => { const tr = [...document.querySelectorAll('#axBody tr.ax-row')].find((r) => r.querySelector('b')?.textContent === 'كلاسك برغر'); return tr && tr.children[8].textContent.includes('3,600'); });
  c = await rowOf(p, 'كلاسك برغر');
  assert.match(c[7], /2,400.*✏️/); assert.doesNotMatch(c[0], /انباع بتكلفة/);

  // فشاج: وصفة من مواد المخزن (صمون + نص كيلو لحم بالعشرة = 300 + 750)
  await p.click('#axBody tr.ax-row:has(b:text-is("فشاج برغر"))');
  await p.click('#axMoBody .ax-seg button >> text=وصفة');
  await p.click('#axMoBody button >> text=إضافة مكوّن');
  await p.click('#axMoBody button >> text=إضافة مكوّن');
  await p.selectOption('#axMoBody .ax-ing >> nth=0 >> select', 'bun'); await p.fill('#axMoBody .ax-ing >> nth=0 >> input', '1');
  await p.selectOption('#axMoBody .ax-ing >> nth=1 >> select', 'pat'); await p.fill('#axMoBody .ax-ing >> nth=1 >> input', '0.05');
  await p.waitForFunction(() => document.getElementById('axDc').textContent === '1,050');
  await p.locator('#axMoBody').screenshot({ path: 'shots/admin-cost-recipe.png' }).catch(() => {});
  await p.click('#axIsave');
  const rec = await until(async () => ((await read('accounting/RC')).recipes || {})['فشاج برغر|وحدة']);
  assert.deepEqual(rec, [{ mid: 'bun', q: 1 }, { mid: 'pat', q: 0.05 }]);
  await p.waitForFunction(() => { const tr = [...document.querySelectorAll('#axBody tr.ax-row')].find((r) => r.querySelector('b')?.textContent === 'فشاج برغر'); return tr && tr.children[2].textContent.includes('1,050'); });
  f = await rowOf(p, 'فشاج برغر');
  assert.equal(num(f[8]), 7500 - 3150, 'old sales without a sale-day cost use the new recipe cost');

  // حذف التكلفة الثابتة يمشي (چانت ترجع لأن الحفظ چان merge)
  await p.click('#axBody tr.ax-row:has(b:text-is("كابوي برغر"))');
  await p.fill('#axIcost', '');
  await p.click('#axIsave');
  await until(async () => !('كابوي برغر|وحدة' in ((await read('accounting/RC')).costs || {})));
  await p.screenshot({ path: 'shots/admin-costs.png', fullPage: true });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
