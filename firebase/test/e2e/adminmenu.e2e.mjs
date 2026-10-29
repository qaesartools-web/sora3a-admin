// المنيو يتعدل من لوحة الإدارة بس: فروع وأصناف وأسعار وصور ومخزون جاهز — والكاشير يبيع وينقّص المخزون بدون ما يمسح تعديل المالك
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, runTransaction } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, own;
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (path) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), path))).data(); }); return v; };
const menuDoc = () => read('restaurants/RM/menu/main');
const item = (m, name) => m && m.cats.flatMap((c) => c.items).find((i) => i.name === name);
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  own = await signUp('menuown@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RM', email: 'menuown@x.com', name: 'أبو مصطفى' });
    await setDoc(doc(db, 'restaurants/RM'), { name: 'مطعم المنيو', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RM/settings/main'), { kSecOn: true, catSection: { 'مشويات': 'k1' }, updatedAtMs: 1 });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function admin() {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'menuown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  await p.click('.dnav-btn[data-screen="scMenu"]');
  return p;
}
async function cashier() {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'menuown@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#appPage.show', { timeout: 15000 });
  return p;
}
async function addItem(p, { name, vars, stock, img }) {
  await p.click('#mnBody button >> text=صنف جديد >> nth=0');
  await p.waitForSelector('#mnMo.open');
  await p.fill('#mnIn', name);
  for (let i = 0; i < vars.length; i++) {
    if (i) await p.click('#mnMo button >> text=حجم/سعر');
    await p.fill(`#mnVars .mn-var >> nth=${i} >> input >> nth=0`, vars[i][0]);
    await p.fill(`#mnVars .mn-var >> nth=${i} >> input >> nth=1`, String(vars[i][1]));
  }
  if (stock != null) await p.fill('#mnIs', String(stock));
  if (img) { await p.setInputFiles('#mnMo input[type=file]', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await p.waitForSelector('#mnIp img'); }
  await p.click('#mnIsave');
  await p.waitForSelector('#mnMo.open', { state: 'detached' }).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('mnMo').classList.contains('open'));
}

test('admin builds the menu (category, items with sizes, image, ready stock); the cashier shows it and has no menu editing', async () => {
  const c = await cashier();
  await c.waitForSelector('.prod-empty');
  const p = await admin();
  await p.waitForSelector('#mnBody >> text=المنيو فاضي');
  await p.click('#mnBody button >> text=أضف أول فرع');
  await p.fill('#mnCn', 'مشويات'); await p.fill('#mnCe', '🔥'); await p.click('#mnCsave');
  await until(async () => { const m = await menuDoc(); return m && m.cats[0] && m.cats[0].cat === 'مشويات'; });
  await p.waitForSelector('.mn-cats button >> text=مشويات');
  await addItem(p, { name: 'تكة', vars: [['صغير', 4000], ['كبير', 7000]], img: true });
  await addItem(p, { name: 'كباب', vars: [['وحدة', 6000]], stock: 5 });
  const m = await until(async () => { const d = await menuDoc(); return item(d, 'كباب') ? d : null; });
  const t = item(m, 'تكة'), k = item(m, 'كباب');
  assert.deepEqual(t.variants, [{ name: 'صغير', price: 4000 }, { name: 'كبير', price: 7000 }]);
  assert.ok(t.imgId, 'image saved');
  assert.match((await read('restaurants/RM/menuImages/' + t.imgId)).data, /^data:image\/jpeg/);
  assert.equal(k.stock, 5); assert.equal(m.device, 'admin');
  await p.waitForSelector('.mn-item:has-text("تكة") .mn-img img');
  await p.screenshot({ path: 'shots/admin-menu.png' });
  // الكاشير: الأصناف توصل وحدها وياها الصورة، وما بيه أي تعديل للمنيو
  await c.waitForFunction(() => document.querySelectorAll('#prods .prod').length === 2, null, { timeout: 15000 });
  await c.waitForSelector('#prods .prod:has-text("تكة") .pimg img');
  await c.evaluate(() => goTab('menu'));
  assert.equal(await c.isVisible('#mt1'), false); assert.equal(await c.isVisible('#mAddSec'), false);
  assert.deepEqual(clean(p), []); assert.deepEqual(clean(c), []);
  await p.context().close(); await c.context().close();
});

test('a sale lowers the ready stock on top of an admin edit made at the same moment (nothing is lost); «نفذ» stops the item at the cashier', async () => {
  const c = await cashier();
  await c.waitForSelector('#prods .prod:has-text("كباب")');
  await c.click('#prods .prod:has-text("كباب")'); await c.click('#prods .prod:has-text("كباب")');
  await c.keyboard.press('F9'); await c.waitForSelector('#typeOv.on'); await c.keyboard.press('1');
  await c.waitForSelector('#payOv.on'); await c.click('#payOk');
  // المالك يغيّر سعر «تكة» بنفس اللحظة (قبل ما يرتفع نقص المخزون)
  await E.withSecurityRulesDisabled(async (x) => {
    const db = x.firestore(), ref = doc(db, 'restaurants/RM/menu/main');
    await runTransaction(db, async (tx) => { const d = (await tx.get(ref)).data();
      d.cats[0].items.find((i) => i.name === 'تكة').variants[1].price = 7500;
      tx.set(ref, { ...d, updatedAtMs: Date.now(), device: 'admin' }); });
  });
  const m = await until(async () => { const d = await menuDoc(); return item(d, 'كباب').stock === 3 ? d : null; });
  assert.ok(m, 'stock 5 − 2 sold = 3 in the cloud');
  assert.equal(item(m, 'تكة').variants[1].price, 7500, 'the admin price change is kept');
  await c.waitForFunction(() => menu[0].items.find((i) => i.name === 'تكة').variants[1].price === 7500 && menu[0].items.find((i) => i.name === 'كباب').stock === 3, null, { timeout: 15000 });
  // «نفذ» من الإدارة ← الكاشير ما يكدر يطلبه
  const p = await admin();
  await p.click('.mn-item:has-text("كباب") button >> text=نفذ');
  await until(async () => item(await menuDoc(), 'كباب').stock === 0);
  await c.waitForSelector('#prods .prod.soldout:has-text("كباب")', { timeout: 15000 });
  await p.click('.mn-item:has-text("كباب") button >> text=متوفر');
  await until(async () => item(await menuDoc(), 'كباب').stock === undefined);
  assert.deepEqual(clean(p), []); assert.deepEqual(clean(c), []);
  await p.context().close(); await c.context().close();
});

test('rename a category (its kitchen section follows), move and delete items, delete a category', async () => {
  const p = await admin();
  await p.waitForSelector('.mn-cats button >> text=مشويات');
  await p.click('#mnBody button >> text=تعديل الفرع');
  await p.fill('#mnCn', 'مشاوي'); await p.click('#mnCsave');
  await until(async () => (await menuDoc()).cats[0].cat === 'مشاوي');
  const s = await until(async () => { const d = await read('restaurants/RM/settings/main'); return d.catSection['مشاوي'] ? d : null; });
  assert.equal(s.catSection['مشاوي'], 'k1'); assert.equal(s.catSection['مشويات'], undefined);
  // فرع ثاني ونقل «كباب» له
  await p.click('#mnBody button >> text=فرع جديد');
  await p.fill('#mnCn', 'عروض'); await p.click('#mnCsave');
  await p.waitForSelector('.mn-cats button >> text=عروض');
  await p.click('.mn-cats button >> text=مشاوي');
  await p.click('.mn-item:has-text("كباب") button >> text=تعديل');
  await p.selectOption('#mnIc', 'عروض'); await p.click('#mnIsave');
  const m = await until(async () => { const d = await menuDoc(); return d.cats[1] && d.cats[1].items.some((i) => i.name === 'كباب') ? d : null; });
  assert.deepEqual(m.cats[0].items.map((i) => i.name), ['تكة']);
  // ما يقبل اسم مكرر
  await p.click('.mn-item:has-text("تكة") button >> text=تعديل');
  await p.fill('#mnIn', 'كباب'); await p.click('#mnIsave');
  await p.waitForTimeout(800);
  assert.ok(await p.isVisible('#mnMo.open'), 'duplicate name refused');
  await p.evaluate(() => mnClose());
  // حذف صنف ثم الفرع
  await p.click('.mn-item:has-text("تكة") button.btn-del');
  await until(async () => (await menuDoc()).cats[0].items.length === 0);
  await p.click('.mn-cats button >> text=عروض');
  await p.click('#mnBody .card-title button.btn-del');
  const d = await until(async () => { const x = await menuDoc(); return x.cats.length === 1 ? x : null; });
  assert.equal(d.cats[0].cat, 'مشاوي');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
