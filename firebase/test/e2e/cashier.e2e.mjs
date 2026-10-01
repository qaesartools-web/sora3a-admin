import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const all = async (col, f, val) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(f ? query(collection(c.firestore(), col), where(f, '==', val)) : collection(c.firestore(), col)); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.owner = await signUp('owner@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RC', email: 'owner@x.com', name: 'صاحب المطعم' });
    await setDoc(doc(db, 'restaurants/RC'), { name: 'مطعم الاتصال', userId: U.owner, active: true });
    await setDoc(doc(db, 'captains/CC'), { restaurantId: 'RC', userId: 'z', name: 'سجاد', available: true });
    await setDoc(doc(db, 'restaurants/RC/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }, { name: 'زنكر', variants: [{ name: 'وحدة', price: 4000 }] }] }] });
    await setDoc(doc(db, 'restaurants/RC/customers/07701112222'), { phone: '07701112222', name: 'أبو حسين', address: 'المنصور شارع 14', orders: 4, spent: 40000,
      lastOrderAt: Date.now() - 2 * 86400000, lastItems: [{ name: 'زنكر', variant: 'وحدة', qty: 2, note: 'حار' }], itemCounts: { 'زنكر': 7, 'كلاسك': 2 } });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function adminLogin(p, email) {
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', email); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
}
async function posLogin(p, email, pass = 'secret123') {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', email); await p.fill('#inPass', pass); await p.click('#loginBtn');
  await p.waitForSelector('#appPage.show', { timeout: 15000 });
}
let LINE;

test('owner creates a cashier with default permissions and a phone line', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await adminLogin(p, 'owner@x.com');
  await p.click('.dnav-btn[data-screen="scMyRest"]');
  await p.fill('#mcName', 'علي الكاشير'); await p.fill('#mcEmail', 'cash@x.com'); await p.fill('#mcPass', 'cashpass1');
  await p.click('#mcAddBtn');
  const cu = await until(async () => (await all('users', 'role', 'cashier'))[0]);
  assert.equal(cu.restaurantId, 'RC');
  assert.deepEqual(cu.perms, { discount: true, cancel: false, reports: false, inventory: false, menu: false, settings: false });
  U.cash = cu.id;
  await p.waitForSelector('#mcList .entity');
  await p.fill('#mlLabel', 'خط زين');
  await p.click('button >> text=إضافة خط');
  LINE = await until(async () => (await all('lineTokens', 'restaurantId', 'RC'))[0]);
  assert.ok(LINE.id.length >= 24); assert.equal(LINE.line, '1'); assert.equal(LINE.active, true);
  await p.waitForSelector('#mlList .entity');
  await p.click('button >> text=طريقة الربط');
  const setup = await p.textContent('#mlList');
  assert.ok(setup.includes(LINE.id) && setup.includes('incomingCalls?key=') && setup.includes('[call_number]'));
  assert.deepEqual(clean(p), []);
  await p.screenshot({ path: 'shots/admin-lines.png', fullPage: true });
  await p.context().close();
});

test('cashier sees only allowed sections; permissions update live', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await posLogin(p, 'cash@x.com', 'cashpass1');
  await p.waitForSelector('#prods .prod');
  const vis = async (t) => p.evaluate((t) => getComputedStyle(document.querySelector(`.dnb[data-tab="${t}"]`)).display !== 'none', t);
  assert.equal(await vis('reports'), false); assert.equal(await vis('acc'), false); assert.equal(await vis('menu'), false);
  assert.equal(await vis('cashier'), true); assert.equal(await vis('shift'), true); assert.equal(await vis('kitchen'), true);
  await p.evaluate(() => goTab('reports'));
  assert.equal(await p.evaluate(() => document.getElementById('reportsScreen').classList.contains('on')), false);
  assert.match(await p.textContent('#restName'), /علي الكاشير/);
  // صاحب المطعم يفعّل التقارير → تظهر فوراً
  await write('users/' + U.cash, { perms: { discount: true, cancel: false, reports: true, inventory: false, menu: false, settings: false } });
  await p.waitForFunction(() => getComputedStyle(document.querySelector('.dnb[data-tab="reports"]')).display !== 'none', null, { timeout: 10000 });
  // إيقاف الحساب يخرجه
  await write('users/' + U.cash, { disabled: true });
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 10000 });
  await write('users/' + U.cash, { disabled: false });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('incoming call via line token → customer card → repeat last order → delivery prefilled', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await posLogin(p, 'cash@x.com', 'cashpass1');
  await p.waitForTimeout(1200);
  await p.waitForSelector('#prods .prod');
  // الجهاز يرسل المكالمة (نفس طلب MacroDroid تماماً، بدون تسجيل دخول)
  const body = JSON.stringify({ fields: { token: { stringValue: LINE.id }, restaurantId: { stringValue: 'RC' }, line: { stringValue: '1' }, number: { stringValue: '+964 770 111 2222' }, status: { stringValue: 'ringing' } } });
  const r = await fetch('http://127.0.0.1:8080/v1/projects/sora3a-system/databases/(default)/documents/incomingCalls?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(r.status, 200, await r.text());
  // توكن خاطئ مرفوض
  const bad = await fetch('http://127.0.0.1:8080/v1/projects/sora3a-system/databases/(default)/documents/incomingCalls?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body.replace(LINE.id, 'X'.repeat(30)) });
  assert.equal(bad.status, 403);
  await p.waitForSelector('.call-card', { timeout: 10000 });
  await p.waitForFunction(() => document.querySelector('.call-info').textContent.includes('أبو حسين'));
  const info = await p.textContent('.call-info');
  assert.ok(info.includes('المنصور') && info.includes('زنكر'));
  await p.waitForTimeout(400); await p.screenshot({ path: 'shots/pos-call.png' });
  await p.click('.call-btns button >> text=كرر آخر طلب');
  await p.waitForFunction(() => cart.length === 1 && cart[0].name === 'زنكر' && cart[0].qty === 2 && cart[0].note === 'حار');
  const call = await until(async () => (await all('incomingCalls', 'restaurantId', 'RC')).find((c) => c.status === 'taken'));
  assert.ok(call);
  assert.match(await p.textContent('#curCust'), /07701112222/);
  await p.click('#sendBtn'); await p.keyboard.press('4');
  await p.waitForSelector('#delivOv.on');
  assert.equal(await p.inputValue('#dName'), 'أبو حسين');
  assert.equal(await p.inputValue('#dAddr'), 'المنصور شارع 14');
  assert.equal(await p.inputValue('#dPhone'), '07701112222');
  await p.click('#capList .capcard'); await p.click('#confCapBtn');
  const o = await until(async () => (await all('orders', 'restaurantId', 'RC')).find((x) => x.orderType === 'delivery'));
  assert.equal(o.phone, '07701112222'); assert.equal(o.customer, 'أبو حسين');
  const cust = await until(async () => { const d = await read('restaurants/RC/customers/07701112222'); return d.orders === 5 ? d : null; });
  assert.equal(cust.itemCounts['زنكر'], 9);
  assert.equal(await p.evaluate(() => document.getElementById('curCust').classList.contains('on')), false);
  // زبون جديد يكتب رقمه يدوياً ثم يرجع يتصل → معلوماته محفوظة
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('4');
  await p.fill('#dPhone', '07809998877'); await p.fill('#dName', 'زبون جديد'); await p.fill('#dAddr', 'الكرادة');
  await p.click('#capList .capcard'); await p.click('#confCapBtn');
  await until(() => read('restaurants/RC/customers/07809998877'));
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('4');
  await p.fill('#dPhone', '0780 999 8877');
  await p.waitForFunction(() => document.getElementById('dName').value === 'زبون جديد', null, { timeout: 8000 });
  assert.equal(await p.inputValue('#dAddr'), 'الكرادة');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('cashier without cancel/discount permission cannot cancel or discount', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await write('users/' + U.cash, { perms: { discount: false, cancel: false } });
  await posLogin(p, 'cash@x.com', 'cashpass1');
  await p.waitForSelector('#prods .prod');
  await p.click('#prods .prod >> nth=0');
  assert.equal(await p.isVisible('#discBtn'), false);
  await p.evaluate(() => goTab('orders'));
  await p.waitForSelector('.ocard');
  assert.equal(await p.locator('button[onclick^="ordCancel"]').count(), 0);
  await p.context().close();
});
