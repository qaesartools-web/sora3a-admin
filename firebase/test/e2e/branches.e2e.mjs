// الفروع: المدير الأعلى يربط الفروع ← صاحب المطعم يتنقل بينها (لوحة المطعم + الكاشير) ويشوف ملخصها سوا
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const list = async (col, k, v) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where(k, '==', v))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const bagDay = (ms) => new Date((ms ?? Date.now()) + 3 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;
const it = (name, price) => ({ name, variants: [{ name: 'وحدة', price }] });

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.admin = await signUp('brboss@x.com', 'secret123');
  U.owner = await signUp('multi@x.com', 'secret123');
  U.ownerB = await signUp('ownb@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.admin), { role: 'admin', email: 'brboss@x.com', name: 'المدير' });
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RA', email: 'multi@x.com' });
    await setDoc(doc(db, 'users', U.ownerB), { role: 'restaurant', restaurantId: 'RB', email: 'ownb@x.com' });
    await setDoc(doc(db, 'restaurants/RA'), { name: 'مشويات الكرادة', area: 'الكرادة', userId: U.owner, active: true, expiryMs: Date.now() + 30 * DAY });
    await setDoc(doc(db, 'restaurants/RB'), { name: 'فرع زيونة', area: 'زيونة', userId: U.ownerB, active: true });
    await setDoc(doc(db, 'restaurants/RC'), { name: 'فرع المنصور', area: 'المنصور', userId: 'nobody', active: true, expiryMs: Date.now() - DAY });
    await setDoc(doc(db, 'restaurants/RA/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'مشويات', emoji: '🍢', items: [it('كباب الكرادة', 8000)] }] });
    await setDoc(doc(db, 'restaurants/RB/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'مشويات', emoji: '🍢', items: [it('تكة زيونة', 9000)] }] });
    const today = bagDay(), o = (rid, v, t) => ({ restaurantId: rid, value: v, orderType: t, status: 'delivered', day: today, createdAtMs: Date.now() - 3600000 });
    await setDoc(doc(db, 'orders/A1'), o('RA', 10000, 'salon'));
    await setDoc(doc(db, 'orders/A2'), o('RA', 15000, 'delivery'));
    await setDoc(doc(db, 'orders/B1'), o('RB', 7000, 'takeaway'));
    await setDoc(doc(db, 'orders/B2'), { ...o('RB', 99000, 'salon'), status: 'cancelled' });
    await setDoc(doc(db, 'orders/B3'), { ...o('RB', 5000, 'salon'), day: bagDay(Date.now() - 2 * DAY) });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function adminLogin(p, email) {
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', email); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
}

test('super admin links two restaurants as branches of an owner', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await adminLogin(p, 'brboss@x.com');
  await p.click('.dnav-btn[data-screen="scRests"]');
  await p.waitForSelector('#restList .entity >> text=مشويات الكرادة');
  const card = p.locator('#restList .entity', { has: p.locator('.entity-name', { hasText: 'مشويات الكرادة' }) });
  await card.locator('button >> text=الفروع').click();
  await p.waitForSelector('#brMo.open');
  assert.equal(await p.locator('#brMoBody .br-opt').count(), 2);
  await p.check('#brMoBody .br-opt input[value="RB"]');
  await p.check('#brMoBody .br-opt input[value="RC"]');
  await p.screenshot({ path: 'shots/branches-admin-link.png' });
  await p.click('#brMoBody .btn-save');
  const u = await until(async () => { const d = await read('users/' + U.owner); return d.branches ? d : null; });
  assert.deepEqual(u.branches, ['RB', 'RC']);
  await p.waitForSelector('#restList .br-line >> text=فروعه');
  assert.ok((await card.textContent()).includes('فرع زيونة'));
  assert.ok((await p.locator('#restList .entity', { has: p.locator('.entity-name', { hasText: 'فرع زيونة' }) }).textContent()).includes('فرع تابع لـ مشويات الكرادة'));
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('owner panel: branch switcher + today summary of all branches; switching shows only that branch', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await adminLogin(p, 'multi@x.com');
  await p.waitForSelector('#branchSel:not([hidden])');
  const opts = await p.$$eval('#branchSel option', (os) => os.map((o) => ({ v: o.value, t: o.textContent, d: o.disabled, s: o.selected })));
  assert.deepEqual(opts.map((o) => o.v), ['RA', 'RB', 'RC']);
  assert.equal(opts[0].s, true); assert.equal(opts[2].d, true); assert.ok(opts[2].t.includes('منتهي'));
  await p.waitForSelector('#brSum tr.tot');
  const rows = await p.$$eval('#brSum tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  assert.ok(rows[0][0].startsWith('مشويات الكرادة'));
  assert.deepEqual(rows[0].slice(1), ['2', '25,000', '1', '1', '0']);
  assert.deepEqual(rows[1].slice(1), ['1', '7,000', '0', '0', '1'], 'cancelled and old orders not counted');
  assert.ok(rows[2][1].includes('منتهي'));
  assert.deepEqual(rows[3], ['المجموع', '3', '32,000 د.ع', '1', '1', '1']);
  await p.screenshot({ path: 'shots/branches-owner-summary.png', fullPage: true });
  // التحويل لفرع زيونة
  await p.selectOption('#branchSel', 'RB');
  await p.waitForFunction(() => document.getElementById('hdrName').textContent === 'فرع زيونة', null, { timeout: 15000 });
  await p.click('.dnav-btn[data-screen="scOrders"]');
  await until(async () => (await p.evaluate(() => allOrders.length)) === 3);
  assert.deepEqual((await p.evaluate(() => allOrders.map((o) => o.restaurantId))).filter((r) => r !== 'RB'), []);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('cashier: owner picks the branch on this device, sells there, and can switch', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'multi@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#branchPick .br-b');
  assert.equal(await p.locator('#branchPick .br-b').count(), 3);
  assert.equal(await p.locator('#branchPick .br-b[data-id="RC"]').isDisabled(), true);
  await p.screenshot({ path: 'shots/branches-cashier-pick.png' });
  await p.click('#branchPick .br-b[data-id="RB"]');
  await p.waitForSelector('#prods .prod >> text=تكة زيونة', { timeout: 15000 });
  assert.equal(await p.textContent('#restName'), 'فرع زيونة');
  assert.equal(await p.isVisible('#branchBtn'), true);
  await p.click('#prods .prod >> text=تكة زيونة');
  await p.click('#sendBtn'); await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on'); await p.click('#payOk');
  const o = await until(async () => (await list('orders', 'restaurantId', 'RB')).find((x) => x.items && x.items[0].name === 'تكة زيونة'));
  assert.equal(o.restaurantName, 'فرع زيونة'); assert.equal(o.day, bagDay());
  // نفس الجهاز بعد إعادة الفتح: يفتح الفرع المحفوظ مباشرة
  await p.reload();
  await p.waitForSelector('#prods .prod >> text=تكة زيونة', { timeout: 15000 });
  assert.equal(await p.locator('#branchPick').count(), 0);
  // تغيير الفرع
  await p.click('#branchBtn');
  await p.waitForSelector('#branchPick .br-b');
  await p.click('#branchPick .br-b[data-id="RA"]');
  await p.waitForSelector('#prods .prod >> text=كباب الكرادة', { timeout: 15000 });
  assert.equal(await p.textContent('#restName'), 'مشويات الكرادة');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('a single-restaurant owner sees no branch UI', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await adminLogin(p, 'ownb@x.com');
  await p.waitForSelector('#dashStats .stat');
  assert.equal(await p.isVisible('#branchSel'), false);
  assert.equal(await p.isVisible('#brSumCard'), false);
  await p.context().close();
});
