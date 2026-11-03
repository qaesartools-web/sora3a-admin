// تطبيق الويتر بدون نت: الطلب يروح للكاشير على الواي فاي، الكاشير يقبله ← المطبخ، والويتر يشوف الحالة.
//  يرجع النت: كلشي يترفع مرة وحدة بس — بدون طلب مكرر بالمطبخ، وبدون ما ترجع حالة لورا
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

const require = createRequire(import.meta.url);
const { createHub, createClient } = require(path.join(ROOTS['sora3a-rest2'], 'desktop/lan.js'));
const UDP = 43000 + Math.floor(Math.random() * 2500);
const BASE = 'http://localhost:5050/sora3a-rest2/';

let srv, E, B, own, hub;
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const put = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); }); };
const list = async (col) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where('restaurantId', '==', 'RWL'))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext|wakeLock|speech|offline|unavailable|Could not reach|ERR_INTERNET|net::|WebChannel|Firestore \(|permission/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  own = await signUp('wl@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RWL', email: 'wl@x.com', name: 'أبو علي' });
    await setDoc(doc(db, 'restaurants/RWL'), { name: 'مطعم الويتر', userId: own, active: true, features: { kitchen: true, waiter: true } });
    await setDoc(doc(db, 'restaurants/RWL/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'سندويش', emoji: '🥙', items: [{ name: 'فلافل', variants: [{ name: 'وحدة', price: 1500 }] }, { name: 'شاورما', variants: [{ name: 'وحدة', price: 3000 }] }] }] });
    await setDoc(doc(db, 'restaurants/RWL/settings/main'), { receiptTitle: 'فلافل الويتر', tables: 6, updatedAtMs: 1 });
  });
});
after(async () => { hub?.stop(); await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

// الصفحة تشوف window.SoraLan مثل التطبيق، وورا الجسر نفس كود الشبكة الحقيقي
async function wire(p, node, role) {
  await p.exposeBinding('__lan', async (_s, m, a) => {
    if (m === 'start') { const st = await node.start({ ...a[0], dev: a[0].dev || role + '-dev' }); return st || { on: true, rid: a[0].rid, peers: [] }; }
    if (m === 'status') return node.status ? node.status() : { on: true, peers: node.hubs().filter((h) => h.on) };
    if (m === 'send') { node.send(a[0], a[1]); return true; }
    if (m === 'broadcast') { node.broadcast(a[0]); return true; }
    if (m === 'stop') { node.stop(); return true; }
    return null;
  });
  await p.addInitScript((r) => {
    window.__lanCbs = [];
    window.SoraLan = { role: r, start: (c) => window.__lan('start', [c || {}]), stop: () => window.__lan('stop', []), status: () => window.__lan('status', []),
      send: (to, m) => { window.__lan('send', [String(to || '*'), m]); }, broadcast: (m) => { window.__lan('broadcast', [m]); }, on: (cb) => { window.__lanCbs.push(cb); } };
  }, role);
  ['join', 'leave', 'msg', 'ev', 'status'].forEach((t) => node.on(t, (v) => { p.evaluate((ev) => (window.__lanCbs || []).forEach((cb) => cb(ev)), { ...v, t }).catch(() => {}); }));
}
async function offline(p) {
  const ctx = p.context();
  await ctx.route(/:(8080|9099)\//, (r) => r.abort());
  await ctx.setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event('offline')));
}
async function online(p) {
  const ctx = p.context();
  await ctx.unroute(/:(8080|9099)\//); await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
}
async function pair(p, url, kind, name) {
  await p.goto(url);
  await p.waitForSelector('#pairCode', { timeout: 15000 });
  const code = (await p.textContent('#pairCode')).trim();
  const pr = await until(() => read('screenPairs/' + code));
  await put('screens/' + pr.uid, { restaurantId: 'RWL', restName: 'مطعم الويتر', code, kind, name, pairedBy: 'hq', approved: true, atMs: Date.now() });
  return pr.uid;
}
// الويتر: طاولة ← أصناف ← إرسال
async function order(w, t, items) {
  await w.click('.tab[data-tab="tables"]');
  await w.click(`.tb[data-t="${t}"]`);
  await w.waitForSelector('.it');
  for (const it of items) await w.click(`.it >> text=${it}`);
  await w.click('#barBtn'); await w.waitForSelector('#cartSh.on');
  await w.click('#cSend');
  await w.waitForSelector('#vOrders:not([hidden])', { timeout: 8000 });
}
const stOf = (w, t) => w.evaluate((tt) => [...document.querySelectorAll('#ords .od')].filter((e) => e.querySelector('.tn').textContent.includes(tt)).map((e) => e.querySelector('.st').textContent), t);

test('waiter with no internet: the order reaches the cashier over WiFi, the kitchen gets it, the waiter sees each stage, and it all syncs once when the internet is back', async () => {
  // ── الكاشير (صاحب المطعم) = المركز
  hub = createHub({ udpPort: UDP, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const c = await page(B, { w: 1280, h: 860 });
  await wire(c, hub, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'wl@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  const key = (await until(() => read('restaurants/RWL/lan/key')))?.key;
  assert.match(key || '', /^[0-9a-f]{64}$/);
  await until(() => hub.status().on);

  // ── شاشة المجهز
  const kc = createClient({ role: 'kitchen', udpPort: UDP, targets: ['127.0.0.1'] });
  const k = await page(B, { w: 1100, h: 800 });
  await wire(k, kc, 'kitchen');
  await pair(k, BASE + 'kitchen.html', 'kitchen', 'المجهز');
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });

  // ── تلفون الويتر (تطبيق «سرعة - الويتر»): ينربط برمز، ويتصل بالكاشير على الواي فاي
  const wc = createClient({ role: 'waiter', udpPort: UDP, targets: ['127.0.0.1'] });
  const w = await page(B, { w: 390, h: 844 });
  await wire(w, wc, 'waiter');
  const wuid = await pair(w, BASE + 'waiter.html', 'waiter', 'علي');
  await w.waitForSelector('.tb', { timeout: 15000 });
  assert.ok(await until(() => hub.status().peers.some((x) => x.role === 'waiter')), 'the waiter phone connected to the cashier');
  assert.ok(await until(() => hub.status().peers.some((x) => x.role === 'kitchen')));
  await c.waitForTimeout(1500);

  // ── ينقطع النت (الواي فاي باقي)
  await offline(c); await offline(k); await offline(w);
  await w.waitForSelector('#net:not([hidden])', { timeout: 20000 });
  await w.waitForFunction(() => /على الواي فاي/.test(document.getElementById('net').textContent), null, { timeout: 15000 });

  // طلب طاولة 3 ← يوصل للكاشير فوراً (بدون انتظار)
  const t0 = Date.now();
  await order(w, '3', ['فلافل', 'فلافل', 'شاورما']);
  assert.ok(Date.now() - t0 < 6000, 'sending did not hang without internet');
  await c.waitForSelector('#webBox .web-card:has-text("علي")', { timeout: 10000 });
  assert.match(await c.textContent('#webBox'), /طاولة 3/);
  await w.waitForFunction(() => /عند الكاشير/.test(document.querySelector('#ords .od .st').textContent));
  const id1 = await c.evaluate(() => document.querySelector('#webBox .call-go').getAttribute('onclick').match(/webAccept\('([^']+)'/)[1]);

  // الكاشير يقبل بدون نت ← المطبخ يشوفه ← الويتر يشوف «يتحضر»
  await c.click('#webBox .call-go');
  const oid = await (await c.waitForFunction((wid) => { const o = orders.find((x) => x.webId === wid); return o && o.id; }, id1, { timeout: 10000 })).jsonValue();
  await k.waitForSelector(`[data-done="${oid}"]`, { timeout: 10000 });
  await w.waitForFunction(() => /يتحضر/.test(document.querySelector('#ords .od .st').textContent), null, { timeout: 10000 });
  const tk = await c.evaluate((id) => String(orders.find((o) => o.id === id).salonNum || orders.find((o) => o.id === id).ticketNo), oid);
  assert.ok(tk);

  // المطبخ يضغط «جاهز» ← الويتر يشوف «جاهز — وصّله»
  await k.click(`[data-done="${oid}"]`);
  await w.waitForSelector('#ords .od.ready', { timeout: 10000 });
  assert.equal(await w.textContent('#rdBadge'), '1');

  // طلب ثاني (طاولة 4) ← الكاشير يرفضه ← الويتر يشوف «انرفض» والسبب
  await order(w, '4', ['شاورما']);
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 4")', { timeout: 10000 });
  const id2 = await c.evaluate(() => document.querySelector('#webBox .web-card button:not(.call-go)').getAttribute('onclick').match(/webReject\('([^']+)'/)[1]);
  await c.click('#webBox .web-card button:not(.call-go)');
  await c.fill('#acf_reason', 'الشاورما خلصت'); await c.click('#acDlgOk');
  await w.waitForFunction(() => [...document.querySelectorAll('#ords .od')].some((e) => /انرفض/.test(e.textContent) && /الشاورما خلصت/.test(e.textContent)), null, { timeout: 10000 });

  // طلب ثالث (طاولة 5) ← كاشير ثاني على نفس الواي فاي قبله ← يختفي من هذا الكاشير فوراً
  await order(w, '5', ['فلافل']);
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 5")', { timeout: 10000 });
  const id3 = await c.evaluate(() => document.querySelector('#webBox .call-go').getAttribute('onclick').match(/webAccept\('([^']+)'/)[1]);
  const other = createClient({ role: 'line', udpPort: UDP, targets: ['127.0.0.1'] });
  await other.start({ rid: 'RWL', key, dev: 'cashier-2', name: 'كاشير ٢' });
  await until(() => other.hubs().some((h) => h.on));
  other.broadcast({ t: 'wtaken', id: id3 });
  await c.waitForSelector('#webBox .web-card', { state: 'detached', timeout: 8000 });
  other.stop();

  assert.equal((await list('orders')).length, 0, 'nothing reached the server yet');
  assert.equal((await list('webOrders')).length, 0);

  // ── يرجع النت: كلشي يترفع، مرة وحدة
  await online(c); await online(k); await online(w);
  const w1 = await until(async () => { const x = (await list('webOrders')).find((d) => d.id === id1); return x && x.status === 'accepted' && x.orderId && x.stage === 'ready' ? x : null; }, 30000);
  assert.ok(w1, 'order 1 reached the server as accepted and ready');
  assert.equal(w1.waiterUid, wuid); assert.equal(w1.table, '3'); assert.equal(w1.orderId, oid);
  const w2 = await until(async () => { const x = (await list('webOrders')).find((d) => d.id === id2); return x && x.status === 'rejected' ? x : null; }, 20000);
  assert.equal(w2.reason, 'الشاورما خلصت');
  assert.ok(await until(async () => (await list('webOrders')).some((d) => d.id === id3)), 'order 3 reached the server too');
  const ko = await until(async () => { const o = (await list('orders')).find((x) => x.id === oid); return o && o.kitchen === 'ready' ? o : null; }, 20000);
  assert.ok(ko, 'the kitchen «ready» reached the server');
  await c.waitForTimeout(3000);
  const all = await list('orders');
  assert.equal(all.filter((o) => o.webId === id1).length, 1, 'one kitchen order for the waiter order — no duplicate');
  assert.equal(all.filter((o) => o.webId === id2 || o.webId === id3).length, 0);
  assert.equal((await list('webOrders')).length, 3);
  // ما ترجع بطاقات بالكاشير (اللي انقبل بكاشير ثاني ما يطلع مرة ثانية)، والطلب الجاهز ما يرجع للمطبخ
  assert.equal(await c.locator('#webBox .web-card').count(), 0);
  assert.equal(await k.locator(`[data-done="${oid}"]`).count(), 0);
  // الويتر: ٣ طلبات بس (بدون تكرار)، والجاهز باقي جاهز
  await w.waitForSelector('#net', { state: 'hidden', timeout: 30000 });
  assert.equal(await w.locator('#ords .od').count(), 3);
  assert.ok((await stOf(w, '3'))[0].includes('جاهز'));
  assert.ok((await stOf(w, '4'))[0].includes('انرفض'));
  await w.screenshot({ path: 'shots/waiter-lan-synced.png' });
  assert.deepEqual(clean(c), []); assert.deepEqual(clean(k), []); assert.deepEqual(clean(w), []);

  // ── الويتر بدون نت وماكو كاشير على الواي فاي: الطلب ينحفظ بالتلفون، ومن يرجع النت يوصل للكاشير مرة وحدة
  wc.stop();
  await offline(w);
  await w.waitForSelector('#net:not([hidden])', { timeout: 20000 });
  const t1 = Date.now();
  await order(w, '6', ['شاورما']);
  assert.ok(Date.now() - t1 < 8000, 'the order was saved on the phone without hanging');
  await w.waitForFunction(() => /محفوظ بالتلفون/.test(document.getElementById('net').textContent), null, { timeout: 10000 });
  assert.equal((await list('webOrders')).length, 3, 'not on the server yet');
  await online(w);
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 6")', { timeout: 30000 });
  await c.waitForTimeout(1500);
  assert.equal(await c.locator('#webBox .web-card').count(), 1);
  assert.equal((await list('webOrders')).filter((d) => d.table === '6').length, 1);

  kc.stop();
  await c.context().close(); await k.context().close(); await w.context().close();
});


test('waiter phone HAS internet (mobile data) but the cashier has none: the new order still reaches the cashier over WiFi — once the phone joins the WiFi, no duplicate later', async () => {
  const UDP2 = UDP + 1;
  const hub2 = createHub({ udpPort: UDP2, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const c = await page(B, { w: 1280, h: 860 });
  await wire(c, hub2, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'wl@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  const key = (await until(() => read('restaurants/RWL/lan/key')))?.key;
  await until(() => hub2.status().on);
  // تلفون الويتر (التطبيق): ينربط، والكاشير مو متصل بعد على الواي فاي
  const wc = createClient({ role: 'waiter', udpPort: UDP2, targets: ['127.0.0.1'] });
  const w = await page(B, { w: 390, h: 844 });
  await wire(w, wc, 'waiter');
  const wuid = await pair(w, BASE + 'waiter.html', 'waiter', 'حسن');
  await w.waitForSelector('.tb', { timeout: 15000 });
  await until(() => hub2.status().peers.some((x) => x.role === 'waiter'));
  await w.waitForFunction(() => /الكاشير متصل على الواي فاي/.test(document.getElementById('lanSt').textContent), null, { timeout: 10000 });
  // نت الكاشير ينقطع، والتلفون يطلع من الواي فاي (بس عنده نت من الموبايل)
  await offline(c);
  wc.stop();
  await w.waitForFunction(() => /مو متصل/.test(document.getElementById('lanSt').textContent), null, { timeout: 15000 });
  await order(w, '2', ['فلافل']);
  const wo = await until(async () => (await list('webOrders')).find((d) => d.table === '2' && d.waiterUid === wuid));
  assert.ok(wo, 'the order reached the server from the phone internet');
  await c.waitForTimeout(2000);
  assert.equal(await c.locator('#webBox .web-card:has-text("طاولة 2")').count(), 0, 'the cashier (no internet) does not have it yet');
  // التلفون يرجع للواي فاي ← الطلب يوصل للكاشير مباشرة، بدون ما ينتظر نت الكاشير
  await wc.start({ rid: 'RWL', key, dev: 'waiter-dev', name: '🧑‍🍳 حسن' });
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 2")', { timeout: 30000 });
  await w.waitForFunction(() => /الكاشير متصل على الواي فاي/.test(document.getElementById('lanSt').textContent), null, { timeout: 10000 });
  await w.screenshot({ path: 'shots/waiter-lan-chip.png' });
  // الكاشير يقبله بدون نت ← من يرجع النت: طلب واحد بس بالمطبخ والسيرفر
  await c.click('#webBox .web-card:has-text("طاولة 2") .call-go');
  await c.waitForFunction((id) => orders.some((o) => o.webId === id), wo.id, { timeout: 10000 });
  await online(c);
  const done = await until(async () => { const x = (await list('webOrders')).find((d) => d.id === wo.id); return x && x.status === 'accepted' && x.orderId ? x : null; }, 30000);
  assert.ok(done, 'accepted on the server once the cashier internet is back');
  await c.waitForTimeout(3000);
  assert.equal((await list('orders')).filter((o) => o.webId === wo.id).length, 1, 'one kitchen order — no duplicate');
  assert.equal((await list('webOrders')).filter((d) => d.table === '2' && d.waiterUid === wuid).length, 1);
  assert.equal(await c.locator('#webBox .web-card:has-text("طاولة 2")').count(), 0, 'its card is gone after accepting');
  wc.stop(); hub2.stop();
  await c.context().close(); await w.context().close();
});

// الويتر على طلبه: تعديل (المطبخ يشوف شنو انضاف ومنو عدّل)، إلغاء (قبل وبعد القبول)، «تم التقديم» بعد ما يجهز، والمبلغ الكلي
//  بالنت، وبدون نت على الواي فاي — والنتيجة تترفع للسيرفر مرة وحدة
test('waiter edits, cancels and completes (served) his orders — online and over WiFi with no internet; the kitchen sees what was added and by whom; totals are shown', async () => {
  const UDP3 = UDP + 2;
  const hub3 = createHub({ udpPort: UDP3, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const c = await page(B, { w: 1280, h: 860 });
  await wire(c, hub3, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'wl@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  await until(() => hub3.status().on);
  const kc = createClient({ role: 'kitchen', udpPort: UDP3, targets: ['127.0.0.1'] });
  const k = await page(B, { w: 1100, h: 800 });
  await wire(k, kc, 'kitchen');
  await pair(k, BASE + 'kitchen.html', 'kitchen', 'المجهز');
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  const wc = createClient({ role: 'waiter', udpPort: UDP3, targets: ['127.0.0.1'] });
  const w = await page(B, { w: 390, h: 844 });
  await wire(w, wc, 'waiter');
  const wuid = await pair(w, BASE + 'waiter.html', 'waiter', 'سجاد');
  await w.waitForSelector('.tb', { timeout: 15000 });
  await until(() => hub3.status().peers.some((x) => x.role === 'waiter') && hub3.status().peers.some((x) => x.role === 'kitchen'));
  const card = (t) => w.locator('#ords .od').filter({ has: w.locator('.tn', { hasText: '🪑 ' + t }) }).first();
  const webOf = async (t) => (await list('webOrders')).find((d) => d.table === t && d.waiterUid === wuid);
  const accept = async (t) => {
    await c.waitForSelector(`#webBox .web-card:has-text("طاولة ${t}")`, { timeout: 15000 });
    await c.click(`#webBox .web-card:has-text("طاولة ${t}") .call-go`);
    const id = (await until(() => webOf(t))).id;
    return (await c.waitForFunction((wid) => { const o = orders.find((x) => x.webId === wid); return o && o.id; }, id, { timeout: 10000 })).jsonValue();
  };

  // ── بالنت: طلب طاولة 1 (فلافل) ← الكاشير يقبله ← الويتر يعدّله ويضيف شاورما
  await order(w, '1', ['فلافل']);
  const o1 = await accept('1');
  await k.waitForSelector(`.card[data-id="${o1}"]`, { timeout: 10000 });
  await card('1').locator('.st', { hasText: 'يتحضر' }).waitFor({ timeout: 10000 });
  assert.match(await card('1').textContent(), /1,500 د\.ع/, 'the order shows its amount');
  await card('1').locator('[data-act="edit"]').click();
  await w.waitForSelector('#vMenu:not([hidden])');
  assert.match(await w.textContent('#curTable'), /تعديل طلب طاولة 1/);
  await w.click('.it >> text=شاورما');
  await w.click('#barBtn'); await w.waitForSelector('#cartSh.on');
  const sh = await w.textContent('#cartSh');
  assert.match(sh, /المبلغ قبل التعديل\s*1,500/); assert.match(sh, /المبلغ بعد التعديل\s*4,500/);
  assert.match(await w.textContent('#cSend'), /حفظ التعديل/);
  await w.screenshot({ path: 'shots/waiter-edit-sheet.png' });
  await w.click('#cSend');
  await w.waitForSelector('#vOrders:not([hidden])');
  // الكاشير يطبّقه وحده ← المطبخ يشوف «انعدل الطلب — سجاد» و«+ انضاف 1× شاورما»
  const kc1 = k.locator(`.card[data-id="${o1}"]`);
  await kc1.locator('.edit-h').waitFor({ timeout: 15000 });
  const kt = await kc1.textContent();
  assert.match(kt, /انعدل الطلب/); assert.match(kt, /سجاد/); assert.match(kt, /\+ انضاف 1× شاورما/);
  const co1 = await c.evaluate((id) => { const o = orders.find((x) => x.id === id); return { v: o.value, n: o.items.map((i) => i.name + '×' + i.qty).sort().join(',') }; }, o1);
  assert.equal(co1.v, 4500); assert.equal(co1.n, 'شاورما×1,فلافل×1');
  const wo1 = await until(async () => { const x = await webOf('1'); return x && x.reqDone && x.reqDone === x.req.id ? x : null; });
  assert.equal(wo1.reqRes, 'ok'); assert.equal(wo1.total, 4500);
  await card('1').locator('.od-ok').waitFor({ timeout: 10000 });
  assert.match(await card('1').textContent(), /4,500 د\.ع/, 'the new total');
  await w.screenshot({ path: 'shots/waiter-edit-done.png' });
  // جدول الطاولات: مبلغ الطاولة
  await w.click('.tab[data-tab="tables"]');
  assert.match(await w.textContent('.tb[data-t="1"]'), /4,500/);
  await w.click('.tab[data-tab="orders"]');

  // ── جاهز ← «تم التقديم» (الإلغاء ما يطلع بعد ما يجهز)
  await k.click(`[data-done="${o1}"]`);
  await card('1').locator('.st', { hasText: 'جاهز' }).waitFor({ timeout: 10000 });
  assert.equal(await card('1').locator('[data-act="cancel"]').count(), 0, 'no cancel once ready');
  await card('1').locator('[data-act="served"]').click();
  await card('1').locator('.st', { hasText: 'تم' }).waitFor({ timeout: 15000 });
  assert.ok(await until(async () => (await read('orders/' + o1))?.servedAtMs), 'served time saved on the order');

  // ── طلب طاولة 2 ما انقبل بعد ← الويتر يلغيه ← يختفي من الكاشير
  await order(w, '2', ['شاورما']);
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 2")', { timeout: 15000 });
  await card('2').locator('[data-act="cancel"]').click();
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 2")', { state: 'detached', timeout: 15000 });
  await card('2').locator('.st', { hasText: 'انلغى' }).waitFor({ timeout: 10000 });
  const wo2 = await until(async () => { const x = await webOf('2'); return x && x.status === 'rejected' ? x : null; });
  assert.equal(wo2.reason, 'ألغاه الويتر');
  assert.equal((await list('orders')).filter((o) => o.webId === wo2.id).length, 0, 'never reached the kitchen');

  // ── طلب طاولة 3 انقبل وبالمطبخ ← الويتر يلغيه ← المطبخ يشوف «ملغي»، ومنو ألغاه بالطلب
  await order(w, '3', ['فلافل']);
  const o3 = await accept('3');
  await k.waitForSelector(`.card[data-id="${o3}"]`, { timeout: 10000 });
  await card('3').locator('.st', { hasText: 'يتحضر' }).waitFor({ timeout: 10000 });
  await card('3').locator('[data-act="cancel"]').click();
  await k.waitForSelector(`.card.canc[data-id="${o3}"]`, { timeout: 15000 });
  const x3 = await until(async () => { const o = await read('orders/' + o3); return o && o.status === 'cancelled' ? o : null; });
  assert.equal(x3.cancelledByName, 'سجاد'); assert.equal(x3.cancelledBy, 'الويتر');
  await card('3').locator('.st', { hasText: 'انلغى' }).waitFor({ timeout: 10000 });
  await w.screenshot({ path: 'shots/waiter-requests.png' });

  // ── بدون نت (الواي فاي باقي): طلب طاولة 4 ← يقبله الكاشير ← الويتر يعدّله (فلافل ثاني) ← المطبخ يشوفه، والويتر يشوف النتيجة
  await offline(c); await offline(k); await offline(w);
  await w.waitForFunction(() => /على الواي فاي/.test(document.getElementById('net').textContent), null, { timeout: 20000 });
  await order(w, '4', ['شاورما']);
  await c.waitForSelector('#webBox .web-card:has-text("طاولة 4")', { timeout: 10000 });
  const id4 = await c.evaluate(() => [...document.querySelectorAll('#webBox .web-card')].find((e) => /طاولة 4/.test(e.textContent)).querySelector('.call-go').getAttribute('onclick').match(/webAccept\('([^']+)'/)[1]);
  await c.click('#webBox .web-card:has-text("طاولة 4") .call-go');
  const o4 = await (await c.waitForFunction((wid) => { const o = orders.find((x) => x.webId === wid); return o && o.id; }, id4, { timeout: 10000 })).jsonValue();
  await k.waitForSelector(`.card[data-id="${o4}"]`, { timeout: 10000 });
  await card('4').locator('.st', { hasText: 'يتحضر' }).waitFor({ timeout: 10000 });
  await card('4').locator('[data-act="edit"]').click();
  await w.click('.it >> text=فلافل');
  await w.click('#barBtn'); await w.waitForSelector('#cartSh.on');
  await w.click('#cSend');
  await k.locator(`.card[data-id="${o4}"] .edit-h`).waitFor({ timeout: 15000 });
  assert.match(await k.textContent(`.card[data-id="${o4}"]`), /\+ انضاف 1× فلافل/);
  await card('4').locator('.od-ok').waitFor({ timeout: 15000 });
  assert.match(await card('4').textContent(), /4,500 د\.ع/);
  assert.equal(await c.evaluate((id) => orders.find((x) => x.id === id).value, o4), 4500);
  assert.equal((await list('orders')).filter((o) => o.webId === id4).length, 0, 'nothing on the server yet');

  // ── يرجع النت: كلشي يترفع مرة وحدة
  await online(c); await online(k); await online(w);
  const s4 = await until(async () => { const o = (await list('orders')).find((x) => x.id === o4); return o && o.value === 4500 && (o.kEdits || []).length ? o : null; }, 30000);
  assert.ok(s4, 'the edited order reached the server');
  const wo4 = await until(async () => { const x = await read('webOrders/' + id4); return x && x.reqDone && x.req && x.reqDone === x.req.id && x.total === 4500 ? x : null; }, 30000);
  assert.ok(wo4, 'the request and its result reached the server');
  await c.waitForTimeout(3000);
  assert.equal((await list('orders')).filter((o) => o.webId === id4).length, 1, 'one kitchen order — no duplicate');
  assert.equal((await read('orders/' + o4)).kEdits.length, 1, 'the edit applied once');
  assert.deepEqual(clean(c), []); assert.deepEqual(clean(k), []); assert.deepEqual(clean(w), []);
  wc.stop(); kc.stop(); hub3.stop();
  await c.context().close(); await k.context().close(); await w.context().close();
});

// شاشة «طلبك جاهز» (تطبيق التلفزيون) واتصالها بالسيرفر يعلك بنص الشغل: المجهز يخلّص كل الطلبات ← كلها تروح لـ«جاهز»
//  (قبل: الطلبات اللي جانت قبل ما يعلك تبقى «قيد التحضير» من نسخة السيرفر القديمة، والجديدة بس تتحدث من الواي فاي)
test('ready screen whose server connection gets stuck mid-service: all orders the kitchen finishes move to «ready» (the cashier copy over WiFi wins) and when the server copy stays behind, the screen reconnects then reloads by itself', async () => {
  const UDP4 = UDP + 3;
  const hub4 = createHub({ udpPort: UDP4, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const c = await page(B, { w: 1280, h: 860 });
  await wire(c, hub4, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'wl@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  await until(() => hub4.status().on);
  // الطلبات القديمة من الاختبارات اللي قبل تخلص أول
  await c.evaluate(() => orders.filter((o) => o.kitchen === 'new').forEach((o) => kdsDone(o.id)));
  const sc = createClient({ role: 'screen', udpPort: UDP4, targets: ['127.0.0.1'] });
  const s = await page(B, { w: 1280, h: 720 });
  await s.addInitScript(() => { window.__stMs = 4000; window.__viewMs = 1000; window.__lgMs = 600000; });   // أوقات قصيرة بالاختبار
  await wire(s, sc, 'screen');
  await pair(s, BASE + 'screen.html', 'ready', 'طلبك جاهز');
  await s.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  assert.ok(await until(() => hub4.status().peers.some((x) => x.role === 'screen')), 'ready screen connected to the cashier');
  // ٤ طلبات سفري «قيد التحضير»
  const ids = [];
  for (let i = 0; i < 4; i++) {
    await c.click('#prods .prod >> nth=0');
    await c.click('#sendBtn'); await c.keyboard.press('3'); await c.click('#acDlgOk');
    ids.push(await (await c.waitForFunction((n) => { const l = orders.filter((o) => o.held && o.kitchen === 'new'); return l.length > n && l[0].id; }, i, { timeout: 8000 })).jsonValue());
  }
  await s.waitForFunction(() => document.getElementById('ppN').textContent === '4', null, { timeout: 15000 });
  await s.waitForTimeout(1500);
  // ── اتصال الشاشة بالسيرفر يعلك (الواي فاي ويا الكاشير شغّال)
  // المكتبة «تعلك» وهي تحسب نفسها متصلة: التحديثات من السيرفر توقف توصل (مثل التلفزيون)
  await s.evaluate(() => { window.__mark = 1; window.__fsFreeze = true; });
  // المجهز يخلّص الكل
  await c.evaluate(() => orders.filter((o) => o.held && o.kitchen === 'new').forEach((o) => kdsDone(o.id)));
  // كلها تروح لـ«جاهز» على الشاشة (نسخة الكاشير على الواي فاي أحدث من نسخة السيرفر العالقة)
  await s.waitForFunction(() => document.getElementById('ppN').textContent === '0' && +document.getElementById('rdN').textContent >= 4, null, { timeout: 15000 });
  // ونسخة السيرفر بقت متأخرة عن الكاشير ← الشاشة تعيد الاتصال، وإذا بقت ← تحمّل نفسها من جديد
  await s.waitForFunction(() => !window.__mark, null, { timeout: 30000 });
  await s.waitForSelector('#scr:not([hidden])', { timeout: 30000 });
  await s.waitForFunction(() => document.getElementById('ppN').textContent === '0' && +document.getElementById('rdN').textContent >= 4, null, { timeout: 30000 });
  assert.equal(await s.locator('#pairCode').count(), 0, 'still linked');
  sc.stop(); hub4.stop();
  await c.context().close(); await s.context().close();
});
