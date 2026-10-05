// سيرفر إشعارات الكابتن: الكاشير يبلّغ السيرفر بكل طلب دلفري (السيرفر نفسه وهمي هنا)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, mock, hits = [];
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  mock = http.createServer((req, res) => {
    const h = { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const auth = req.headers.authorization || '';
      hits.push({ auth, body: b });
      res.writeHead(auth.startsWith('Bearer ey') ? 200 : 401, { ...h, 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
  }).listen(5099);
  await E.clearFirestore(); await clearAuth();
  const admin = await signUp('boss@p.iq', 'secret123');
  const owner = await signUp('owner@p.iq', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', admin), { role: 'admin', email: 'boss@p.iq' });
    await setDoc(doc(db, 'users', owner), { role: 'restaurant', restaurantId: 'RP', email: 'owner@p.iq' });
    await setDoc(doc(db, 'restaurants/RP'), { name: 'مطعم', userId: owner, active: true });
    await setDoc(doc(db, 'captains/CP'), { restaurantId: 'RP', userId: 'z', name: 'كرار', available: true });
    await setDoc(doc(db, 'restaurants/RP/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'زنكر', variants: [{ name: 'وحدة', price: 6000 }] }] }] });
    await setDoc(doc(db, 'config/push'), { url: 'http://localhost:5099/api/notify' });
  });
});
after(async () => { await B?.close(); srv?.close(); mock?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('cashier notifies the push server for each new delivery order (with the user token)', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'owner@p.iq'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 }); await p.waitForTimeout(1200);
  await p.click('#prods .prod >> nth=0');
  await p.click('#sendBtn'); await p.keyboard.press('4');
  await p.waitForSelector('#delivOv.on');
  await p.fill('#dName', 'زبون'); await p.fill('#dPhone', '07701234567'); await p.fill('#dAddr', 'الكرادة');
  await p.click('#capList .capcard'); await p.click('#confCapBtn');
  const hit = await until(() => hits.find((x) => x.body.includes('orderId')));
  assert.ok(hit, 'push server was called');
  assert.match(hit.auth, /^Bearer ey/);
  assert.match(JSON.parse(hit.body).orderId, /^[A-Za-z0-9]{20}$/);
  // وقت التخصيص: يخلي إعادة تخصيص نفس الكابتن ترن من جديد
  assert.ok(Math.abs(JSON.parse(hit.body).n - Date.now()) < 60000);
  await p.context().close();
});

test('super admin saves and tests the server URL', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'boss@p.iq'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('.dnav-btn[data-screen="scSecurity"]', { timeout: 15000 });
  await p.click('.dnav-btn[data-screen="scSecurity"]');
  await p.waitForFunction(() => document.getElementById('pushUrl').value.includes('5099'));
  await p.click('#pushCard button >> text=فحص السيرفر');
  await p.waitForFunction(() => document.getElementById('pushStatus').textContent.includes('شغّال ومضبوط'));
  await p.fill('#pushUrl', 'http://insecure');
  await p.click('#pushCard button >> text=حفظ');
  await p.waitForTimeout(500);
  let cfg; await E.withSecurityRulesDisabled(async (c) => { cfg = (await getDoc(doc(c.firestore(), 'config/push'))).data(); });
  assert.equal(cfg.url, 'http://localhost:5099/api/notify', 'insecure URL must be rejected');
  await p.context().close();
});
