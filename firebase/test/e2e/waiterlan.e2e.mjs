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

