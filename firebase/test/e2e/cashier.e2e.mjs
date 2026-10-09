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
  assert.deepEqual(cu.perms, { discount: true, cancel: false, inventory: false, menu: false, settings: false });
  U.cash = cu.id;
  await p.waitForSelector('#mcList .entity');
  // الطريقة الأساسية هي تطبيق «خط المطعم»؛ الإضافة اليدوية (سنترال/MacroDroid) تحت «متقدم»
  assert.match(await p.getAttribute('.ml-app a', 'href'), /download\/line-android\/sora3a-line\.apk$/);
  await p.click('.ml-adv summary');
  await p.fill('#mlLabel', 'خط زين');
  await p.click('button >> text=إضافة خط يدوي');
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
  // صاحب المطعم يفعّل المخزون → يظهر فوراً، والتقارير تبقى مخفية عن الكاشير دائماً
  await write('users/' + U.cash, { perms: { discount: true, cancel: false, reports: true, inventory: true, menu: false, settings: false } });
  await p.waitForFunction(() => getComputedStyle(document.querySelector('.dnb[data-tab="acc"]')).display !== 'none', null, { timeout: 10000 });
  assert.equal(await vis('reports'), false);
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

test('working hours: shift auto-closes with printed total at end, cashier locked until hours start', async () => {
  const bag = () => (Math.floor(Date.now() / 60000) + 180) % 1440;
  const wrap = (n) => ((n % 1440) + 1440) % 1440;
  const n = bag();
  await write('users/' + U.cash, { perms: { discount: true }, hours: { from: wrap(n - 60), to: wrap(n + 60) } });
  const p = await page(B, { w: 1280, h: 800 });
  await posLogin(p, 'cash@x.com', 'cashpass1');
  await p.waitForSelector('#prods .prod');
  await p.evaluate(() => goTab('shift'));
  await p.fill('#shOpenCash', '10000');
  await p.click('button >> text=فتح الوردية');
  const sh = await until(async () => (await all('restaurants/RC/shifts', 'status', 'open'))[0]);
  assert.equal(sh.uid, U.cash);
  await E.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'orders/OH1'), { restaurantId: 'RC', status: 'delivered', orderType: 'takeaway', value: 7000, shiftId: sh.id, createdAtMs: Date.now(),
      payment: { method: 'cash', cash: 7000, card: 0, shiftId: sh.id, atMs: Date.now() } });
  });
  await p.waitForFunction(() => orders.some((o) => o.id === 'OH1'));
  // صاحب المطعم يجعل الدوام منتهياً قبل دقيقتين → يطلع «تمديد»؛ الكاشير يختار إنهاء الدوام → إغلاق تلقائي + طباعة + قفل
  await write('users/' + U.cash, { hours: { from: wrap(n - 120), to: wrap(n - 2) } });
  await p.waitForSelector('#extAsk.on', { timeout: 10000 });
  assert.match(await p.textContent('#extAsk'), /تمدد الدوام/);
  assert.ok(await p.isVisible('#extAsk .ext-b.eod'), 'until end of day is always offered');
  await p.click('#extAsk button >> text=إنهاء الدوام');
  await p.waitForSelector('#dutyLock.on', { timeout: 10000 });
  const closed = await until(async () => { const d = await read('restaurants/RC/shifts/' + sh.id); return d.status === 'closed' ? d : null; });
  assert.equal(closed.autoClosed, true); assert.equal(closed.report.sales, 7000); assert.equal(closed.expectedCash, 17000);
  const printed = await p.evaluate(() => document.getElementById('prtFr').srcdoc);
  assert.ok(printed.includes('تقرير إغلاق الوردية') && /(7,000|٧٬٠٠٠|٧,٠٠٠|7000|٧٠٠٠)/.test(printed));
  assert.match(await p.textContent('#dutyLock'), /خارج وقت الدوام/);
  await p.screenshot({ path: 'shots/pos-duty-lock.png' });
  // بعد السماح: السيرفر يرفض أي كتابة من الكاشير
  await write('users/' + U.cash, { hours: { from: wrap(n - 120), to: wrap(n - 30) } });
  const denied = await p.evaluate(async () => { try { await window._fb.setDoc(window._fb.doc(window._fb.db, 'restaurants/RC/shifts/hack'), { status: 'open' }); return false; } catch (e) { return e.code; } });
  assert.equal(denied, 'permission-denied');
  // بداية الدوام → يفتح تلقائياً
  await write('users/' + U.cash, { hours: { from: wrap(n - 5), to: wrap(n + 60) } });
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => !!document.querySelector('#dutyLock.on')), false);
  await p.context().close();
  // دخول خارج الدوام → مقفل مباشرة
  await write('users/' + U.cash, { hours: { from: wrap(n + 60), to: wrap(n + 120) } });
  const q = await page(B, { w: 390, h: 800 });
  await posLogin(q, 'cash@x.com', 'cashpass1');
  await q.waitForSelector('#dutyLock.on', { timeout: 10000 });
  await q.screenshot({ path: 'shots/pos-duty-mobile.png' });
  await q.context().close();
  await write('users/' + U.cash, { hours: null });
});

test('hours end → the cashier extends and keeps working; the owner sees it and cancels, then no more self-extension today', async () => {
  const bag = () => (Math.floor(Date.now() / 60000) + 180) % 1440;
  const wrap = (n) => ((n % 1440) + 1440) % 1440;
  const n = bag();
  await write('users/' + U.cash, { hours: { from: wrap(n - 120), to: wrap(n + 60) }, hoursExt: { untilMs: 0, atMs: 0, h: '0' } });
  const p = await page(B, { w: 1280, h: 800 });
  await posLogin(p, 'cash@x.com', 'cashpass1');
  await p.waitForSelector('#prods .prod');
  // خلص الوقت ← يطلع «تمديد» (ساعة، ساعتين، ٣ ساعات، لنهاية اليوم)
  await write('users/' + U.cash, { hours: { from: wrap(n - 120), to: wrap(n - 2) } });
  await p.waitForSelector('#extAsk.on', { timeout: 10000 });
  await p.screenshot({ path: 'shots/pos-hours-extend.png' });
  const first = p.locator('#extAsk .ext-b').first();   // ساعة (أو لنهاية اليوم إذا باقي أقل من ساعة)
  await first.click();
  const u = await until(async () => { const d = await read('users/' + U.cash); return d.hoursExt && d.hoursExt.untilMs > Date.now() ? d : null; });
  assert.ok(u.hoursExt.untilMs <= Date.now() + 3600000 + 5000, 'one hour at most');
  await p.waitForSelector('#extAsk', { state: 'hidden' });
  assert.equal(await p.evaluate(() => !!document.querySelector('#dutyLock.on')), false);
  // السيرفر يسمح يشتغل خلال التمديد
  const ok = await p.evaluate(async () => { try { await window._fb.setDoc(window._fb.doc(window._fb.db, 'restaurants/RC/shifts/extok'), { status: 'open', uid: window.posUser.uid }); return true; } catch (e) { return e.code; } });
  assert.equal(ok, true);
  // صاحب المطعم يشوف التمديد ويلغيه
  const a = await page(B, { w: 1280, h: 800 });
  await adminLogin(a, 'owner@x.com');
  await a.click('.dnav-btn[data-screen="scMyRest"]');
  await a.waitForFunction(() => document.getElementById('mcList').textContent.includes('ممدد لغاية'), null, { timeout: 15000 });
  await a.click('#mcList button >> text=إلغاء التمديد');
  await until(async () => (await read('users/' + U.cash)).hoursExt.untilMs === 0);
  // الكاشير ينقفل، وما يطلعله تمديد ثاني اليوم
  await p.waitForSelector('#dutyLock.on', { timeout: 15000 });
  assert.equal(await p.locator('#dutyLock .ext-b').count(), 0);
  assert.deepEqual(clean(a), []);
  await a.context().close(); await p.context().close();
  await write('users/' + U.cash, { hours: null, hoursExt: { untilMs: 0, atMs: 0, h: '0' } });
});

test('owner sets and clears cashier working hours from the admin app', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await adminLogin(p, 'owner@x.com');
  await p.click('.dnav-btn[data-screen="scMyRest"]');
  await p.waitForSelector('#hf_' + U.cash);
  await p.fill('#hf_' + U.cash, '09:00'); await p.fill('#ht_' + U.cash, '17:30');
  await p.click('button >> text=حفظ الدوام');
  const u = await until(async () => { const d = await read('users/' + U.cash); return d.hours ? d : null; });
  assert.deepEqual(u.hours, { from: 540, to: 1050 });
  await p.waitForFunction(() => document.getElementById('mcList').textContent.includes('9:00 ص ← 5:30 م'));
  await p.screenshot({ path: 'shots/admin-hours.png', fullPage: true });
  await p.click('button >> text=بدون وقت');
  await until(async () => (await read('users/' + U.cash)).hours === null);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
