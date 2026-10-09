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
  // الافتراضي: الصالة تطلع حتى بدون بيجر (#8)، والدلفري (#7) لا
  assert.deepEqual(await nums(p, '#prep'), ['#12', '#5', '#8', '#11📟 بيجر 4']);
  assert.deepEqual(await nums(p, '#ready'), ['#6📟 بيجر 3']);
  await p.screenshot({ path: 'shots/ready-screen.png' });
  // المطبخ يخلص ٥ ← يطلع بالأخضر ويومض
  await write('orders/A', { kitchen: 'ready', kitchenReadyAt: Date.now() });
  await p.waitForFunction(() => document.querySelector('#ready .n.new') && document.querySelector('#ready .n.new').textContent.includes('#5'));
  assert.deepEqual(await nums(p, '#ready'), ['#5', '#6📟 بيجر 3']);
  // تحرير البيجر ← يختفي
  await write('orders/B', { pagerDone: true, servedAtMs: Date.now() });
  await p.waitForFunction(() => document.querySelectorAll('#ready .n').length === 1);
  // المطعم يغيّر من الإعدادات ← الشاشة تتبع فوراً: الصالة بدون بيجر تختفي، والدلفري يطلع لحد ما يستلمه الكابتن
  await write('restaurants/RW/settings/main', { screen: { salon: false, delivery: true } });
  await p.waitForFunction(() => [...document.querySelectorAll('#prep .n')].map((e) => e.textContent).join(',') === '#12,#7,#11📟 بيجر 4');
  await write('orders/C', { status: 'pickup' });
  await p.waitForFunction(() => ![...document.querySelectorAll('#prep .n')].some((e) => e.textContent === '#7'));
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: false } });
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

test('ready screen updates itself when the page is updated (no one touches the TV)', async () => {
  const { utimes } = await import('node:fs/promises');
  const p = await page(B, { w: 1280, h: 720 });
  await p.addInitScript(() => { window.__auMs = 400; });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  await p.evaluate(() => { window.__oldPage = true; });
  await p.waitForTimeout(1200);                       // أخذ البصمة الأولى
  assert.equal(await p.evaluate(() => window.__oldPage), true, 'no reload without an update');
  const f = new URL('../../../../sora3a-rest2/staff.js', import.meta.url).pathname, t = new Date(Date.now() + 60000);
  await utimes(f, t, t);                              // «نشرنا تحديث»
  await p.waitForFunction(() => !window.__oldPage, null, { timeout: 15000 });
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });   // رجعت الشاشة وحدها بدون تسجيل دخول
  assert.equal(await p.locator('#gEmail').count(), 0);
  await p.context().close();
});

test('cashier settings: choose what the ready screen shows (dine-in without pager, delivery)', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await posLogin(p);
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#stScrSalon');
  assert.equal(await p.isChecked('#stScrSalon'), true);
  assert.equal(await p.isChecked('#stScrDel'), false);
  await p.uncheck('#stScrSalon'); await p.check('#stScrDel');
  await p.click('button >> text=حفظ الإعدادات');
  const st = await until(async () => { const d = await read('restaurants/RW/settings/main'); return d && d.screen && d.screen.delivery ? d : null; });
  assert.deepEqual(st.screen, { salon: false, delivery: true, qr: true });
  assert.equal(st.tables, 8, 'other settings kept');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('ready screen menu with the remote: sound on/off, and log out needs a second press', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  await p.waitForFunction(() => document.getElementById('mk').textContent === 'ب');
  await p.keyboard.press('ArrowDown');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'menuBtn');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#menu:not([hidden])');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mSnd');
  await p.screenshot({ path: 'shots/ready-screen-menu.png' });
  await p.keyboard.press('Enter');
  assert.ok((await p.textContent('#mSnd')).includes('مطفي'));
  assert.equal(await p.textContent('#sndIco'), '🔇');
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowDown');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mOut');
  await p.keyboard.press('Enter');
  assert.ok((await p.textContent('#mOut')).includes('متأكد'));
  assert.equal(await p.isVisible('#scr'), true, 'first press only asks');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#gEmail', { timeout: 10000 });
  assert.equal(await p.isVisible('#scr'), false);
  assert.equal(await p.isVisible('#menu'), false);
  // الإيميل محفوظ على الجهاز: بالريموت يكتب الرمز بس
  assert.equal(await p.inputValue('#gEmail'), 'scr@x.com');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'gPass');
  await p.screenshot({ path: 'shots/ready-screen-login.png' });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('ready screen shows the menu QR in the corner when the online menu is on (order or view-only), and it can be hidden', async () => {
  await put('publicMenus/RW', { name: 'برغر الشاشة', on: true, modes: { table: true, pickup: true, delivery: false }, cats: [], updatedAtMs: 1 });
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: false, qr: true } });
  const p = await page(B, { w: 1280, h: 720 });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#qrBox:not([hidden]) #qrCode svg', { timeout: 15000 });
  assert.ok((await p.getAttribute('#qrCode', 'data-url')).endsWith('/sora3a-rest2/menu.html?r=RW'));
  assert.ok((await p.textContent('#qrT')).includes('واطلب'));
  await p.screenshot({ path: 'shots/ready-screen-qr.png' });
  // عرض المنيو بس
  await write('publicMenus/RW', { modes: { table: false, pickup: false, delivery: false } });
  await p.waitForFunction(() => document.getElementById('qrT').textContent.includes('وشوف المنيو'));
  // المطعم يطفيه من إعدادات الشاشة
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: false, qr: false } });
  await p.waitForSelector('#qrBox', { state: 'hidden' });
  // المنيو الأونلاين مطفي ← ما يطلع
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: false, qr: true } });
  await p.waitForSelector('#qrBox:not([hidden])');
  await write('publicMenus/RW', { on: false });
  await p.waitForSelector('#qrBox', { state: 'hidden' });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('TV app: «برتقالي مشمس» theme with the app colours, and the auto-start switch in the menu talks to the app', async () => {
  const now = Date.now(), today = bagDay();
  const base = { restaurantId: 'RW', status: 'delivered', value: 5000, day: today, createdAtMs: now - 5 * 60000 };
  await put('orders/K1', { ...base, orderType: 'takeaway', kitchen: 'new', ticketNo: 31 });
  await put('orders/K2', { ...base, orderType: 'salon', kitchen: 'new', ticketNo: 32 });
  await put('orders/K3', { ...base, orderType: 'delivery', status: 'pending', kitchen: 'new', ticketNo: 33 });
  await put('orders/K4', { ...base, orderType: 'takeaway', kitchen: 'ready', kitchenReadyAt: now - 30000, ticketNo: 34 });
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: true, qr: true } });
  await write('publicMenus/RW', { on: true, modes: { table: true, pickup: true, delivery: false } });
  const p = await page(B, { w: 1280, h: 720 });
  await p.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 9; X96) Chrome/120 Mobile Safari/537.36 SoraScreenApp/1.6' }); window.__autoState = true; window.__goApp = (u) => { (window.__asked = window.__asked || []).push(u); }; });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#prep .n[data-t="دلفري"]', { timeout: 15000 });
  await p.waitForSelector('#qrBox:not([hidden]) #qrCode svg');
  const st = await p.evaluate(() => {
    const cs = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo || null);
    return {
      band: cs('#scr', '::before').backgroundImage, bg: cs('body').backgroundImage, card: cs('.ready').backgroundColor,
      ready: cs('.ready .hd h2').color, tile: cs('#ready .n').backgroundImage, prep: cs('.prep .hd h2').color, qrBox: cs('#qrBox').backgroundImage,
      take: cs('#prep .n[data-t="سفري"]', '::after').backgroundColor, salon: cs('#prep .n[data-t="صالة"]', '::after').backgroundColor,
      deliv: cs('#prep .n[data-t="دلفري"]', '::after').backgroundColor,
    };
  });
  const G = 'rgb(61, 240, 139)', O = 'rgb(255, 181, 71)', Bl = 'rgb(147, 166, 255)', T = 'rgb(62, 230, 207)';
  for (const c of [G, O, Bl, T]) assert.ok(st.band.includes(c), 'top band has ' + c);
  // خلفية برتقالية زاهية، بطاقات بيضاء، الجاهز أخضر، التحضير برتقالي غامق، وكود المنيو أزرق
  assert.ok(st.bg.includes('rgb(255, 193, 77)') && st.bg.includes('rgb(217, 72, 15)'), st.bg);
  assert.equal(st.card, 'rgb(255, 255, 255)');
  assert.equal(st.ready, 'rgb(15, 122, 61)'); assert.ok(st.tile.includes('rgb(43, 196, 106)'), st.tile);
  assert.equal(st.prep, 'rgb(217, 72, 15)'); assert.ok(st.qrBox.includes('rgb(107, 134, 255)'), st.qrBox);
  assert.deepEqual([st.take, st.salon, st.deliv], [O, Bl, T], 'order type tags: takeaway orange, dine-in blue, delivery turquoise');
  await p.screenshot({ path: 'shots/ready-screen-colors.png' });
  // «يفتح وحده مع التلفزيون»: التطبيق بلّغ إنه شغّال ← الزر يطلع بالقائمة، والضغط يطلب من التطبيق يطفيه
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.waitForSelector('#menu:not([hidden])');
  assert.ok((await p.textContent('#mAuto')).includes('يشتغل'));
  await p.keyboard.press('ArrowDown');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mAuto');
  await p.keyboard.press('Enter');
  assert.deepEqual(await p.evaluate(() => window.__asked), ['sora3a://autostart?on=0']);
  await p.evaluate(() => window.__setAuto(false));
  assert.ok((await p.textContent('#mAuto')).includes('مطفي'));
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('services: the super admin stops/starts the screen, the QR (barcode) and the waiter app — each on its own, live', async () => {
  // الشاشة موقوفة ← رسالة بدل الطلبات، وترجع وحدها أول ما تتفعّل
  await write('restaurants/RW', { features: { screen: false } });
  const p = await page(B, { w: 1280, h: 720 });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#off:not([hidden])', { timeout: 15000 });
  assert.equal(await p.isVisible('#scr'), false);
  assert.ok((await p.textContent('#off')).includes('موقوفة'));
  await p.screenshot({ path: 'shots/ready-screen-off.png' });
  await write('restaurants/RW', { features: { screen: true, online: false } });
  await p.waitForSelector('#scr:not([hidden])', { timeout: 10000 });
  assert.equal(await p.isVisible('#off'), false);
  // الباركود مطفي ← ما يطلع كود المنيو بالزاوية، ويرجع ويا الخدمة
  assert.equal(await p.isVisible('#qrBox'), false);
  await write('restaurants/RW', { features: { online: true } });
  await p.waitForSelector('#qrBox:not([hidden]) #qrCode svg', { timeout: 10000 });
  // الويتر موقوف ← رسالة؛ يتفعّل ← يرجع التطبيق بدون تحديث
  await write('restaurants/RW', { features: { waiter: false } });
  const w = await page(B);
  await login(w, BASE + 'waiter.html', 'waiter@x.com');
  await w.waitForSelector('#off:not([hidden])', { timeout: 15000 });
  assert.equal(await w.isVisible('#app'), false);
  await write('restaurants/RW', { features: {} });
  await w.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  assert.equal(await w.isVisible('#off'), false);
  // الكاشير: أزرار الشاشة تختفي إذا الخدمة موقوفة
  const c = await page(B, { w: 1280, h: 860 });
  await write('restaurants/RW', { features: { screen: false } });
  await posLogin(c);
  await c.waitForFunction(() => document.getElementById('readyScrBtn').style.display === 'none');
  await write('restaurants/RW', { features: {} });
  await c.waitForFunction(() => document.getElementById('readyScrBtn').style.display === '', null, { timeout: 10000 });
  for (const x of [p, w, c]) { assert.deepEqual(clean(x), []); await x.context().close(); }
});

test('«تم التسليم» at the cashier takes the order off the ready screen right away (kitchen strip and orders list)', async () => {
  const now = Date.now(), today = bagDay();
  const base = { restaurantId: 'RW', status: 'delivered', value: 5000, day: today, createdAtMs: now - 5 * 60000, payment: { method: 'cash', cash: 5000, card: 0 } };
  await put('orders/S1', { ...base, orderType: 'takeaway', kitchen: 'ready', kitchenReadyAt: now - 60000, ticketNo: 41 });
  await put('orders/S2', { ...base, orderType: 'salon', kitchen: 'ready', kitchenReadyAt: now - 30000, ticketNo: 42, pager: 6 });
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: false, qr: true } });
  const scr = await page(B, { w: 1280, h: 720 });
  await login(scr, BASE + 'screen.html', 'scr@x.com');
  const onScreen = (n) => scr.evaluate((n) => [...document.querySelectorAll('#ready .n, #prep .n')].some((e) => e.textContent.replace(/\D+/g, ' ').trim().split(' ')[0] === n), n);
  await until(async () => (await onScreen('41')) && (await onScreen('42')), 15000);
  assert.ok(await onScreen('41')); assert.ok(await onScreen('42'));
  // شاشة المطبخ: شريط «جاهز — ينتظر الزبون» ← «تم التسليم»
  const c = await page(B, { w: 1280, h: 860 });
  await posLogin(c);
  await c.evaluate(() => goTab('kitchen'));
  await c.waitForSelector('#kdsReady:not([hidden]) .kr-b:has-text("#41")', { timeout: 15000 });
  await c.screenshot({ path: 'shots/kitchen-ready-handover.png' });
  await c.click('#kdsReady .kr-b:has-text("#41")');
  await until(async () => !(await onScreen('41')), 10000);
  assert.equal(await onScreen('41'), false, 'handed over → gone from the screen');
  assert.ok((await read('orders/S1')).servedAtMs);
  // قائمة الطلبات: الطلب المدفوع «جاهز — ينتظر الزبون» وبيه «تم التسليم» (ويتحرر البيجر)
  await c.evaluate(() => goTab('orders'));
  const card = c.locator('.ocard', { has: c.locator('.oid', { hasText: /^S2$/ }) });
  await card.waitFor({ timeout: 10000 });
  assert.ok((await card.textContent()).includes('ينتظر الزبون'));
  await card.locator('button', { hasText: 'تم التسليم' }).click();
  await until(async () => !(await onScreen('42')), 10000);
  assert.equal(await onScreen('42'), false);
  const s2 = await read('orders/S2');
  assert.ok(s2.servedAtMs); assert.equal(s2.pagerDone, true);
  for (const x of [scr, c]) { assert.deepEqual(clean(x), []); await x.context().close(); }
});
