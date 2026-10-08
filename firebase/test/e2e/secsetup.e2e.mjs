// حالة «مندي المدينة»: التقسيم مطفي والفئات مو مربوطة → الطلب يطلع فاتورة بس.
// الإعدادات لازم تنبّه، والربط التلقائي يربط الفئات بالأقسام، والطلب التجريبي يطابق الطلب الحقيقي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const it = (name, price) => ({ name, variants: [{ name: 'وحدة', price }] });
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const u = await signUp('mandi@x.com', 'secret123');
  const boss = await signUp('boss@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', u), { role: 'restaurant', restaurantId: 'RM', email: 'mandi@x.com' });
    await setDoc(doc(db, 'users', boss), { role: 'admin', email: 'boss@x.com' });
    await setDoc(doc(db, 'restaurants/RM'), { name: 'مندي المدينة', userId: u, active: true });
    await setDoc(doc(db, 'restaurants/RM/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'برغر', emoji: '🍔', items: [it('فشاج برغر', 2500), it('برغر دبل', 5000)] },
      { cat: 'شاورما', emoji: '🌯', items: [it('شاورما لحم', 4000)] },
      { cat: 'صاج', emoji: '🫓', items: [it('صاج دجاج', 2000)] },
      { cat: 'بيتزا', emoji: '🍕', items: [it('بيتزا كرسبي (كبير)', 7000)] }] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('super admin: printer test mode is OFF by default and is switched on per restaurant', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'boss@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('.dnav-btn[data-screen="scRests"]', { timeout: 15000 });
  await p.click('.dnav-btn[data-screen="scRests"]');
  const btn = p.locator('.svc', { hasText: 'تجربة الطابعات' });
  await btn.waitFor();
  assert.match(await btn.textContent(), /⛔/, 'off by default');
  assert.match(await p.locator('.svc', { hasText: 'البيجر' }).textContent(), /✅/, 'other services stay on by default');
  await btn.click();
  const r = await until(async () => { const d = await read('restaurants/RM'); return d.features && d.features.printTest === true ? d : null; });
  assert.ok(r, 'features.printTest saved');
  await p.waitForFunction(() => [...document.querySelectorAll('.svc')].some((b) => b.textContent.includes('تجربة الطابعات') && b.textContent.includes('✅')));
  await p.context().close();
});

test('split off / categories unlinked → clear warnings, auto-link by name, sample order matches the real routing', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.addInitScript(() => {
    window.__dJobs = [];
    window.SoraDesktop = { version: '1.0.4', printers: async () => [{ name: 'V-Cashier', displayName: 'V-Cashier', isDefault: true, ok: true, statusText: 'جاهزة' }],
      print: async (html, o) => { window.__dJobs.push({ html, ...o }); return { ok: true }; }, jobs: async () => [], reprint: async () => ({ ok: true }),
      getAutoStart: async () => false, setAutoStart: async (v) => v, getTestMode: async () => true, setTestMode: async (v) => v, openSimulator: async () => true, onUpdate() {} };
  });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'mandi@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#secHealth .sh-warn');
  // 1) التقسيم مطفي → تنبيه واضح، والطلب التجريبي يطبع فاتورة بس مثل الطلب الحقيقي
  assert.match(await p.textContent('#secHealth'), /تقسيم الأقسام مطفي/);
  await p.click('button >> text=طلب تجريبي');
  await p.waitForFunction(() => window.__dJobs.length === 1);
  await p.waitForSelector('text=انطبعت فاتورة بس');
  // 2) نفعّل → تنبيه الفئات غير المربوطة
  await p.click('#secHealth button >> text=فعّل التقسيم');
  await p.waitForFunction(() => document.getElementById('secHealth').textContent.includes('ما مربوطة'));
  assert.match(await p.textContent('#secHealth'), /4 فئة ما مربوطة.*برغر.*شاورما.*صاج.*بيتزا/s);
  assert.match(await p.textContent('#secHealth'), /حفظ الإعدادات/);
  // 3) الربط التلقائي: برغر←البرغر، شاورما←الشاورما، بيتزا←البيتزا، صاج يبقى (ماكو قسم يشبهه)
  await p.click('#secHealth button >> text=ربط تلقائي');
  const map = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id^="stCat"]')].map((el) => [el.dataset.cat, el.value])));
  assert.deepEqual(map, { 'برغر': 'k3', 'شاورما': 'k1', 'صاج': '', 'بيتزا': 'k4' });
  assert.match(await p.textContent('#secHealth'), /1 فئة ما مربوطة.*صاج/s);
  // صاج يدوياً للشاورما
  await p.selectOption('select[data-cat="صاج"]', 'k1');
  await p.waitForFunction(() => document.getElementById('secHealth').textContent.includes('كل الفئات مربوطة'));
  await p.locator('.sh-card', { has: p.locator('#secHealth') }).screenshot({ path: 'shots/pos-sections-health.png' });
  await p.click('button >> text=حفظ الإعدادات');
  const st = await until(async () => { const d = await read('restaurants/RM/settings/main'); return d && d.kSecOn ? d : null; });
  assert.deepEqual(st.catSection, { 'برغر': 'k3', 'شاورما': 'k1', 'صاج': 'k1', 'بيتزا': 'k4' });
  // 4) الطلب التجريبي هسه: فاتورة + 3 تذاكر (الشاورما فيها شاورما + صاج)، من المنيو الحقيقي
  await p.evaluate(() => { window.__dJobs = []; });
  await p.click('button >> text=طلب تجريبي');
  await p.waitForFunction(() => window.__dJobs.length === 4);
  const kinds = await p.evaluate(() => window.__dJobs.map((j) => (j.html.match(/قسم ([^<]+)</) || [, 'فاتورة'])[1].trim()).sort());
  assert.deepEqual(kinds, ['البرغر', 'البيتزا', 'الشاورما', 'فاتورة']);
  const sh = await p.evaluate(() => window.__dJobs.find((j) => j.html.includes('قسم الشاورما')).html);
  assert.ok(sh.includes('شاورما لحم') && sh.includes('صاج دجاج') && !sh.includes('فشاج برغر') && sh.includes('يكتمل مع'));
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('pos_ticket_RM') || 'null')), null, 'sample did not consume a ticket number');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('cashier: no test mode without the service; when the admin turns it off, test mode switches off and real printers come back', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.addInitScript(() => {
    window.__test = true; window.__setCalls = [];
    window.SoraDesktop = { version: '1.0.4', printers: async () => [{ name: 'XP-80', displayName: 'XP-80', isDefault: true, ok: true, statusText: 'جاهزة' }],
      print: async () => ({ ok: true }), jobs: async () => [], reprint: async () => ({ ok: true }), getAutoStart: async () => false, setAutoStart: async (v) => v,
      getTestMode: async () => window.__test, setTestMode: async (v) => { window.__setCalls.push(v); window.__test = !!v; return !!v; }, openSimulator: async () => true, onUpdate() {} };
    localStorage.setItem('pos_dp_RM', JSON.stringify({ main: '🧪 تجريبية — الكاشير', printers: { k1: '🧪 تجريبية — مطبخ 1', k3: 'XP-80' }, copies: {}, receiptCopies: 1, fallback: true }));
  });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'mandi@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#dpTestChk');   // الخدمة مفعّلة من الاختبار السابق
  // المدير الأعلى يطفيها
  await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'restaurants/RM'), { 'features.printTest': false }); });
  await p.waitForFunction(() => window.__setCalls.includes(false), null, { timeout: 10000 });
  await p.waitForFunction(() => !document.getElementById('dpTestChk'), null, { timeout: 10000 });
  const cfg = await p.evaluate(() => dpCfgGet());
  assert.deepEqual({ main: cfg.main, printers: cfg.printers }, { main: '', printers: { k3: 'XP-80' } }, 'virtual printers removed, real ones kept');
  await p.waitForSelector('text=انطفت من الإدارة');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
