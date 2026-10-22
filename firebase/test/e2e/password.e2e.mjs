// كلمة سر جديدة: لوحة الإدارة (الواجهة الحقيقية) ← سيرفر الإشعارات (نفس كود الإنتاج) ← Firebase Auth (المحاكي).
// خدمات Google (مفاتيح التوقيع، oauth، Firestore، Identity Toolkit) مزيّفة محلياً وتروح للمحاكي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { doc, setDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

const PID = 'sora3a-system';
let srv, E, B, worker, U = {};
const authCalls = [];
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const write = async (fn) => E.withSecurityRulesDisabled(async (c) => fn(c.firestore()));

// ── Google مزيّف ──
const b64u = (b) => Buffer.from(b).toString('base64url');
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const saKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ type: 'service_account', project_id: PID, client_email: 'push@test.iam', private_key: saKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
function signIdToken(payload) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })), p = b64u(JSON.stringify(payload));
  return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), google.privateKey).toString('base64url');
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) return Response.json({ keys: [{ ...google.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  if (u === 'https://oauth2.googleapis.com/token') {
    const jwt = new URLSearchParams(init.body).get('assertion').split('.');
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
    assert.match(claims.scope, /identitytoolkit/, 'token can change passwords');
    return Response.json({ access_token: 'AT-OK', expires_in: 3600 });
  }
  if (u.startsWith('https://firestore.googleapis.com/')) {
    return realFetch(u.replace('https://firestore.googleapis.com', 'http://127.0.0.1:8080'), { ...init, headers: { ...init.headers, authorization: 'Bearer owner' } });
  }
  if (u.startsWith('https://identitytoolkit.googleapis.com/')) {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer AT-OK');
    authCalls.push(JSON.parse(init.body));
    return realFetch(u.replace('https://identitytoolkit.googleapis.com', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com'), { ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer owner' } });
  }
  return realFetch(url, init);
};
// تسجيل دخول حقيقي على محاكي Auth (حتى نتأكد إن كلمة السر تغيّرت فعلاً)
async function canLogin(email, password) {
  const r = await realFetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.ok ? (await r.json()).idToken : null;
}
// نطلب من السيرفر مباشرة باسم مستخدم معيّن
async function ask(asEmail, asPass, target, password = 'NewPass-1234') {
  const tok = await canLogin(asEmail, asPass);
  const r = await realFetch('http://localhost:5096/', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ action: 'setPassword', uid: target, password }) });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  const { default: w } = await import(path.join(ROOTS['sora3a-admin'], 'push/cloudflare-worker.js'));
  worker = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const h = new Headers(); for (const [k, v] of Object.entries(req.headers)) h.set(k, String(v));
    const tok = (h.get('authorization') || '').replace(/^Bearer /, '');
    if (tok) { const pl = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url')); h.set('authorization', 'Bearer ' + signIdToken(pl)); }
    const r = await w.fetch(new Request('http://localhost:5096' + req.url, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { FIREBASE_SERVICE_ACCOUNT: SA });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
  }).listen(5096);

  await E.clearFirestore(); await clearAuth();
  U.boss = await signUp('boss@pw.iq', 'secret123');
  U.owner = await signUp('owner@pw.iq', 'secret123');
  U.owner2 = await signUp('owner2@pw.iq', 'secret123');
  U.cash = await signUp('cash@pw.iq', 'secret123');
  U.cash2 = await signUp('cash2@pw.iq', 'secret123');
  U.hqView = await signUp('view@pw.iq', 'secret123');
  U.hqEdit = await signUp('edit@pw.iq', 'secret123');
  await write(async (db) => {
    await setDoc(doc(db, 'users', U.boss), { role: 'admin', email: 'boss@pw.iq', name: 'المدير' });
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RA', email: 'owner@pw.iq', name: 'صاحب أ' });
    await setDoc(doc(db, 'users', U.owner2), { role: 'restaurant', restaurantId: 'RB', email: 'owner2@pw.iq', name: 'صاحب ب' });
    await setDoc(doc(db, 'users', U.cash), { role: 'cashier', restaurantId: 'RA', email: 'cash@pw.iq', name: 'أحمد', perms: { discount: true } });
    await setDoc(doc(db, 'users', U.cash2), { role: 'cashier', restaurantId: 'RB', email: 'cash2@pw.iq', name: 'سيف' });
    await setDoc(doc(db, 'users', U.hqView), { role: 'hq', email: 'view@pw.iq', name: 'مشاهد' });
    await setDoc(doc(db, 'users', U.hqEdit), { role: 'hq', email: 'edit@pw.iq', name: 'محرر' });
    await setDoc(doc(db, 'hqTeam', U.hqView), { name: 'مشاهد', perms: { rests: 'view' } });
    await setDoc(doc(db, 'hqTeam', U.hqEdit), { name: 'محرر', perms: { rests: 'edit' } });
    await setDoc(doc(db, 'restaurants/RA'), { name: 'مطعم أ', userId: U.owner, active: true });
    await setDoc(doc(db, 'restaurants/RB'), { name: 'مطعم ب', userId: U.owner2, active: true });
    await setDoc(doc(db, 'config/push'), { url: 'http://localhost:5096/' });
  });
});
after(async () => { await B?.close(); srv?.close(); worker?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('owner gives his cashier a new password from the admin app → the old one stops, the new one logs in, WhatsApp/copy ready', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'owner@pw.iq'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scMyRest"]');
  await p.waitForSelector('#mcList .entity');
  await p.click('#mcList button:has-text("كلمة سر جديدة")');
  await p.waitForSelector('.pw-ov #pwNew');
  const pass = (await p.textContent('#pwNew')).trim();
  assert.match(pass, /^[a-z2-9]{10}$/);
  assert.match(await p.getAttribute('.pw-ov a', 'href'), /^https:\/\/wa\.me\/\?text=.*cash%40pw\.iq/);
  assert.equal(await canLogin('cash@pw.iq', 'secret123'), null, 'old password stops working');
  assert.ok(await canLogin('cash@pw.iq', pass), 'new password works');
  assert.equal(authCalls.at(-1).localId, U.cash);
  await p.click('.pw-ov [data-x]');
  assert.equal(await p.locator('.pw-ov').count(), 0);
  await p.context().close();
});

test('the server only lets the right people change a password', async () => {
  const n = authCalls.length;
  // صاحب مطعم ثاني، كاشير، وفريق البرج «مشاهدة» ← مرفوض
  assert.equal((await ask('owner2@pw.iq', 'secret123', U.cash)).status, 403, 'other restaurant owner');
  assert.equal((await ask('cash2@pw.iq', 'secret123', U.cash)).status, 403, 'a cashier');
  assert.equal((await ask('view@pw.iq', 'secret123', U.cash2)).status, 403, 'HQ team with view only');
  // صاحب المطعم ما يغيّر كلمة سر صاحب مطعم ثاني، ولا أحد يغيّر حساب المدير
  assert.equal((await ask('owner@pw.iq', 'secret123', U.owner2)).status, 403);
  assert.equal((await ask('edit@pw.iq', 'secret123', U.boss)).body.error, 'bad_target');
  // كلمة سر قصيرة أو بدون تسجيل دخول
  assert.equal((await ask('boss@pw.iq', 'secret123', U.cash2, 'short')).body.error, 'bad_password');
  const anon = await realFetch('http://localhost:5096/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'setPassword', uid: U.cash2, password: 'NewPass-1234' }) });
  assert.equal(anon.status, 401);
  assert.equal(authCalls.length, n, 'nothing reached Firebase Auth');
  // المسموح: فريق البرج «تعديل» لأي كاشير، والمدير لصاحب مطعم
  const a = await ask('edit@pw.iq', 'secret123', U.cash2, 'Team-pass-77');
  assert.equal(a.status, 200); assert.ok(await canLogin('cash2@pw.iq', 'Team-pass-77'));
  const b = await ask('boss@pw.iq', 'secret123', U.owner2, 'Owner-pass-88');
  assert.equal(b.status, 200); assert.ok(await canLogin('owner2@pw.iq', 'Owner-pass-88'));
  // تطبيق البرج (ويندوز app://hq وأندرويد appassets) مسموح يوصل للسيرفر
  for (const origin of ['app://hq', 'https://appassets.androidplatform.net']) {
    const o = await realFetch('http://localhost:5096/', { method: 'OPTIONS', headers: { origin } });
    assert.equal(o.headers.get('access-control-allow-origin'), origin);
  }
});
