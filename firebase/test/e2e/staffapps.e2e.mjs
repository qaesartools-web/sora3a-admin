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
  assert.match((await p.textContent('#clk')).trim(), /^\d{1,2}:\d{2} [صم]$/, 'TV clock is 12-hour');
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

test('ready screen stays signed in when the TV starts without internet — no password again; only «تسجيل خروج» signs out', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  // التلفزيون انطفى ورجع اشتغل والواي فاي بعده ما متصل: السيرفر ما يوصل
  await p.context().route(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/, (r) => r.abort('internetdisconnected'));
  await p.reload();
  await p.waitForSelector('.gate-hold', { timeout: 30000 });
  assert.match(await p.textContent('.gate-hold'), /ننتظر الإنترنت|ترجع وحدها/);
  assert.equal(await p.locator('#gPass').count(), 0, 'ما يطلب الرمز');
  // النت رجع: الشاشة ترجع وحدها بدون ما أحد يكتب شي
  await p.context().unroute(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForSelector('#scr:not([hidden])', { timeout: 30000 });
  assert.equal(await p.locator('#gPass').count(), 0);
  // نفس الشي لو النت انقطع وهي شغّالة: تبقى
  await p.context().route(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/, (r) => r.abort('internetdisconnected'));
  await p.reload();
  await p.waitForSelector('.gate-hold', { timeout: 30000 });
  // زر تسجيل الخروج (الحالة الوحيدة اللي يرجع يطلب الرمز)
  await p.context().unroute(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/);
  await p.click('.gate-out');
  await p.waitForSelector('#gPass', { timeout: 15000 });
  assert.equal(await p.inputValue('#gEmail'), 'scr@x.com', 'الإيميل محفوظ');
  assert.deepEqual(clean(p).filter((e) => !/Could not reach Cloud Firestore backend|client is offline|internetdisconnected|ERR_INTERNET/i.test(e)), []);
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
  await p.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 9; X96) Chrome/120 Mobile Safari/537.36 SoraScreenApp/1.6' }); window.__autoState = true; window.__autoDiag = 1; window.__goApp = (u) => { (window.__asked = window.__asked || []).push(u); }; });
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
  // «فحص التشغيل التلقائي» ← التطبيق يعرض شنو صار بالتلفزيون
  await p.keyboard.press('ArrowDown');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mDiag');
  await p.keyboard.press('Enter');
  assert.deepEqual(await p.evaluate(() => window.__asked), ['sora3a://autostart?on=0', 'sora3a://autodiag']);
  assert.equal(await p.isHidden('#menu'), true);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('TV app: a newer version shows ⬆️ on ⚙️ and the menu updates the app without a flash drive', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await p.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 9; smart_tv) Chrome/120 Mobile Safari/537.36 SoraScreenApp/1.25' }); window.__autoState = true; window.__autoDiag = 1; window.__goApp = (u) => { (window.__asked = window.__asked || []).push(u); }; });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#scr:not([hidden])');
  assert.equal(await p.isHidden('#mUpd'), true, 'no update → no button');
  assert.equal(await p.evaluate(() => document.getElementById('menuBtn').classList.contains('upd')), false);
  // التطبيق لگى نسخة أحدث
  await p.evaluate(() => window.__setUpdate('1.30'));
  assert.equal(await p.evaluate(() => document.getElementById('menuBtn').classList.contains('upd')), true, '⬆️ on the settings button');
  await p.focus('#menuBtn'); await p.keyboard.press('Enter');
  await p.waitForSelector('#menu:not([hidden])');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mUpd', 'update is the first choice');
  assert.match(await p.textContent('#mUpd'), /تحديث التطبيق — نسخة 1\.30/);
  await p.keyboard.press('Enter');
  assert.deepEqual(await p.evaluate(() => window.__asked), ['sora3a://update']);
  assert.equal(await p.isHidden('#menu'), true);
  await p.evaluate(() => window.__setUpdate(''));
  assert.equal(await p.isHidden('#mUpd'), true);
  // «الفتح مثل الريموت»: يطلع بالقائمة لما التطبيق يبلّغ بحالته، والضغط يطلب من التطبيق يضبطه
  assert.equal(await p.isHidden('#mAdb'), true, 'old app → no button');
  await p.evaluate(() => window.__setAdb(false));
  assert.match(await p.textContent('#mAdb'), /الفتح مثل الريموت \(وضع المطوّر\)/);
  await p.click('#menuBtn'); await p.waitForSelector('#menu:not([hidden])');
  await p.click('#mAdb');
  assert.deepEqual(await p.evaluate(() => window.__asked), ['sora3a://update', 'sora3a://adb']);
  await p.evaluate(() => window.__setAdb(true));
  assert.match(await p.textContent('#mAdb'), /مفعّل ✅/);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('kitchen display (شاشة المجهز): shows new orders, «جاهز» → ready (back to cashier), and the cashier kitchen tab hides when on', async () => {
  const now = Date.now();
  // الخدمة موقوفة افتراضياً ← رسالة
  await put('restaurants/RW', { name: 'مطعم الشاشة', userId: U.owner, active: true, features: {} });
  const p = await page(B, { w: 1280, h: 800 });
  await login(p, BASE + 'kitchen.html', 'scr@x.com');
  await p.waitForSelector('#off:not([hidden])', { timeout: 15000 });
  // المدير الأعلى يفعّلها ← تشتغل مباشرة
  await write('restaurants/RW', { features: { kitchen: true } });
  await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  // طلب جديد للمطبخ (أونلاين قيد التحضير)
  await put('orders/KD1', { restaurantId: 'RW', orderType: 'takeaway', status: 'preparing', kitchen: 'new', ticketNo: 77, value: 9000, day: bagDay(now), createdAt: '20:05', createdAtMs: now - 3 * 60000,
    items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 2, note: 'بدون بصل' }, { name: 'لبن', variant: 'وحدة', qty: 1 }] });
  await p.waitForSelector('.card [data-done="KD1"]', { timeout: 15000 });
  const card = await p.evaluate(() => document.querySelector('[data-done="KD1"]').closest('.card').textContent);
  for (const re of [/#77/, /برغر لحم/, /بدون بصل/, /لبن/, /8:05 م/, /🥡 سفري/]) assert.match(card, re);
  // المجهز يضغط «جاهز»
  await p.click('.card [data-done="KD1"]');
  const o = await until(async () => { const x = await read('orders/KD1'); return x && x.kitchen === 'ready' ? x : null; });
  assert.equal(o.kitchen, 'ready'); assert.equal(o.status, 'ready', 'رجع للكاشير جاهز');
  assert.ok(o.kitchenReadyAt > 0);
  assert.ok((o.timeline || []).some((t) => t.status === 'ready'), 'انضاف للـtimeline');
  // طلع من القيد ودخل شريط «جاهز — رجع للكاشير»
  await p.waitForSelector('.card [data-done="KD1"]', { state: 'detached', timeout: 8000 });
  assert.match(await p.textContent('#rdy'), /#77/);
  await p.context().close();
  // الكاشير: تبويب المطبخ ينخفي لأن شاشة المجهز شغّالة
  const c = await page(B, { w: 1280, h: 800 });
  await posLogin(c);
  await until(async () => await c.evaluate(() => getComputedStyle(document.querySelector('[data-tab="kitchen"]')).display === 'none'));
  assert.equal(await c.evaluate(() => getComputedStyle(document.querySelector('[data-tab="kitchen"]')).display), 'none', 'المطبخ مخفي من الكاشير');
  assert.notEqual(await c.evaluate(() => document.getElementById('kdsLink').style.display), 'none', 'رابط شاشة المطبخ مفعّل');
  // نطفّي الخدمة ← يرجع تبويب المطبخ
  await write('restaurants/RW', { features: { kitchen: false } });
  await until(async () => await c.evaluate(() => getComputedStyle(document.querySelector('[data-tab="kitchen"]')).display !== 'none'));
  assert.notEqual(await c.evaluate(() => getComputedStyle(document.querySelector('[data-tab="kitchen"]')).display), 'none');
  assert.deepEqual(clean(c), []);
  await c.context().close();
});

test('kitchen sections screen (kitchen.html?sec): each device picks its section from a list, sees only its items, «ready» marks its section; its own service, installable', async () => {
  const now = Date.now();
  // شاشة المطبخ شغّالة وشاشة المجهز مطفية — كل وحدة بخدمتها
  await write('restaurants/RW', { features: { kitchen: false, kitchenSec: true } });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 2, kSecOn: true,
    sections: [{ id: 'grill', name: 'الشوي', emoji: '🔥' }, { id: 'drinks', name: 'المشروبات', emoji: '🥤' }] });
  await put('orders/KS1', { restaurantId: 'RW', orderType: 'salon', status: 'delivered', kitchen: 'new', ticketNo: 88, value: 12750, day: bagDay(now), createdAt: '20:10', createdAtMs: now - 2 * 60000,
    items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 2, sec: 'grill' }, { name: 'لبن', variant: 'وحدة', qty: 1, sec: 'drinks' }],
    kSec: { grill: { n: 2, readyAt: 0 }, drinks: { n: 1, readyAt: 0 } } });
  const p = await page(B, { w: 1280, h: 800 });
  await login(p, BASE + 'kitchen.html?sec', 'scr@x.com');
  // أول ما تنفتح: «اختار قسمك» بأقسام المطبخ
  await p.waitForSelector('#pick:not([hidden]) [data-pick="grill"]', { timeout: 15000 });
  assert.match(await p.textContent('#pick'), /اختار قسمك/);
  assert.match(await p.textContent('#pickG'), /الشوي/); assert.match(await p.textContent('#pickG'), /المشروبات/);
  assert.equal(await p.isVisible('#pickBack'), false, 'أول مرة لازم يختار');
  await p.screenshot({ path: 'shots/kitchen-pick.png' });
  await p.click('[data-pick="grill"]');
  await p.waitForSelector('.card [data-sec="KS1|grill"]', { timeout: 15000 });
  assert.equal(await p.isVisible('#pick'), false);
  assert.match(await p.textContent('#rName'), /برغر الشاشة — 🔥 الشوي/);
  assert.match(new URL(p.url()).search, /sec=grill/);
  const card = await p.evaluate(() => document.querySelector('[data-sec="KS1|grill"]').closest('.card').textContent);
  assert.match(card, /برغر لحم/); assert.doesNotMatch(card, /لبن/, 'قسم الشوي ما يشوف المشروبات');
  assert.match(card, /الشوي جاهز/);
  await p.screenshot({ path: 'shots/kitchen-section.png' });
  // ملف التثبيت باسم القسم ويفتح على قسمه
  const mf = await p.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  assert.equal(mf.short_name, 'المطبخ — الشوي'); assert.equal(mf.display, 'standalone');
  assert.match(mf.start_url, /\/sora3a-rest2\/kitchen\.html\?sec=grill$/); assert.ok(mf.icons.length >= 2);
  assert.equal(await p.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content'), 'المطبخ — الشوي');
  // «الشوي جاهز» ← يتعلّم القسم بس، والطلب بعده بالمطبخ (المشروبات ما خلصت)
  await p.click('.card [data-sec="KS1|grill"]');
  let o = await until(async () => { const x = await read('orders/KS1'); return x && x.kSec.grill.readyAt ? x : null; });
  assert.ok(o.kSec.grill.readyAt > 0); assert.equal(o.kSec.drinks.readyAt, 0); assert.equal(o.kitchen, 'new');
  await p.waitForSelector('.card [data-sec="KS1|grill"]', { state: 'detached', timeout: 8000 });
  // الجهاز يتذكر قسمه حتى لو انفتح الرابط العام (?sec) مرة ثانية
  await p.goto(BASE + 'kitchen.html?sec'); await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await until(async () => /الشوي/.test(await p.textContent('#rName')));
  assert.match(await p.textContent('#rName'), /الشوي/);
  assert.equal(await p.isVisible('#pick'), false, 'ما يسأله مرة ثانية');
  // يبدّل لقسم المشروبات من ⚙️ «تغيير القسم» ← «جاهز» يكمّل آخر قسم فالطلب كله يصير جاهز
  await p.click('#menuBtn'); await p.click('#mSec');
  await p.waitForSelector('#pick:not([hidden]) #pickBack:not([hidden])', { timeout: 5000 });
  await p.click('[data-pick="drinks"]');
  await p.waitForSelector('.card [data-sec="KS1|drinks"]', { timeout: 8000 });
  assert.match(new URL(p.url()).search, /sec=drinks/);
  await p.click('.card [data-sec="KS1|drinks"]');
  o = await until(async () => { const x = await read('orders/KS1'); return x && x.kitchen === 'ready' ? x : null; });
  assert.equal(o.kitchen, 'ready');
  // قابلة للتثبيت (فحص المتصفح نفسه)
  const cdp = await p.context().newCDPSession(p);
  const errs = await until(async () => { const r = await cdp.send('Page.getInstallabilityErrors'); const e = (r.installabilityErrors || []).map((x) => x.errorId).filter((x) => x !== 'in-incognito'); return e.length ? null : e; }, 15000);
  assert.deepEqual(errs, [], 'installability errors: ' + JSON.stringify((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors));
  // شاشة المجهز مطفية ← رسالة بروحها، والمطبخ يبقى شغّال
  const x = await page(B, { w: 1280, h: 800 });
  await login(x, BASE + 'kitchen.html', 'scr@x.com');
  await x.waitForSelector('#off:not([hidden])', { timeout: 15000 });
  assert.match(await x.textContent('#off'), /المجهز/);
  assert.equal(await x.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content'), 'شاشة المجهز');
  // نطفي شاشة المطبخ ونشغّل المجهز ← المطبخ يوكف، والمجهز يشتغل طبيعي بدون تحديث
  await write('restaurants/RW', { features: { kitchen: true, kitchenSec: false } });
  await p.waitForSelector('#off:not([hidden])', { timeout: 10000 });
  assert.match(await p.textContent('#off'), /شاشة المطبخ \(الأقسام\) موقوفة/);
  await x.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  assert.equal(await x.isVisible('#pick'), false, 'المجهز ما يسأل عن قسم');
  for (const y of [p, x]) { assert.deepEqual(clean(y), []); await y.context().close(); }
  // نرجّع المطعم مثل ما چان للفحوصات اللي بعدها
  await write('restaurants/RW', { features: { kitchen: false } });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 3 });
});

test('approved devices: every screen (expediter, kitchen, waiter) needs approval when the service is on — even with the restaurant email', async () => {
  await write('restaurants/RW', { features: { kitchen: true, kitchenSec: true, devices: true } });
  const p = await page(B, { w: 1280, h: 800 });
  await login(p, BASE + 'kitchen.html', 'scr@x.com');
  await p.waitForSelector('.dev-code', { timeout: 15000 });
  assert.match(await p.textContent('#gate'), /هذا الجهاز مو معتمد/);
  assert.equal(await p.isVisible('#app'), false);
  const key = await p.evaluate(() => localStorage.getItem('sora3a_dev_key'));
  const code = (await p.textContent('.dev-code')).trim();
  const req = await until(() => read('deviceReqs/' + key));
  assert.equal(req.restaurantId, 'RW'); assert.equal(req.status, 'pending'); assert.equal(req.code, code);
  assert.match(req.platform, /شاشة المجهز/);
  await p.screenshot({ path: 'shots/kitchen-device-block.png' });
  // المدير الأعلى يعتمده (برج سرعة) ← الشاشة تفتح وحدها
  await put('restaurants/RW/devices/' + key, { name: 'شاشة المجهز', code, platform: req.platform, approvedAtMs: Date.now() });
  await write('deviceReqs/' + key, { status: 'approved' });
  await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  // نفس الجهاز المعتمد يفتح شاشة المطبخ مباشرة
  await p.goto(BASE + 'kitchen.html?sec'); await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  // تلفون ثاني (مو معتمد) على الويتر بإيميل المطعم ← ينقفل لحد الاعتماد
  const w = await page(B);
  await login(w, BASE + 'waiter.html', 'scr@x.com');
  await w.waitForSelector('.dev-code', { timeout: 15000 });
  const wk = await w.evaluate(() => localStorage.getItem('sora3a_dev_key'));
  assert.match((await until(() => read('deviceReqs/' + wk))).platform, /الويتر/);
  // الخدمة مطفية ← يدخل عادي
  await write('restaurants/RW', { features: { devices: false } });
  await w.reload(); await w.waitForSelector('#app:not([hidden]), #off:not([hidden])', { timeout: 15000 });
  for (const y of [p, w]) { assert.deepEqual(clean(y).filter((e) => !/permission/i.test(e)), []); await y.context().close(); }
  await write('restaurants/RW', { features: { kitchen: false } });
});

test('admin panel «الشاشات»: every screen link in one place — expediter, kitchen sections, waiter, menu, apps — with QR', async () => {
  await write('restaurants/RW', { features: { kitchen: true, waiter: false } });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 4, kSecOn: true,
    sections: [{ id: 'grill', name: 'الشوي', emoji: '🔥' }, { id: 'drinks', name: 'المشروبات', emoji: '🥤' }] });
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'scr@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible', timeout: 15000 });
  await p.click('.dnav-btn[data-screen="scScreens"]');
  await p.waitForSelector('#scrList [data-scr="kitchenSec"]', { timeout: 15000 });
  const url = (id) => p.inputValue(`[data-scr="${id}"] .scr-u`);
  assert.equal(await url('cashier'), BASE.replace('http://localhost:5050', 'https://qaesartools-web.github.io'));
  assert.match(await url('kitchen'), /\/sora3a-rest2\/kitchen\.html$/);
  assert.match(await url('kitchenSec'), /\/sora3a-rest2\/kitchen\.html\?sec$/);
  assert.match(await p.textContent('[data-scr="kitchenSec"]'), /شاشة المطبخ/);
  assert.match(await p.textContent('[data-scr="kitchenSec"]'), /الشوي/, 'يذكر أقسام المطعم');
  assert.match(await url('waiter'), /\/waiter\.html$/);
  assert.match(await p.textContent('[data-scr="waiter"] .scr-tag'), /موقوفة/, 'الويتر موقوف لهذا المطعم');
  assert.match(await p.textContent('[data-scr="kitchen"] .scr-tag'), /شغّالة/);
  assert.match(await p.textContent('[data-scr="kitchenSec"] .scr-tag'), /موقوفة/, 'المطبخ بخدمته');
  assert.match(await url('menu'), /\/menu\.html\?r=RW$/);
  assert.match(await url('screen'), /screen-android\/sora3a-screen\.apk$/);
  assert.match(await url('line'), /line-android\/sora3a-line\.apk$/);
  assert.match(await url('captain'), /sora3a-captain\/captain\.html$/);
  assert.match(await p.textContent('.scr-intro'), /بإيميل المطعم وكلمة السر/);
  // QR يترسم للمسح بكاميرا التلفون
  await p.click('[data-scr="kitchenSec"] button:has-text("QR")');
  await p.waitForSelector('[data-qr="kitchenSec"]:not([hidden]) svg', { timeout: 8000 });
  await p.screenshot({ path: 'shots/admin-screens.png', fullPage: true });
  assert.deepEqual(clean(p).filter((e) => !/permission/i.test(e)), []);
  await p.context().close();
  await write('restaurants/RW', { features: { kitchen: false } });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 5 });
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
