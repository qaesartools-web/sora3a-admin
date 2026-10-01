// قبل نشر القواعد الجديدة وقبل "ربط الحسابات": الحسابات القديمة يجب أن تبقى تعمل
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc } from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { serve, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
before(async () => {
  srv = await serve(); B = await browser();
  E = await initializeTestEnvironment({ projectId: 'sora3a-system', firestore: { host: '127.0.0.1', port: 8080, rules: "rules_version='2';service cloud.firestore{match /databases/{d}/documents{match /{x=**}{allow read,write: if request.auth!=null;} match /tracking/{t}{allow read: if true;}}}" } });
  await E.clearFirestore(); await clearAuth();
  U.cap = await signUp('oldcap@x.com', 'secret123');
  U.rest = await signUp('oldrest@x.com', 'secret123');
  U.thief = await signUp('thief@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.cap), { role: 'captain', email: 'oldcap@x.com', name: 'قديم' });     // شكل الحساب القديم
    await setDoc(doc(db, 'users', U.rest), { role: 'restaurant', email: 'oldrest@x.com', name: 'قديم' });
    await setDoc(doc(db, 'captains/CL'), { name: 'كابتن قديم', email: 'oldcap@x.com', userId: U.cap, restaurantId: 'RL', available: true });
    await setDoc(doc(db, 'restaurants/RL'), { name: 'مطعم قديم', email: 'oldrest@x.com', userId: U.rest, active: true });
    // محاولة الاستيلاء بالإيميل: حساب آخر بنفس إيميل مستند المطعم يجب أن يُرفض
    await setDoc(doc(db, 'restaurants/RX'), { name: 'ضحية', email: 'thief@x.com', userId: 'someone-else', active: true });
    await setDoc(doc(db, 'orders/ORDLEGACY000001'), { restaurantId: 'RL', status: 'pending', captainId: 'CL', value: 1000, fee: 500, rejectedBy: [], createdAtMs: Date.now() });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('legacy captain logs in and sees the order', async () => {
  const p = await page(B);
  await p.goto('http://localhost:5050/sora3a-captain/captain.html');
  await p.fill('#email', 'oldcap@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#incoming.show', { timeout: 15000 });
  await p.context().close();
});
test('legacy restaurant logs in to cashier and admin', async () => {
  for (const url of ['sora3a-rest2/index.html', 'sora3a-admin/index.html']) {
    const p = await page(B, { w: 1024, h: 768 });
    await p.goto('http://localhost:5050/' + url);
    const [em, pw, bt] = url.includes('rest2') ? ['#inEmail', '#inPass', '#loginBtn'] : ['#lEmail', '#lPass', '#lBtn'];
    await p.waitForSelector(em, { state: 'visible', timeout: 15000 });
    await p.fill(em, 'oldrest@x.com'); await p.fill(pw, 'secret123'); await p.click(bt);
    await p.waitForSelector(url.includes('rest2') ? '#appPage.show' : '#appPage', { state: 'visible', timeout: 15000 });
    await p.context().close();
  }
});
test('email match alone does not grant access', async () => {
  const p = await page(B, { w: 1024, h: 768 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#inEmail', { state: 'visible' });
  await p.fill('#inEmail', 'thief@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#errBox', { state: 'visible' });
  assert.equal(await p.isVisible('#appPage.show'), false);
  await p.context().close();
});
