// تطبيق «سرعة — خط المطعم» (صفحة وحدة line.html): صاحب المطعم يسجّل دخول ويكتب الرقم ← ينضاف خط للمطعم،
// والتلفون يرسل رقم المتصل (شريحة/واتساب) ← يطلع بالكاشير. تطبيق الكاشير ما بيه ربط خط (بدون تكرار)،
// بس يفتح وحده مع تشغيل الجهاز.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDocs, updateDoc, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const LINE_URL = 'http://localhost:5050/sora3a-rest2/line.html';
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const lines = async () => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), 'lineTokens'), where('restaurantId', '==', 'RL'))); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
// نفس الطلب اللي يرسله التطبيق (CallLine.body بالجافا)
const ring = (token, line, number) => fetch('http://127.0.0.1:8080/v1/projects/sora3a-system/databases/(default)/documents/incomingCalls?key=fake', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { token: { stringValue: token }, restaurantId: { stringValue: 'RL' }, line: { stringValue: line }, number: { stringValue: number }, status: { stringValue: 'ringing' } } }) });

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.owner = await signUp('line@x.com', 'secret123');
  U.cash = await signUp('linecash@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RL', email: 'line@x.com' });
    await setDoc(doc(db, 'users', U.cash), { role: 'cashier', restaurantId: 'RL', email: 'linecash@x.com', name: 'علي', perms: { settings: true, menu: true } });
    await setDoc(doc(db, 'restaurants/RL'), { name: 'مطعم الخط', userId: U.owner, active: true });
    await setDoc(doc(db, 'restaurants/RL/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }] }] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

// تطبيق خط المطعم (window.SoraDesktop من Bridge.SHIM بنسخة الخط) — حالة الخط والأذونات بالذاكرة مثل SharedPreferences
async function linePage(w = 412) {
  const p = await page(B, { w, h: 900 });
  await p.addInitScript(() => {
    window.__line = null; window.__opened = [];
    window.__perms = { phone: false, notif: false, battery: false, overlay: false, sim: true };
    const status = () => ({ linked: !!window.__line, perms: { ...window.__perms }, android: 34, maker: 'xiaomi', ...(window.__line || {}) });
    window.SoraDesktop = { version: '1.6', platform: 'android', canCallLine: true,
      getCallLine: async () => status(),
      setCallLine: async (c) => { window.__line = { ...c, lastAt: 0 }; return status(); },
      clearCallLine: async () => { window.__line = null; return status(); },
      openPerm: async (k) => { window.__opened.push(k); return true; },
      // التطبيق يرسل مكالمة تجريبية بنفس طلب المكالمة الحقيقية (بدون تسجيل دخول)
      testCall: async () => { const l = window.__line;
        const r = await fetch('http://127.0.0.1:8080/v1/projects/sora3a-system/databases/(default)/documents/incomingCalls?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fields: { token: { stringValue: l.token }, restaurantId: { stringValue: l.restaurantId }, line: { stringValue: l.line }, number: { stringValue: '07700000000' }, status: { stringValue: 'ringing' } } }) });
        Object.assign(l, { lastAt: Date.now(), lastNumber: '07700000000', lastErr: r.ok ? '' : 'خطأ ' + r.status, lastKind: 'sim' }); return r.ok ? { ok: true } : { ok: false, error: 'خطأ ' + r.status }; } };
  });
  return p;
}
async function lineLogin(p, email, pass = 'secret123') {
  await p.goto(LINE_URL);
  await p.waitForSelector('#lnEmail', { timeout: 15000 });
  await p.fill('#lnEmail', email); await p.fill('#lnPass', pass); await p.click('#lnLoginBtn');
}
async function cashierLogin(p) {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'line@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
}
const resume = (p) => p.evaluate(() => window.dispatchEvent(new Event('sora:resume')));

test('line app: owner signs in, types the number → line added, permissions guided, SIM/WhatsApp calls reach the cashier, unlink removes it', async () => {
  const cash = await page(B, { w: 1280, h: 800 });
  await cashierLogin(cash);
  await cash.waitForTimeout(1500); // الكاشير يبدأ يسمع المكالمات
  const p = await linePage();
  // كلمة مرور غلط ← رسالة واضحة
  await lineLogin(p, 'line@x.com', 'wrongpass1');
  await p.waitForFunction(() => document.getElementById('lnErr').textContent.includes('غلط'));
  await p.fill('#lnPass', 'secret123'); await p.click('#lnLoginBtn');
  await p.waitForSelector('#lnNum');
  assert.match(await p.textContent('#app'), /مطعم الخط/);
  // رقم ناقص ← تنبيه وما ينضاف شي
  await p.fill('#lnNum', '0780');
  await p.click('#lnLinkBtn');
  await p.waitForSelector('text=اكتب رقم المطعم كامل');
  assert.equal((await lines()).length, 0);
  await p.fill('#lnNum', '0780 123 4567');
  await p.click('#lnLinkBtn');
  const [ln] = await until(async () => { const l = await lines(); return l.length ? l : null; });
  assert.deepEqual({ line: ln.line, label: ln.label, active: ln.active }, { line: '1', label: '07801234567', active: true });
  assert.ok(ln.id.length >= 24, 'secret token');
  const saved = await p.evaluate(() => window.__line);
  assert.deepEqual({ ...saved, lastAt: undefined }, { token: ln.id, restaurantId: 'RL', line: '1', label: '07801234567', sim: true, wa: true, lastAt: undefined });
  // مربوط + الأذونات الناقصة كل وحدة بزرها
  await p.waitForSelector('#app .ok');
  assert.match(await p.textContent('#app .ok'), /مطعم الخط.*خط 1.*07801234567/s);
  assert.equal(await p.locator('.perm.bad').count(), 3);
  assert.match(await p.textContent('#app'), /الإعدادات المقيّدة/, 'Android 13+ restricted-settings hint');
  assert.match(await p.textContent('#app'), /Autostart/, 'Xiaomi autostart hint');
  await p.click('.perm.bad >> nth=0 >> button.btn');
  await p.click('.perm.bad >> nth=1 >> button.btn');
  assert.deepEqual(await p.evaluate(() => window.__opened), ['phone', 'notif']);
  // رجع من الإعدادات بعد ما سمح ← كلها ✅
  await p.evaluate(() => { Object.assign(window.__perms, { phone: true, notif: true, battery: true }); });
  await resume(p);
  await p.waitForFunction(() => document.querySelectorAll('.perm.bad').length === 0 && document.body.textContent.includes('الأذونات كاملة'));
  // مكالمة على الشريحة ومكالمة واتساب من التلفون ← تطلع بالكاشير
  assert.equal((await ring(ln.id, '1', '07709998888')).status, 200);
  await cash.waitForSelector('.call-card >> text=07709998888');
  assert.match(await cash.textContent('.call-card'), /خط 1/);
  assert.equal((await ring(ln.id, 'واتساب 1', 'أبو علي')).status, 200);
  await cash.waitForSelector('.call-card >> text=خط واتساب 1');
  // مكالمة تجريبية من التطبيق
  await p.click('#lnTestBtn');
  await p.waitForSelector('text=لازم تطلع هسه بشاشة الكاشير');
  await cash.waitForSelector('.call-card >> text=07700000000');
  await p.waitForFunction(() => document.getElementById('app').textContent.includes('آخر مكالمة وصلت للكاشير'));
  // إلغاء الربط ← الخط ينحذف من المطعم ويرجع حقل الرقم
  await p.click('button[onclick="lnUnlink()"]');
  await until(async () => (await lines()).length === 0);
  assert.equal((await lines()).length, 0);
  await p.waitForSelector('#lnNum');
  assert.equal(await p.evaluate(() => window.__line), null);
  assert.equal((await ring(ln.id, '1', '07709998888')).status, 403, 'old token stops working');
  assert.deepEqual(clean(p), []);
  assert.deepEqual(clean(cash), []);
  await p.context().close(); await cash.context().close();
});

test('line app: same number on a new phone reuses its line (no extra lines); a paused line is refused', async () => {
  const T = 'L'.repeat(30) + 'reuse';
  await E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'lineTokens', T), { restaurantId: 'RL', line: '3', label: '0780 555 1212', active: true, createdAtMs: 1 }));
  const p = await linePage();
  await lineLogin(p, 'line@x.com');
  await p.waitForSelector('#lnNum');
  await p.fill('#lnNum', '07805551212');
  await p.uncheck('#lnSim');
  await p.click('#lnLinkBtn');
  await p.waitForSelector('#app .ok');
  const saved = await p.evaluate(() => window.__line);
  assert.equal(saved.token, T); assert.equal(saved.line, '3'); assert.equal(saved.sim, false); assert.equal(saved.wa, true);
  assert.equal((await lines()).length, 1, 'no new line created');
  // واتساب بس ← ما يطلب إذن الهاتف
  assert.equal(await p.locator('.perm').count(), 2);
  // التلفون انفصل محلياً، والإدارة أوقفت الخط ← ما ينربط
  await p.evaluate(() => { window.__line = null; });
  await write('lineTokens/' + T, { active: false });
  await resume(p);
  await p.waitForSelector('#lnNum');
  await p.fill('#lnNum', '07805551212');
  await p.click('#lnLinkBtn');
  await p.waitForSelector('text=هذا الخط موقوف من الإدارة');
  assert.equal(await p.evaluate(() => window.__line), null);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('line app: cashier account refused (owner only); services off → clear message; opened outside the app → download link', async () => {
  const p = await linePage();
  await lineLogin(p, 'linecash@x.com');
  await p.waitForFunction(() => (document.getElementById('lnErr') || {}).textContent?.includes('حساب كاشير'));
  assert.equal(await p.$('#lnNum'), null);
  await write('restaurants/RL', { features: { calls: false, whatsapp: false } });
  await p.fill('#lnEmail', 'line@x.com'); await p.fill('#lnPass', 'secret123'); await p.click('#lnLoginBtn');
  await p.waitForSelector('text=خدمة المكالمات مطفية');
  assert.equal(await p.$('#lnNum'), null);
  await write('restaurants/RL', { features: {} });
  await p.click('button[onclick="lnLogout()"]');
  await p.waitForSelector('#lnEmail');
  assert.deepEqual(clean(p), []);
  await p.context().close();
  // متصفح عادي (مو داخل التطبيق)
  const w = await page(B, { w: 412, h: 900 });
  await w.goto(LINE_URL);
  await w.waitForSelector('#app a.btn');
  assert.match(await w.getAttribute('#app a.btn', 'href'), /download\/line-android\/sora3a-line\.apk$/);
  await w.context().close();
});

test('Android cashier app: no line card (it lives in the line app); auto-start asks for overlay then turns on', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.addInitScript(() => {
    window.__opened = []; window.__overlay = false; window.__auto = true;
    window.SoraDesktop = { version: '1.6', platform: 'android', canAutoStart: true, canAddNetwork: true,
      printers: async () => [], print: async () => ({ ok: true }), jobs: async () => [], reprint: async () => ({ ok: true }),
      getTestMode: async () => false, setTestMode: async (v) => v, openSimulator: async () => true, onUpdate() {},
      addNetworkPrinter: async () => ({ ok: true }), removePrinter: async () => ({ ok: true }),
      getAutoStart: async () => window.__auto && window.__overlay,
      setAutoStart: async (on) => { window.__auto = on; if (on && !window.__overlay) window.__opened.push('overlay'); return on && window.__overlay; } };
  });
  await cashierLogin(p);
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#dpAutoChk');
  assert.equal(await p.$('#clBox'), null, 'no line card in the cashier');
  assert.doesNotMatch(await p.textContent('#mSetSec'), /خط المطعم/);
  assert.match(await p.textContent('label:has(#dpAutoChk)'), /مع تشغيل الجهاز/);
  assert.equal(await p.isChecked('#dpAutoChk'), false);
  await p.check('#dpAutoChk');
  await p.waitForSelector('text=بالظهور فوق التطبيقات');
  assert.deepEqual(await p.evaluate(() => window.__opened), ['overlay']);
  await p.evaluate(() => { window.__overlay = true; });
  await resume(p);
  await p.waitForFunction(() => document.getElementById('dpAutoChk').checked);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('Windows/Mac/Linux app: auto-start option shown and toggled', async () => {
  const p = await page(B, { w: 1280, h: 900 });
  await p.addInitScript(() => {
    window.__auto = true;
    window.SoraDesktop = { version: '1.0.9', platform: 'win32', canAutoStart: true, printers: async () => [], print: async () => ({ ok: true }), jobs: async () => [],
      reprint: async () => ({ ok: true }), getTestMode: async () => false, setTestMode: async (v) => v, openSimulator: async () => true, onUpdate() {},
      getAutoStart: async () => window.__auto, setAutoStart: async (v) => (window.__auto = v) };
  });
  await cashierLogin(p);
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForFunction(() => document.getElementById('dpAutoChk') && document.getElementById('dpAutoChk').checked);
  assert.match(await p.textContent('label:has(#dpAutoChk)'), /مع تشغيل الحاسبة/);
  await p.uncheck('#dpAutoChk');
  await p.waitForSelector('text=ما يشتغل وحده');
  assert.equal(await p.evaluate(() => window.__auto), false);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
