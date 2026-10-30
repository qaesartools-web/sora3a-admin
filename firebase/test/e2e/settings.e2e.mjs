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
    assert.ok(len > 1000, 'settings rendered: ' + MODES[mode]); assert.deepEqual(errs, []);
    await p.context().close();
  });
}
