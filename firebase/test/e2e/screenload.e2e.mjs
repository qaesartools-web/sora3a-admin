// شاشة «طلبك جاهز» بتلفزيون ضعيف ويه طلبات هواية (أكثر من اللي يلزمه العمود): لازم تبقى سريعة —
//  چانت تعلك من توصل ~١٩ طلب: كل تحديث يصغّر الأرقام خطوة خطوة (لحد ٢٨ مرة يعيد رسم الشاشة)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const BASE = 'http://localhost:5050/sora3a-rest2/';
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const put = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), p), d); }); };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const bagDay = (ms) => new Date((ms ?? Date.now()) + 3 * 3600000).toISOString().slice(0, 10);
const N = Number(process.env.SCR_N || 40);

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const own = await signUp('load@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'RZ', email: 'load@x.com' });
    await setDoc(doc(db, 'restaurants/RZ'), { name: 'مطعم الزحمة', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/RZ/settings/main'), { receiptTitle: 'مطعم الزحمة', updatedAtMs: 1 });
    const now = Date.now();
    for (let i = 0; i < N; i++) await setDoc(doc(db, 'orders/Z' + i), { restaurantId: 'RZ', status: 'delivered', orderType: i % 3 ? 'salon' : 'takeaway', kitchen: 'new', ticketNo: 100 + i, value: 5000, day: bagDay(), createdAtMs: now - (N - i) * 60000, ...(i % 5 === 0 ? { pager: (i % 9) + 1 } : {}) });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('ready screen with many orders on a slow TV stays fast: each order the kitchen finishes moves to «ready» within seconds', async () => {
  const p = await page(B, { w: 1280, h: 720 });
  await p.goto(BASE + 'screen.html');
  await p.waitForSelector('#pairCode', { timeout: 15000 });
  const code = (await p.textContent('#pairCode')).trim();
  const pr = await until(() => read('screenPairs/' + code));
  await put('screens/' + pr.uid, { restaurantId: 'RZ', restName: 'مطعم الزحمة', code, kind: 'ready', name: 'شاشة', pairedBy: 'hq', approved: true, atMs: Date.now() });
  await p.waitForFunction((n) => document.querySelectorAll('#prep .n').length === n, N, { timeout: 20000 });
  // تلفزيون ضعيف: المعالج أبطأ ٦ مرات
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await cdp.send('Performance.enable');
  const M = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  // وهي واكفة (ماكو تحديث): التلفزيون لازم يكون مرتاح — چانت أشرطة «يتحضر» المتحركة تشغله كل لحظة ويختنق
  const a = await M(); await p.waitForTimeout(3000); const b = await M();
  const idle = { recalcs: b.RecalcStyleCount - a.RecalcStyleCount, busy: +(b.TaskDuration - a.TaskDuration).toFixed(2) };
  console.log('IDLE', JSON.stringify(idle));
  assert.ok(idle.recalcs < 40 && idle.busy < 0.6, 'the TV rests while nothing changes: ' + JSON.stringify(idle));
  const lay0 = (await M()).LayoutCount;
  const took = [];
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    await write('orders/Z' + i, { kitchen: 'ready', kitchenReadyAt: Date.now() });
    await p.waitForFunction((n) => [...document.querySelectorAll('#ready .n')].some((e) => e.textContent.includes('#' + n)), 100 + i, { timeout: 60000 });
    took.push(Date.now() - t0);
  }
  const lay1 = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount').value;
  console.log('TOOK', JSON.stringify(took), 'layouts', lay1 - lay0);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  assert.ok(Math.max(...took) < 2500, 'each ready order shows within seconds: ' + JSON.stringify(took));
  await p.context().close();
});
