// إعدادات الكاشير تنفتح دائماً: بالمتصفح وببرنامج الحاسبة (القديم والجديد)، وحتى لو الإعدادات المحفوظة بيها خانة فارغة أو بشكل غلط
//  (قبل: خانة فارغة بأقسام المطبخ أو الملاحظات = صفحة الإعدادات فارغة وما يتحرك شي)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';
const BASE = 'http://localhost:5050/sora3a-rest2/';
let srv, E, B, own;
before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  own = await signUp('rp@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RP', email: 'rp@x.com', name: 'x' });
    await setDoc(doc(db, 'restaurants/RP'), { name: 'مندي', userId: own, active: true, features: { kitchen: true, kitchenSec: true, captain: true } });
    await setDoc(doc(db, 'restaurants/RP/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [{ cat: 'a', items: [{ name: 'b', variants: [{ name: 'c', price: 1 }] }] }] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });
const MODES = { browser: 'المتصفح', 'desktop-old': 'برنامج الحاسبة القديم', 'desktop-new': 'برنامج الحاسبة الجديد', 'bad-null': 'قسم فارغ', 'bad-obj': 'الأقسام مو قائمة', 'bad-notes': 'الملاحظات نص' };
for (const mode of Object.keys(MODES)) {
  test('settings opens: ' + mode, async () => {
    const bad = { 'bad-null': { sections: [null, { id: 's1', name: 'شوي', emoji: '🔥' }] }, 'bad-obj': { sections: { 0: { id: 's1', name: 'شوي' } } }, 'bad-notes': { quickNotes: 'بدون بصل، حار' } }[mode];
    await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'restaurants/RP/settings/main'), { receiptTitle: 'مندي', updatedAtMs: Date.now(), ...(bad || {}) }); });
    const p = await page(B, { w: 1600, h: 900 });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack || e)));
    if (mode !== 'browser') await p.addInitScript((m) => {
      window.SoraDesktop = { version: '1.0.13', platform: 'win32', canAutoStart: true, printers: async () => [], print: async () => ({ ok: true }), jobs: async () => [], reprint: async () => ({}), getTestMode: async () => false, setTestMode: async () => false, openSimulator: async () => true, getAutoStart: async () => true, setAutoStart: async () => true, onUpdate: () => {} };
      window.SoraLan = { role: 'hub', start: async (c) => ({ on: true, rid: c.rid, ips: ['192.168.1.5'], peers: [] }), stop: async () => true, status: async () => ({ on: true, peers: [] }), send: () => {}, broadcast: () => {}, on: () => {} };
      if (m === 'desktop-new') { window.SoraLan.fw = async () => ({ ok: false, blocked: true }); window.SoraLan.fwFix = async () => ({ ok: true }); }
    }, mode);
    await p.goto(BASE + 'index.html');
    await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
    await p.fill('#inEmail', 'rp@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
    await p.waitForSelector('#prods .prod', { timeout: 15000 });
    await p.waitForTimeout(1500);
    await p.click('[data-tab="menu"]');
    await p.waitForTimeout(1000);
    const len = await p.evaluate(() => document.getElementById('mSetSec').innerHTML.length);
    if (mode.startsWith('bad')) assert.ok(await p.isVisible('#stTitle'), 'invoice fields shown');
    assert.ok(len > 1000, 'settings rendered: ' + MODES[mode]);
    // سطر النسخة يبين (حتى المطعم يصوّره)، وبدون تنبيه أحمر لما الإعدادات تنعرض
    await p.waitForFunction(() => /نسخة الكاشير \d+/.test(document.getElementById('setDiag').textContent));
    await p.waitForTimeout(700);
    assert.doesNotMatch(await p.textContent('#setDiag'), /⚠️/); assert.deepEqual(errs, []);
    await p.context().close();
  });
}

test('if the settings ever fail to show, a red line says why (for a photo)', async () => {
  const p = await page(B, { w: 1600, h: 900 });
  await p.addInitScript(() => { window.__breakSettings = 1; });
  await p.goto(BASE + 'index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'rp@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  // نخرّب الصفحة عمداً (مثل نسخة قديمة أو خطأ غير متوقع): الإعدادات تبقى فارغة
  await p.evaluate(() => { window.showMTab = () => { throw new Error('تجربة خطأ'); }; });
  await p.click('[data-tab="menu"]');
  await p.waitForFunction(() => /ما انعرضت/.test(document.getElementById('setDiag').textContent), null, { timeout: 5000 });
  assert.match(await p.textContent('#setDiag'), /تجربة خطأ/);
  await p.context().close();
});

// طابعة تعريفها نصي (Generic / Text Only): العربي يطلع رموز ← البرنامج يطبعها صورة وتبين «تنطبع كصورة»،
//  وأي طابعة ثانية الكاشير يكدر يشغّلها «اطبع كصورة» بضغطة
test('printers: text-only driver shows «تنطبع كصورة»; any other printer can be switched to image printing', async () => {
  const p = await page(B, { w: 1600, h: 900 });
  await p.addInitScript(() => {
    const img = new Set();
    window.__img = [];
    window.SoraDesktop = { version: '1.0.99', platform: 'win32', canAutoStart: true, canImageMode: true,
      printers: async () => [{ name: 'CHALLENGE MONSTER 80mm', displayName: 'CHALLENGE MONSTER 80mm', ok: true, isDefault: true, textOnly: true },
        { name: 'Kitchen', displayName: 'Kitchen', ok: true, ...(img.has('Kitchen') ? { image: true } : {}) }],
      setImageMode: async (n, on) => { window.__img.push([n, on]); if (on) img.add(n); else img.delete(n); return img.has(n); },
      print: async () => ({ ok: true }), jobs: async () => [], reprint: async () => ({}), getTestMode: async () => false, setTestMode: async () => false,
      openSimulator: async () => true, getAutoStart: async () => true, setAutoStart: async () => true, onUpdate: () => {}, installUpdate: async () => false };
  });
  await p.goto(BASE + 'index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'rp@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  await p.click('[data-tab="menu"]');
  await p.waitForSelector('#dpStatus .dp-pr');
  const st = () => p.textContent('#dpStatus');
  assert.match(await st(), /CHALLENGE MONSTER 80mm 🖼️ تنطبع كصورة/);
  assert.equal(await p.locator('#dpStatus .dp-img').count(), 1, 'only the normal printer gets the switch');
  await p.click('#dpStatus .dp-img');
  await p.waitForSelector('#dpStatus .dp-img.on');
  assert.match(await st(), /Kitchen 🖼️ تنطبع كصورة ✓/);
  await p.click('#dpStatus .dp-img.on');
  await p.waitForSelector('#dpStatus .dp-img:not(.on)');
  assert.deepEqual(await p.evaluate(() => window.__img), [['Kitchen', true], ['Kitchen', false]]);
  await p.locator('#dpStatus').screenshot({ path: 'shots/pos-printers-image.png' }).catch(() => {});
  await p.context().close();
});

// اختيار الطابعة ينحفظ أول ما يتغيّر ويبقى (حتى لو الإعدادات انعادت أو الكاشير طلع ورجع)، وزر التجربة يطبع عليها،
//  والورق بدون إيميجي (بالحرارية الأسود والأبيض يطلع لطخة) وبخط عريض
test('printer choice is saved the moment it changes and stays; test print goes to it; paper has no emoji', async () => {
  const p = await page(B, { w: 1600, h: 900 });
  const prefs = {};
  await p.exposeBinding('__pref', (_s, op, k, v) => { if (op === 'set') { prefs[k] = v; return true; } return prefs[k] ?? null; });
  await p.addInitScript(() => {
    window.__prints = [];
    window.SoraDesktop = { version: '1.0.99', platform: 'win32', canAutoStart: true,
      printers: async () => [{ name: 'CHALLENGE MONSTER 80mm', displayName: 'CHALLENGE MONSTER 80mm', ok: true, image: true }, { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', ok: true, isDefault: true }],
      print: async (html, o) => { window.__prints.push({ html, printer: o.printer, title: o.title }); return { ok: true, printer: o.printer }; },
      jobs: async () => [], reprint: async () => ({}), getTestMode: async () => false, setTestMode: async () => false,
      getPref: (k) => window.__pref('get', k), setPref: (k, v) => window.__pref('set', k, v),
      openSimulator: async () => true, getAutoStart: async () => true, setAutoStart: async () => true, onUpdate: () => {}, installUpdate: async () => false };
  });
  const login = async () => {
    await p.goto(BASE + 'index.html');
    const first = await Promise.race([p.waitForSelector('#loginPage', { state: 'visible', timeout: 30000 }).then(() => 'login'), p.waitForSelector('#prods .prod', { timeout: 30000 }).then(() => 'in')]);
    if (first === 'login') { await p.fill('#inEmail', 'rp@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn'); }
    await p.waitForSelector('#prods .prod', { timeout: 15000 });
    await p.click('[data-tab="menu"]');
    await p.waitForSelector('#dpStatus .dp-pr');
  };
  await login();
  await p.selectOption('#dpMain', 'CHALLENGE MONSTER 80mm');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('pos_dp_')))).main);
  assert.equal(saved, 'CHALLENGE MONSTER 80mm', 'saved without pressing «save settings»');
  assert.match(await p.textContent('#toast, .toast, body'), /انحفظت الطابعة/);
  // الإعدادات تنعاد (تحديث من السحابة) ← الاختيار باقي
  await p.evaluate(() => { goTab('cashier'); goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#dpStatus .dp-pr');
  assert.equal(await p.inputValue('#dpMain'), 'CHALLENGE MONSTER 80mm');
  // يطلع ويرجع (تحديث الصفحة) ← باقي
  await login();
  assert.equal(await p.inputValue('#dpMain'), 'CHALLENGE MONSTER 80mm');
  assert.equal(Object.values(prefs)[0].main, 'CHALLENGE MONSTER 80mm', 'a copy is kept inside the cashier program');
  // ذاكرة الصفحة انمسحت ← الطابعة ترجع من البرنامج وحدها
  await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pos_dp_')).forEach((k) => localStorage.removeItem(k)));
  await login();
  await p.waitForFunction(() => document.getElementById('dpMain') && document.getElementById('dpMain').value === 'CHALLENGE MONSTER 80mm', null, { timeout: 10000 });
  // زر التجربة يطبع على نفس الطابعة
  await p.evaluate(() => dpTest('main'));
  await p.waitForFunction(() => window.__prints.length > 0);
  const t = await p.evaluate(() => window.__prints[0]);
  assert.equal(t.printer, 'CHALLENGE MONSTER 80mm');
  // فاتورة حقيقية: بدون إيموجي، وخط عريض أسود
  await p.evaluate(() => printOrderReceipt({ id: 'ABC123x', orderType: 'salon', tableNo: '4', ticketNo: 22, createdAt: '10:04 م', createdAtMs: Date.now(), value: 4500, subtotal: 4500,
    items: [{ name: 'كلاسك برغر', variant: 'وحدة', price: 4500, qty: 1, note: 'حار' }], payment: { method: 'cash' } }, 'salon'));
  await p.waitForFunction(() => window.__prints.length > 1);
  const r = await p.evaluate(() => window.__prints.at(-1));
  assert.equal(r.printer, 'CHALLENGE MONSTER 80mm');
  assert.doesNotMatch(r.html, /\p{Extended_Pictographic}/u, 'no emoji on paper');
  assert.match(r.html, /صالة — طاولة 4/); assert.match(r.html, /font-weight:700/); assert.match(r.html, /رقم الطلب:<\/div><div class="v bx big">#22</); assert.match(r.html, /<div class="tot"><span>الصافي<\/span><span>4,500<\/span>/);
  assert.match(r.html, /<th>اسم الصنف<\/th><th>الكمية<\/th><th>السعر<\/th>/);
  // شعار الفاتورة من برج سرعة (restaurants/{id}/theme/receipt) ← ينحفظ بالجهاز وينطبع يسار فوق الفاتورة
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'restaurants/RP/theme/receipt'), { data: PNG, atMs: Date.now() }); });
  await p.waitForFunction((u) => window.posReceiptLogo() === u, PNG, { timeout: 10000 });
  await p.waitForSelector('#stLogoPv img');
  await p.evaluate(() => printOrderReceipt({ id: 'ABC124x', orderType: 'takeaway', ticketNo: 23, createdAt: '10:05', createdAtMs: Date.now(), value: 3000, subtotal: 3000,
    items: [{ name: 'كلاسك برغر', variant: 'وحدة', price: 3000, qty: 1 }], payment: { method: 'cash' } }, 'takeaway'));
  await p.waitForFunction(() => window.__prints.length > 2);
  const lg = await p.evaluate(() => window.__prints.at(-1).html);
  assert.ok(lg.includes('<div class="lg"><img src="' + PNG + '"'), 'logo printed at the top left');
  assert.match(lg, /<div class="nm"><b>/);
  await p.context().close();
});
