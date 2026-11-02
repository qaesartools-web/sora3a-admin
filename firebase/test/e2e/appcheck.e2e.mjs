// رمز الحماية من السيرفر (App Check لتطبيقات الأندرويد): سيرفر الإشعارات (نفس كود الإنتاج) ينطي الرمز بس للجهاز المربوط
// أو الحساب المسجّل. خدمات Google (مفاتيح التوقيع، oauth، Firestore، App Check) مزيّفة وتروح للمحاكي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { doc, setDoc } from 'firebase/firestore';
import { env } from './harness.mjs';

const PID = 'sora3a-system', APP = '1:516304449260:web:0110ba6c2621d6a16dbfc9';
let E, worker;
const b64u = (b) => Buffer.from(b).toString('base64url');
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const saKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ type: 'service_account', project_id: PID, client_email: 'push@test.iam', private_key: saKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const idTok = (uid) => {
  const now = Math.floor(Date.now() / 1000), h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ aud: PID, iss: 'https://securetoken.google.com/' + PID, sub: uid, iat: now, exp: now + 3600 }));
  return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), google.privateKey).toString('base64url');
};
const exchanges = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) return Response.json({ keys: [{ ...google.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  if (u === 'https://oauth2.googleapis.com/token') {
    const claims = JSON.parse(Buffer.from(new URLSearchParams(init.body).get('assertion').split('.')[1], 'base64url'));
    assert.match(claims.scope, /cloud-platform/, 'access token can call App Check');
    return Response.json({ access_token: 'AT-OK', expires_in: 3600 });
  }
  if (u.startsWith('https://firestore.googleapis.com/')) return realFetch(u.replace('https://firestore.googleapis.com', 'http://127.0.0.1:8080'), { ...init, headers: { ...init.headers, authorization: 'Bearer owner' } });
  if (u === `https://firebaseappcheck.googleapis.com/v1/projects/${PID}/apps/${APP}:exchangeCustomToken`) {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer AT-OK');
    const ct = JSON.parse(init.body).customToken.split('.');
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(ct[0] + '.' + ct[1]), saKey.publicKey, Buffer.from(ct[2], 'base64url')), 'signed by the service account');
    const c = JSON.parse(Buffer.from(ct[1], 'base64url'));
    assert.equal(c.app_id, APP); assert.equal(c.iss, 'push@test.iam'); assert.equal(c.ttl, '21600s');
    assert.equal(c.aud, 'https://firebaseappcheck.googleapis.com/google.firebase.appcheck.v1.TokenExchangeService');
    exchanges.push(c);
    return Response.json({ token: 'AC-TOKEN-' + exchanges.length, ttl: '21600s' });
  }
  return realFetch(url, init);
};
const call = (tok) => worker.fetch(new Request('https://sora3a-push.test/appcheck', { method: 'POST', headers: { origin: 'https://qaesartools-web.github.io', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: '{}' }), { FIREBASE_SERVICE_ACCOUNT: SA });
const put = (p, d) => E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); });

before(async () => {
  E = await env(); await E.clearFirestore();
  worker = (await import('../../../push/cloudflare-worker.js')).default;
  await put('restaurants/RA', { name: 'مطعم أ', active: true, features: { devices: false } });
  await put('restaurants/RB', { name: 'مطعم ب', active: true, features: { devices: true } });
  await put('restaurants/RC', { name: 'مطعم موقوف', active: false });
  await put('screens/tvA', { restaurantId: 'RA', kind: 'ready', approved: false });
  await put('screens/tvB', { restaurantId: 'RB', kind: 'kitchen', approved: false });
  await put('screens/tvB2', { restaurantId: 'RB', kind: 'kitchen', approved: true });
  await put('screens/tvC', { restaurantId: 'RC', kind: 'ready', approved: true });
  await put('users/cash1', { role: 'cashier', restaurantId: 'RA' });
  await put('users/cap1', { role: 'captain', restaurantId: 'RA' });
  await put('users/off1', { role: 'cashier', restaurantId: 'RA', disabled: true });
  await put('users/odd1', { role: 'customer' });
});
after(async () => { await E?.cleanup(); });

test('App Check from our server: only linked devices and signed-in staff get a protection token', async () => {
  const st = async (tok) => { const r = await call(tok); return [r.status, await r.json(), r.headers.get('access-control-allow-origin')]; };
  let [s, j, o] = await st(null); assert.equal(s, 401); assert.equal(o, 'https://qaesartools-web.github.io');
  [s, j] = await st('not.a.token'); assert.equal(s, 401);
  [s, j] = await st(idTok('stranger')); assert.equal(s, 403); assert.equal(j.error, 'not_linked');
  [s, j] = await st(idTok('tvA')); assert.equal(s, 200); assert.equal(j.token, 'AC-TOKEN-1'); assert.equal(j.ttlMillis, 21600000);
  [s, j] = await st(idTok('tvB')); assert.equal(s, 403); assert.equal(j.error, 'not_approved', 'approved-devices restaurant: waits for Tower approval');
  [s, j] = await st(idTok('tvB2')); assert.equal(s, 200);
  [s, j] = await st(idTok('tvC')); assert.equal(s, 403); assert.equal(j.error, 'restaurant_off');
  [s, j] = await st(idTok('cash1')); assert.equal(s, 200);
  [s, j] = await st(idTok('cap1')); assert.equal(s, 200);
  [s, j] = await st(idTok('off1')); assert.equal(s, 403);
  [s, j] = await st(idTok('odd1')); assert.equal(s, 403);
  assert.equal(exchanges.length, 4);
  // GET يبين إن الخدمة موجودة
  const g = await (await worker.fetch(new Request('https://sora3a-push.test/'), { FIREBASE_SERVICE_ACCOUNT: SA })).json();
  assert.equal(g.appcheck, 'v1');
  // فحص الخدمة: يجرّب يسك رمز بدون ما يرجّعه
  const sf = await (await worker.fetch(new Request('https://sora3a-push.test/appcheck'), { FIREBASE_SERVICE_ACCOUNT: SA })).json();
  assert.deepEqual(sf, { ok: true, appcheck: 'ok', ttlHours: 6 }); assert.equal(sf.token, undefined);
});
