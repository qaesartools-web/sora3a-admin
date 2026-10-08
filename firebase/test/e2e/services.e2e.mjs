import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext|permission/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.admin = await signUp('boss@x.com', 'secret123');
  U.owner = await signUp('own@x.com', 'secret123');
  U.cap = await signUp('svccap@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.admin), { role: 'admin', email: 'boss@x.com', name: 'المدير' });
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RS', email: 'own@x.com' });
    await setDoc(doc(db, 'users', U.cap), { role: 'captain', restaurantId: 'RS', captainId: 'CS', email: 'svccap@x.com' });
    await setDoc(doc(db, 'restaurants/RS'), { name: 'مطعم الخدمات', area: 'المنصور', email: 'own@x.com', userId: U.owner, active: true });
    await setDoc(doc(db, 'captains/CS'), { restaurantId: 'RS', userId: U.cap, name: 'كرار', available: true });
    await setDoc(doc(db, 'restaurants/RS/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }] }] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function adminLogin(p, email) {
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', email); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
}

test('super admin switches restaurant services; restaurant cannot', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await adminLogin(p, 'boss@x.com');
  await p.click('.dnav-btn[data-screen="scRests"]');
  await p.waitForSelector('#restList .svc');
  assert.equal(await p.locator('#restList .svc.on').count(), 5);   // الكابتن، الشريحة، واتساب، البيجر، المنيو الأونلاين (المحاكي مطفي افتراضياً)
  await p.click('#restList .svc >> text=البيجر');
  await until(async () => (await read('restaurants/RS')).features?.pager === false);
  await p.click('#restList .svc >> text=الكابتن');
  await until(async () => (await read('restaurants/RS')).features?.captain === false);
  await p.waitForSelector('#restList .svc.off >> nth=1');
  await p.screenshot({ path: 'shots/admin-services.png' });
  assert.deepEqual(clean(p), []);
  await p.context().close();
  // صاحب المطعم: تبويب الكباتن والخريطة مخفيان، ولا يستطيع تشغيل الخدمة بنفسه
  const o = await page(B, { w: 1280, h: 800 });
  await adminLogin(o, 'own@x.com');
  await o.waitForFunction(() => !document.querySelector('.dnav-btn[data-screen="scCaptains"]'), null, { timeout: 8000 });
  assert.equal(await o.locator('.dnav-btn[data-screen="scMap"]').count(), 0);
  const denied = await o.evaluate(async () => { try { await window._fb.updateDoc(window._fb.doc(window._fb.db, 'restaurants', 'RS'), { 'features.captain': true }); return false; } catch (e) { return e.code; } });
  assert.equal(denied, 'permission-denied');
  // المدير يشغّلها → يظهر التبويب فوراً
  await write('restaurants/RS', { 'features.captain': true });
  await o.waitForSelector('.dnav-btn[data-screen="scCaptains"]', { timeout: 8000 });
  await write('restaurants/RS', { 'features.captain': false });
  await o.waitForFunction(() => !document.querySelector('.dnav-btn[data-screen="scCaptains"]'), null, { timeout: 8000 });
  await o.context().close();
});

test('cashier hides disabled services live', async () => {
  const p = await page(B, { w: 1280, h: 800 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'own@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  assert.equal(await p.isVisible('#pagerBar'), false);
  await p.click('#prods .prod >> nth=0'); await p.click('#sendBtn');
  await p.waitForSelector('#typeOv.on');
  assert.equal(await p.isVisible('.otype[onclick*="delivery"]'), false);
  await p.keyboard.press('4');
  assert.equal(await p.isVisible('#delivOv.on'), false);
  await p.keyboard.press('Escape'); await p.evaluate(() => document.getElementById('typeOv').classList.remove('on'));
  await write('restaurants/RS', { 'features.pager': true, 'features.captain': true });
  await p.waitForSelector('#pagerBar .pg', { timeout: 8000 });
  await p.click('#sendBtn');
  assert.equal(await p.isVisible('.otype[onclick*="delivery"]'), true);
  await p.context().close();
});

test('captain blocked when captain service is off (login and live)', async () => {
  await write('restaurants/RS', { 'features.captain': false });
  const p = await page(B, { notif: true });
  await p.goto('http://localhost:5050/sora3a-captain/captain.html');
  await p.fill('#email', 'svccap@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#loginErr:not(.hidden)', { timeout: 10000 });
  assert.match(await p.textContent('#loginErr'), /خدمة الكابتن متوقفة/);
  await write('restaurants/RS', { 'features.captain': true });
  await p.fill('#email', 'svccap@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  assert.equal(await p.isVisible('#login'), false);
  await write('restaurants/RS', { 'features.captain': false });
  await p.waitForSelector('#loginErr:not(.hidden)', { timeout: 10000 });
  assert.match(await p.textContent('#loginErr'), /خدمة الكابتن متوقفة/);
  await p.context().close();
});
