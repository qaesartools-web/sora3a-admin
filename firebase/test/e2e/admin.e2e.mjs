import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const findOne = async (col, f, val) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where(f, '==', val))); v = s.docs[0] ? { id: s.docs[0].id, ...s.docs[0].data() } : null; }); return v; };
const URL_ = 'http://localhost:5050/sora3a-admin/index.html';

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.admin = await signUp('boss@x.com', 'secret123');
  U.legacyRest = await signUp('oldrest@x.com', 'secret123');
  U.legacyCap = await signUp('oldcap@x.com', 'secret123');
  U.rogue = await signUp('rogue@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.admin), { role: 'admin', email: 'boss@x.com', name: 'Boss' });
    await setDoc(doc(db, 'users', U.rogue), { role: 'admin', email: 'rogue@x.com' }); // self-made admin from old rules
    // legacy shapes created by the old apps
    await setDoc(doc(db, 'users', U.legacyRest), { role: 'restaurant', email: 'oldrest@x.com', name: 'Old' });
    await setDoc(doc(db, 'users', U.legacyCap), { role: 'captain', email: 'oldcap@x.com', name: 'Cap' });
    await setDoc(doc(db, 'restaurants/RL'), { name: 'Old <img src=x onerror=window.__xss=1>', email: 'oldrest@x.com', active: true, expiry: '2099-01-01' });
    await setDoc(doc(db, 'captains/CL'), { name: 'Cap', email: 'oldcap@x.com', userId: U.legacyCap, restaurantId: 'RL', available: true });
    await setDoc(doc(db, 'orders/ORDACTIVE000001'), { restaurantId: 'RL', restaurantName: 'Old', status: 'accepted', captainId: 'CL', captainName: 'Cap', value: 5000, fee: 2000, phone: '0770', address: 'addr', createdAtMs: Date.now(), orderType: 'delivery' });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function login(p, email) {
  await p.goto(URL_);
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', email); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
}

test('legacy restaurant cannot log in before migration (no restaurantId)', async () => {
  const p = await page(B);
  await login(p, 'oldrest@x.com');
  await p.waitForSelector('#lErr', { state: 'visible' });
  assert.match(await p.textContent('#lErr'), /غير مرتبط/);
  await p.context().close();
});

test('admin: migration links legacy accounts, lists rogue admin, XSS inert', async () => {
  const p = await page(B);
  await login(p, 'boss@x.com');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scRests"]');
  await p.waitForSelector('#restList .entity');
  assert.equal(await p.evaluate(() => window.__xss), undefined, 'xss inert');
  await p.click('.dnav-btn[data-screen="scSecurity"]');
  await p.click('#secScanBtn');
  await p.waitForFunction(() => !document.getElementById('secFixBtn').disabled, null, { timeout: 10000 });
  const adm = await p.textContent('#secAdmins');
  assert.match(adm, /rogue@x.com/);
  await p.click('#secFixBtn');
  await until(async () => (await read('users/' + U.legacyRest))?.restaurantId === 'RL');
  assert.equal((await read('users/' + U.legacyRest)).restaurantId, 'RL');
  assert.equal((await read('restaurants/RL')).userId, U.legacyRest);
  assert.ok((await read('restaurants/RL')).expiryMs > Date.now());
  const cu = await read('users/' + U.legacyCap);
  assert.equal(cu.captainId, 'CL'); assert.equal(cu.restaurantId, 'RL');
  const t = await read('tracking/ORDACTIVE000001');
  assert.equal(t.status, 'accepted'); assert.equal(t.phone, undefined);
  // disable rogue admin
  await p.waitForSelector('#secAdmins button');
  await p.click('#secAdmins button');
  await until(async () => (await read('users/' + U.rogue))?.disabled === true);
  assert.equal((await read('users/' + U.rogue)).disabled, true);
  await p.screenshot({ path: 'shots/admin-security.png', fullPage: true });
  await p.context().close();
});

test('rogue admin is locked out after being disabled', async () => {
  const p = await page(B);
  await login(p, 'rogue@x.com');
  await p.waitForSelector('#lErr', { state: 'visible' });
  assert.match(await p.textContent('#lErr'), /غير مصرح/);
  await p.context().close();
});

test('admin creates restaurant + captain with correct linking', async () => {
  const p = await page(B);
  await login(p, 'boss@x.com');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scRests"]');
  await p.fill('#nrName', 'مطعم جديد'); await p.fill('#nrArea', 'بغداد'); await p.fill('#nrEmail', 'new@x.com'); await p.fill('#nrPass', 'longpass1'); await p.fill('#nrExpiry', '2099-12-31');
  await p.click('#addRestBtn');
  const r = await until(() => findOne('restaurants', 'email', 'new@x.com'));
  assert.ok(r?.userId);
  const ru = await until(() => read('users/' + r.userId));
  assert.equal(ru.role, 'restaurant'); assert.equal(ru.restaurantId, r.id);
  assert.ok(r.expiryMs > Date.now());
  // admin is still logged in (secondary app used)
  assert.ok(await p.isVisible('#appPage'));
  await p.click('.dnav-btn[data-screen="scCaptains"]');
  await p.waitForFunction((id) => [...document.querySelectorAll('#ncRest option')].some((o) => o.value === id), r.id);
  await p.selectOption('#ncRest', r.id);
  await p.fill('#ncName', 'كابتن'); await p.fill('#ncPhone', '0770'); await p.fill('#ncEmail', 'newcap@x.com'); await p.fill('#ncPass', 'longpass1');
  await p.click('#addCapForm .btn-primary');
  const c = await until(() => findOne('captains', 'email', 'newcap@x.com'));
  const cu = await until(() => read('users/' + c.userId));
  assert.equal(cu.role, 'captain'); assert.equal(cu.captainId, c.id); assert.equal(cu.restaurantId, r.id);
  // delete captain revokes access
  await p.waitForSelector(`button[onclick="deleteCaptain('${c.id}')"]`);
  await p.click(`button[onclick="deleteCaptain('${c.id}')"]`);
  await until(async () => !(await read('users/' + c.userId)));
  assert.equal(await read('users/' + c.userId), undefined);
  const errs = p.errors.filter((e) => !/favicon|Failed to load resource|integrity|digest|Chart|vibrate/.test(e));
  assert.deepEqual(errs, []);
  await p.context().close();
});

test('restaurant role in admin app sees only its data and no delete', async () => {
  const p = await page(B);
  await login(p, 'oldrest@x.com');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.waitForSelector('#dashOrders .order-row');
  assert.equal(await p.locator('button[onclick^="deleteOrder"]').count(), 0);
  assert.equal(await p.locator('.dnav-btn[data-screen="scSecurity"]').count(), 0);
  await p.context().close();
});
