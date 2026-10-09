// وضع الاستلام بتطبيق الكابتن: يبقى صاحي ويرن حتى والشاشة مطفية
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const uid = await signUp('stby@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', uid), { role: 'captain', restaurantId: 'RS', captainId: 'CS', name: 'حيدر', email: 'stby@x.com' });
    await setDoc(doc(db, 'captains/CS'), { restaurantId: 'RS', userId: uid, name: 'حيدر', available: true });
    await setDoc(doc(db, 'restaurants/RS'), { name: 'مطعم', userId: 'r', active: true });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('standby keeps the app awake, rings a looping sound on a new order, and blocks auto-reload', async () => {
  const p = await page(B, { notif: true });
  await p.goto('http://localhost:5050/sora3a-captain/captain.html');
  await p.fill('#email', 'stby@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#stbyChip:not([hidden])', { timeout: 15000 });
  if (await p.isVisible('#notifSheet.show').catch(() => false)) await p.click('#notifLater');
  assert.match(await p.textContent('#stbyChip'), /اضغط هنا/);
  await p.click('#stbyChip');
  await p.waitForFunction(() => document.getElementById('stbyChip').classList.contains('on'), null, { timeout: 5000 });
  assert.match(await p.textContent('#stbyChip'), /وضع الاستلام شغّال/);
  let st = await p.evaluate(() => window.__stby());
  assert.equal(st.standby, true); assert.equal(st.keep, true); assert.equal(st.ring, false);
  assert.equal(await p.evaluate(() => window.auIdle()), false, 'auto-update must not reload during standby');
  // طلب جديد → رنين متكرر كملف صوتي
  await E.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'orders/OSTBY00000001'), { restaurantId: 'RS', restaurantName: 'مطعم', status: 'pending', captainId: 'CS', rejectedBy: [], value: 9000, fee: 2000, address: 'الكرادة', createdAtMs: Date.now(), timeline: [] });
  });
  await p.waitForSelector('#incoming.show', { timeout: 10000 });
  await p.waitForFunction(() => window.__stby().ring, null, { timeout: 5000 });
  // الكابتن لمس الطلب → الرنة توقف والطلب يبقى ظاهر
  await p.click('#inAddr');
  await p.waitForFunction(() => !window.__stby().ring, null, { timeout: 5000 });
  assert.equal(await p.isVisible('#incoming.show'), true);
  await p.click('#rejectBtn');
  await p.waitForFunction(() => !window.__stby().ring, null, { timeout: 8000 });
  // غير متاح ← يوقف وضع الاستلام
  await p.click('#availBtn');
  await p.waitForFunction(() => !window.__stby().standby, null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => window.auIdle()), true);
  await p.context().close();
});

test('a quick touch before the ring sound starts does not leave a second beep ringing forever', async () => {
  // مثل تطبيق الأندرويد: تشغيل الصوت ياخذ شوية وقت، والإيقاف قبلها يرفض التشغيل (AbortError)
  const p = await page(B, { notif: true });
  await p.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play, pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function () {
      const el = this; el.__pend = true;
      return new Promise((res, rej) => { el.__rej = rej; setTimeout(() => { if (!el.__pend) return; el.__pend = false; play.call(el).then(res, rej); }, 900); });
    };
    HTMLMediaElement.prototype.pause = function () {
      if (this.__pend) { this.__pend = false; const e = new Error('The play() request was interrupted by a call to pause()'); e.name = 'AbortError'; this.__rej(e); }
      return pause.call(this);
    };
  });
  // الاختبار السابق خلّاه «غير متاح» — نرجّعه متاح قبل الدخول
  await E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'captains/CS'), { available: true }, { merge: true }));
  await p.goto('http://localhost:5050/sora3a-captain/captain.html');
  await p.fill('#email', 'stby@x.com'); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#stbyChip:not([hidden])', { timeout: 15000 });
  if (await p.isVisible('#notifSheet.show').catch(() => false)) await p.click('#notifLater');
  await E.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'orders/OSTBY00000002'), { restaurantId: 'RS', restaurantName: 'مطعم', status: 'pending', captainId: 'CS', rejectedBy: [], value: 9000, fee: 2000, address: 'المنصور', createdAtMs: Date.now(), timeline: [] });
  });
  await p.waitForSelector('#incoming.show', { timeout: 10000 });
  // لمسة سريعة قبل ما يشتغل الصوت
  await p.click('#inAddr');
  await p.waitForTimeout(3000);
  const st = await p.evaluate(() => window.__stby());
  assert.equal(st.beeping, false, 'no fallback beep left running');
  assert.equal(st.ring, false);
  await p.click('#rejectBtn');
  await p.context().close();
});
