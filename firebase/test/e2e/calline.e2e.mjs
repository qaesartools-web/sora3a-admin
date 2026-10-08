// خط المطعم بتطبيق الأندرويد (بدل MacroDroid): صاحب المطعم يكتب الرقم ← ينضاف خط للمطعم،
// والتلفون يرسل رقم المتصل (شريحة/واتساب) ← يطلع بالكاشير. + فتح الكاشير وحده مع تشغيل الجهاز.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDocs, updateDoc, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
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

// تطبيق الأندرويد (window.SoraDesktop) — حالة الخط والأذونات بالذاكرة مثل SharedPreferences
async function androidPage() {
  const p = await page(B, { w: 1280, h: 900 });
  await p.addInitScript(() => {
    window.__line = null; window.__opened = []; window.__overlay = false; window.__auto = true;
    window.__perms = { phone: false, notif: false, battery: false, overlay: false, sim: true };
    const status = () => ({ linked: !!window.__line, perms: { ...window.__perms, overlay: window.__overlay }, android: 34, maker: 'xiaomi', ...(window.__line || {}) });
    window.SoraDesktop = { version: '1.4', platform: 'android', canAutoStart: true, canAddNetwork: true, canCallLine: true,
      printers: async () => [], print: async () => ({ ok: true }), jobs: async () => [], reprint: async () => ({ ok: true }),
      getTestMode: async () => false, setTestMode: async (v) => v, openSimulator: async () => true, onUpdate() {},
      getAutoStart: async () => window.__auto && window.__overlay,
      setAutoStart: async (on) => { window.__auto = on; if (on && !window.__overlay) window.__opened.push('overlay'); return on && window.__overlay; },
      getCallLine: async () => status(),
      setCallLine: async (c) => { window.__line = { ...c, lastAt: 0 }; return status(); },
      clearCallLine: async () => { window.__line = null; return status(); },
      openPerm: async (k) => { window.__opened.push(k); return true; },
      testCall: async () => { const l = window.__line, f = window._fb;
        await f.addDoc(f.collection(f.db, 'incomingCalls'), { token: l.token, restaurantId: l.restaurantId, line: l.line, number: '07700000000', status: 'ringing' });
        Object.assign(l, { lastAt: Date.now(), lastNumber: '07700000000', lastErr: '', lastKind: 'sim' }); return { ok: true }; } };
  });
  return p;
}
async function login(p, email) {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', email); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
}
const resume = (p) => p.evaluate(() => window.dispatchEvent(new Event('sora:resume')));

test('owner types the restaurant number → line added, permissions guided, SIM/WhatsApp calls reach the cashier, unlink removes it', async () => {
  const p = await androidPage();
  await login(p, 'line@x.com');
  await p.waitForSelector('#clNum');
  // رقم ناقص ← تنبيه وما ينضاف شي
  await p.fill('#clNum', '0780');
  await p.click('button[onclick="clLink()"]');
  await p.waitForSelector('text=اكتب رقم المطعم كامل');
  assert.equal((await lines()).length, 0);
  await p.fill('#clNum', '0780 123 4567');
  await p.click('button[onclick="clLink()"]');
  const [ln] = await until(async () => { const l = await lines(); return l.length ? l : null; });
  assert.deepEqual({ line: ln.line, label: ln.label, active: ln.active }, { line: '1', label: '07801234567', active: true });
  assert.ok(ln.id.length >= 24, 'secret token');
  const saved = await p.evaluate(() => window.__line);
  assert.deepEqual({ ...saved, lastAt: undefined }, { token: ln.id, restaurantId: 'RL', line: '1', label: '07801234567', sim: true, wa: true, lastAt: undefined });
  // مربوط + الأذونات الناقصة كل وحدة بزرها
  await p.waitForSelector('#clBox .sh-ok');
  assert.match(await p.textContent('#clBox .sh-ok'), /خط 1.*07801234567/s);
  assert.equal(await p.locator('.cl-perm.bad').count(), 3);
  assert.match(await p.textContent('#clBox'), /الإعدادات المقيّدة/, 'Android 13+ restricted-settings hint');
  assert.match(await p.textContent('#clBox'), /Autostart/, 'Xiaomi autostart hint');
  await p.click('.cl-perm.bad >> nth=0 >> button.btn-soft');
  await p.click('.cl-perm.bad >> nth=1 >> button.btn-soft');
  assert.deepEqual(await p.evaluate(() => window.__opened), ['phone', 'notif']);
  // رجع من الإعدادات بعد ما سمح ← كلها ✅
  await p.evaluate(() => { Object.assign(window.__perms, { phone: true, notif: true, battery: true }); });
  await resume(p);
  await p.waitForFunction(() => document.querySelectorAll('.cl-perm.bad').length === 0 && document.querySelectorAll('.cl-perm.ok').length === 3);
  // مكالمة على الشريحة ومكالمة واتساب من التلفون ← تطلع بالكاشير
  await p.evaluate(() => goTab('pos'));
  assert.equal((await ring(ln.id, '1', '07709998888')).status, 200);
  await p.waitForSelector('.call-card >> text=07709998888');
  assert.match(await p.textContent('.call-card'), /خط 1/);
  assert.equal((await ring(ln.id, 'واتساب 1', 'أبو علي')).status, 200);
  await p.waitForSelector('.call-card >> text=خط واتساب 1');
  // مكالمة تجريبية من الإعدادات
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#clBox .sh-ok');
  await p.click('button[onclick="clTest()"]');
  await p.waitForSelector('text=لازم تطلع هسه بشاشة الكاشير');
  await p.waitForFunction(() => document.getElementById('clBox').textContent.includes('آخر مكالمة وصلت للكاشير'));
  // إلغاء الربط ← الخط ينحذف من المطعم ويرجع حقل الرقم
  await p.click('button[onclick="clUnlink()"]');
  await until(async () => (await lines()).length === 0);
  assert.equal((await lines()).length, 0);
  await p.waitForSelector('#clNum');
  assert.equal(await p.evaluate(() => window.__line), null);
  assert.equal((await ring(ln.id, '1', '07709998888')).status, 403, 'old token stops working');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('same number on a new phone reuses its line (no extra lines); a paused line is refused', async () => {
  const T = 'L'.repeat(30) + 'reuse';
  await E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'lineTokens', T), { restaurantId: 'RL', line: '3', label: '0780 555 1212', active: true, createdAtMs: 1 }));
  const p = await androidPage();
  await login(p, 'line@x.com');
  await p.waitForSelector('#clNum');
  await p.fill('#clNum', '07805551212');
  await p.uncheck('#clSim');
  await p.click('button[onclick="clLink()"]');
  await p.waitForSelector('#clBox .sh-ok');
  const saved = await p.evaluate(() => window.__line);
  assert.equal(saved.token, T); assert.equal(saved.line, '3'); assert.equal(saved.sim, false); assert.equal(saved.wa, true);
  assert.equal((await lines()).length, 1, 'no new line created');
  // واتساب بس ← ما يطلب إذن الهاتف
  assert.equal(await p.locator('.cl-perm').count(), 2);
  // التلفون انفصل محلياً، والإدارة أوقفت الخط ← ما ينربط
  await p.evaluate(() => { window.__line = null; });
  await write('lineTokens/' + T, { active: false });
  await resume(p);
  await p.waitForSelector('#clNum');
  await p.fill('#clNum', '07805551212');
  await p.click('button[onclick="clLink()"]');
  await p.waitForSelector('text=هذا الخط موقوف من الإدارة');
  assert.equal(await p.evaluate(() => window.__line), null);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('cashier account can not link (owner only); services off → clear message; Android auto-start asks for overlay then turns on', async () => {
  const p = await androidPage();
  await login(p, 'linecash@x.com');
  await p.waitForSelector('#clBox .sh-warn');
  assert.match(await p.textContent('#clBox'), /حساب صاحب المطعم/);
  assert.equal(await p.$('#clNum'), null);
  // التشغيل مع الجهاز: أول مرة يفتح إذن «الظهور فوق التطبيقات»، ولما يرجع تنصح الخانة
  assert.match(await p.textContent('label:has(#dpAutoChk)'), /مع تشغيل الجهاز/);
  assert.equal(await p.isChecked('#dpAutoChk'), false);
  await p.check('#dpAutoChk');
  await p.waitForSelector('text=بالظهور فوق التطبيقات');
  assert.deepEqual(await p.evaluate(() => window.__opened), ['overlay']);
  await p.evaluate(() => { window.__overlay = true; });
  await resume(p);
  await p.waitForFunction(() => document.getElementById('dpAutoChk').checked);
  // الإدارة طفّت خدمتي المكالمات
  await write('restaurants/RL', { features: { calls: false, whatsapp: false } });
  await p.waitForSelector('text=تم تحديث خدمات المطعم');
  await resume(p);
  await p.waitForFunction(() => document.getElementById('clBox').textContent.includes('خدمة المكالمات مطفية'));
  await write('restaurants/RL', { features: {} });
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
  await login(p, 'line@x.com');
  await p.waitForFunction(() => document.getElementById('dpAutoChk') && document.getElementById('dpAutoChk').checked);
  assert.match(await p.textContent('label:has(#dpAutoChk)'), /مع تشغيل الحاسبة/);
  assert.equal(await p.$('#clBox'), null, 'no phone line card on a computer');
  await p.uncheck('#dpAutoChk');
  await p.waitForSelector('text=ما يشتغل وحده');
  assert.equal(await p.evaluate(() => window.__auto), false);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
