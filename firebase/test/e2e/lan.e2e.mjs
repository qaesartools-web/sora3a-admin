// شبكة المطعم (بنت أو بدون نت): الكاشير «مركز» على الواي فاي — شاشة المجهز وشاشة «طلبك جاهز» وتلفون الخط يتصلون بيه مباشرة
//  نفس كود البرنامج الحقيقي (desktop/lan.js) بين الصفحات: الكاشير = المركز، والشاشات = أجهزة متصلة. النت ينقطع والشغل يكمل
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

const require = createRequire(import.meta.url);
const { createHub, createClient } = require(path.join(ROOTS['sora3a-rest2'], 'desktop/lan.js'));
const UDP = 46000 + Math.floor(Math.random() * 3000);
const BASE = 'http://localhost:5050/sora3a-rest2/';

let srv, E, B, own, hub;
const sent = [];   // كل اللي أرسله الكاشير للشاشات (نتأكد ما بيه أرقام الزبائن)
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const put = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); }); };
const ordersOf = async (rid) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), 'orders'), where('restaurantId', '==', rid))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext|wakeLock|speech|offline|unavailable|Could not reach|ERR_INTERNET|net::|WebChannel|Firestore \(/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  own = await signUp('lan@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RL', email: 'lan@x.com', name: 'أبو علي' });
    await setDoc(doc(db, 'restaurants/RL'), { name: 'مطعم الشبكة', userId: own, active: true, features: { kitchen: true } });
    await setDoc(doc(db, 'restaurants/RL/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'سندويش', emoji: '🥙', items: [{ name: 'فلافل', variants: [{ name: 'وحدة', price: 1500 }] }] }] });
    await setDoc(doc(db, 'restaurants/RL/settings/main'), { receiptTitle: 'فلافل الشبكة', updatedAtMs: 1 });
  });
});
after(async () => { hub?.stop(); await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

// الصفحة تشوف window.SoraLan مثل التطبيق، وورا الجسر نفس كود الشبكة الحقيقي (TCP/UDP على 127.0.0.1)
async function wire(p, node, role) {
  await p.exposeBinding('__lan', async (_s, m, a) => {
    if (m === 'start') { const st = await node.start({ ...a[0], dev: a[0].dev || role + '-dev' }); return st || { on: true, rid: a[0].rid, peers: [] }; }
    if (m === 'status') return node.status ? node.status() : { on: true, peers: node.hubs().filter((h) => h.on) };
    if (m === 'send') { if (role === 'hub') sent.push(a[1]); node.send(a[0], a[1]); return true; }
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
// نفس الشي بس الصفحة نفسها تنفتح (بالتطبيق الحقيقي من الذاكرة — بالتجربة من السيرفر المحلي)
async function offlineSoft(p) { await p.context().route(/:(8080|9099)\//, (r) => r.abort()); }
async function online(p) {
  const ctx = p.context();
  await ctx.unroute(/:(8080|9099)\//); await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('no internet: the kitchen and the ready screen keep working with the cashier over WiFi, calls from the line phone ring, and everything syncs back', async () => {
  // ── الكاشير (صاحب المطعم): يسوي الرمز السري ويشغّل المركز
  hub = createHub({ udpPort: UDP, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const c = await page(B, { w: 1280, h: 860 });
  await wire(c, hub, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'lan@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  const key = (await until(() => read('restaurants/RL/lan/key')))?.key;
  assert.match(key || '', /^[0-9a-f]{64}$/, 'the cashier created the restaurant LAN key');
  await until(() => hub.status().on);
  assert.equal(hub.status().rid, 'RL');

  // ── شاشة المجهز (تطبيق المطبخ): تنربط بالرمز وتتصل بالكاشير على الواي فاي
  const kc = createClient({ role: 'kitchen', udpPort: UDP, targets: ['127.0.0.1'] });
  const k = await page(B, { w: 1100, h: 800 });
  await wire(k, kc, 'kitchen');
  await k.goto(BASE + 'kitchen.html');
  await k.waitForSelector('#pairCode', { timeout: 15000 });
  const code = (await k.textContent('#pairCode')).trim();
  const pr = await until(() => read('screenPairs/' + code));
  await put('screens/' + pr.uid, { restaurantId: 'RL', restName: 'مطعم الشبكة', code, kind: 'kitchen', name: 'المجهز', pairedBy: 'hq', approved: true, atMs: Date.now() });
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  assert.ok(await until(() => hub.status().peers.some((x) => x.role === 'kitchen')), 'kitchen connected to the cashier');

  // ── شاشة «طلبك جاهز» (تطبيق التلفزيون)
  const sc = createClient({ role: 'screen', udpPort: UDP, targets: ['127.0.0.1'] });
  const s = await page(B, { w: 1280, h: 720 });
  await wire(s, sc, 'screen');
  await s.goto(BASE + 'screen.html');
  await s.waitForSelector('#gEmail', { timeout: 15000 });
  await s.fill('#gEmail', 'lan@x.com'); await s.fill('#gPass', 'secret123'); await s.click('#gGo');
  await s.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  assert.ok(await until(() => hub.status().peers.some((x) => x.role === 'screen')), 'ready screen connected to the cashier');
  await c.waitForTimeout(1500);

  // ── ينقطع النت (الواي فاي باقي): الكاشير والمطبخ والشاشة
  await offline(c); await offline(k); await offline(s);
  await k.waitForSelector('#lanB:not([hidden])', { timeout: 20000 });
  await k.waitForFunction(() => /متصل بالكاشير/.test(document.getElementById('lanB').textContent), null, { timeout: 15000 });

  // طلب سفري «قيد التحضير» من الكاشير بدون نت ← يطلع بالمطبخ وبالشاشة فوراً
  await c.click('#prods .prod >> nth=0');
  await c.click('#sendBtn'); await c.keyboard.press('3'); await c.click('#acDlgOk');
  const oid = await (await c.waitForFunction(() => { const o = orders.find((x) => x.held && x.status === 'preparing'); return o && o.id; }, null, { timeout: 8000 })).jsonValue();
  const num = await c.evaluate((id) => String(orders.find((o) => o.id === id).ticketNo), oid);
  await k.waitForSelector(`#grid .card:has-text("#${num}") .done-b`, { timeout: 10000 });
  await k.waitForSelector('#grid .card:has-text("فلافل")');
  await s.waitForFunction((n) => [...document.querySelectorAll('#prep .n')].some((e) => e.textContent.includes(n)), num, { timeout: 10000 });

  // المطبخ يضغط «جاهز» ← الكاشير يحفظه (بجهازه لحد ما يرجع النت) ← الرقم يطلع بـ«جاهز» على الشاشة
  await k.click(`#grid .card:has-text("#${num}") .done-b`);
  await c.waitForFunction((id) => { const o = orders.find((x) => x.id === id); return o && o.kitchen === 'ready' && o.status === 'ready'; }, oid, { timeout: 10000 });
  await k.waitForFunction((n) => ![...document.querySelectorAll('#grid .cnum')].some((e) => e.textContent.trim() === '#' + n), num, { timeout: 10000 });
  await s.waitForFunction((n) => [...document.querySelectorAll('#ready .n')].some((e) => e.textContent.includes(n)), num, { timeout: 10000 });
  await s.screenshot({ path: 'shots/lan-screen-offline.png' });
  assert.equal((await ordersOf('RL')).length, 0, 'nothing reached the server yet');

  // ── تلفون الخط: المكالمة توصل للكاشير عن طريق الواي فاي (رسالة مباشرة + حدث بالبث) ومرة وحدة بس
  const ln = createClient({ role: 'line', udpPort: UDP, targets: ['127.0.0.1'] });
  await ln.start({ rid: 'RL', key, dev: 'line-1', name: 'خط المطعم' });
  await until(() => ln.hubs().some((h) => h.on));
  const call = { t: 'call', id: 'call-1', line: '1', number: '07701112222', at: Date.now() };
  ln.broadcast(call); ln.send('*', call);
  await c.waitForSelector('#callsBox .call-card:has-text("07701112222")', { timeout: 10000 });
  await c.waitForTimeout(600);
  assert.equal(await c.$$eval('#callsBox .call-card', (e) => e.length), 1, 'one card for the same call');
  // رمز غلط ← ما يدخل
  const bad = createClient({ role: 'line', udpPort: UDP, targets: ['127.0.0.1'] });
  await bad.start({ rid: 'RL', key: 'f'.repeat(64), dev: 'line-x', name: 'x' });
  bad.broadcast({ t: 'call', id: 'call-x', line: '1', number: '07709999999', at: Date.now() });
  await c.waitForTimeout(1200);
  assert.equal(await c.$$eval('#callsBox .call-card', (e) => e.length), 1, 'a forged call is ignored');
  bad.stop();
  await c.click('#callsBox .call-go');
  await c.waitForSelector('#callsBox .call-card', { state: 'detached', timeout: 5000 });
  ln.stop();

  // ما ينرسل للشاشات أرقام أو عناوين الزبائن
  const shipped = sent.filter((m) => m && m.t === 'state').flatMap((m) => m.orders || []);
  assert.ok(shipped.length > 0);
  shipped.forEach((o) => ['phone', 'customer', 'customerPhone', 'address', 'payment', 'value'].forEach((f) => assert.equal(o[f], undefined, f + ' leaked to screens')));

  // ── يرجع النت: كلشي يترفع للسحابة
  await online(c); await online(k); await online(s);
  const up = await until(async () => { const o = (await ordersOf('RL')).find((x) => x.id === oid); return o && o.kitchen === 'ready' && o.status === 'ready' ? o : null; }, 30000);
  assert.ok(up, 'the offline order and its «ready» reached the server');
  await k.waitForSelector('#lanB', { state: 'hidden', timeout: 30000 });
  assert.deepEqual(clean(c), []); assert.deepEqual(clean(k), []); assert.deepEqual(clean(s), []);
  kc.stop(); sc.stop();
  await c.context().close(); await k.context().close(); await s.context().close();
});

test('the kitchen app reopened with no internet still shows the cashier orders (offline cold start over WiFi)', async () => {
  // الكاشير شغّال (المركز) وبيه طلب قيد التحضير؛ تابلت المطبخ ينطفي وينفتح والنت مقطوع
  const c = await page(B, { w: 1280, h: 860 });
  await wire(c, hub, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'lan@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  await until(() => hub.status().on);
  const kc = createClient({ role: 'kitchen', udpPort: UDP, targets: ['127.0.0.1'] });
  const k = await page(B, { w: 1100, h: 800 });
  await wire(k, kc, 'kitchen');
  await k.goto(BASE + 'kitchen.html');
  await k.waitForSelector('#pairCode', { timeout: 15000 });
  const code = (await k.textContent('#pairCode')).trim();
  const pr = await until(() => read('screenPairs/' + code));
  await put('screens/' + pr.uid, { restaurantId: 'RL', restName: 'مطعم الشبكة', code, kind: 'kitchen', name: 'المجهز', pairedBy: 'hq', approved: true, atMs: Date.now() });
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await until(() => hub.status().peers.some((x) => x.role === 'kitchen'));
  await k.waitForTimeout(1500);   // الكاش المحلي ينحفظ
  // النت ينقطع، والكاشير يسوي طلب
  await offline(c); await offlineSoft(k);
  await c.click('#prods .prod >> nth=0');
  await c.click('#sendBtn'); await c.keyboard.press('3'); await c.click('#acDlgOk');
  const num = await (await c.waitForFunction(() => { const o = orders.filter((x) => x.held && x.status === 'preparing').sort((a, b) => b.createdAtMs - a.createdAtMs)[0]; return o && String(o.ticketNo); }, null, { timeout: 8000 })).jsonValue();
  // الشاشة تنفتح من جديد بدون نت (التطبيق يبقى متصل بالكاشير): تطلع شاشة المطبخ نفسها (مو الرمز) وبيها الطلب
  await k.reload();
  await k.waitForSelector('#app:not([hidden])', { timeout: 25000 });
  assert.equal(await k.isVisible('#pairCode'), false, 'stays linked offline');
  await k.waitForSelector(`#grid .card:has-text("#${num}")`, { timeout: 15000 });
  await online(c); await k.context().unroute(/:(8080|9099)\//);
  kc.stop();
  await c.context().close(); await k.context().close();
});
