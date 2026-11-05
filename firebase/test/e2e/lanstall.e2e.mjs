// النت ينقطع والواي فاي باقي («اللحظة اللي بين» الحقيقية): الأجهزة تحسب نفسها متصلة بالسيرفر بس ماكو شي يوصل —
//  الاتصالات المفتوحة تبقى مفتوحة وساكتة (مو ترفض مثل «بدون نت»). الكاشير والمجهز وشاشة «طلبك جاهز» لازم يكملون على الواي فاي:
//  كل طلب يخلصه المجهز يوصل للكاشير ويطلع «جاهز» بالشاشة فوراً، حتى الطلبات اللي انسوت قبل ما ينقطع النت،
//  والشاشة إذا انفتحت من جديد تبقى صحيحة، ومن يرجع النت كلشي يترفع
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createHub, createClient } = require(path.join(ROOTS['sora3a-rest2'], 'desktop/lan.js'));
const UDP = 49100 + Math.floor(Math.random() * 3000);
const BASE = 'http://localhost:5050/sora3a-rest2/';

let srv, E, B, hub, proxy;
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const put = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); }); };
const ordersOf = async (rid) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), 'orders'), where('restaurantId', '==', rid))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };

// وسيط بين الصفحات وقاعدة البيانات: freeze() = النت انقطع والواي فاي باقي (الاتصالات تبقى مفتوحة وماكو بيانات تعبر)
function stallProxy(target) {
  let frozen = false;
  const pairs = new Set();
  const s = net.createServer((c) => {
    const u = net.connect(target, '127.0.0.1');
    const p = { c, u };
    pairs.add(p);
    c.on('data', (b) => { if (!frozen) u.write(b); });
    u.on('data', (b) => { if (!frozen) c.write(b); });
    const end = () => { c.destroy(); u.destroy(); pairs.delete(p); };
    c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
  });
  return {
    listen: () => new Promise((res) => s.listen(0, '127.0.0.1', () => res(s.address().port))),
    freeze() { frozen = true; },
    // يرجع النت: الاتصالات اللي علكت تنقطع (مثل الحقيقة بعد انقطاع طويل) والأجهزة تتصل من جديد
    heal() { frozen = false; pairs.forEach((p) => { p.c.destroy(); p.u.destroy(); }); pairs.clear(); },
    close() { s.close(); pairs.forEach((p) => { p.c.destroy(); p.u.destroy(); }); },
  };
}

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  proxy = stallProxy(8080); proxy.port = await proxy.listen();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('stall@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RS', email: 'stall@x.com', name: 'أبو علي' });
    await setDoc(doc(db, 'restaurants/RS'), { name: 'مطعم الانقطاع', userId: own, active: true, features: { kitchen: true } });
    await setDoc(doc(db, 'restaurants/RS/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'سندويش', emoji: '🥙', items: [{ name: 'فلافل', variants: [{ name: 'وحدة', price: 1500 }] }] }] });
    await setDoc(doc(db, 'restaurants/RS/settings/main'), { receiptTitle: 'فلافل الانقطاع', updatedAtMs: 1 });
  });
});
after(async () => { hub?.stop(); proxy?.close(); await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

// الصفحة تتصل بقاعدة البيانات عن طريق الوسيط، وتسجيل الدخول (9099) يعلك ويه النت
async function viaProxy(p) {
  const fs = (await readFile(path.join(HERE, 'sdk', 'firebase-firestore.js'), 'utf8')).replace('connectFirestoreEmulator(d, "127.0.0.1", 8080)', `connectFirestoreEmulator(d, "127.0.0.1", ${proxy.port})`);
  assert.ok(fs.includes(String(proxy.port)));
  await p.context().route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.7\.1\/firebase-firestore\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs }));
  await p.context().route(/:9099\//, (r) => (proxy.frozenAuth ? undefined : r.continue()));
}
// نفس جسر الشبكة اللي بالتطبيق (lan.e2e)
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
async function pair(p, url, kind, name) {
  await p.goto(url);
  await p.waitForSelector('#pairCode', { timeout: 15000 });
  const code = (await p.textContent('#pairCode')).trim();
  const pr = await until(() => read('screenPairs/' + code));
  await put('screens/' + pr.uid, { restaurantId: 'RS', restName: 'مطعم الانقطاع', code, kind, name, pairedBy: 'hq', approved: true, atMs: Date.now() });
}
async function hold(c) {
  const before = await c.evaluate(() => orders.filter((o) => o.held).length);
  await c.click('#prods .prod >> nth=0');
  await c.click('#sendBtn'); await c.keyboard.press('3'); await c.click('#acDlgOk');
  await c.waitForFunction((n) => orders.filter((o) => o.held).length > n, before, { timeout: 8000 });
}
const nums = (s, col) => s.$$eval('#' + col + ' .n', (els) => els.map((e) => (e.textContent.match(/#(\d+)/) || [])[1]).filter(Boolean));

test('internet drops while the WiFi stays (connections hang silently): every order the preparer finishes — made before or after the drop — reaches the cashier and shows «ready» on the screen at once, stays right after the screen reloads, and syncs when the internet is back', async () => {
  // ── الكاشير (المركز)
  hub = createHub({ udpPort: UDP, tcpPort: 0, host: '127.0.0.1', bcast: ['127.0.0.1'] });
  const c = await page(B, { w: 1280, h: 860 });
  await viaProxy(c); await wire(c, hub, 'hub');
  await c.goto(BASE + 'index.html');
  await c.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await c.fill('#inEmail', 'stall@x.com'); await c.fill('#inPass', 'secret123'); await c.click('#loginBtn');
  await c.waitForSelector('#prods .prod', { timeout: 15000 });
  await until(() => read('restaurants/RS/lan/key'));
  await until(() => hub.status().on);
  // ── المجهز
  const kc = createClient({ role: 'kitchen', udpPort: UDP, targets: ['127.0.0.1'] });
  const k = await page(B, { w: 1100, h: 800 });
  await viaProxy(k); await wire(k, kc, 'kitchen');
  await pair(k, BASE + 'kitchen.html', 'kitchen', 'المجهز');
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  // ── شاشة «طلبك جاهز»
  const sc = createClient({ role: 'screen', udpPort: UDP, targets: ['127.0.0.1'] });
  const s = await page(B, { w: 1280, h: 720 });
  await viaProxy(s); await wire(s, sc, 'screen');
  await pair(s, BASE + 'screen.html', 'ready', 'طلبك جاهز');
  await s.waitForSelector('#scr:not([hidden])', { timeout: 15000 });
  assert.ok(await until(() => hub.status().peers.some((x) => x.role === 'kitchen') && hub.status().peers.some((x) => x.role === 'screen')), 'both connected to the cashier');

  // ── بالنت: ٣ طلبات سفري قيد التحضير (توصل للسيرفر)
  for (let i = 0; i < 3; i++) await hold(c);
  assert.ok(await until(async () => (await ordersOf('RS')).length === 3), 'the first orders reached the server');
  await k.waitForFunction(() => document.querySelectorAll('#grid .done-b').length === 3, null, { timeout: 15000 });
  // المجهز ضغط «جاهز» بالغلط ← «رجّع» يرجعه بالكاشير والشاشة هم (الكاشير يستلم «جاهز» و«رجّع» على الواي فاي)
  const first = await c.evaluate(() => orders.find((o) => o.held).id);
  await k.click(`[data-done="${first}"]`);
  await k.waitForSelector('#undoB:not([hidden])', { timeout: 15000 });
  await c.waitForFunction((id) => (orders.find((o) => o.id === id) || {}).kitchen === 'ready', first, { timeout: 15000 });
  await k.click('#undoB');
  await c.waitForFunction((id) => (orders.find((o) => o.id === id) || {}).kitchen === 'new', first, { timeout: 15000 });
  await s.waitForFunction(() => document.querySelectorAll('#prep .n').length === 3, null, { timeout: 15000 });
  await k.waitForSelector(`[data-done="${first}"]`, { timeout: 15000 });
  assert.equal((await read('orders/' + first)).kitchen, 'new');
  await c.waitForTimeout(1500);

  // ── النت ينقطع والواي فاي باقي: الاتصالات تبقى مفتوحة وساكتة
  proxy.freeze(); proxy.frozenAuth = true;
  // ٤ طلبات ثانية بدون نت — كل طلب يطلع بالشاشة بلحظته
  const took = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now(), n0 = await s.evaluate(() => document.querySelectorAll('#prep .n').length);
    await hold(c);
    await s.waitForFunction((n) => document.querySelectorAll('#prep .n').length > n, n0, { timeout: 20000 });
    took.push(Date.now() - t0);
  }
  // طلب واحد بس ينتظر (هو اللي يكتشف إن السيرفر ما يجاوب)، والباقي بلحظتهم — چانت كلها تنتظر ٤ ثواني ونص
  const sorted = [...took].sort((a, b) => a - b);
  assert.ok(sorted[sorted.length - 2] < 2500 && sorted[sorted.length - 1] < 6500, 'orders reach the screen at once: ' + JSON.stringify(took));
  const all7 = await c.evaluate(() => orders.filter((o) => o.held).map((o) => ({ id: o.id, n: String(o.ticketNo) })));
  assert.equal(all7.length, 7);
  await k.waitForFunction(() => document.querySelectorAll('#grid .done-b').length === 7, null, { timeout: 15000 });
  await s.waitForFunction(() => document.querySelectorAll('#prep .n').length === 7, null, { timeout: 15000 });
  // المجهز يخلصهن كلهن (قبل وبعد الانقطاع)
  for (const o of all7) await k.click(`[data-done="${o.id}"]`);
  // الكاشير يعرف بكلهن
  const atCashier = await c.waitForFunction((ids) => ids.every((id) => { const o = orders.find((x) => x.id === id); return o && o.kitchen === 'ready'; }), all7.map((o) => o.id), { timeout: 15000 }).then(() => true, () => false);
  const cashState = await c.evaluate((ids) => ids.map((id) => (orders.find((x) => x.id === id) || {}).kitchen), all7.map((o) => o.id));
  assert.ok(atCashier, 'the cashier knows all 7 are ready: ' + JSON.stringify(cashState));
  // والشاشة تحوّلهن «جاهز» فوراً
  const onScreen = await s.waitForFunction(() => document.querySelectorAll('#ready .n').length === 7 && !document.querySelectorAll('#prep .n').length, null, { timeout: 15000 }).then(() => true, () => false);
  assert.ok(onScreen, 'all 7 ready on the screen: ready=' + JSON.stringify(await nums(s, 'ready')) + ' prep=' + JSON.stringify(await nums(s, 'prep')));

  // ── الشاشة تنفتح من جديد (التلفزيون انطفى ورجع) والنت بعده مقطوع: تبقى صحيحة
  await s.reload();
  await s.waitForSelector('#scr:not([hidden])', { timeout: 20000 });
  const afterReload = await s.waitForFunction(() => document.querySelectorAll('#ready .n').length === 7 && !document.querySelectorAll('#prep .n').length, null, { timeout: 20000 }).then(() => true, () => false);
  assert.ok(afterReload, 'still all ready after the screen reopened: ready=' + JSON.stringify(await nums(s, 'ready')) + ' prep=' + JSON.stringify(await nums(s, 'prep')));

  // ── يرجع النت: كلشي يترفع للسيرفر، والشاشة تبقى صحيحة
  proxy.frozenAuth = false; proxy.heal();
  for (const p of [c, k, s]) await p.evaluate(() => window.dispatchEvent(new Event('online'))).catch(() => {});
  const synced = await until(async () => { const o = await ordersOf('RS'); return o.length === 7 && o.every((x) => x.kitchen === 'ready') ? o : null; }, 60000);
  assert.ok(synced, 'all 7 reached the server as ready: ' + JSON.stringify((await ordersOf('RS')).map((x) => x.kitchen)));
  await s.waitForTimeout(3000);
  assert.equal((await nums(s, 'ready')).length, 7);
  assert.equal((await nums(s, 'prep')).length, 0);

  for (const p of [c, k, s]) await p.context().close();
  kc.stop(); sc.stop();
});

test('the preparer / kitchen screen updates itself when the page is updated (it stays open for days) — only at a quiet moment', async () => {
  const { utimes } = await import('node:fs/promises');
  const k = await page(B, { w: 1100, h: 800 });
  await k.addInitScript(() => { window.__auMs = 400; window.__auIdle = 1500; });
  await pair(k, BASE + 'kitchen.html', 'kitchen', 'المجهز ٢');
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await k.evaluate(() => { window.__oldPage = true; });
  await k.waitForTimeout(1500);                       // البصمة الأولى
  assert.equal(await k.evaluate(() => window.__oldPage), true, 'no reload without an update');
  // القائمة مفتوحة (مو وقت هادئ) ← ما يحدّث
  await k.evaluate(() => { document.getElementById('menu').hidden = false; });
  const f = new URL('../../../../sora3a-rest2/staff.js', import.meta.url).pathname, t = new Date(Date.now() + 120000);
  await utimes(f, t, t);                              // «نشرنا تحديث»
  await k.waitForTimeout(3000);
  assert.equal(await k.evaluate(() => window.__oldPage), true, 'waits for a quiet moment');
  await k.evaluate(() => { document.getElementById('menu').hidden = true; });
  await k.waitForFunction(() => !window.__oldPage, null, { timeout: 15000 });
  await k.waitForSelector('#app:not([hidden])', { timeout: 15000 });   // رجعت وحدها بدون ما تنربط من جديد
  assert.equal(await k.locator('#pairCode').count(), 0);
  await k.context().close();
});
