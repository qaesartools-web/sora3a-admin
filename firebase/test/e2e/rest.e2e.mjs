import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const ordersOf = async (rid) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), 'orders'), where('restaurantId', '==', rid))); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const URL_ = 'http://localhost:5050/sora3a-rest2/index.html';

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.r1 = await signUp('r1@x.com', 'secret123');
  U.r2 = await signUp('r2@x.com', 'secret123');
  U.exp = await signUp('exp@x.com', 'secret123');
  U.cap = await signUp('cap@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.r1), { role: 'restaurant', restaurantId: 'R1', email: 'r1@x.com' });
    await setDoc(doc(db, 'users', U.r2), { role: 'restaurant', restaurantId: 'R2', email: 'r2@x.com' });
    await setDoc(doc(db, 'users', U.exp), { role: 'restaurant', restaurantId: 'R3', email: 'exp@x.com' });
    await setDoc(doc(db, 'users', U.cap), { role: 'captain', restaurantId: 'R1', captainId: 'C1' });
    await setDoc(doc(db, 'restaurants/R1'), { name: 'برغر ويست', area: 'الحسينية', phone: '0772', userId: U.r1, active: true });
    await setDoc(doc(db, 'restaurants/R2'), { name: 'R2', userId: U.r2, active: true });
    await setDoc(doc(db, 'restaurants/R3'), { name: 'R3', userId: U.exp, active: true, expiryMs: Date.now() - 1000 });
    await setDoc(doc(db, 'captains/C1'), { restaurantId: 'R1', userId: U.cap, name: '<img src=x onerror=window.__xss=1>علي', phone: '0770', available: true });
    await setDoc(doc(db, 'restaurants/R1/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }, { name: 'دبل', variants: [{ name: 'وحدة', price: 5000 }] }] },
      { cat: 'بيتزا', emoji: '🍕', items: [{ name: 'بيتزا لحم', variants: [{ name: 'صغير', price: 4000 }, { name: 'كبير', price: 8000 }] }] }] });
    await setDoc(doc(db, 'orders/OTHERREST00001'), { restaurantId: 'R2', status: 'pending', value: 1, customer: 'سري' });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function login(p, email) {
  await p.goto(URL_);
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', email); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
}

test('expired restaurant is blocked at login', async () => {
  const p = await page(B, { w: 1024, h: 768 });
  await login(p, 'exp@x.com');
  await p.waitForSelector('#errBox', { state: 'visible' });
  assert.match(await p.textContent('#errBox'), /انتهى الاشتراك/);
  await p.context().close();
});

test('captain account cannot use the restaurant app', async () => {
  const p = await page(B, { w: 1024, h: 768 });
  await login(p, 'cap@x.com');
  await p.waitForSelector('#errBox', { state: 'visible' });
  assert.match(await p.textContent('#errBox'), /غير مسجل كمطعم/);
  await p.context().close();
});

test('cashier: delivery order → tracking, captain reject → escaped notice, cancel', async () => {
  const p = await page(B, { w: 1024, h: 768 });
  await login(p, 'r1@x.com');
  await p.waitForSelector('#appPage.show', { timeout: 15000 });
  await p.evaluate(() => { const t = document.querySelector('.ts-panel,#themeSwitcher'); if (t) t.remove(); });
  // add first product
  await p.waitForSelector('#prods .prod');
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn');
  await p.click('button[onclick="pickType(\'delivery\')"]');
  await p.fill('#dName', 'زبون <script>'); await p.fill('#dPhone', '07701112222'); await p.fill('#dAddr', 'المنصور');
  await p.click('#capList .capcard >> nth=0');
  await p.click('#confCapBtn');
  const o = await until(async () => (await ordersOf('R1'))[0]);
  assert.equal(o.status, 'pending'); assert.equal(o.captainId, 'C1'); assert.equal(o.orderType, 'delivery');
  const t = await until(() => read('tracking/' + o.id));
  assert.equal(t.status, 'pending'); assert.equal(t.phone, undefined); assert.equal(t.restaurantName, 'برغر ويست');
  assert.equal(await p.evaluate(() => window.__xss), undefined, 'captain name XSS inert');
  // captain rejects (simulate the captain app write)
  await write('orders/' + o.id, { rejectedBy: ['C1'], rejectNotice: { by: '<img src=x onerror=window.__xss2=1>', time: '12:00', timestamp: Date.now(), seen: false } });
  await p.waitForSelector('#rejOverlay.show', { timeout: 10000 });
  assert.equal(await p.evaluate(() => window.__xss2), undefined, 'reject notice XSS inert');
  await until(async () => (await read('orders/' + o.id)).rejectNotice.seen === true);
  await p.click('button[onclick="dismissRej()"]');
  // cancel from orders screen
  await p.evaluate(() => goTab('orders'));
  await p.click(`button[onclick="ordCancel('${o.id}')"]`);
  await p.click('#acOv .confbtn, #acOv button.btn-primary, #acOv [id=acOk]').catch(async () => { await p.click('#acOv button >> text=تأكيد'); });
  await until(async () => (await read('orders/' + o.id)).status === 'cancelled');
  const tc = await until(async () => (await read('tracking/' + o.id)).status === 'cancelled' && 1); console.log('ERRS', JSON.stringify(p.errors));
  assert.equal((await read('tracking/' + o.id)).status, 'cancelled');
  // salon order
  await p.evaluate(() => goTab('cashier'));
  await p.click('#prods .prod >> nth=1');
  await p.click('#sendBtn');
  await p.click('button[onclick="pickType(\'salon\')"]');
  await p.click('#payOk');
  await until(async () => (await ordersOf('R1')).some((x) => x.orderType === 'salon'));
  // never sees the other restaurant's order
  assert.ok(!(await p.content()).includes('سري'));
  const errs = p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest/.test(e));
  assert.deepEqual(errs, []);
  await p.screenshot({ path: 'shots/rest-orders.png', fullPage: false });
  await p.context().close();
});
