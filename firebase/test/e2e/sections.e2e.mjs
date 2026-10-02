import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const all = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), 'orders'), where('restaurantId', '==', 'RK'))); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const it = (name, price) => ({ name, variants: [{ name: 'وحدة', price }] });

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.owner = await signUp('kit@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RK', email: 'kit@x.com' });
    await setDoc(doc(db, 'restaurants/RK'), { name: 'مطعم الأقسام', userId: U.owner, active: true });
    await setDoc(doc(db, 'restaurants/RK/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'شاورما', emoji: '🌯', items: [it('ساندويش شاورما', 3000)] },
      { cat: 'كنتاكي', emoji: '🍗', items: [it('وجبة ٣ قطع', 7000)] },
      { cat: 'برغر', emoji: '🍔', items: [it('برغر كلاسك', 5000)] },
      { cat: 'بيتزا', emoji: '🍕', items: [it('بيتزا خضار', 9000)] },
      { cat: 'مشروبات', emoji: '🥤', items: [it('بيبسي', 1000)] }] });
    // طلبات قديمة بتوقيتات كاملة لشاشة التحليلات
    const t0 = Date.now() - 3 * 3600000, m = 60000;
    await setDoc(doc(db, 'orders/T1'), { restaurantId: 'RK', orderType: 'delivery', status: 'delivered', value: 9000, ticketNo: 7, captainName: 'كرار',
      createdAtMs: t0, kitchenReadyAt: t0 + 12 * m, acceptedAtMs: t0 + 3 * m, pickupAtMs: t0 + 13 * m, deliveringAtMs: t0 + 14 * m, deliveredAtMs: t0 + 32 * m,
      kSec: { k1: { n: 1, readyAt: t0 + 8 * m }, k4: { n: 1, readyAt: t0 + 12 * m } } });
    await setDoc(doc(db, 'orders/T2'), { restaurantId: 'RK', orderType: 'salon', status: 'delivered', value: 5000, ticketNo: 8,
      createdAtMs: t0 + 60 * m, kitchenReadyAt: t0 + 70 * m, servedAtMs: t0 + 72 * m });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function posLogin(p) {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'kit@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
}
const addByName = async (p, name) => { await p.fill('#prodSearch', name); await p.click('#prods .prod >> nth=0'); await p.fill('#prodSearch', ''); };

test('settings: enable sections and map menu categories', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await posLogin(p);
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#stSecOn');
  await p.check('#stSecOn');
  const map = { 'شاورما': 'k1', 'كنتاكي': 'k2', 'برغر': 'k3', 'بيتزا': 'k4' };
  for (const [cat, sid] of Object.entries(map)) await p.selectOption(`select[data-cat="${cat}"]`, sid);
  await p.screenshot({ path: 'shots/pos-sections-settings.png', fullPage: true });
  await p.click('button >> text=حفظ الإعدادات');
  const st = await until(async () => { const d = await read('restaurants/RK/settings/main'); return d && d.kSecOn ? d : null; });
  assert.deepEqual(st.catSection, map);
  assert.equal(st.sections[0].name, 'الشاورما');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('order splits by section, one printer: receipt + one ticket per section', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await posLogin(p);
  await addByName(p, 'بيتزا'); await addByName(p, 'شاورما'); await addByName(p, '٣ قطع'); await addByName(p, 'برغر'); await addByName(p, 'بيبسي');
  await p.click('#pagerBar .pg[data-pg="3"]');
  await p.click('#sendBtn'); await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on'); await p.click('#payOk');
  const o = await until(async () => (await all()).find((x) => x.orderType === 'salon' && x.kSec));
  assert.deepEqual(Object.keys(o.kSec).sort(), ['k1', 'k2', 'k3', 'k4']);
  assert.equal(o.items.find((i) => i.name === 'بيبسي').sec, undefined);
  assert.equal(o.ticketNo, 9);   // يكمل بعد أعلى رقم اليوم
  const doc_ = await p.evaluate(() => document.getElementById('prtFr').srcdoc);
  for (const n of ['قسم الشاورما', 'قسم الكنتاكي', 'قسم البرغر', 'قسم البيتزا']) assert.ok(doc_.includes(n), n);
  assert.equal((doc_.match(/page-break-before:always/g) || []).length >= 4, true);
  assert.ok(doc_.includes('#9') && doc_.includes('بيجر 3'));
  // تذكرة الشاورما فيها أصنافها فقط
  const sh = await p.evaluate((id) => secTicketBody(orders.find((x) => x.id === id), 'k1'), o.id);
  assert.ok(sh.includes('ساندويش شاورما') && !sh.includes('بيتزا خضار') && sh.includes('يكتمل مع'));
  await p.setContent(`<div style="display:flex;gap:16px;padding:16px;background:#eee">${['k1', 'k2', 'k3', 'k4'].map(() => '').join('')}</div>`).catch(() => {});
  await p.context().close();
  // صورة التذاكر
  const v = await page(B, { w: 1400, h: 700 });
  await v.setContent(`<html><body style="margin:0;background:#ddd"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start">${await (async () => {
    const q = await page(B, { w: 1280, h: 900 }); await posLogin(q);
    const h = await q.evaluate((id) => ['k1', 'k2', 'k3', 'k4'].map((k) => `<div style="background:#fff">${secTicketBody(orders.find((x) => x.id === id), k)}</div>`).join(''), o.id);
    await q.context().close(); return h; })()}</div></body></html>`);
  await v.screenshot({ path: 'shots/section-tickets.png' });
  await v.context().close();
});

test('kitchen tracking: section chips, section filter, all sections ready → order ready', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await posLogin(p);
  await p.evaluate(() => goTab('kitchen'));
  await p.waitForSelector('.kds-card .kds-sec');
  assert.equal(await p.locator('.kds-card >> nth=0').locator('.kds-sec').count(), 4);
  await p.screenshot({ path: 'shots/kds-sections.png' });
  await p.click('.kds-sec >> text=الشاورما');
  const o1 = await until(async () => (await all()).find((x) => x.kSec && x.kSec.k1 && x.kSec.k1.readyAt && x.orderType === 'salon'));
  assert.ok(o1);
  // فلتر قسم البيتزا: يظهر صنف البيتزا فقط
  await p.selectOption('#kdsSecSel', 'k4');
  await p.waitForFunction(() => document.querySelector('.kds-card .kds-items').textContent.includes('بيتزا') && !document.querySelector('.kds-card .kds-items').textContent.includes('شاورما'));
  await p.click('.kds-card .kds-done');
  await p.selectOption('#kdsSecSel', '');
  for (const n of ['الكنتاكي', 'البرغر']) await p.click(`.kds-sec >> text=${n}`);
  const done = await until(async () => (await all()).find((x) => x.id === o1.id && x.kitchen === 'ready'));
  assert.ok(done.kitchenReadyAt && Object.values(done.kSec).every((s) => s.readyAt));
  await p.evaluate(() => goTab('cashier'));
  await p.waitForSelector('#pagerBar .pg[data-pg="3"].ready');
  await p.click('#pagerBar .pg[data-pg="3"]'); await p.click('#acDlgOk');
  const served = await until(async () => (await all()).find((x) => x.id === o1.id && x.servedAtMs));
  assert.ok(served.servedAtMs >= served.kitchenReadyAt);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('QZ Tray mode: each section to its own printer, unassigned section falls back to receipt printer', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.addInitScript(() => {
    window.__qzJobs = [];
    window.qz = { websocket: { _a: false, isActive() { return this._a; }, async connect() { this._a = true; } },
      security: { setCertificatePromise() {}, setSignatureAlgorithm() {}, setSignaturePromise() {} },
      printers: { async find() { return ['P-SHAWARMA', 'P-KFC', 'P-BURGER', 'P-PIZZA']; } },
      configs: { create(printer, opts) { return { printer, opts }; } },
      async print(cfg, data) { window.__qzJobs.push({ printer: cfg.printer, html: data[0].data }); } };
  });
  await posLogin(p);
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#stQzOn');
  await p.selectOption('#stQzOn', '1');
  await p.click('button >> text=جلب الطابعات');
  await p.waitForFunction(() => document.querySelectorAll('#qzP_k1 option').length > 2);
  await p.selectOption('#qzP_k1', 'P-SHAWARMA'); await p.selectOption('#qzP_k2', 'P-KFC'); await p.selectOption('#qzP_k3', 'P-BURGER');
  await p.click('#qzBox button[onclick="qzTest(\'k1\')"]');
  await p.waitForFunction(() => window.__qzJobs.length === 1);
  await p.screenshot({ path: 'shots/pos-qz-settings.png', fullPage: true });
  await p.click('button >> text=حفظ الإعدادات');
  await p.evaluate(() => { window.__qzJobs = []; goTab('cashier'); });
  await addByName(p, 'شاورما'); await addByName(p, '٣ قطع'); await addByName(p, 'بيتزا');
  await p.click('#sendBtn'); await p.keyboard.press('1');
  await p.waitForSelector('#payOv.on'); await p.click('#payOk');
  await p.waitForFunction(() => window.__qzJobs.length === 2);
  const jobs = await p.evaluate(() => window.__qzJobs.map((j) => ({ printer: j.printer, sh: j.html.includes('قسم الشاورما'), kfc: j.html.includes('قسم الكنتاكي') })));
  assert.deepEqual(jobs, [{ printer: 'P-SHAWARMA', sh: true, kfc: false }, { printer: 'P-KFC', sh: false, kfc: true }]);
  await p.waitForFunction(() => document.getElementById('prtFr').srcdoc.includes('قسم البيتزا'));
  const rc = await p.evaluate(() => document.getElementById('prtFr').srcdoc);
  assert.ok(!rc.includes('قسم الشاورما'));
  await p.context().close();
});

test('admin: order times analytics (restaurant owner)', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'kit@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scTimes"]');
  await p.waitForSelector('#tmBody .tm-tbl');
  const txt = await p.textContent('#tmBody');
  assert.ok(txt.includes('٣٢ د'), 'delivery total 32 min');
  assert.ok(txt.includes('١٢ د'), 'kitchen 12 min');
  assert.ok(txt.includes('كرار'));
  assert.ok(txt.includes('الشاورما'), 'section names from settings');
  await p.screenshot({ path: 'shots/admin-times.png', fullPage: true });
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
