import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, uid;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  uid = await signUp('cap@x.com', 'secret123');
  const legacy = await signUp('legacy@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', uid), { role: 'captain', restaurantId: 'R1', captainId: 'C1', name: 'علي', email: 'cap@x.com' });
    await setDoc(doc(db, 'users', legacy), { role: 'captain', name: 'old', email: 'legacy@x.com' });
    await setDoc(doc(db, 'captains/C1'), { restaurantId: 'R1', userId: uid, name: 'علي', available: true });
    await setDoc(doc(db, 'restaurants/R1'), { name: 'برغر <b>X</b>', userId: 'r', active: true });
    await setDoc(doc(db, 'orders/O1AAAAAAAAAAAA'), { restaurantId: 'R1', restaurantName: 'برغر <b>X</b>', status: 'pending', captainId: 'C1', rejectedBy: [],
      customer: '<img src=x onerror=window.__xss=1>', phone: '07701234567', address: 'الحسينية', value: 10000, fee: 5000, notes: 'برغر×2', createdAtMs: Date.now(), timeline: [] });
    await setDoc(doc(db, 'orders/O2BBBBBBBBBBBB'), { restaurantId: 'R1', status: 'pending', rejectedBy: [], value: 7000, fee: 3000, address: 'المنصور', createdAtMs: Date.now() + 1, timeline: [] });
    await setDoc(doc(db, 'orders/O3CCCCCCCCCCCC'), { restaurantId: 'R1', status: 'accepted', captainId: 'C9', value: 1, fee: 1, phone: 'secret', timeline: [] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };

test('legacy captain without captainId is refused with a clear message', async () => {
  const p = await page(B);
  await p.goto('http://localhost:5050/sora3a-captain/captain.html');
  await p.fill('#email', 'legacy@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#loginErr:not(.hidden)');
  assert.match(await p.textContent('#loginErr'), /تحديث من الإدارة/);
  await p.context().close();
});

test('captain full delivery flow', async () => {
  const p = await page(B, { notif: true });
  await p.goto('http://localhost:5050/sora3a-captain/captain.html');
  await p.fill('#email', 'cap@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#incoming.show', { timeout: 15000 });
  assert.equal(await p.textContent('#inFee'), '5,000');
  // push token registered for this user only
  const tok = await until(() => read('pushTokens/' + uid));
  assert.ok(tok && tok.tokens.length >= 1 && tok.captainId === 'C1', 'push token saved: ' + JSON.stringify(tok));
  // XSS payload rendered as text
  assert.equal(await p.evaluate(() => window.__xss), undefined);
  // new tab shows two offers, and NOT the other captain's order
  assert.equal(await p.textContent('#newPill'), '2');
  await p.click('#acceptBtn');
  await p.waitForSelector('#waSheet.show');
  await p.click('#waSkip');
  let o = await until(async () => { const d = await read('orders/O1AAAAAAAAAAAA'); return d.status === 'accepted' ? d : null; });
  assert.equal(o.status, 'accepted');
  let t = await until(() => read('tracking/O1AAAAAAAAAAAA'));
  assert.equal(t.status, 'accepted'); assert.equal(t.phone, undefined);
  // after accepting O1, the second offer rings
  await p.waitForSelector('#incoming.show');
  await p.click('#rejectBtn');
  await p.waitForFunction(() => !document.querySelector('#incoming').classList.contains('show'));
  const o2 = await until(async () => { const d = await read('orders/O2BBBBBBBBBBBB'); return d.rejectedBy?.length ? d : null; });
  assert.deepEqual(o2.rejectedBy, ['C1']);
  // progress
  await p.click('[data-act="pickup"]');
  await p.waitForSelector('[data-act="deliver"]');
  await p.click('[data-act="deliver"]');
  await p.waitForSelector('input[data-photo]', { state: 'attached' });
  await p.setInputFiles('input[data-photo]', { name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('[data-act="done"]');
  await p.click('[data-act="done"]');
  await p.waitForFunction(() => document.getElementById('sToday').textContent === '1', null, { timeout: 10000 });
  o = await until(async () => { const d = await read('orders/O1AAAAAAAAAAAA'); return d.status === 'delivered' ? d : null; });
  assert.equal(o.status, 'delivered'); assert.equal(o.hasProof, true); assert.equal(o.deliveryProof, undefined);
  const proof = await until(() => read('deliveryProofs/O1AAAAAAAAAAAA'));
  assert.match(proof.image, /^data:image\/jpeg/);
  assert.equal(await p.textContent('#sEarn'), '5,000');
  // availability toggle
  await p.click('#availBtn');
  await p.waitForFunction(() => document.getElementById('availTxt').textContent === 'غير متاح');
  assert.equal((await until(async () => { const d = await read('captains/C1'); return d.available === false ? d : null; })).available, false);
  assert.deepEqual(p.errors.filter((e) => !/favicon|Failed to load resource|navigator.vibrate/.test(e)), []);
  await p.screenshot({ path: 'shots/captain-history.png', fullPage: true });
  await p.context().close();
});

test('public tracking page shows status without personal data', async () => {
  const p = await page(B);
  await p.goto('http://localhost:5050/sora3a-captain/?order=O1AAAAAAAAAAAA');
  await p.waitForSelector('.status h2');
  assert.match(await p.textContent('.status h2'), /تم تسليم/);
  const html = await p.content();
  assert.ok(!html.includes('07701234567') && !html.includes('الحسينية'), 'no phone/address');
  assert.ok(html.includes('برغر &lt;b&gt;X&lt;/b&gt;'), 'restaurant name escaped');
  await p.screenshot({ path: 'shots/tracking.png', fullPage: true });
  await p.goto('http://localhost:5050/sora3a-captain/?order=../../x');
  await p.waitForSelector('.msg h2');
  assert.match(await p.textContent('.msg h2'), /غير صالح/);
  await p.context().close();
});
