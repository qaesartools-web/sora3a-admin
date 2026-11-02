// يوم العمل: الحسابات من وقت فتح المطعم لوقت إغلاقه حتى لو يعبر نص الليل (مثلاً يفتح ١٢ الظهر ويسد ٢ بالليل)
//  مبيعات ١٢:٣٠ بالليل تنحسب على نفس اليوم (بالكاشير ولوحة الإدارة)، وأرقام الطلبات تبقى تتصفر ١٢ بالليل
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const H = 3600000, DAY = 24 * H;
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 250)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// الساعة بالمتصفح: اليوم ١:٣٠ بالليل (بعد نص الليل وقبل ما يسد المطعم)
const T = (() => { const d = new Date(); d.setHours(1, 30, 0, 0); return d.getTime(); })();
const money = (n) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '[,٬]'));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('bown@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RB', email: 'bown@x.com', name: 'أبو حيدر' });
    await setDoc(doc(db, 'restaurants/RB'), { name: 'مطعم الليل', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RB/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [
      { name: 'كلاسك', variants: [{ name: 'وحدة', price: 5000 }] }, { name: 'زنكر', variants: [{ name: 'وحدة', price: 3000 }] }, { name: 'بطاطا', variants: [{ name: 'وحدة', price: 1000 }] }] }] });
    // يفتح ١٢ الظهر ويسد ٢ بالليل
    await setDoc(doc(db, 'restaurants/RB/settings/main'), { tables: 4, receiptTitle: 'مطعم الليل', bizHours: { open: 720, close: 120 }, updatedAtMs: 1 });
    const o = (id, at, name, price, extra) => setDoc(doc(db, 'orders/' + id), { restaurantId: 'RB', status: 'delivered', createdAtMs: at, items: [{ name, variant: 'وحدة', price, qty: 1 }], value: price, ...extra });
    await o('A', T - 12.5 * H, 'كلاسك', 5000, { orderType: 'salon', payment: { method: 'cash', cash: 5000, card: 0 } });    // أمس ١ الظهر
    await o('B', T - 1 * H, 'زنكر', 3000, { orderType: 'takeaway', payment: { method: 'card', cash: 0, card: 3000 } });    // اليوم ١٢:٣٠ بالليل (نفس يوم العمل)
    await o('C', T - 20.5 * H, 'بطاطا', 1000, { orderType: 'salon', payment: { method: 'cash', cash: 1000, card: 0 } });   // أمس ٥ الصبح (يوم العمل اللي قبله)
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function at(w, h) { const p = await page(B, { w, h }); await p.clock.install({ time: T }); await p.clock.resume(); return p; }
async function pos() {
  const p = await at(1280, 860);
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'bown@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  return p;
}
const daily = async (p) => { await p.evaluate(() => { document.getElementById('prtFr') && (document.getElementById('prtFr').srcdoc = ''); goTab('shift'); }); await p.click('button >> text=طباعة تقرير اليوم'); return p.evaluate(() => document.getElementById('prtFr').srcdoc); };

test('business day: the cashier counts sales from opening to closing even after midnight; settings set the hours; Tower hours are the fallback', async () => {
  const p = await pos();
  await p.waitForFunction(() => window.posBizCut && window.posBizCut() === 420, null, { timeout: 10000 });   // اليوم الجديد يبدي ٧ الصبح (نص فترة الغلق)
  // تقرير اليوم: أمس ١ الظهر + اليوم ١٢:٣٠ بالليل = ٨٠٠٠ — وطلب ٥ الصبح أمس مو منه
  let rc = await daily(p);
  assert.ok(rc.includes('التقرير اليومي'));
  assert.match(rc, money(8000)); assert.ok(rc.includes('صالة (1)') && rc.includes('سفري (1)'), 'one salon + one takeaway');
  assert.doesNotMatch(rc, money(9000));
  // التقارير: «اليوم» = تاريخ يوم العمل (أمس بالتقويم)
  await p.evaluate(() => { goTab('reports'); setPreset('today'); });
  assert.equal(await p.inputValue('#repFrom'), ymd(T - DAY)); assert.equal(await p.inputValue('#repTo'), ymd(T - DAY));
  // الإعدادات: الأوقات تبين، والتغيير ينحفظ لكل الأجهزة بدون ما يمسح باقي الإعدادات
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  assert.equal(await p.inputValue('#stBizOpen'), '12:00'); assert.equal(await p.inputValue('#stBizClose'), '02:00');
  assert.match(await p.textContent('#stBizNote'), /يعبر ١٢ بالليل/);
  await p.fill('#stBizClose', '');
  await p.click('button >> text=حفظ الإعدادات');
  await p.waitForTimeout(800);
  assert.equal((await read('restaurants/RB/settings/main')).bizHours.close, 120, 'half-filled hours are refused');
  await p.fill('#stBizClose', '03:00');
  await p.click('button >> text=حفظ الإعدادات');
  const s = await until(async () => { const x = await read('restaurants/RB/settings/main'); return x && x.bizHours && x.bizHours.close === 180 ? x : null; });
  assert.deepEqual(s.bizHours, { open: 720, close: 180 }); assert.equal(s.tables, 4);
  assert.equal(await p.evaluate(() => window.posBizCut()), 450);
  // بدون أوقات (ولا ساعات دوام بالبرج): نص الليل مثل قبل ← اليوم = بس طلب ١٢:٣٠
  await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'restaurants/RB/settings/main'), { bizHours: null }); });
  await p.waitForFunction(() => window.posBizCut() === 0, null, { timeout: 10000 });
  rc = await daily(p);
  assert.match(rc, money(3000)); assert.doesNotMatch(rc, money(8000));
  // ساعات الدوام من برج سرعة (١٠ الصبح ← ١ بالليل) ← اليوم الجديد يبدي ٥:٣٠ الصبح
  await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'restaurants/RB'), { hours: { on: true, open: 600, close: 60 } }); });
  await p.waitForFunction(() => window.posBizCut() === 330, null, { timeout: 10000 });
  rc = await daily(p);
  assert.match(rc, money(8000));
  assert.deepEqual(clean(p), []);
  await p.context().close();
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await updateDoc(doc(db, 'restaurants/RB'), { hours: null });
    await updateDoc(doc(db, 'restaurants/RB/settings/main'), { bizHours: { open: 720, close: 120 } });
  });
});

test('business day in the admin app: today\'s orders and sales follow opening→closing; the owner sets the hours from the accounts screen', async () => {
  const p = await at(1280, 900);
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', 'bown@x.com'); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  // الرئيسية: طلبات اليوم = ٢ (أمس ١ الظهر + ١٢:٣٠ بالليل)
  await p.waitForFunction(() => /^2\s*📅 طلبات اليوم/.test((document.querySelector('#dashStats .stat') || {}).innerText?.replace(/\n/g, ' ') || ''), null, { timeout: 15000 });
  // الحسابات ← مبيعات الأصناف: اليوم ٨٠٠٠، وأمس (يوم العمل اللي قبله) ١٠٠٠
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.click('#axTabs button >> text=مبيعات الأصناف');
  await p.waitForFunction(() => (document.getElementById('axSalesTbl') || {}).textContent?.includes('8,000'), null, { timeout: 10000 });
  assert.ok(!(await p.textContent('#axSalesTbl')).includes('بطاطا'));
  await p.selectOption('#axRange', 'yesterday');
  await p.waitForFunction(() => document.getElementById('axSalesTbl').textContent.includes('بطاطا'));
  assert.ok(!(await p.textContent('#axSalesTbl')).includes('زنكر'));
  // من تاريخ إلى تاريخ: تاريخ يوم العمل
  await p.selectOption('#axRange', 'custom');
  await p.fill('#axFrom', ymd(T - DAY)); await p.fill('#axTo', ymd(T - DAY)); await p.dispatchEvent('#axTo', 'change');
  await p.waitForFunction(() => document.getElementById('axSalesTbl').textContent.includes('8,000'));
  // خانة يوم العمل: تبين الأوقات، والحفظ ما يمسح باقي إعدادات المطعم
  assert.equal(await p.isVisible('#bizBox'), true);
  assert.equal(await p.inputValue('#bizOpen'), '12:00'); assert.equal(await p.inputValue('#bizClose'), '02:00');
  await p.fill('#bizOpen', '13:00'); await p.click('#bizSaveBtn');
  const s = await until(async () => { const x = await read('restaurants/RB/settings/main'); return x && x.bizHours && x.bizHours.open === 780 ? x : null; });
  assert.deepEqual(s.bizHours, { open: 780, close: 120 }); assert.equal(s.tables, 4); assert.equal(s.receiptTitle, 'مطعم الليل');
  await p.fill('#bizClose', ''); await p.click('#bizSaveBtn');
  await p.waitForTimeout(800);
  assert.equal((await read('restaurants/RB/settings/main')).bizHours.close, 120, 'half-filled hours are refused');
  assert.deepEqual(clean(p), []);
  await p.screenshot({ path: 'shots/admin-bizday.png' });
  await p.context().close();
});
