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
  // شاشة «طلبك جاهز» ما تدخل بإيميل بعد: تطلع رمز وصاحب المطعم يربطها
  if (/screen\.html/.test(url)) { await pairScreen(p, url, { name: 'شاشة طلبك جاهز' }); return; }
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
// شاشة المطبخ: تفتح ← تطلع رمز ← البرج (أو صاحب المطعم) يربطها — بدون إيميل
async function openScreen(p, url) {
  await p.goto(url);
  await p.waitForSelector('#pairCode', { timeout: 15000 });
  const code = (await p.textContent('#pairCode')).trim();
  const pr = await until(() => read('screenPairs/' + code));
  return { code, uid: pr.uid, pair: pr };
}
async function pairScreen(p, url, extra = {}) {
  const sc = await openScreen(p, url);
  await put('screens/' + sc.uid, { restaurantId: 'RW', restName: 'مطعم الشاشة', code: sc.code, kind: sc.pair.kind, name: 'شاشة', pairedBy: 'hq', approved: true, atMs: Date.now(), ...extra });
  return sc;
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

test('ready screen stays linked when the TV starts without internet — opens from its saved copy; only «فصل الشاشة» unlinks it', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await login(p, BASE + 'screen.html', 'scr@x.com');
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(1500);   // الكاش المحلي ينحفظ
  // التلفزيون انطفى ورجع اشتغل والواي فاي بدون نت: الشاشة تفتح من النسخة المحفوظة (وتكمل ويا الكاشير على الواي فاي)
  await p.context().route(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/, (r) => r.abort('internetdisconnected'));
  await p.reload();
  await p.waitForSelector('#scr:not([hidden])', { timeout: 30000 });
  assert.equal(await p.locator('#gPass').count(), 0, 'ما يطلب الرمز');
  assert.match(await p.textContent('#nm'), /برغر الشاشة/, 'name from the saved copy');
  // النت رجع: تكمل وحدها بدون ما أحد يكتب شي
  await p.context().unroute(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(1500);
  assert.equal(await p.isVisible('#scr'), true);
  assert.equal(await p.locator('#gPass').count(), 0);
  // زر تسجيل الخروج (الحالة الوحيدة اللي يرجع يطلب الرمز) — حتى بدون نت
  await p.context().route(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/, (r) => r.abort('internetdisconnected'));
  await p.reload();
  await p.waitForSelector('#scr:not([hidden])', { timeout: 30000 });
  await p.context().unroute(/127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/);
  await p.click('#menuBtn'); await p.click('#mOut'); await p.click('#mOut');
  await p.waitForSelector('#pairCode', { timeout: 15000 });   // «فصل الشاشة» ← رمز جديد للربط
  assert.equal(await p.locator('#gEmail').count(), 0, 'no email login any more');
  assert.deepEqual(clean(p).filter((e) => !/Could not reach Cloud Firestore backend|client is offline|internetdisconnected|ERR_INTERNET/i.test(e)), []);
  await p.context().close();
});

test('ready screen opened from the cashier button links itself to that restaurant (no code, no email), the cashier stays signed in, and it shows the cashier orders', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await posLogin(p);
  assert.equal(await p.getAttribute('#readyScrBtn', 'href'), 'screen.html?from=pos');
  await p.evaluate(() => { cart.push({ name: 'برغر لحم', variant: 'وحدة', price: 6000, qty: 1 }); holdOrder({ name: 'سجاد' }); });
  const o = await until(async () => (await list('orders', 'restaurantId', 'RW')).find((x) => x.customer === 'سجاد'));
  assert.equal(o.day, bagDay());
  const s = await p.context().newPage();
  s.errors = []; s.on('pageerror', (e) => s.errors.push(String(e)));
  await s.goto(BASE + 'screen.html?from=pos');
  await s.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  assert.equal(await s.locator('#gEmail').count(), 0, 'no second login');
  const linked = (await list('screens', 'restaurantId', 'RW')).find((x) => x.kind === 'ready' && x.pairedBy === 'owner');
  assert.ok(linked, 'the screen got linked to the restaurant by itself');
  assert.ok(await p.isVisible('#prods'), 'the cashier window is still signed in');
  assert.equal(o.byUid, U.owner, 'each order remembers the cashier who took it');
  await s.waitForFunction((n) => [...document.querySelectorAll('#prep .n')].some((e) => e.textContent.startsWith('#' + n)), o.ticketNo);
  assert.deepEqual(s.errors, []);
  await p.context().close();
});

test('waiter: picks table 5 on the phone → the cashier gets an alert and approves → kitchen screen shows it → waiter sees ready', async () => {
  await write('restaurants/RW', { features: { kitchen: true } });
  const cashier = await page(B, { w: 1280, h: 860 });
  await posLogin(cashier);
  const w = await page(B, { w: 390, h: 844 });
  const ws = await pairScreen(w, BASE + 'waiter.html', { name: 'علي' });   // بدون إيميل: رمز + اسم الويتر
  assert.equal(ws.pair.kind, 'waiter');
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
  assert.equal(wo.waiter, 'علي'); assert.equal(wo.waiterUid, ws.uid); assert.equal(wo.day, bagDay());
  // الكاشير يشوف الطلب بتنبيه وينتظر موافقته — وما يروح للمطبخ قبلها
  await cashier.waitForSelector('#webBox .web-card:has-text("علي")', { timeout: 15000 });
  assert.match(await cashier.textContent('#webBox'), /طاولة 5/);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await list('orders', 'restaurantId', 'RW')).find((x) => x.webId === wo.id), undefined, 'not in the kitchen before the cashier accepts');
  // الكاشير يوافق ← يروح للمطبخ، وشاشة المجهز تشوفه
  await cashier.click('#webBox .call-go');
  const o = await until(async () => (await list('orders', 'restaurantId', 'RW')).find((x) => x.webId === wo.id));
  // بعد الموافقة: يبقى «قيد التحضير» بالكاشير (طاولة 5 • علي) لحد ما يستلم المبلغ
  assert.equal(o.status, 'preparing'); assert.equal(o.held, true);
  await cashier.waitForSelector('#holdStrip .hchip:has-text("علي")', { timeout: 10000 });
  assert.match(await cashier.textContent('#holdStrip'), /🪑 5/);
  const k = await page(B, { w: 1280, h: 800 });
  await pairScreen(k, BASE + 'kitchen.html', { name: 'المجهز' });
  await k.waitForSelector(`[data-done="${o.id}"]`, { timeout: 15000 });
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
  // الكاشير يفتح الطاولة من «قيد التحضير» ← «💰 استلام المبلغ» ← ينشال من الشريط ويصير مدفوع
  await cashier.click('#holdStrip .hchip:has-text("علي")');
  await cashier.click('button:has-text("💰 استلام المبلغ")');
  await cashier.waitForSelector('#payOv.on'); await cashier.click('#payOk');
  const paid = await until(async () => { const x = (await list('orders', 'restaurantId', 'RW')).find((y) => y.id === o.id); return x && x.status === 'delivered' ? x : null; });
  assert.equal(paid.payment.method, 'cash'); assert.equal(paid.payment.cash, paid.value);
  await cashier.waitForFunction(() => !/علي/.test((document.getElementById('holdStrip') || {}).textContent || ''), null, { timeout: 10000 });
  await w.click('.tab[data-tab="orders"]');
  await w.waitForFunction(() => /تم/.test(document.querySelector('.od .st').textContent), null, { timeout: 10000 });
  assert.deepEqual(clean(w), []);
  assert.deepEqual(clean(cashier), []);
  await w.context().close(); await cashier.context().close(); await k.context().close();
  await write('restaurants/RW', { features: {} });
});

test('waiter: no email or password — the phone shows a link code + QR; the owner links it from the admin panel with the waiter name; unlink brings a new code', async () => {
  await write('restaurants/RW', { features: {} });
  const w = await page(B, { w: 390, h: 844 });
  const sc = await openScreen(w, BASE + 'waiter.html');
  assert.equal(await w.$('#gEmail'), null, 'no email login on the waiter app');
  assert.match(await w.textContent('#gate'), /اربط هذا التلفون/);
  await w.waitForSelector('#pairQr svg', { timeout: 8000 });
  await w.screenshot({ path: 'shots/waiter-pair.png' });
  const a = await page(B, { w: 1280, h: 900 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html?pair=' + sc.code);
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'scr@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#scScreens.on #scrCode', { timeout: 15000 });
  await until(async () => (await a.inputValue('#scrCode')) === sc.code);
  await a.fill('#scrName', 'حسين'); await a.click('#scrPairBtn');
  const s1 = await until(() => read('screens/' + sc.uid));
  assert.equal(s1.kind, 'waiter'); assert.equal(s1.name, 'حسين'); assert.equal(s1.pairedBy, 'owner');
  await w.waitForSelector('#app:not([hidden]) .tb', { timeout: 20000 });
  assert.match(await w.textContent('#wName'), /حسين/);
  await a.waitForSelector(`[data-paired="${sc.uid}"]`);
  assert.match(await a.textContent(`[data-paired="${sc.uid}"]`), /🧑‍🍳/);
  // الويتر يفصل التلفون من 🔌 ← يرجع رمز جديد
  await w.click('#outBtn');   // التأكيد يقبله الـharness
  await w.waitForSelector('#pairCode', { timeout: 15000 });
  assert.equal(await read('screens/' + sc.uid), null);
  for (const y of [w, a]) { assert.deepEqual(clean(y).filter((e) => !/permission/i.test(e)), []); await y.context().close(); }
});

test('waiter: opening the link asks to install the app (prompt, close, manifest)', async () => {
  const w = await page(B, { w: 390, h: 844 });
  await w.goto(BASE + 'waiter.html');
  await w.waitForSelector('#pairCode', { timeout: 15000 });
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
  await w.reload(); await w.waitForSelector('#pairCode', { timeout: 15000 });
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

test('ready screen inside the TV app: page reports it works, shows a link code (no email), opens once linked, no fullscreen button', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await p.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 9; X96) Chrome/120 Mobile Safari/537.36 SoraScreenApp/1.5' }); });
  const sc = await openScreen(p, BASE + 'screen.html');
  assert.equal(sc.pair.kind, 'ready');
  assert.equal(await p.evaluate(() => window.__scrOk), true);
  assert.equal(await p.locator('#gEmail').count(), 0, 'no email or password on the TV');
  await put('screens/' + sc.uid, { restaurantId: 'RW', restName: 'مطعم الشاشة', code: sc.code, kind: 'ready', name: 'الطابق الأول', pairedBy: 'hq', approved: true, atMs: Date.now() });
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
  assert.deepEqual(st.screen, { salon: false, delivery: true, qr: true, keepMin: 10 });
  assert.equal(st.tables, 8, 'other settings kept');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('ready screen menu with the remote: sound on/off, and unlinking needs a second press', async () => {
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
  await p.waitForSelector('#pairCode', { timeout: 10000 });   // انفصلت ← رمز جديد
  assert.equal(await p.isVisible('#scr'), false);
  assert.equal(await p.isVisible('#menu'), false);
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
  await pairScreen(p, BASE + 'kitchen.html');
  await p.waitForSelector('#off:not([hidden])', { timeout: 15000 });
  // شاشة المجهز بلونها (بنفسجي)
  const pm = await p.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  assert.equal(pm.short_name, 'شاشة المجهز');
  assert.ok(pm.icons.length === 3 && pm.icons.every((i) => /\/prep-(192|512|maskable-512)\.png$/.test(i.src)), 'preparer icons are purple');
  assert.match(await p.getAttribute('link[rel="icon"]', 'href'), /prep-192\.png$/);
  assert.match(await p.getAttribute('link[rel="apple-touch-icon"]', 'href'), /prep-apple-180\.png$/);
  for (const i of pm.icons) assert.equal((await fetch(i.src.replace(/^.*\/sora3a-rest2\//, BASE))).status, 200, i.src);

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
  // صاحب المطعم يوقف شاشة المجهز (svcOff) ← يرجع تبويب المطبخ للكاشير
  await write('restaurants/RW', { svcOff: { kitchen: true } });
  await until(async () => await c.evaluate(() => getComputedStyle(document.querySelector('[data-tab="kitchen"]')).display !== 'none'));
  assert.notEqual(await c.evaluate(() => getComputedStyle(document.querySelector('[data-tab="kitchen"]')).display), 'none');
  await write('restaurants/RW', { features: { kitchen: false }, svcOff: {} });
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
  await pairScreen(p, BASE + 'kitchen.html?sec');
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
  // كل شاشة بلونها: المطبخ فيروزي (kitchen-*)، والمجهز بنفسجي (prep-*)
  assert.ok(mf.icons.every((i) => /\/kitchen-/.test(i.src)), 'kitchen screen keeps the teal icon');
  assert.match(await p.getAttribute('link[rel="icon"]', 'href'), /kitchen-192\.png$/);
  assert.match(await p.getAttribute('#instApp', 'href'), /kitchen-android\/sora3a-kitchen\.apk$/);
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
  await pairScreen(x, BASE + 'kitchen.html');
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

test('kitchen screens link with a code — no admin email: owner links from the admin panel, Tower approves, owner pauses/resumes, unlinks', async () => {
  await write('restaurants/RW', { features: { kitchen: true, kitchenSec: true, devices: true, captain: false } });
  // الشاشة: ماكو إيميل ولا كلمة سر — رمز + QR يفتح لوحة الإدارة على «ربط شاشة»
  const p = await page(B, { w: 1280, h: 800 });
  const sc = await openScreen(p, BASE + 'kitchen.html');
  assert.equal(await p.$('#gEmail'), null, 'no email login on the kitchen screen');
  assert.match(sc.code, /^[A-Z2-9]{6}$/);
  assert.equal(sc.pair.kind, 'kitchen'); assert.match(sc.pair.platform, /شاشة المجهز/);
  await p.waitForSelector('#pairQr svg', { timeout: 8000 });
  await p.screenshot({ path: 'shots/kitchen-pair.png' });
  // صاحب المطعم يفتح الـQR (لوحة الإدارة ?pair=) ← الرمز جاهز ← «ربط»
  const a = await page(B, { w: 1280, h: 900 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html?pair=' + sc.code);
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'scr@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#scScreens.on #scrCode', { timeout: 15000 });
  await until(async () => (await a.inputValue('#scrCode')) === sc.code);
  assert.equal(await a.inputValue('#scrCode'), sc.code);
  await a.fill('#scrName', 'مجهز الصالة'); await a.click('#scrPairBtn');
  const s1 = await until(() => read('screens/' + sc.uid));
  assert.equal(s1.restaurantId, 'RW'); assert.equal(s1.approved, false); assert.equal(s1.pairedBy, 'owner'); assert.equal(s1.name, 'مجهز الصالة');
  await a.waitForSelector(`[data-paired="${sc.uid}"]`, { timeout: 8000 });
  assert.match(await a.textContent(`[data-paired="${sc.uid}"]`), /تنتظر اعتماد إدارة سرعة/);
  // الشاشة: انربطت وتنتظر اعتماد البرج (الأجهزة المعتمدة شغّالة)
  await p.waitForFunction(() => /بانتظار اعتماد إدارة سرعة/.test(document.getElementById('gate').textContent), null, { timeout: 15000 });
  assert.equal(await p.isVisible('#app'), false);
  // البرج يعتمدها ← تفتح وحدها
  await write('screens/' + sc.uid, { approved: true });
  await p.waitForSelector('#app:not([hidden])', { timeout: 40000 });
  await a.waitForFunction((u) => /شغّالة/.test(document.querySelector(`[data-paired="${u}"]`).textContent), sc.uid, { timeout: 8000 });
  // «خدمات مطعمك»: صاحب المطعم يوقف شاشة المجهز ← الشاشة توكف برسالة، ويرجّعها ← ترجع
  await a.waitForSelector('#scrSvc:not([hidden]) [data-svc="kitchen"] .scr-sw.on', { timeout: 8000 });
  assert.match(await a.textContent('#scrSvc [data-svc="captain"]'), /تتفعّل من إدارة سرعة/, 'services Tower did not enable cannot be switched');
  assert.equal(await a.$('#scrSvc [data-svc="captain"] .scr-sw'), null);
  await a.click('#scrSvc [data-svc="kitchen"] .scr-sw');
  await until(async () => ((await read('restaurants/RW')).svcOff || {}).kitchen === true);
  await p.waitForSelector('#off:not([hidden])', { timeout: 10000 });
  assert.match(await p.textContent('#off'), /موقوفة من صاحب المطعم/);
  await a.waitForSelector('[data-scr="kitchen"] .scr-tag.warn', { timeout: 8000 });
  await a.screenshot({ path: 'shots/admin-pair.png', fullPage: true });
  await a.click('#scrSvc [data-svc="kitchen"] .scr-sw');
  await p.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  // البرج يطفي الخدمة ← صاحب المطعم ما يكدر يشغّلها
  await write('restaurants/RW', { features: { kitchen: false, kitchenSec: true, devices: true } });
  await a.waitForFunction(() => /تتفعّل من إدارة سرعة/.test(document.querySelector('#scrSvc [data-svc="kitchen"]').textContent), null, { timeout: 8000 });
  assert.equal(await a.$('#scrSvc [data-svc="kitchen"] .scr-sw'), null);
  await write('restaurants/RW', { features: { kitchen: true, kitchenSec: true, devices: true } });
  // صاحب المطعم يفصلها ← ترجع لرمز جديد
  await a.click(`[data-paired="${sc.uid}"] button:has-text("فصل")`);   // التأكيد يقبله الـharness
  await p.waitForSelector('#pairCode', { timeout: 15000 });
  assert.equal(await read('screens/' + sc.uid), null);
  // البرج يربط شاشة مباشرة ← معتمدة وتفتح بدون انتظار
  const q = await page(B, { w: 1280, h: 800 });
  await pairScreen(q, BASE + 'kitchen.html?sec');
  await q.waitForSelector('#app:not([hidden]), #pick:not([hidden])', { timeout: 15000 });
  for (const y of [p, a, q]) { assert.deepEqual(clean(y).filter((e) => !/permission/i.test(e)), []); await y.context().close(); }
  await write('restaurants/RW', { features: { kitchen: false } });
});

test('a screen on a device signs out an old restaurant-email login there once (so nobody opens the cashier as the owner)', async () => {
  await write('restaurants/RW', { features: {} });
  const w = await page(B, { w: 1280, h: 860 });
  await posLogin(w);
  await openScreen(w, BASE + 'kitchen.html');
  await w.goto(BASE + 'index.html');
  await w.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  assert.deepEqual(clean(w).filter((e) => !/permission/i.test(e)), []); await w.context().close();
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
  assert.match(await url('waiterApk'), /waiter-android\/sora3a-waiter\.apk$/);
  assert.match(await p.textContent('[data-scr="waiterApk"]'), /بدون نت/);
  assert.match(await url('captain'), /sora3a-captain\/captain\.html$/);
  assert.match(await p.textContent('.scr-intro'), /بدون إيميل/);
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
  await pairScreen(w, BASE + 'waiter.html', { name: 'علي' });
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

// التسلسل: الكاشير ← شاشة المطبخ (كل قسم يطبخ) ← شاشة المجهز (يجمّع ويتمم) ← جاهز. شاشة المطبخ مطفية ← المجهز مباشرة
test('kitchen flow: the order goes to the kitchen sections first, then to the preparer, who completes it; kitchen screen off → straight to the preparer', async () => {
  const now = Date.now();
  await write('restaurants/RW', { features: { kitchen: true, kitchenSec: true }, svcOff: {} });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 3, kSecOn: true,
    sections: [{ id: 'grill', name: 'الشوي', emoji: '🔥' }, { id: 'drinks', name: 'المشروبات', emoji: '🥤' }] });
  const ord = (id, n, extra = {}) => put('orders/' + id, { restaurantId: 'RW', orderType: 'takeaway', status: 'preparing', held: true, kitchen: 'new', ticketNo: n, value: 9000, day: bagDay(now),
    createdAt: '20:15', createdAtMs: now - 60000, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1, sec: 'grill' }, { name: 'لبن', variant: 'وحدة', qty: 1, sec: 'drinks' }],
    kSec: { grill: { n: 1, readyAt: 0 }, drinks: { n: 1, readyAt: 0 } }, ...extra });
  await ord('KF1', 91);
  // شاشة المجهز: الطلب بعده بالمطبخ ← بشريط «بعدها بالمطبخ» بس، بدون زر
  const prep = await page(B, { w: 1280, h: 800 });
  await pairScreen(prep, BASE + 'kitchen.html');
  await prep.waitForSelector('#cook:not([hidden])', { timeout: 15000 });
  await prep.waitForFunction(() => /#91/.test(document.getElementById('cook').textContent), null, { timeout: 15000 });
  assert.equal(await prep.locator('[data-done="KF1"]').count(), 0, 'not on the preparer while the kitchen cooks');
  assert.match(await prep.textContent('#flow'), /بعد ما يخلص المطبخ/);
  // شاشة المطبخ: قسم الشوي ثم المشروبات
  const k = await page(B, { w: 1280, h: 800 });
  await pairScreen(k, BASE + 'kitchen.html?sec=grill');
  await k.waitForSelector('.card [data-sec="KF1|grill"]', { timeout: 15000 });
  assert.match(await k.textContent('#flow'), /يروح لشاشة المجهز/);
  await k.click('.card [data-sec="KF1|grill"]');
  await until(async () => (await read('orders/KF1')).kSec.grill.readyAt > 0);
  await k.goto(BASE + 'kitchen.html?sec=drinks');
  await k.waitForSelector('.card [data-sec="KF1|drinks"]', { timeout: 15000 });
  await k.click('.card [data-sec="KF1|drinks"]');
  let o = await until(async () => { const x = await read('orders/KF1'); return x.kitchenSecDoneAt ? x : null; });
  assert.equal(o.kitchen, 'new', 'kitchen done → with the preparer, not ready yet'); assert.equal(o.status, 'preparing');
  // المجهز يستلمه (وينشال من «بعدها بالمطبخ») ويتممه
  await prep.waitForSelector('.card [data-done="KF1"]', { timeout: 15000 });
  assert.match(await prep.textContent('.card:has([data-done="KF1"])'), /تم التجهيز — جاهز للزبون/);
  assert.equal(await prep.locator('.card:has([data-done="KF1"]) .sec[data-sec]').count(), 0, 'section chips are info only on the preparer');
  await prep.click('.card [data-done="KF1"]');
  o = await until(async () => { const x = await read('orders/KF1'); return x.kitchen === 'ready' ? x : null; });
  assert.equal(o.status, 'ready');
  // دلفري: نفس الشي، وزر المجهز يكول يرجع لكاشير الدلفري
  await ord('KF3', 93, { orderType: 'delivery', status: 'preparing', awaitCap: true, held: false, kSec: { grill: { n: 1, readyAt: now }, drinks: { n: 1, readyAt: now } }, kitchenSecDoneAt: now });
  await prep.waitForSelector('.card [data-done="KF3"]', { timeout: 15000 });
  assert.match(await prep.textContent('.card:has([data-done="KF3"])'), /يرجع لكاشير الدلفري/);
  // شاشة المطبخ مطفية ← الطلب يوصل للمجهز مباشرة
  await write('restaurants/RW', { svcOff: { kitchenSec: true } });
  await ord('KF2', 92);
  await prep.waitForSelector('.card [data-done="KF2"]', { timeout: 15000 });
  assert.match(await prep.textContent('#flow'), /مباشرة/);
  assert.deepEqual(clean(prep), []); assert.deepEqual(clean(k), []);
  await write('restaurants/RW', { features: { kitchen: false, kitchenSec: false }, svcOff: {} });
  await prep.context().close(); await k.context().close();
});

// دلفري خلص تجهيزه يرجع للكاشير اللي سجّله (حتى يختار الكابتن)؛ إذا ما اختار خلال ٣ دقايق يطلع لباقي كاشيرية الدلفري
test('a delivery order finished by the preparer comes back to the cashier who took it; other delivery cashiers see it only after 3 minutes', async () => {
  const mk = async (email) => { const uid = await signUp(email, 'secret123');
    await put('users/' + uid, { role: 'cashier', restaurantId: 'RW', email, name: email.split('@')[0], perms: {} }); };
  await mk('dlA@x.com'); await mk('dlB@x.com');
  const login = async (email, dev) => { const p = await page(B, { w: 1280, h: 860 });
    await p.addInitScript((d) => { try { localStorage.setItem('pos_device', JSON.stringify(d)); } catch (e) {} }, dev);
    await p.goto(BASE + 'index.html');
    await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
    await p.fill('#inEmail', email); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
    await p.waitForSelector('#prods .prod', { timeout: 15000 }); return p; };
  const a = await login('dlA@x.com', 'dev-A'), b = await login('dlB@x.com', 'dev-B');
  const now = Date.now();
  await put('orders/DLB1', { restaurantId: 'RW', orderType: 'delivery', status: 'preparing', awaitCap: true, captainId: null, kitchen: 'ready', kitchenReadyAt: now, device: 'dev-A',
    ticketNo: 95, customer: 'أبو حيدر', phone: '07705550000', value: 6000, fee: 1000, day: bagDay(now), createdAt: '20:20', createdAtMs: now - 5 * 60000, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1 }] });
  await a.waitForSelector('#capWaitBox .cap-wait:has-text("#95")', { timeout: 15000 });
  await b.waitForTimeout(1500);
  assert.equal(await b.locator('#capWaitBox .cap-wait:has-text("#95")').count(), 0, 'the other delivery cashier does not get it right away');
  // بعد ٣ دقايق (هنا نص ثانية) يطلع لهم هم
  await b.evaluate(() => { window.__capBack = 500; renderCapWait(); });
  await b.waitForSelector('#capWaitBox .cap-wait:has-text("#95")', { timeout: 5000 });
  assert.deepEqual(clean(a), []); assert.deepEqual(clean(b), []);
  await a.context().close(); await b.context().close();
});

test('the kitchen app and the preparer app are separate: each opens only its own screen; an old preparer tablet is told to get the preparer app', async () => {
  await put('restaurants/RW', { name: 'مطعم الشاشة', userId: U.owner, active: true, features: { kitchen: true, kitchenSec: true } });
  await put('restaurants/RW/settings/main', { kSecOn: true, updatedAtMs: Date.now(), sections: [{ id: 'grill', name: 'الشوي', emoji: '🔥' }, { id: 'drinks', name: 'المشروبات', emoji: '🥤' }] });
  const asApp = async (kds, pre) => {
    const p = await page(B, { w: 1280, h: 800 });
    await p.addInitScript(([k, ls]) => {
      const ua = navigator.userAgent + ' SoraKitchenApp/1.49' + (k ? ' SoraKds/' + k : '');
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true });
      if (ls && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.entries(ls).forEach(([a, b]) => localStorage.setItem(a, b)); }
    }, [kds, pre || null]);
    return p;
  };
  // تطبيق «سرعة - المجهز»: حتى لو انفتح رابط القسم يرجع للمجهز، وماكو زر تحويل
  const prep = await asApp('prep');
  await prep.goto(BASE + 'kitchen.html?sec=grill');
  await prep.waitForURL(/kitchen\.html$/, { timeout: 10000 });
  await prep.waitForSelector('#pairCode', { timeout: 15000 });
  assert.equal(await prep.title(), 'سرعة — شاشة المجهز');
  assert.match(await prep.getAttribute('#instApp', 'href'), /prep-android\/sora3a-prep\.apk$/);
  await prep.context().close();
  // تطبيق «سرعة - المطبخ»: جهاز كان مجهز بالنسخة القديمة ← يروح لشاشة المطبخ ويطلع تنبيه بتطبيق المجهز
  const k = await asApp('sec', { kds_mode: 'all' });
  await pairScreen(k, BASE + 'kitchen.html');
  await k.waitForURL(/kitchen\.html\?sec/, { timeout: 15000 });
  // أول شي «اختار قسمك» — وبيها نفس التنبيه
  await k.waitForSelector('#pick:not([hidden]) #movedP:not([hidden])', { timeout: 15000 });
  await k.click('#pickG [data-pick] >> nth=0');
  await k.waitForSelector('#moved:not([hidden])', { timeout: 15000 });
  assert.match(await k.getAttribute('#moved a', 'href'), /prep-android\/sora3a-prep\.apk$/);
  await k.click('#menuBtn'); await k.waitForSelector('#menu:not([hidden])');
  assert.equal(await k.isVisible('#mMode'), false, 'no switch inside the kitchen app');
  await k.evaluate(() => { document.getElementById('menu').hidden = true; });
  await k.click('#movedX');
  assert.equal(await k.isVisible('#moved'), false);
  await k.reload();
  await k.waitForURL(/kitchen\.html\?sec/, { timeout: 15000 });
  await k.waitForTimeout(800);
  assert.equal(await k.isVisible('#moved'), false, 'the notice stays closed');
  await k.context().close();
  // النسخة القديمة (تطبيق واحد للثنين): زر التحويل يبقى مثل قبل
  const old = await asApp('');
  await pairScreen(old, BASE + 'kitchen.html');
  await old.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await old.click('#menuBtn'); await old.waitForSelector('#menu:not([hidden])');
  assert.equal(await old.isVisible('#mMode'), true, 'the old single app keeps its switch');
  await old.context().close();
});

test('many orders: the ready screen shrinks the numbers so none hide behind the QR; the kitchen fits 20+ orders and «ready» reacts at once', async () => {
  const now = Date.now(), day = bagDay();
  // نبدأ نظيف: طلبات الاختبارات السابقة لهذا المطعم تتلغى
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore(), q = await getDocs(query(collection(db, 'orders'), where('restaurantId', '==', 'RW')));
    await Promise.all(q.docs.map((d) => updateDoc(d.ref, { status: 'cancelled' }))); });
  await put('restaurants/RW', { name: 'مطعم الشاشة', userId: U.owner, active: true, features: { kitchen: true, online: true } });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: Date.now(), screen: { salon: true, delivery: false, qr: true } });
  await put('publicMenus/RW', { name: 'برغر الشاشة', on: true, modes: { table: true, pickup: true, delivery: false }, cats: [], updatedAtMs: 1 });
  // ── شاشة «طلبك جاهز»: طلبين بس ← الحجم الطبيعي
  for (let i = 0; i < 2; i++) await put('orders/MQ' + i, { restaurantId: 'RW', orderType: i % 2 ? 'salon' : 'takeaway', status: 'delivered', held: false, kitchen: 'new', ticketNo: 100 + i, value: 5000, day, createdAtMs: now - (40 - i) * 60000 });
  const s = await page(B, { w: 1280, h: 720 });
  await login(s, BASE + 'screen.html', 'scr@x.com');
  await s.waitForSelector('#prep .n', { timeout: 15000 });
  await s.waitForSelector('#qrBox:not([hidden]) svg', { timeout: 15000 });
  assert.equal(await s.evaluate(() => getComputedStyle(document.getElementById('prep')).getPropertyValue('--z').trim()), '1', 'few orders keep the normal size');
  // 30 طلب قيد التحضير ← كلها تبين فوق الباركود
  for (let i = 2; i < 30; i++) await put('orders/MQ' + i, { restaurantId: 'RW', orderType: i % 2 ? 'salon' : 'takeaway', status: 'delivered', held: false, kitchen: 'new', ticketNo: 100 + i, value: 5000, day, createdAtMs: now - (40 - i) * 60000 });
  await s.waitForFunction(() => document.querySelectorAll('#prep .n').length === 30, null, { timeout: 15000 });
  await s.waitForTimeout(300);
  const fitS = await s.evaluate(() => {
    const box = document.getElementById('prep').getBoundingClientRect(), qr = document.getElementById('qrBox').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('#prep .n')].map((n) => n.getBoundingClientRect());
    return { z: +getComputedStyle(document.getElementById('prep')).getPropertyValue('--z'), hidden: tiles.filter((r) => r.bottom > box.bottom + 1 || r.bottom > qr.top + 1).length };
  });
  assert.ok(fitS.z < 1, 'numbers got smaller');
  assert.equal(fitS.hidden, 0, 'no order number hides behind the QR');
  await s.screenshot({ path: 'shots/ready-screen-many.png' });
  await s.context().close();

  // ── شاشة المجهز: 24 طلب ← كلها بالشاشة و«جاهز» ينضغط
  for (let i = 0; i < 30; i++) await write('orders/MQ' + i, { status: 'ready', kitchen: 'ready', kitchenReadyAt: now - 30 * 60000 });
  // الطلبات الملغية من الاختبارات القديمة (بطاقات حمرة) نخليها قديمة حتى ما تزاحم
  for (const x of await list('orders', 'restaurantId', 'RW')) if (x.status === 'cancelled' && x.kitchen === 'new') await write('orders/' + x.id, { cancelledAt: now - 3 * 3600000 });
  for (let i = 0; i < 24; i++) await put('orders/MK' + i, { restaurantId: 'RW', orderType: 'takeaway', status: 'delivered', kitchen: 'new', ticketNo: 200 + i, value: 5000, day, createdAt: '20:05', createdAtMs: now - (30 - i) * 60000,
    items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1 }, { name: 'بطاطا', variant: 'وحدة', qty: 2 }] });
  const k = await page(B, { w: 1280, h: 800 });
  await pairScreen(k, BASE + 'kitchen.html');
  await k.waitForFunction(() => document.querySelectorAll('#grid .card:not(.canc)').length === 24, null, { timeout: 20000 });   // (الملغية من الاختبارات القديمة تطلع بطاقات حمرة)
  await k.waitForTimeout(300);
  const fitK = await k.evaluate(() => {
    const g = document.getElementById('grid'), box = g.getBoundingClientRect();
    const cards = [...g.querySelectorAll('.card')].map((c) => c.getBoundingClientRect());
    return { z: +getComputedStyle(g).getPropertyValue('--z'), out: cards.filter((r) => r.bottom > box.bottom + 1).length, bottom: box.bottom, vh: innerHeight };
  });
  assert.ok(fitK.z < 1 && fitK.z >= 0.6, 'cards got smaller (not too small): ' + fitK.z);
  assert.equal(fitK.out, 0, 'all 24 orders are on the screen');
  assert.ok(fitK.bottom <= fitK.vh + 1, 'the list ends inside the screen');
  await k.screenshot({ path: 'shots/kitchen-many.png' });
  // تحديث ما يغيّر شي بالشاشة ← البطاقات نفسها تبقى (ما تنرسم من جديد، فالضغطة ما تضيع)
  await k.evaluate(() => { document.querySelector('#grid .card').__keep = 1; });
  await write('orders/MK0', { printedAt: Date.now() });
  await k.waitForTimeout(1200);
  assert.equal(await k.evaluate(() => document.querySelector('#grid .card').__keep), 1, 'no redraw when nothing on screen changed');
  // «تم التجهيز» ← البطاقة تطلع فوراً
  const t0 = Date.now();
  await k.click('#grid .card[data-id="MK3"] .done-b');
  await k.waitForSelector('#grid .card[data-id="MK3"]', { state: 'detached', timeout: 1500 });
  assert.ok(Date.now() - t0 < 1500, 'ready reacts at once');
  await until(async () => (await read('orders/MK3')).kitchen === 'ready');
  await k.context().close();
  for (let i = 0; i < 24; i++) await write('orders/MK' + i, { status: 'cancelled' });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: Date.now() });
});

test('a screen on a device with a wrong clock shows how to fix it (otherwise the server rejects its requests)', async () => {
  const k = await page(B, { w: 1280, h: 800 });
  await k.context().addInitScript(() => { const N = Date.now; Date.now = () => N() + 3 * 3600000; });   // ساعة الجهاز مقدّمة ٣ ساعات
  await pairScreen(k, BASE + 'kitchen.html', { name: 'المجهز' });
  await k.waitForSelector('#clockWarn', { timeout: 15000 });
  assert.match(await k.textContent('#clockWarn'), /مقدّمة 3 ساعة.*التاريخ والوقت/);
  await k.context().close();
  // جهاز ساعته صحيحة: ماكو تنبيه
  const ok = await page(B, { w: 1280, h: 800 });
  await pairScreen(ok, BASE + 'kitchen.html', { name: 'المجهز' });
  await ok.waitForTimeout(2500);
  assert.equal(await ok.$('#clockWarn'), null);
  await ok.context().close();
});

test('a TV that was signed in with the restaurant email links itself to the restaurant (no code), then the owner login leaves that device', async () => {
  await write('restaurants/RW', { features: { kitchen: true, screen: true } });
  const p = await page(B, { w: 1280, h: 720 });
  await posLogin(p);   // نفس الجهاز جان داخل بإيميل المطعم (قبل الربط بالرمز)
  const before = (await list('screens', 'restaurantId', 'RW')).length;
  const s = await p.context().newPage();
  s.errors = []; s.on('pageerror', (e) => s.errors.push(String(e)));
  await s.goto(BASE + 'screen.html');
  await s.waitForSelector('#scr:not([hidden])', { timeout: 20000 });
  const mine = await until(async () => { const l = await list('screens', 'restaurantId', 'RW'); return l.length > before && l.find((x) => x.kind === 'ready' && x.pairedBy === 'owner' && x.approved === false); });
  assert.ok(mine, 'linked to the same restaurant by itself');
  // جلسة صاحب المطعم طلعت من التلفزيون (محد يفتح الكاشير منه)
  await p.reload();
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  assert.deepEqual(s.errors, []);
  await p.context().close();
});

test('a restaurant with two halls: each ready screen shows only its own cashiers orders; the owner picks them in the admin panel and the screen follows live', async () => {
  await write('restaurants/RW', { features: { kitchen: true, screen: true } });
  const c1 = 'hallOne', c2 = 'hallTwo', now = Date.now(), today = bagDay();
  await put('users/' + c1, { role: 'cashier', restaurantId: 'RW', email: 'hall1@x.com', name: 'كاشير الطابق الأول', perms: {} });
  await put('users/' + c2, { role: 'cashier', restaurantId: 'RW', email: 'hall2@x.com', name: 'كاشير الطابق الثاني', perms: {} });
  const base = { restaurantId: 'RW', status: 'delivered', value: 5000, day: today, createdAtMs: now - 5 * 60000, orderType: 'takeaway', kitchen: 'ready', kitchenReadyAt: now - 60000 };
  await put('orders/H1', { ...base, ticketNo: 71, byUid: c1 });
  await put('orders/H2', { ...base, ticketNo: 72, byUid: c2 });
  await put('orders/H3', { ...base, ticketNo: 73 });   // طلب قديم بدون اسم كاشير: يطلع بكل الشاشات
  const one = await page(B, { w: 1280, h: 720 }), two = await page(B, { w: 1280, h: 720 });
  const s1 = await pairScreen(one, BASE + 'screen.html', { name: 'الطابق الأول', cashiers: [c1] });
  await pairScreen(two, BASE + 'screen.html', { name: 'الطابق الثاني', cashiers: [c2] });
  const shown = (p) => p.$$eval('#ready .n, #prep .n', (els) => els.map((e) => e.textContent.trim().replace(/\D.*$/, '').replace('#', '')));
  const has = (p, n) => p.waitForFunction((n) => [...document.querySelectorAll('#ready .n, #prep .n')].some((e) => e.textContent.trim().startsWith('#' + n)), n, { timeout: 15000 });
  await has(one, 71); await has(one, 73); await has(two, 72);
  assert.ok(!(await one.textContent('#ready')).includes('#72'), 'hall 1 does not show hall 2 orders');
  assert.ok(!(await two.textContent('#ready')).includes('#71'), 'hall 2 does not show hall 1 orders');
  // صاحب المطعم: لوحة الإدارة ← الشاشات ← «تعرض طلبات» ← يضيف كاشير الطابق الثاني للشاشة الأولى
  const a = await page(B, { w: 1280, h: 900 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html');
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'scr@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#appPage', { state: 'visible', timeout: 15000 });
  await a.click('.dnav-btn[data-screen="scScreens"]');
  await a.waitForSelector(`[data-cash="${s1.uid}"]`, { timeout: 15000 });
  assert.match(await a.textContent(`[data-cash="${s1.uid}"] summary`), /كاشير الطابق الأول/);
  await a.click(`[data-cash="${s1.uid}"] summary`);
  await a.check(`[data-cash="${s1.uid}"] input[data-cu="${c2}"]`);
  await until(async () => ((await read('screens/' + s1.uid)).cashiers || []).length === 2);
  await has(one, 72);   // الشاشة تتبع فوراً
  await a.screenshot({ path: 'shots/admin-ready-cashiers.png' });
  for (const p of [one, two, a]) await p.context().close();
});

test('Tower picks the ready screen look per restaurant: design + 2 colours + logo, the TV follows live; the default stays exactly as before', async () => {
  await write('restaurants/RW', { features: { kitchen: true, screen: true }, screenTheme: null, screenMax: null });
  const now = Date.now(), today = bagDay();
  const base = { restaurantId: 'RW', status: 'delivered', value: 5000, day: today, createdAtMs: now - 5 * 60000, orderType: 'takeaway' };
  for (const [i, n] of [81, 82, 83].entries()) await put('orders/TH' + n, { ...base, ticketNo: n, kitchen: 'ready', kitchenReadyAt: now - (i + 1) * 30000 });
  for (const n of [84, 85, 86, 87]) await put('orders/TH' + n, { ...base, ticketNo: n, kitchen: 'new' });
  const p = await page(B, { w: 1280, h: 720 });
  await pairScreen(p, BASE + 'screen.html', { name: 'شاشة الثيمات' });
  await p.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  await p.waitForFunction(() => document.querySelectorAll('#ready .n').length >= 3, null, { timeout: 15000 });
  const look = () => p.evaluate(() => ({ cls: [...document.documentElement.classList].filter((c) => c.startsWith('th-')), o2: document.documentElement.style.getPropertyValue('--o2'), c2: document.documentElement.style.getPropertyValue('--c2'), logo: !!document.querySelector('#mk img') }));
  assert.deepEqual(await look(), { cls: ['th-classic'], o2: '', c2: '', logo: false }, 'no Tower setting = the current design untouched');
  // نفس ألوان التصميم الحالي من البرج = ولا تغيير
  await write('restaurants/RW', { screenTheme: { design: 'classic', c1: '#f5891f', c2: '#16a34a' } });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await look()).o2, '', 'the default colours saved from Tower keep the exact original look');
  // شعار من البرج
  const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#7c3aed'; g.beginPath(); g.arc(80, 80, 76, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.textAlign = 'center'; g.fillText('و', 80, 112); return c.toDataURL('image/png'); });
  await put('restaurants/RW/theme/logo', { data: png, atMs: Date.now() });
  await p.waitForSelector('#mk img', { timeout: 10000 });
  for (const [design, c1, c2] of [['classic', '#7c3aed', '#0ea5e9'], ['board', '#16130e', '#ffc94a'], ['tickets', '#1f5b57', '#fce7a2'], ['whiteboard', '#f6f8f8', '#2b59c3']]) {
    await write('restaurants/RW', { screenTheme: { design, c1, c2 } });
    await p.waitForFunction(([d, c]) => document.documentElement.classList.contains('th-' + d) && document.documentElement.style.getPropertyValue('--c2').trim().toLowerCase() === c, [design, c2], { timeout: 10000 });
    const l = await look();
    assert.equal(l.c2.trim().toLowerCase(), c2, design + ': colours applied');
    if (design === 'classic') assert.equal(l.o2.trim().toLowerCase(), c1, 'classic with own colours recolours the orange');
    assert.ok(l.logo, design + ': logo stays');
    await new Promise((r) => setTimeout(r, 900));   // الخط والحركة
    await p.screenshot({ path: `shots/ready-theme-${design}.png` });
  }
  // شعار المطعم بخلفية «جاهز»: البرج يشغّله ويحدد وضوحه وحجمه — والأرقام تطلع فوقه
  await write('restaurants/RW', { screenTheme: { design: 'classic', c1: '#7c3aed', c2: '#0ea5e9', wm: { on: true, op: 0.25, size: 'l' } } });
  await p.waitForSelector('#wm:not([hidden]) i', { timeout: 10000 });
  const wm = await p.evaluate(() => {
    const im = document.querySelector('#wm i'), n = document.querySelector('#ready .n'), r = n.getBoundingClientRect();
    const a = im.getBoundingClientRect(), col = document.querySelector('.col.ready').getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { op: getComputedStyle(im).opacity, cls: document.getElementById('wm').className, wide: a.width / col.width, bg: /url\(/.test(im.style.backgroundImage), numOnTop: n.contains(top) };
  });
  assert.equal(wm.op, '0.25'); assert.match(wm.cls, /\bl\b/); assert.ok(wm.wide > 0.8, 'large'); assert.ok(wm.bg); assert.ok(wm.numOnTop, 'numbers show on top of the logo');
  await p.screenshot({ path: 'shots/ready-logo-watermark.png' });
  await write('restaurants/RW', { 'screenTheme.wm.op': 1, 'screenTheme.wm.size': 's' });
  await p.waitForFunction(() => getComputedStyle(document.querySelector('#wm i')).opacity === '1' && /\bs\b/.test(document.getElementById('wm').className), null, { timeout: 10000 });
  await write('restaurants/RW', { 'screenTheme.wm.on': false });
  await p.waitForSelector('#wm', { state: 'hidden', timeout: 10000 });
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains('wm-on')), false);
  // لون كل جزء بروحه: خلفية ذهبية، أرقام «جاهز» بيضاء، وكتابة الشاشة الفارغة حمرة
  await write('restaurants/RW', { screenTheme: { design: 'board', c1: '#16130e', c2: '#ffc94a', x: { bg: '#d4af37', readyNumFg: '#ffffff', emptyFg: '#ff0000', bad: '#123456', prepFg: 'red' } } });
  await p.waitForFunction(() => document.documentElement.classList.contains('xs-bg'), null, { timeout: 10000 });
  const cs = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, rn: getComputedStyle(document.querySelector('#ready .n')).color, prep: document.documentElement.classList.contains('xs-prepFg') }));
  assert.equal(cs.bg, 'rgb(212, 175, 55)'); assert.equal(cs.rn, 'rgb(255, 255, 255)'); assert.equal(cs.prep, false, 'a wrong colour value is ignored');
  await p.screenshot({ path: 'shots/ready-theme-gold.png' });
  // البرج يشيل الشعار ← يرجع الحرف
  await E.withSecurityRulesDisabled(async (c) => { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(c.firestore(), 'restaurants/RW/theme/logo')); });
  await p.waitForFunction(() => !document.querySelector('#mk img'), null, { timeout: 10000 });
  assert.deepEqual(clean(p), []);
  await write('restaurants/RW', { screenTheme: null });
  await p.context().close();
});

test('Tower limits how many ready screens a restaurant links: the admin panel refuses one more, and the cashier button stops self-linking', async () => {
  await write('restaurants/RW', { features: { kitchen: true, screen: true, devices: false }, screenMax: 1 });
  for (const s of await list('screens', 'restaurantId', 'RW')) if (s.kind === 'ready') await E.withSecurityRulesDisabled(async (c) => { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(c.firestore(), 'screens/' + s.id)); });
  await pairScreen(await page(B, { w: 800, h: 600 }), BASE + 'screen.html', { name: 'الأولى' });
  // لوحة الإدارة: شاشة ثانية ← «وصلت الحد»
  const p2 = await page(B, { w: 1280, h: 720 });
  const sc = await openScreen(p2, BASE + 'screen.html');
  const a = await page(B, { w: 1280, h: 900 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html?pair=' + sc.code);
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'scr@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#scScreens.on #scrCode', { timeout: 15000 });
  await a.waitForFunction(() => /شاشات «طلبك جاهز»: 1 من 1/.test(document.body.textContent), null, { timeout: 15000 });
  await until(async () => (await a.inputValue('#scrCode')) === sc.code);
  await a.click('#scrPairBtn');
  await a.waitForFunction(() => /وصلت حد شاشات/.test(document.body.textContent), null, { timeout: 10000 });
  assert.equal(await read('screens/' + sc.uid), null, 'not linked');
  // زر الكاشير: ما تنربط وحدها، تبقى على الرمز
  const p = await page(B, { w: 1280, h: 860 });
  await posLogin(p);
  const s = await p.context().newPage();
  await s.goto(BASE + 'screen.html?from=pos');
  await s.waitForSelector('#pairCode', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await list('screens', 'restaurantId', 'RW')).filter((x) => x.kind === 'ready').length, 1, 'still one ready screen');
  await write('restaurants/RW', { screenMax: null });
  for (const x of [p2, a, p]) await x.context().close();
});

test('old TV browsers (no clamp/min/max/env/gap): the Sora3a bar stays thin on every screen — it once grew to a third of the TV', async () => {
  const oldCss = (css) => css.replace(/clamp\(/g, 'clampx(').replace(/\bmin\(/g, 'minx(').replace(/\bmax\(/g, 'maxx(').replace(/env\(/g, 'envx(').replace(/dvh/g, 'dvhx').replace(/\binset:/g, 'insetx:').replace(/([;{\s])gap:/g, '$1gapx:');
  const { readFileSync } = await import('node:fs');
  for (const [url, w, h] of [['screen.html', 960, 540], ['kitchen.html', 1280, 720], ['index.html', 1280, 800], ['waiter.html', 400, 800]]) {
    const p = await page(B, { w, h });
    await p.route('**/sora3a-rest2/brand.css*', (r) => r.fulfill({ contentType: 'text/css', body: oldCss(readFileSync(new URL('../../../../sora3a-rest2/brand.css', import.meta.url), 'utf8')) }));
    await p.goto(BASE + url);
    await p.waitForSelector('.sb-bar', { timeout: 15000 });
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : 0; }; return { bar: r('.sb-bar'), mark: r('.sb-bar .sb-m'), foot: r('.sb-foot') }; });
    assert.ok(m.bar >= 40 && m.bar <= 60, `${url}: bar ${m.bar}px`);
    assert.ok(m.mark > 0 && m.mark <= m.bar, `${url}: logo ${m.mark}px inside the bar`);
    assert.ok(m.foot <= 40, `${url}: footer ${m.foot}px`);
    if (url === 'screen.html') await p.screenshot({ path: 'shots/old-tv-screen.png' });
    await p.context().close();
  }
});

test('kitchen screen: a cancelled order turns red and stays until «شفته»; a cashier edit shows what was added/removed; «رجّع» undoes a wrong «جاهز»; item totals, table colours, late times from settings', async () => {
  const now = Date.now(), day = bagDay(now);
  await write('restaurants/RW', { features: { kitchen: true, kitchenSec: false }, svcOff: {} });
  await put('restaurants/RW/settings/main', { tables: 8, pagers: 10, receiptTitle: 'برغر الشاشة', updatedAtMs: 4, kWarn: 2, kLate: 30 });
  // طلبات الاختبارات القديمة تطلع من المطبخ حتى المجموع يكون لطلبات هذا الاختبار بس
  for (const x of await list('orders', 'restaurantId', 'RW')) if (x.kitchen === 'new') await write('orders/' + x.id, { kitchen: 'ready', kitchenReadyAt: now - 3600000, status: x.status === 'cancelled' ? 'cancelled' : 'delivered', cancelledAt: x.status === 'cancelled' ? now - 3 * 3600000 : null });
  const base = { restaurantId: 'RW', status: 'preparing', held: true, kitchen: 'new', value: 13500, day, createdAt: '20:15' };
  await put('orders/KX1', { ...base, orderType: 'salon', tableNo: '5', ticketNo: 61, createdAtMs: now - 3 * 60000, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 2, price: 6000 }] });
  await put('orders/KX2', { ...base, orderType: 'takeaway', ticketNo: 62, createdAtMs: now - 30000, value: 6750, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1, price: 6000 }, { name: 'لبن', variant: 'وحدة', qty: 1, price: 750 }] });
  const k = await page(B, { w: 1280, h: 800 });
  await pairScreen(k, BASE + 'kitchen.html');
  await k.waitForSelector('.card [data-done="KX1"]', { timeout: 15000 });
  await k.waitForSelector('.card [data-done="KX2"]', { timeout: 15000 });
  // أوقات التأخير من الإعدادات (أصفر بعد دقيقتين) + لون الطاولة + مجموع الأصناف
  assert.ok(await k.$('.card.warn:has([data-done="KX1"])'), 'yellow after 2 minutes (restaurant setting)');
  assert.ok(await k.$('.card.warn:has([data-done="KX2"])') === null);
  assert.match(await k.getAttribute('.card:has([data-done="KX1"]) .tbl', 'style'), /background:hsl\(/);
  assert.match(await k.textContent('#tot'), /3×\s*برغر لحم/);
  // الكاشير يعدّل الطلب: يضيف 2 لبن وينقص البرغر
  const c = await page(B, { w: 1280, h: 860 });
  await posLogin(c);
  await c.waitForFunction(() => typeof window.ordEdit === 'function' && orders.some((o) => o.id === 'KX2'), null, { timeout: 15000 });
  await c.evaluate(() => { window.ordEdit('KX2'); edState.work.find((i) => i.name === 'لبن').qty = 3; edState.work = edState.work.filter((i) => i.name !== 'برغر لحم'); window.edSave(); });
  const o2 = await until(async () => { const x = await read('orders/KX2'); return x.kEdits && x.kEdits.length ? x : null; });
  assert.deepEqual(o2.kEdits[0].add.map((a) => [a.name, a.qty]), [['لبن', 2]]);
  assert.deepEqual(o2.kEdits[0].rem.map((a) => [a.name, a.qty]), [['برغر لحم', 1]]);
  await k.waitForSelector('.card.edited:has([data-done="KX2"])', { timeout: 15000 });
  const card = await k.textContent('.card.edited:has([data-done="KX2"])');
  assert.match(card, /انعدل الطلب/); assert.match(card, /\+ انضاف 2× لبن/); assert.match(card, /− انشال 1× برغر لحم/);
  assert.ok(await k.$('.card:has([data-done="KX2"]) .it.it-add'), 'the added item is highlighted');
  await k.screenshot({ path: 'shots/kitchen-edited.png' });
  await k.click('.card [data-ack-e^="KX2|"]');
  await k.waitForSelector('.card.edited', { state: 'detached', timeout: 8000 });
  // «جاهز» بالغلط ← «رجّع»
  await k.click('.card [data-done="KX2"]');
  await until(async () => (await read('orders/KX2')).kitchen === 'ready');
  await k.waitForSelector('#undoB:not([hidden])', { timeout: 8000 });
  assert.match(await k.textContent('#undoB'), /#62/);
  await k.click('#undoB');
  const back = await until(async () => { const x = await read('orders/KX2'); return x.kitchen === 'new' ? x : null; });
  assert.equal(back.status, 'preparing', 'status back to preparing'); assert.equal(back.kitchenReadyAt, undefined);
  await k.waitForSelector('.card [data-done="KX2"]', { timeout: 15000 });
  // بعد «جاهز»، الكاشير يضيف صنف ← يرجع للمطبخ ويبين التعديل
  await k.click('.card [data-done="KX2"]');
  await until(async () => (await read('orders/KX2')).kitchen === 'ready');
  await c.waitForFunction(() => orders.some((o) => o.id === 'KX2' && o.kitchen === 'ready'), null, { timeout: 15000 });
  await c.evaluate(() => { window.ordEdit('KX2'); edState.work.push({ name: 'برغر دجاج', variant: 'عادي', qty: 1, price: 5000 }); window.edSave(); });
  await until(async () => (await read('orders/KX2')).kitchen === 'new');
  await k.waitForSelector('.card.edited:has([data-done="KX2"])', { timeout: 15000 });
  assert.match(await k.textContent('.card.edited:has([data-done="KX2"])'), /\+ انضاف 1× برغر دجاج \(عادي\)/);
  // الكاشير يلغي طلب الطاولة 5 ← بطاقة حمرة «ملغي» بالسبب، تبقى لحد «شفته» (حتى بعد إعادة التحميل)
  await write('orders/KX1', { status: 'cancelled', cancelledAt: Date.now(), cancelReason: 'الزبون غيّر رأيه', cancelledBy: 'المطعم' });
  await k.waitForSelector('.card.canc[data-id="KX1"]', { timeout: 15000 });
  const cc = await k.textContent('.card.canc[data-id="KX1"]');
  assert.match(cc, /ملغي — لا تحضّره/); assert.match(cc, /الزبون غيّر رأيه/);
  assert.equal(await k.locator('[data-done="KX1"]').count(), 0, 'no «ready» button on a cancelled order');
  await k.screenshot({ path: 'shots/kitchen-cancelled.png' });
  await k.reload();
  await k.waitForSelector('.card.canc[data-id="KX1"]', { timeout: 15000 });
  await k.click('.card.canc [data-ack-c="KX1"]');
  await k.waitForSelector('.card.canc', { state: 'detached', timeout: 8000 });
  await k.reload();
  await k.waitForSelector('.card [data-done="KX2"]', { timeout: 15000 });
  assert.equal(await k.locator('.card.canc').count(), 0, 'stays dismissed after reload');
  assert.equal(await k.locator('.card.edited').count(), 1, 'the unseen edit is still flagged after reload');
  assert.deepEqual(clean(k), []);
  await write('restaurants/RW', { features: { kitchen: false, kitchenSec: false }, svcOff: {} });
  await k.context().close(); await c.context().close();
});

test('welcome screen «النفق» on every entry: Sora3a logo + «سرعة / SORA3A» + app name (Arabic and English) in the app colour, star tunnel, no greeting or name; goes away by itself or on a tap', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await p.addInitScript(() => { window.SB_WELCOME_TEST = true; window.SB_HEALTH_TEST = true; });
  await p.goto(BASE + 'index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'scr@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('.sb-welcome', { timeout: 15000 });
  const w = await p.textContent('.sb-welcome');
  assert.match(w, /سرعة/); assert.match(w, /SORA3A/); assert.match(w, /الكاشير/); assert.match(w, /CASHIER/);
  assert.doesNotMatch(w, /صباح الخير|هلا بيك|مساء الخير|👋|مطعم الشاشة/, 'no greeting, no name');
  const look = await p.evaluate(() => { const t = document.querySelector('.sb-welcome .sb-w-t'), cv = document.querySelector('.sb-welcome canvas');
    return { tile: getComputedStyle(t).backgroundImage, cv: !!cv && cv.width > 0 && cv.height > 0, base: getComputedStyle(document.querySelector('.sb-welcome')).backgroundColor }; });
  assert.equal(look.base, 'rgb(3, 5, 7)', 'solid dark base — the page never shows through');
  assert.match(look.tile, /rgb\(43, 196, 106\)/, 'cashier green'); assert.ok(look.cv, 'star tunnel canvas');
  await p.waitForTimeout(1600);
  // النجوم تتحرك (مو صورة ثابتة) — نقارن لقطتين للـ canvas
  const px = () => p.evaluate(() => { const c = document.querySelector('.sb-welcome canvas'); return c ? c.toDataURL().length + ':' + c.toDataURL().slice(-60) : ''; });
  const a1 = await px(); await p.waitForTimeout(120); const a2 = await px();
  assert.notEqual(a1, a2, 'stars move');
  await p.screenshot({ path: 'shots/welcome-cashier.png' });
  await p.waitForSelector('.sb-welcome', { state: 'detached', timeout: 6000 });
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  // صحة الجهاز: سجل بساعة الجهاز والمتصفح (البرج يشوفه)
  const hl = await until(async () => (await list('devHealth', 'rid', 'RW')).find((x) => x.app === 'cashier'));
  assert.ok(hl, 'device health record written'); assert.equal(typeof hl.skewSec, 'number'); assert.equal(hl.ac, 'off'); assert.match(hl.browser, /Chrome|HeadlessChrome/);
  // شاشة «طلبك جاهز» بعد الربط
  const s = await page(B, { w: 1280, h: 720 });
  await s.addInitScript(() => { window.SB_WELCOME_TEST = true; });
  await pairScreen(s, BASE + 'screen.html', { name: 'شاشة الصالة' });
  await s.waitForSelector('.sb-welcome', { timeout: 15000 });
  const sw = await s.textContent('.sb-welcome');
  assert.match(sw, /سرعة/); assert.match(sw, /SORA3A/); assert.match(sw, /ORDER READY/);
  assert.match(await s.evaluate(() => getComputedStyle(document.querySelector('.sb-welcome .sb-w-t')).backgroundImage), /rgb\(250, 204, 21\)/, 'ready screen gold');
  await s.waitForTimeout(1700);
  await s.screenshot({ path: 'shots/welcome-screen.png' });
  await s.click('.sb-welcome');   // ضغطة تخفيها
  await s.waitForSelector('.sb-welcome', { state: 'detached', timeout: 3000 });
  await p.context().close(); await s.context().close();
});

test('who cancelled an order: the cashier name and email are saved and shown in the order details and timeline (cashier and admin panel)', async () => {
  const now = Date.now();
  await put('users/' + U.waiter, { role: 'cashier', restaurantId: 'RW', email: 'waiter@x.com', name: 'علي ضياء', perms: { cancel: true } });
  await put('orders/CN1', { restaurantId: 'RW', status: 'preparing', held: true, orderType: 'takeaway', ticketNo: 77, value: 6000, day: bagDay(now), createdAt: '20:00', createdAtMs: now - 60000, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1, price: 6000 }] });
  const c = await page(B, { w: 1280, h: 860 });
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'waiter@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForFunction(() => typeof window.ordCancel === 'function' && typeof orders !== 'undefined' && orders.some((o) => o.id === 'CN1'), null, { timeout: 20000 });
  await c.evaluate(() => window.ordCancel('CN1'));
  await c.waitForSelector('#acDlgOk', { state: 'visible', timeout: 8000 });
  await c.click('#acDlgOk');
  const o = await until(async () => { const x = await read('orders/CN1'); return x.status === 'cancelled' ? x : null; });
  assert.equal(o.cancelledByName, 'علي ضياء'); assert.equal(o.cancelledByEmail, 'waiter@x.com'); assert.equal(o.cancelledByUid, U.waiter);
  assert.match(o.timeline[o.timeline.length - 1].text, /بواسطة علي ضياء \(waiter@x\.com\)/);
  // لوحة الإدارة: تفاصيل الطلب تبين منو ألغاه
  const a = await page(B, { w: 1280, h: 900 });
  await a.goto('http://localhost:5050/sora3a-admin/index.html');
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await a.fill('#lEmail', 'scr@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#appPage', { state: 'visible', timeout: 15000 });
  await a.waitForFunction(() => typeof odHTML === 'function', null, { timeout: 10000 });
  const html = await a.evaluate((x) => odHTML({ id: 'CN1', ...x }), o);
  assert.match(html, /ألغاه: <b>علي ضياء<\/b> — <bdi>waiter@x\.com<\/bdi>/);
  // الطلبات الملغية + إكسل بكل التفاصيل لأي فترة
  await a.click('.dnav-btn[data-screen="scOrders"]').catch(() => a.evaluate(() => showScreen && showScreen('scOrders')));
  await a.waitForSelector('#scOrders.on', { timeout: 10000 });
  await a.selectOption('#ordRange', 'today');
  await a.click('#ordersFilter .filter-btn:has-text("ملغية")');
  await a.waitForFunction(() => /#CN1|CN1/i.test(document.getElementById('ordersList').textContent), null, { timeout: 15000 });
  const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 15000 }), a.click('#ordXlsBtn')]);
  const fp = '/tmp/claude-0/orders-export.xlsx'; await dl.saveAs(fp);
  const { execSync } = await import('node:child_process');
  const xml = execSync(`unzip -p ${fp} 'xl/*'`).toString();
  for (const w of ['علي ضياء', 'waiter@x.com', 'الطلبات', 'الأصناف', 'مراحل الطلب', 'سبب الإلغاء']) assert.ok(xml.includes(w), 'excel has ' + w);
  await c.context().close(); await a.context().close();
});

test('warehouse app (إدارة المخزن) is an on/off service: ON → the storekeeper device (linked by code) has stock, recipes and suppliers and the cashier loses them; OFF → they come back to the cashier', async () => {
  await write('restaurants/RW', { features: { store: true }, svcOff: {} });
  // جهاز أمين المخزن: رمز ← ربط ← يفتح المخزون بس
  const st = await page(B, { w: 1100, h: 800 });
  const sc = await pairScreen(st, BASE + 'index.html?store=1', { name: 'أبو حيدر' });
  assert.equal(sc.pair.kind, 'store');
  await st.waitForSelector('#appPage.show', { timeout: 20000 });
  await st.waitForFunction(() => /إدارة المخزن/.test(document.getElementById('restName').textContent), null, { timeout: 15000 });
  await st.waitForSelector('#acTabs .mtab', { timeout: 15000 });
  const tabs = await st.$$eval('#acTabs .mtab', (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(tabs.filter((x) => !/رجوع/.test(x)), ['📦 المخزون', '🧾 الوصفات والتكلفة', '🏭 الموردين']);
  assert.equal(await st.isVisible('.bnav .nb[data-tab="cashier"]'), false, 'no cashier screens on the storekeeper device');
  // يضيف مادة ← تنحفظ بحسابات المطعم
  await st.evaluate(() => window.matNew());
  await st.waitForSelector('#acf_name', { timeout: 8000 });
  await st.fill('#acf_name', 'لحم برغر'); await st.fill('#acf_qty', '12'); await st.fill('#acf_cost', '9000');
  await st.click('#acDlgOk');
  const accd = await until(async () => { const d = await read('accounting/RW'); return d && (d.materials || []).some((m) => m.name === 'لحم برغر') ? d : null; });
  assert.equal(accd.materials.find((m) => m.name === 'لحم برغر').qty, 12);
  assert.equal(await st.isVisible('#storeGate'), false, 'the link screen goes away after linking');
  assert.ok(await st.isVisible('#accScreen'), 'stock screen is visible');
  await st.screenshot({ path: 'shots/store-app.png' });
  // الكاشير: المخزون والوصفات والموردين انشالوا منه (المصروفات وديون الزبائن تبقى)
  const c = await page(B, { w: 1280, h: 860 });
  await posLogin(c);
  await c.evaluate(() => goTab('acc'));
  await c.waitForSelector('#acTabs .mtab', { timeout: 15000 });
  let ct = await c.$$eval('#acTabs .mtab', (b) => b.map((x) => x.textContent.trim()).join('|'));
  assert.ok(!/المخزون|الوصفات|الموردين/.test(ct), 'cashier: ' + ct); assert.match(ct, /المصروفات/);
  assert.match(await c.textContent('#acBody'), /صاروا بتطبيق «إدارة المخزن»/);
  // تنطفي الخدمة ← يرجعون للكاشير
  await write('restaurants/RW', { features: { store: false } });
  await c.waitForFunction(() => !window.storeSvcOn(), null, { timeout: 15000 });
  await c.evaluate(() => renderAcc());
  ct = await c.$$eval('#acTabs .mtab', (b) => b.map((x) => x.textContent.trim()).join('|'));
  assert.match(ct, /المخزون/); assert.match(ct, /الموردين/);
  assert.deepEqual(clean(st).filter((e) => !/permission|insufficient/i.test(e)), []);
  await st.context().close(); await c.context().close();
});

test('a device that still has an OLD copy of brand.js (no welcome/health) still logs into the admin panel and the cashier — it once signed the owner out silently', async () => {
  const { readFileSync } = await import('node:fs');
  const oldBrand = (repo) => readFileSync(new URL(`../../../../${repo}/brand.js`, import.meta.url), 'utf8').replace(' welcome: welcome,', '').replace(' health: health,', '');
  const a = await page(B, { w: 1280, h: 900 });
  await a.route('**/sora3a-admin/brand.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: oldBrand('sora3a-admin') }));
  await a.goto('http://localhost:5050/sora3a-admin/index.html');
  await a.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  assert.equal(await a.evaluate(() => typeof (window.SB && window.SB.health)), 'undefined', 'old brand.js loaded');
  await a.fill('#lEmail', 'scr@x.com'); await a.fill('#lPass', 'secret123'); await a.click('#lBtn');
  await a.waitForSelector('#appPage', { state: 'visible', timeout: 15000 });
  const c = await page(B, { w: 1280, h: 860 });
  await c.route('**/sora3a-rest2/brand.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: oldBrand('sora3a-rest2') }));
  await posLogin(c);
  assert.ok(await c.isVisible('#prods'), 'cashier opened');
  await a.context().close(); await c.context().close();
});

test('cashier main screen: «جاهز للزبون» strip — tap a number = served, «سلّم الكل» clears the rest; the ready screen hides a number by itself after the minutes set in settings; big order number with the code under it; easy edit (tap an item to add)', async () => {
  const now = Date.now(), today = bagDay();
  // طلبات الاختبارات السابقة: تنسلّم حتى ما تطلع بالشريط
  for (const o of await list('orders', 'restaurantId', 'RW')) if (!o.servedAtMs) await write('orders/' + o.id, { servedAtMs: now - 1000 });
  const base = { restaurantId: 'RW', status: 'delivered', value: 6000, day: today, createdAtMs: now - 5 * 60000, payment: { method: 'cash', cash: 6000, card: 0 }, orderType: 'takeaway' };
  await put('orders/R1', { ...base, kitchen: 'ready', kitchenReadyAt: now - 60000, ticketNo: 71, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1, price: 6000 }] });
  await put('orders/R2', { ...base, kitchen: 'ready', kitchenReadyAt: now - 50000, ticketNo: 72 });
  await put('orders/R3', { ...base, kitchen: 'ready', kitchenReadyAt: now - 40000, ticketNo: 73 });
  await put('orders/R4', { ...base, kitchen: 'ready', kitchenReadyAt: now - 6 * 60000, ticketNo: 74 });   // جاهز من ٦ دقايق
  await put('orders/R5', { restaurantId: 'RW', status: 'preparing', orderType: 'salon', tableNo: 3, ticketNo: 75, value: 6000, day: today, createdAtMs: now - 2 * 60000, items: [{ name: 'برغر لحم', variant: 'وحدة', qty: 1, price: 6000 }] });
  await write('restaurants/RW/settings/main', { screen: { salon: true, delivery: false, qr: true, keepMin: 10 } });
  const scr = await page(B, { w: 1280, h: 720 });
  await login(scr, BASE + 'screen.html', 'scr@x.com');
  const onScreen = (n) => scr.evaluate((n) => [...document.querySelectorAll('#ready .n, #prep .n')].some((e) => e.textContent.replace(/\D+/g, ' ').trim().split(' ')[0] === n), n);
  await until(async () => (await onScreen('71')) && (await onScreen('74')), 15000);
  assert.ok(await onScreen('74'), 'ready 6 min ago, limit 10 → still shown');
  const c = await page(B, { w: 1280, h: 860 });
  c.on('dialog', (d) => d.accept().catch(() => {}));
  await posLogin(c);
  // الشريط فوق السلة بأرقام كبيرة
  await c.waitForSelector('#readyBar .rb-n:has-text("71")', { timeout: 15000 });
  assert.equal(await c.locator('#readyBar .rb-n').count(), 4);
  await c.screenshot({ path: 'shots/cashier-ready-strip.png' });
  // ضغطة على الرقم = تم التسليم
  await c.click('#readyBar .rb-n:has-text("71")');
  await until(async () => !(await onScreen('71')), 10000);
  assert.equal(await onScreen('71'), false, 'tapped → gone from the TV');
  assert.ok((await read('orders/R1')).servedAtMs);
  // الإعدادات: يختفي وحده بعد ٥ دقايق ← رقم ٧٤ (جاهز من ٦) يطلع من الشاشة بدون أحد يدوس
  await c.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await c.waitForSelector('#stScrKeep');
  assert.equal(await c.inputValue('#stScrKeep'), '10');
  await c.fill('#stScrKeep', '5');
  await c.click('button >> text=حفظ الإعدادات');
  await until(async () => ((await read('restaurants/RW/settings/main')).screen || {}).keepMin === 5, 10000);
  await until(async () => !(await onScreen('74')), 12000);
  assert.equal(await onScreen('74'), false, 'older than 5 min → hidden by itself');
  assert.ok(await onScreen('72'));
  // «سلّم الكل» ← يسأل ← الكل يطلع من الشاشة
  await c.evaluate(() => goTab('cashier'));
  await c.waitForSelector('#readyBar .rb-all', { timeout: 10000 });
  await c.click('#readyBar .rb-all');
  await until(async () => !(await onScreen('72')) && !(await onScreen('73')), 10000);
  assert.equal(await onScreen('73'), false);
  assert.ok((await read('orders/R2')).servedAtMs && (await read('orders/R3')).servedAtMs);
  await c.waitForFunction(() => document.getElementById('readyBar').style.display === 'none', null, { timeout: 10000 });
  // قائمة الطلبات: رقم الطلب كبير والرمز صغير تحته
  await c.evaluate(() => goTab('orders'));
  const card = c.locator('.ocard', { has: c.locator('.oid', { hasText: /^R1$/ }) });
  await card.waitFor({ timeout: 10000 });
  assert.equal((await card.locator('.onum').textContent()).trim(), '#71');
  assert.ok(await c.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ocard .onum')).fontSize) >= 22));
  await c.screenshot({ path: 'shots/cashier-order-number.png' });
  // التعديل الأسهل: فروع + بحث، دوس الصنف ينضاف، والحجم يطلع أزرار
  await c.evaluate(() => ordEdit('R5'));
  await c.waitForSelector('#edGrid .ed-it', { timeout: 10000 });
  assert.match(await c.textContent('#viewTitle'), /#75/, 'edit title shows the order number');
  await c.click('#edGrid .ed-it:has-text("برغر لحم")');
  await c.waitForFunction(() => /×?\s*2|٢/.test([...document.querySelectorAll('.ac-line.ed-line-new')].map((e) => e.textContent).join('')), null, { timeout: 5000 });
  await c.click('#edGrid .ed-it:has-text("برغر دجاج")');
  await c.click('.ed-vars .ed-var:has-text("دبل")');
  await c.waitForSelector('.ac-line.ed-line-new:has-text("دبل")');
  await c.fill('#edQ', 'لبن');
  await c.waitForSelector('#edGrid .ed-it:has-text("لبن")');
  assert.equal(await c.locator('#edGrid .ed-it').count(), 1, 'search shows only matches');
  await c.click('#edGrid .ed-it:has-text("لبن")');
  await c.screenshot({ path: 'shots/cashier-edit-grid.png' });
  await c.evaluate(() => edSave());
  const r1 = await until(async () => { const o = await read('orders/R5'); return (o.items || []).length === 3 ? o : null; }, 10000);
  assert.ok(r1, 'saved with the added items');
  assert.equal(r1.items.find((i) => i.name === 'برغر لحم').qty, 2);
  assert.ok(r1.items.find((i) => i.name === 'برغر دجاج' && i.variant === 'دبل'));
  assert.ok(r1.items.find((i) => i.name === 'لبن'));
  for (const x of [scr, c]) { assert.deepEqual(clean(x), []); await x.context().close(); }
});
