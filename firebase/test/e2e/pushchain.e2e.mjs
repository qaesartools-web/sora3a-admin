// سلسلة إشعار الكابتن كاملة: الكاشير (الواجهة الحقيقية) ← سيرفر الإشعارات (نفس كود الإنتاج، توقيع RS256 حقيقي)
// ← رسالة FCM ← تطبيق الكابتن (Service Worker الويب) + فحص شكل الرسالة لتطبيق الأندرويد.
// خدمات Google (المفاتيح، oauth، Firestore، FCM) مزيّفة محلياً؛ Firestore يروح للمحاكي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, arrayUnion } from 'firebase/firestore';
import { chromium } from 'playwright-core';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

const PID = 'sora3a-system';
let srv, E, B, worker, U = {};
const fcm = []; // كل رسالة FCM يرسلها السيرفر
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const write = async (fn) => E.withSecurityRulesDisabled(async (c) => fn(c.firestore()));
const orders = async () => { let v; await write(async (db) => { v = (await getDocs(query(collection(db, 'orders'), where('restaurantId', '==', 'RX')))).docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const sentTo = (tok, n) => fcm.filter((m) => m.message.token === tok).length >= n;

// ── Google مزيّف ──
const b64u = (b) => Buffer.from(b).toString('base64url');
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); // مفتاح securetoken
const saKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); // مفتاح حساب الخدمة
const SA = JSON.stringify({ type: 'service_account', project_id: PID, client_email: 'push@test.iam', private_key: saKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
function signIdToken(payload, key = google.privateKey) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })), p = b64u(JSON.stringify(payload));
  return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url');
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) {
    return Response.json({ keys: [{ ...google.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  }
  if (u === 'https://oauth2.googleapis.com/token') {
    const jwt = new URLSearchParams(init.body).get('assertion').split('.');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), saKey.publicKey, Buffer.from(jwt[2], 'base64url'));
    return ok ? Response.json({ access_token: 'AT-OK', expires_in: 3600 }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
  }
  if (u.startsWith('https://firestore.googleapis.com/')) {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer AT-OK');
    return realFetch(u.replace('https://firestore.googleapis.com', 'http://127.0.0.1:8080'), { ...init, headers: { ...init.headers, authorization: 'Bearer owner' } });
  }
  if (u.startsWith('https://fcm.googleapis.com/')) {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer AT-OK');
    const m = JSON.parse(init.body); fcm.push(m);
    if (m.message.token.startsWith('DEAD')) return Response.json({ error: { status: 'NOT_FOUND', message: 'UNREGISTERED' } }, { status: 404 });
    return Response.json({ name: 'projects/x/messages/1' });
  }
  return realFetch(url, init);
};

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  const { default: w } = await import(path.join(ROOTS['sora3a-admin'], 'push/cloudflare-worker.js'));
  // السيرفر: نفس كود Cloudflare. توكن المحاكي (بدون توقيع) نعيد توقيعه مثل ما يسوي Google
  worker = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const h = new Headers(); for (const [k, v] of Object.entries(req.headers)) h.set(k, String(v));
    const tok = (h.get('authorization') || '').replace(/^Bearer /, '');
    if (tok && !req.headers['x-raw-token']) {
      const pl = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url'));
      h.set('authorization', 'Bearer ' + signIdToken(pl));
    }
    const r = await w.fetch(new Request('http://localhost:5098' + req.url, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { FIREBASE_SERVICE_ACCOUNT: SA });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
  }).listen(5098);

  await E.clearFirestore(); await clearAuth();
  U.cash = await signUp('cash@chain.iq', 'secret123');
  U.c1 = await signUp('ali@chain.iq', 'secret123');
  U.c2 = await signUp('karrar@chain.iq', 'secret123');
  U.other = await signUp('other@chain.iq', 'secret123');
  await write(async (db) => {
    await setDoc(doc(db, 'users', U.cash), { role: 'cashier', restaurantId: 'RX', email: 'cash@chain.iq', name: 'كاشير', perms: { discount: true, cancel: true, inventory: false, menu: false, settings: false } });
    await setDoc(doc(db, 'users', U.other), { role: 'cashier', restaurantId: 'RY', email: 'other@chain.iq', name: 'غريب' });
    await setDoc(doc(db, 'users', U.c1), { role: 'captain', restaurantId: 'RX', captainId: 'C1', email: 'ali@chain.iq', name: 'علي' });
    await setDoc(doc(db, 'users', U.c2), { role: 'captain', restaurantId: 'RX', captainId: 'C2', email: 'karrar@chain.iq', name: 'كرار' });
    await setDoc(doc(db, 'restaurants/RX'), { name: 'مطعم السلسلة', userId: 'o', active: true });
    await setDoc(doc(db, 'captains/C1'), { restaurantId: 'RX', userId: U.c1, name: 'علي', available: true });
    await setDoc(doc(db, 'captains/C2'), { restaurantId: 'RX', userId: U.c2, name: 'كرار', available: true });
    await setDoc(doc(db, 'restaurants/RX/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'زنكر', variants: [{ name: 'وحدة', price: 8000 }] }] }] });
    // علي: تلفون ويب. كرار: تطبيق أندرويد + رمز قديم ميت
    await setDoc(doc(db, 'pushTokens', U.c1), { tokens: ['WEB-ALI'], role: 'captain', captainId: 'C1', restaurantId: 'RX', updatedAtMs: 1 });
    await setDoc(doc(db, 'pushTokens', U.c2), { tokens: ['NATIVE-KARRAR', 'DEAD-KARRAR'], role: 'captain', captainId: 'C2', restaurantId: 'RX', updatedAtMs: 1 });
    await setDoc(doc(db, 'config/push'), { url: 'http://localhost:5098/' });
  });
});
after(async () => { await B?.close(); srv?.close(); worker?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

let P; // صفحة الكاشير (نفسها لكل السيناريوهات)
async function pickCaptain(name) {
  await P.waitForSelector('#delivOv.on');
  await P.click(`#capList .capcard:has-text("${name}")`);
  await P.click('#confCapBtn');
}
async function newDelivery(phone, captain) {
  await P.click('#prods .prod >> nth=0');
  await P.click('#sendBtn'); await P.keyboard.press('4');
  await P.waitForSelector('#delivOv.on');
  await P.fill('#dName', 'زبون'); await P.fill('#dPhone', phone); await P.fill('#dAddr', 'الكرادة');
  await pickCaptain(captain);
  return until(async () => (await orders()).find((o) => o.phone === phone));
}

test('1) new delivery order → push to the chosen captain (web phone)', async () => {
  P = await page(B, { w: 1280, h: 860 });
  await P.goto('http://localhost:5050/sora3a-rest2/index.html');
  await P.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await P.fill('#inEmail', 'cash@chain.iq'); await P.fill('#inPass', 'secret123'); await P.click('#loginBtn');
  await P.waitForSelector('#prods .prod', { timeout: 15000 }); await P.waitForTimeout(1500);
  const o = await newDelivery('07700000001', 'علي');
  assert.ok(await until(() => sentTo('WEB-ALI', 1)), 'push sent to Ali');
  const m = fcm.find((x) => x.message.token === 'WEB-ALI').message;
  assert.equal(m.data.kind, 'order'); assert.equal(m.data.orderId, o.id);
  assert.match(m.data.title, /طلب توصيل جديد/); assert.match(m.data.body, /الكرادة/); assert.match(m.data.body, /أجرة/);
  assert.equal(m.notification, undefined, 'data-only so the app shows and repeats it');
  assert.equal(m.webpush.headers.Urgency, 'high'); assert.equal(m.android.priority, 'HIGH');
  assert.ok(!fcm.some((x) => x.message.token.includes('KARRAR')), 'other captain not disturbed');
  const saved = await until(async () => (await read('orders/' + o.id)).pushedFor);
  assert.match(saved, /^C1:\d+$/);
});

test('2) captain rejects → cashier reassigns the SAME captain → push again', async () => {
  const o = (await orders()).find((x) => x.phone === '07700000001');
  const before = fcm.filter((x) => x.message.token === 'WEB-ALI').length;
  await write((db) => updateDoc(doc(db, 'orders', o.id), { rejectedBy: arrayUnion('C1'), rejectNotice: { by: 'علي', captainId: 'C1', time: 'x', timestamp: Date.now(), seen: false } }));
  await P.waitForSelector('#rejOverlay.show', { timeout: 10000 });
  await P.evaluate(() => window.changeRejectedCaptain());
  await pickCaptain('علي');
  assert.ok(await until(() => sentTo('WEB-ALI', before + 1)), 'Ali rung again after reassignment');
});

test('3) reassign to another captain (Android app) → push to him; dead token cleaned', async () => {
  const o = (await orders()).find((x) => x.phone === '07700000001');
  await write((db) => updateDoc(doc(db, 'orders', o.id), { rejectedBy: arrayUnion('C1'), rejectNotice: { by: 'علي', captainId: 'C1', time: 'x', timestamp: Date.now(), seen: false } }));
  await P.waitForSelector('#rejOverlay.show', { timeout: 10000 });
  await P.evaluate(() => window.changeRejectedCaptain());
  await pickCaptain('كرار');
  assert.ok(await until(() => sentTo('NATIVE-KARRAR', 1)), 'Karrar (Android) rung');
  const m = fcm.find((x) => x.message.token === 'NATIVE-KARRAR').message;
  // نفس الحقول اللي يقراها PushService.java
  assert.equal(m.data.kind, 'order'); assert.ok(m.data.title && m.data.body); assert.equal(m.android.priority, 'HIGH');
  const toks = await until(async () => { const d = await read('pushTokens/' + U.c2); return d.tokens.length === 1 ? d.tokens : null; });
  assert.deepEqual(toks, ['NATIVE-KARRAR']);
});

test('4) completed order, then a new one → push again', async () => {
  const o = (await orders()).find((x) => x.phone === '07700000001');
  await write((db) => updateDoc(doc(db, 'orders', o.id), { status: 'delivered' }));
  const before = fcm.filter((x) => x.message.token === 'NATIVE-KARRAR').length;
  await newDelivery('07700000002', 'كرار');
  assert.ok(await until(() => sentTo('NATIVE-KARRAR', before + 1)));
});

test('5) kitchen (held takeaway) order transferred to a captain → push', async () => {
  const before = fcm.filter((x) => x.message.token === 'WEB-ALI').length;
  await write(async (db) => {
    await setDoc(doc(db, 'orders/HOLD0000000001'), { restaurantId: 'RX', restaurantName: 'مطعم السلسلة', orderType: 'takeaway', held: true, holdNum: 1, customer: 'سفري #1', phone: '07700000003', value: 8000, status: 'preparing', createdAtMs: Date.now(), timeline: [] });
  });
  await until(() => P.evaluate(() => typeof window.holdTransfer === 'function'));
  await P.waitForTimeout(1500);
  await P.evaluate(() => window.holdTransfer('HOLD0000000001'));
  await P.fill('#dName', 'أبو حسن'); await P.fill('#dAddr', 'زيونة');
  await pickCaptain('علي');
  assert.ok(await until(() => sentTo('WEB-ALI', before + 1)), 'transfer rings Ali');
  assert.equal(fcm.filter((x) => x.message.token === 'WEB-ALI').at(-1).message.data.orderId, 'HOLD0000000001');
});

test('6) takeaway / hall orders never ring captains', async () => {
  const n = fcm.length;
  await P.click('#prods .prod >> nth=0');
  await P.click('#sendBtn'); await P.keyboard.press('2');
  await P.waitForTimeout(3000);
  assert.equal(fcm.length, n);
});

test('7) security: forged token → 401, another restaurant’s cashier → 403, nothing sent', async () => {
  const o = (await orders()).find((x) => x.phone === '07700000002');
  await write((db) => updateDoc(doc(db, 'orders', o.id), { status: 'pending' }));
  const n = fcm.length;
  const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const now = Math.floor(Date.now() / 1000);
  const forged = signIdToken({ aud: PID, iss: 'https://securetoken.google.com/' + PID, sub: U.cash, iat: now, exp: now + 600 }, evil);
  let r = await realFetch('http://localhost:5098/', { method: 'POST', headers: { authorization: 'Bearer ' + forged, 'x-raw-token': '1', 'content-type': 'application/json' }, body: JSON.stringify({ orderId: o.id, n: Date.now() }) });
  assert.equal(r.status, 401);
  const otherTok = signIdToken({ aud: PID, iss: 'https://securetoken.google.com/' + PID, sub: U.other, iat: now, exp: now + 600 });
  r = await realFetch('http://localhost:5098/', { method: 'POST', headers: { authorization: 'Bearer ' + otherTok, 'x-raw-token': '1', 'content-type': 'application/json' }, body: JSON.stringify({ orderId: o.id, n: Date.now() }) });
  assert.equal(r.status, 403);
  assert.equal(fcm.length, n);
  await P.context().close();
});

test('8) the web captain phone shows the real message and repeats the ring until opened', async () => {
  // نسخة من تطبيق الكابتن مع Service Worker الحقيقي (مكتبة Firebase بالـ SW مستبدلة بنسخة وهمية صغيرة)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'capsw-')), cap = path.join(dir, 'sora3a-captain');
  mkdirSync(cap); mkdirSync(path.join(dir, 'other'));
  const sw = readFileSync(path.join(ROOTS['sora3a-captain'], 'sw.js'), 'utf8')
    .replace(/importScripts\([^)]*app-compat[^)]*\);/, 'self.firebase={initializeApp(){},messaging(){return{onBackgroundMessage(){}}}};')
    .replace(/importScripts\([^)]*messaging-compat[^)]*\);/, '')
    .replace('RING_GAP_MS = 5000', 'RING_GAP_MS = 600');
  writeFileSync(path.join(cap, 'sw.js'), sw);
  copyFileSync(path.join(ROOTS['sora3a-captain'], 'icon-192.png'), path.join(cap, 'icon-192.png'));
  writeFileSync(path.join(cap, 'captain.html'), "<script>navigator.serviceWorker.register('sw.js',{scope:'/sora3a-captain/'})</script>");
  writeFileSync(path.join(dir, 'other', 'index.html'), 'x');
  const fsrv = http.createServer((q, s) => { try { const b = readFileSync(path.join(dir, decodeURIComponent(q.url.split('?')[0]))); s.writeHead(200, { 'content-type': q.url.endsWith('.js') ? 'text/javascript' : q.url.endsWith('.png') ? 'image/png' : 'text/html' }); s.end(b); } catch { s.writeHead(404); s.end(); } }).listen(5097);
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext(); await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:5097' });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5097/sora3a-captain/captain.html'); await p.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await ctx.newCDPSession(p); let regId;
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { for (const r of e.registrations) regId = r.registrationId; });
  await cdp.send('ServiceWorker.enable'); await until(() => regId, 5000);
  await p.goto('http://localhost:5097/other/index.html'); // التطبيق مسكّر
  const msg = fcm.find((x) => x.message.token === 'WEB-ALI').message; // الرسالة الحقيقية اللي طلعت من السيرفر
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:5097', registrationId: regId, data: JSON.stringify({ data: msg.data }) });
  const notes = () => p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('/sora3a-captain/')).getNotifications()).map((n) => n.title + '|' + n.body));
  const first = await until(async () => (await notes())[0]);
  assert.match(first, /طلب توصيل جديد\|.*الكرادة.*أجرة/);
  const again = await until(async () => ((await notes())[0] || '').startsWith('🔔'), 4000);
  assert.ok(again, 'ring repeated');
  await b.close(); fsrv.close();
});
