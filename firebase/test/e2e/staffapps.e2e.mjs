// شاشة «طلبك جاهز» + تطبيق الويتر
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const put = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); }); };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const list = async (col, k, v) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where(k, '==', v))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext|wakeLock|speech/i.test(e));
const bagDay = (ms) => new Date((ms ?? Date.now()) + 3 * 3600000).toISOString().slice(0, 10);
const BASE = 'http://localhost:5050/sora3a-rest2/';

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.owner = await signUp('scr@x.com', 'secret123');
  U.waiter = await signUp('waiter@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RW', email: 'scr@x.com' });
    await setDoc(doc(db, 'users', U.waiter), { role: 'cashier', restaurantId: 'RW', email: 'waiter@x.com', name: 'علي', perms: {} });
    await setDoc(doc(db, 'restaurants/RW'), { name: 'مطعم الشاشة', userId: U.owner, active: true });
    await setDoc(doc(db, 'restaurants/RW/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'برغر', emoji: '🍔', items: [{ name: 'برغر لحم', variants: [{ name: 'وحدة', price: 6000 }] }, { name: 'برغر دجاج', variants: [{ name: 'عادي', price: 5000 }, { name: 'دبل', price: 7500 }] }] },
      { cat: 'مشروبات', emoji: '🥤', items: [{ name: 'لبن', variants: [{ name: 'وحدة', price: 750 }] }] }] });
    await setDoc(doc(db, 'restaurants/RW/settings/main'), { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 1 });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function login(p, url, email) {
  await p.goto(url);
  await p.waitForSelector('#gEmail', { timeout: 15000 });
  await p.fill('#gEmail', email); await p.fill('#gPass', 'secret123'); await p.click('#gGo');
}
async function posLogin(p) {
  await p.goto(BASE + 'index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'scr@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
}
const nums = (p, sel) => p.$$eval(sel + ' .n', (els) => els.map((e) => e.textContent.trim()));

test('ready screen: takeaway/pager orders in two columns, new ready number flashes, served ones leave', async () => {
  const now = Date.now(), m = 60000, today = bagDay();
  const base = { restaurantId: 'RW', status: 'delivered', value: 5000, day: today, createdAtMs: now - 10 * m };
  await put('orders/A', { ...base, orderType: 'takeaway', kitchen: 'new', ticketNo: 5 });
  await put('orders/B', { ...base, orderType: 'takeaway', kitchen: 'ready', kitchenReadyAt: now - 2 * m, ticketNo: 6, pager: 3 });
  await put('orders/C', { ...base, orderType: 'delivery', status: 'pending', kitchen: 'new', ticketNo: 7 });
  await put('orders/D', { ...base, orderType: 'salon', kitchen: 'new', ticketNo: 8, tableNo: 2 });
  await put('orders/E', { ...base, orderType: 'takeaway', kitchen: 'ready', kitchenReadyAt: now - m, servedAtMs: now, ticketNo: 9 });
  await put('orders/F', { ...base, orderType: 'takeaway', kitchen: 'ready', kitchenReadyAt: now - 40 * m, ticketNo: 10 });
  await put('orders/G', { ...base, orderType: 'salon', kitchen: 'new', ticketNo: 11, pager: 4 });
  await put('orders/H', { ...base, orderType: 'takeaway', status: 'preparing', held: true, holdNum: 2, kitchen: 'new', ticketNo: 12, day: bagDay(now - 86400000), createdAtMs: now - 3 * 3600000 });
  const p = await page(B, { w: 1280, h: 720 });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#scr:not([hidden]) #prep .n');
  assert.equal(await p.textContent('#nm'), 'برغر الشاشة');
  assert.deepEqual(await nums(p, '#prep'), ['#12', '#5', '#11📟 بيجر 4']);
  assert.deepEqual(await nums(p, '#ready'), ['#6📟 بيجر 3']);
  await p.screenshot({ path: 'shots/ready-screen.png' });
  // المطبخ يخلص ٥ ← يطلع بالأخضر ويومض
  await write('orders/A', { kitchen: 'ready', kitchenReadyAt: Date.now() });
  await p.waitForFunction(() => document.querySelector('#ready .n.new') && document.querySelector('#ready .n.new').textContent.includes('#5'));
  assert.deepEqual(await nums(p, '#ready'), ['#5', '#6📟 بيجر 3']);
  // تحرير البيجر ← يختفي
  await write('orders/B', { pagerDone: true, servedAtMs: Date.now() });
  await p.waitForFunction(() => document.querySelectorAll('#ready .n').length === 1);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('ready screen opens straight from a signed-in cashier and shows orders made at the cashier', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await posLogin(p);
  assert.equal(await p.getAttribute('#readyScrBtn', 'href'), 'screen.html');
  await p.evaluate(() => { cart.push({ name: 'برغر لحم', variant: 'وحدة', price: 6000, qty: 1 }); holdOrder({ name: 'سجاد' }); });
  const o = await until(async () => (await list('orders', 'restaurantId', 'RW')).find((x) => x.customer === 'سجاد'));
  assert.equal(o.day, bagDay());
  const s = await p.context().newPage();
  s.errors = []; s.on('pageerror', (e) => s.errors.push(String(e)));
  await s.goto(BASE + 'screen.html');
  await s.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  assert.equal(await s.locator('#gEmail').count(), 0, 'no second login');
  await s.waitForFunction((n) => [...document.querySelectorAll('#prep .n')].some((e) => e.textContent.startsWith('#' + n)), o.ticketNo);
  assert.deepEqual(s.errors, []);
  await p.context().close();
});

test('waiter: picks table 5 on the phone → order auto-accepted at the cashier → kitchen ticket → waiter sees ready', async () => {
  const cashier = await page(B, { w: 1280, h: 860 });
  await posLogin(cashier);
  const w = await page(B, { w: 390, h: 844 });
  await login(w, BASE + 'waiter.html', 'waiter@x.com');
  await w.waitForSelector('.tb');
  assert.equal(await w.locator('.tb').count(), 8);
  assert.ok((await w.textContent('#wName')).includes('علي'));
  await w.screenshot({ path: 'shots/waiter-tables.png' });
  await w.click('.tb[data-t="5"]');
  await w.waitForSelector('.it');
  await w.click('.it >> text=برغر لحم');
  await w.click('.it >> text=برغر لحم');
  await w.click('.it >> text=برغر دجاج');
  await w.waitForSelector('#itemSh.on');
  await w.click('#itemSh [data-v="1"]');
  await w.fill('#iNote', 'بدون مخلل');
  await w.click('#iAdd');
  await w.click('.chip >> text=مشروبات');
  await w.click('.it >> text=لبن');
  assert.equal(await w.textContent('#barN'), '4');
  await w.screenshot({ path: 'shots/waiter-menu.png' });
  await w.click('#barBtn'); await w.waitForSelector('#cartSh.on');
  await w.fill('#cNote', 'الطاولة مستعجلة');
  await w.click('#cSend');
  await w.waitForSelector('#vOrders:not([hidden]) .od');
  const wo = await until(async () => (await list('webOrders', 'restaurantId', 'RW'))[0]);
  assert.equal(wo.source, 'waiter'); assert.equal(wo.mode, 'table'); assert.equal(wo.table, '5');
  assert.equal(wo.waiter, 'علي'); assert.equal(wo.waiterUid, U.waiter); assert.equal(wo.day, bagDay());
  // الكاشير يقبله تلقائياً ويطبع تذكرة المطبخ
  const o = await until(async () => (await list('orders', 'restaurantId', 'RW')).find((x) => x.webId === wo.id));
  assert.equal(o.orderType, 'salon'); assert.equal(o.tableNo, 5); assert.equal(o.source, 'waiter'); assert.equal(o.waiter, 'علي');
  assert.equal(o.value, 6000 * 2 + 7500 + 750); assert.equal(o.note, 'الطاولة مستعجلة'); assert.equal(o.payment.method, 'later');
  const slip = await until(() => cashier.evaluate(() => { const f = document.getElementById('prtFr'); return f && f.srcdoc.includes('ويتر') ? f.srcdoc : null; }));
  assert.ok(slip.includes('طاولة 5') && slip.includes('برغر دجاج [بدون مخلل]') && slip.includes('علي'));
  assert.equal(await cashier.locator('#webBox .web-card').count(), 0);
  await w.waitForFunction(() => document.querySelector('.od .st').textContent.includes('يتحضر'));
  // المطبخ يخلص ← الويتر يشوف «جاهز — وصّله» وعلامة على الطاولة
  await cashier.evaluate((id) => kdsDone(id), o.id);
  await w.waitForFunction(() => document.querySelector('.od.ready'));
  assert.ok((await w.textContent('.od.ready')).includes('جاهز'));
  assert.equal(await w.textContent('#rdBadge'), '1');
  await w.screenshot({ path: 'shots/waiter-orders.png' });
  await w.click('.tab[data-tab="tables"]');
  await w.waitForSelector('.tb.ready[data-t="5"]');
  assert.deepEqual(clean(w), []);
  assert.deepEqual(clean(cashier), []);
  await w.context().close(); await cashier.context().close();
});

test('waiter: a captain account cannot use it; a wrong password shows an Arabic error', async () => {
  U.cap = await signUp('wcap@x.com', 'secret123');
  await put('users/' + U.cap, { role: 'captain', restaurantId: 'RW', captainId: 'C1', email: 'wcap@x.com' });
  const w = await page(B, { w: 390, h: 844 });
  await w.goto(BASE + 'waiter.html');
  await w.waitForSelector('#gEmail');
  await w.fill('#gEmail', 'waiter@x.com'); await w.fill('#gPass', 'wrong-pass'); await w.click('#gGo');
  await w.waitForFunction(() => document.getElementById('gErr').textContent.includes('غلط'));
  await w.fill('#gEmail', 'wcap@x.com'); await w.fill('#gPass', 'secret123'); await w.click('#gGo');
  await w.waitForFunction(() => document.getElementById('gErr') && document.getElementById('gErr').textContent.includes('مو حساب مطعم'));
  assert.equal(await w.locator('#app:not([hidden])').count(), 0);
  await w.context().close();
});

test('waiter: opening the link asks to install the app (prompt, close, manifest)', async () => {
  const w = await page(B, { w: 390, h: 844 });
  await w.goto(BASE + 'waiter.html');
  await w.waitForSelector('#gEmail');
  assert.equal(await w.isVisible('#inst'), false);
  // المتصفح يعلن إن التطبيق قابل للتثبيت
  await w.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); });
  await w.waitForSelector('#inst:not([hidden]) #instGo');
  assert.ok((await w.textContent('#inst')).includes('ثبّت تطبيق الويتر'));
  await w.click('#instGo');
  await w.waitForSelector('#inst', { state: 'hidden' });
  assert.equal(await w.evaluate(() => window.__prompted), true);
  // إغلاق البطاقة يخليها مسكّرة لنفس الجلسة
  await w.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); dispatchEvent(e); });
  await w.click('#instX');
  await w.reload(); await w.waitForSelector('#gEmail');
  await w.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); dispatchEvent(e); });
  assert.equal(await w.isVisible('#inst'), false);
  const m = await (await fetch(BASE + 'waiter.webmanifest')).json();
  assert.equal(m.start_url, '/sora3a-rest2/waiter.html?app=1'); assert.equal(m.display, 'standalone');
  assert.ok(m.start_url.startsWith(m.scope));
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512', '512x512']);
  assert.equal(await w.getAttribute('link[rel=manifest]', 'href'), 'waiter.webmanifest');
  assert.deepEqual(clean(w), []);
  await w.context().close();
});

test('ready screen inside the TV app: page reports it works, no fullscreen button, remote arrows move between login fields', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await p.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 9; X96) Chrome/120 Mobile Safari/537.36 SoraScreenApp/1.5' }); });
  await p.goto(BASE + 'screen.html');
  await p.waitForSelector('#gEmail');
  assert.equal(await p.evaluate(() => window.__scrOk), true);
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'gEmail');
  await p.keyboard.press('ArrowDown'); assert.equal(await p.evaluate(() => document.activeElement.id), 'gPass');
  await p.keyboard.press('ArrowDown'); assert.equal(await p.evaluate(() => document.activeElement.id), 'gGo');
  await p.keyboard.press('ArrowUp'); assert.equal(await p.evaluate(() => document.activeElement.id), 'gPass');
  await p.focus('#gEmail'); await p.keyboard.type('scr@x.com'); await p.keyboard.press('ArrowDown'); await p.keyboard.type('secret123'); await p.keyboard.press('Enter');
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  assert.equal(await p.isVisible('#fsBtn'), false);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
