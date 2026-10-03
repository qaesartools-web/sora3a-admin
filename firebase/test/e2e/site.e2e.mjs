// موقع سرعة: نموذج التجربة يحفظ الطلب ← المدير الأعلى يشوفه ويفعّل تجربة يومين بضغطة
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const all = async (col) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDocs(collection(c.firestore(), col))).docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const SITE = 'http://localhost:5050/sora3a-admin/site/index.html';

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.admin = await signUp('boss@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'users', U.admin), { role: 'admin', email: 'boss@x.com', name: 'Boss' }); });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

for (const w of [390, 1280]) {
  test(`site renders cleanly at ${w}px (no errors, no horizontal scroll)`, async () => {
    const p = await page(B, { w, h: 900 });
    await p.goto(SITE); await p.waitForTimeout(800);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 1, 'horizontal overflow ' + over);
    for (const id of ['features', 'flow', 'apps', 'plans', 'trial', 'faq', 'contact']) assert.ok(await p.$('#' + id), id);
    assert.match(await p.textContent('#contact'), /0771 139 1715/);
    assert.match(await p.textContent('#contact'), /qaesar\.thelove@gmail\.com/);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test('trial form validates, saves the lead with requirements, shows the welcome', async () => {
  const p = await page(B, { w: 390, h: 900 });
  await p.goto(SITE);
  await p.click('#bNext');
  assert.equal(await p.$$eval('.fld.bad', (e) => e.length) >= 3, true);
  await p.fill('#fOwner', 'أحمد علي'); await p.fill('#fRest', 'مطعم الذوق'); await p.fill('#fPhone', '٠٧٧٠١٢٣٤٥٦٧'); await p.fill('#fCity', 'بغداد');
  await p.click('#bNext');
  await p.click('label.chip:has(input[value="captain"])'); await p.click('label.chip:has(input[value="pager"])');
  await p.click('#bNext');
  await p.click('button[data-k="sections"][data-d="1"]'); await p.click('button[data-k="sections"][data-d="1"]');
  await p.click('button[data-k="captains"][data-d="1"]');
  await p.fill('#fNotes', 'عندنا فرعين');
  await p.click('#bNext');
  await p.waitForSelector('.done', { timeout: 15000 });
  assert.match(await p.textContent('.done'), /وصلنا طلبك/);
  const leads = await until(async () => { const l = await all('leads'); return l.length ? l : null; });
  assert.equal(leads.length, 1);
  const l = leads[0];
  assert.equal(l.phone, '07701234567');
  assert.equal(l.status, 'new');
  assert.deepEqual(l.services, ['pos', 'captain', 'pager']);
  assert.equal(l.sections, 3); assert.equal(l.captains, 1); assert.equal(l.notes, 'عندنا فرعين');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('super admin sees the lead and activates a 2-day trial in one click', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'boss@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('.dnav-btn[data-screen="scLeads"]', { timeout: 15000 });
  await p.click('.dnav-btn[data-screen="scLeads"]');
  await p.waitForSelector('#ldList .ld-card');
  const card = await p.textContent('#ldList');
  assert.match(card, /مطعم الذوق/); assert.match(card, /كابتن ودلفري/); assert.match(card, /عندنا فرعين/);
  await p.click('#ldList button:has-text("تفعيل تجربة يومين")');
  await p.waitForSelector('#ldMo.open #ldGo');
  assert.match(await p.inputValue('#ldEmail'), /@sora3a\.app$/);
  await p.click('#ldGo');
  await p.waitForSelector('#ldMo .ld-cred', { timeout: 15000 });
  assert.match(await p.getAttribute('#ldMo a.btn-primary', 'href'), /^https:\/\/wa\.me\/9647701234567\?text=/);
  const lead = (await all('leads'))[0];
  assert.equal(lead.status, 'trial');
  const r = await read('restaurants/' + lead.restaurantId);
  assert.equal(r.trial, true); assert.equal(r.subscription, 0);
  const days = (r.expiryMs - Date.now()) / 86400000;
  assert.ok(days > 1.9 && days < 3.01, 'expiry ~2 days: ' + days);
  const users = await all('users');
  assert.ok(users.some((u) => u.role === 'restaurant' && u.restaurantId === lead.restaurantId));
  assert.deepEqual(p.errors.filter((e) => !/Failed to load resource|integrity/.test(e)), []);
  await p.context().close();
});
