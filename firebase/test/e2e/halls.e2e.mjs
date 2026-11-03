// الصالات: المطعم اللي بيه صالتين — كل صالة إلها أرقام طاولات، وصاحب المطعم يختار صالة كل كاشير،
//  وكل كاشير توصله طلبات طاولات صالته بس (باركود الطاولة والويتر). باركودات الطاولات تنطبع لكل صالة لوحدها
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const day = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.own = await signUp('hall@x.com', 'secret123'); U.a = await signUp('ha@x.com', 'secret123'); U.b = await signUp('hb@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.own), { role: 'restaurant', restaurantId: 'RH', email: 'hall@x.com', name: 'أبو علي' });
    await setDoc(doc(db, 'users', U.a), { role: 'cashier', restaurantId: 'RH', email: 'ha@x.com', name: 'كاشير العوائل', perms: {} });
    await setDoc(doc(db, 'users', U.b), { role: 'cashier', restaurantId: 'RH', email: 'hb@x.com', name: 'كاشير الشباب', perms: {} });
    await setDoc(doc(db, 'restaurants/RH'), { name: 'مطعم الصالتين', userId: U.own, active: true, features: { online: true } });
    await setDoc(doc(db, 'restaurants/RH/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'مشويات', emoji: '🍢', items: [{ name: 'تكة', variants: [{ name: 'وحدة', price: 6000 }] }] }] });
    await setDoc(doc(db, 'restaurants/RH/settings/main'), { tables: 10, receiptTitle: 'مطعم الصالتين', online: { on: true, table: true, pickup: true, delivery: false }, updatedAtMs: 1 });
    await setDoc(doc(db, 'publicMenus/RH'), { on: true, name: 'مطعم الصالتين', modes: { table: true, pickup: true, delivery: false }, tables: 10, cats: [] });
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
// طلب باركود طاولة (مثل ما يكتبه منيو الزبون)
const qr = (id, table) => E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'webOrders/' + id), {
  restaurantId: 'RH', source: 'qr', mode: 'table', table, items: [{ name: 'تكة', variant: 'وحدة', qty: 1 }], customer: '', phone: '', status: 'new', total: 6000, createdAtMs: Date.now(), day: day() }));
const cards = (p) => p.$$eval('#webBox .web-card', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));

test('halls: the owner defines halls (table ranges), picks each cashier\'s hall from the admin app, each cashier gets only its hall\'s table orders, and table QR codes print per hall', async () => {
  // ── صاحب المطعم (الكاشير): يعرّف الصالتين — والتداخل ينرفض
  const o = await pos('hall@x.com');
  await o.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await o.waitForSelector('#stHallN0');
  await o.fill('#stHallN0', 'صالة العوائل'); await o.fill('#stHallF0', '1'); await o.fill('#stHallT0', '5');
  await o.fill('#stHallN1', 'صالة الشباب'); await o.fill('#stHallF1', '5'); await o.fill('#stHallT1', '10');
  await o.click('button >> text=حفظ الإعدادات');
  await o.waitForTimeout(700);
  assert.ok(!((await read('restaurants/RH/settings/main')).halls || []).length, 'overlapping halls are refused');
  await o.fill('#stHallF1', '6');
  await o.click('button >> text=حفظ الإعدادات');
  const st = await until(async () => { const s = await read('restaurants/RH/settings/main'); return s && (s.halls || []).length === 2 ? s : null; });
  const [h1, h2] = st.halls;
  assert.deepEqual([h1.name, h1.from, h1.to, h2.name, h2.from, h2.to], ['صالة العوائل', 1, 5, 'صالة الشباب', 6, 10]);
  assert.equal(st.tables, 10); assert.equal(st.online.on, true, 'other settings kept');
  // باركودات الطاولات: كل صالة بصفحة واسمها على كل باركود — وزر لكل صالة
  await o.click('button >> text=QR الطاولات');
  let sheet = await until(() => o.evaluate(() => { const f = document.getElementById('qrFr'); return f && f.srcdoc; }));
  assert.equal((sheet.match(/<svg/g) || []).length, 10);
  assert.ok(sheet.includes('🏛️ صالة العوائل — طاولات 1–5') && sheet.includes('🏛️ صالة الشباب — طاولات 6–10'));
  assert.ok(sheet.indexOf('صالة الشباب — طاولات') > sheet.indexOf('طاولة 5') && sheet.indexOf('طاولة 6') > sheet.indexOf('صالة الشباب — طاولات'), 'tables grouped under their hall');
  await o.evaluate(() => { document.getElementById('qrFr').srcdoc = ''; });
  await o.click('button >> text=QR صالة الشباب');
  sheet = await until(() => o.evaluate(() => document.getElementById('qrFr').srcdoc));
  assert.equal((sheet.match(/<svg/g) || []).length, 5);
  assert.ok(sheet.includes('طاولة 6') && sheet.includes('طاولة 10') && !sheet.includes('طاولة 5<') && !sheet.includes('صالة العوائل'));

  // ── لوحة الإدارة: صاحب المطعم يختار صالة كل كاشير
  const a = await page(B, { w: 1280, h: 900 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html');
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'hall@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#appPage', { state: 'visible' });
  await a.click('.dnav-btn[data-screen="scMyRest"]');
  await a.waitForSelector(`select[data-hall="${U.a}"]`, { timeout: 15000 });
  assert.deepEqual(await a.$$eval(`select[data-hall="${U.a}"] option`, (x) => x.map((o) => o.textContent.trim())), ['كل الصالات', 'صالة العوائل (طاولات 1–5)', 'صالة الشباب (طاولات 6–10)']);
  await a.selectOption(`select[data-hall="${U.a}"]`, h1.id);
  await a.selectOption(`select[data-hall="${U.b}"]`, h2.id);
  await until(async () => (await read('users/' + U.a)).hall === h1.id && (await read('users/' + U.b)).hall === h2.id);
  await a.screenshot({ path: 'shots/admin-cashier-hall.png' });

  // ── كل كاشير توصله طلبات طاولات صالته بس
  const ca = await pos('ha@x.com'), cb = await pos('hb@x.com');
  await qr('QRT3aaaaaaaaaaaaaaaa', '3'); await qr('QRT8aaaaaaaaaaaaaaaa', '8');
  await ca.waitForSelector('#webBox .web-card', { timeout: 15000 });
  await cb.waitForSelector('#webBox .web-card', { timeout: 15000 });
  await ca.waitForTimeout(800);
  let A = await cards(ca), Bc = await cards(cb);
  assert.equal(A.length, 1); assert.match(A[0], /طاولة 3/);
  assert.equal(Bc.length, 1); assert.match(Bc[0], /طاولة 8/);
  // الويتر (طاولة ٩) ← كاشير الشباب بس
  await E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'screens/wH'), { restaurantId: 'RH', kind: 'waiter', approved: true, code: 'WH23CD', name: 'علي' }));
  await E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'webOrders/WT9aaaaaaaaaaaaaaaaa'), { restaurantId: 'RH', source: 'waiter', mode: 'table', table: '9', items: [{ name: 'تكة', variant: 'وحدة', qty: 2, price: 6000 }],
    status: 'new', total: 12000, createdAtMs: Date.now(), day: day(), waiter: 'علي', waiterUid: 'wH' }));
  await cb.waitForFunction(() => document.querySelectorAll('#webBox .web-card').length === 2, null, { timeout: 15000 });
  await ca.waitForTimeout(1000);
  assert.equal((await cards(ca)).length, 1, 'the families cashier does not get table 9');
  // طاولة برا الصالات (مثلاً ١٢) ← الكل
  await qr('QRT12aaaaaaaaaaaaaaa', '12');
  await ca.waitForFunction(() => document.querySelectorAll('#webBox .web-card').length === 2, null, { timeout: 15000 });
  // صاحب المطعم يرجّع كاشير العوائل «كل الصالات» ← توصله كلها فوراً
  await a.selectOption(`select[data-hall="${U.a}"]`, '');
  await ca.waitForFunction(() => document.querySelectorAll('#webBox .web-card').length >= 3, null, { timeout: 15000 });
  // كاشير الشباب يقبل طاولة ٨ ← تختفي عنده
  await cb.click('#webBox .web-card:has-text("طاولة 8") .call-go');
  await until(async () => (await read('webOrders/QRT8aaaaaaaaaaaaaaaa')).status === 'accepted');
  for (const p of [o, a, ca, cb]) assert.deepEqual(clean(p), []);
  for (const p of [o, a, ca, cb]) await p.context().close();
});
