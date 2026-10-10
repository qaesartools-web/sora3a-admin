import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

// لوحة الإدارة ما تنزّل كل التاريخ: أرقام اليوم تنحسب بالسيرفر، والفترات تنجاب وقت الحاجة
let srv, E, B;
const DAY = 86400000;
const bagDay = (ms) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const boss = await signUp('lboss@x.com', 'secret123'), own = await signUp('lrown@x.com', 'secret123');
  const now = Date.now();
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', boss), { role: 'admin', email: 'lboss@x.com', name: 'المدير' });
    await setDoc(doc(db, 'users', own), { role: 'restaurant', restaurantId: 'R1', email: 'lrown@x.com', name: 'صاحب الأول' });
    await setDoc(doc(db, 'restaurants/R1'), { name: 'المطعم الأول', userId: own, active: true });
    await setDoc(doc(db, 'restaurants/R2'), { name: 'المطعم الثاني', userId: 'x', active: true });
    await setDoc(doc(db, 'accounting/R1'), { materials: [], recipes: {}, costs: {}, moves: [], expenses: [] });
    const base = { status: 'delivered', orderType: 'takeaway', items: [{ name: 'كلاسك', variant: 'وحدة', price: 1000, qty: 1 }] };
    // ١٥٠ طلب قديم (قبل ١٠ أيام) بكل مطعم
    for (const rid of ['R1', 'R2']) {
      const b = writeBatch(db);
      for (let i = 0; i < 150; i++) { const at = now - 10 * DAY - i * 60000; b.set(doc(db, 'orders', rid + 'old' + i), { ...base, restaurantId: rid, value: 1000, createdAtMs: at, day: bagDay(at) }); }
      await b.commit();
    }
    const t = (id, rid, extra) => setDoc(doc(db, 'orders', id), { ...base, restaurantId: rid, restaurantName: rid === 'R1' ? 'المطعم الأول' : 'المطعم الثاني', createdAtMs: now - 60000, day: bagDay(now), ...extra });
    await t('T1', 'R1', { value: 5000 }); await t('T2', 'R1', { value: 7000 }); await t('T3', 'R1', { value: 3000 });
    await t('T4', 'R1', { status: 'cancelled', value: 9000 }); await t('T5', 'R1', { status: 'pending', orderType: 'delivery', value: 4000 });
    await t('T6', 'R2', { value: 2000 }); await t('T7', 'R2', { value: 6000 });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function login(email) {
  const p = await page(B, { w: 1280, h: 900 });
  await p.goto('http://localhost:5050/sora3a-admin/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#lEmail', email); await p.fill('#lPass', 'secret123'); await p.click('#lBtn');
  await p.waitForSelector('#appPage', { state: 'visible' });
  return p;
}
const statOf = (p, label) => p.evaluate((l) => { const s = [...document.querySelectorAll('#dashStats .stat')].find((x) => x.textContent.includes(l)); return s && s.querySelector('.stat-v').textContent.trim(); }, label);

test('super admin: only the latest orders load; today numbers from the server; periods and restaurants load on demand', async () => {
  const p = await login('lboss@x.com');
  await p.waitForFunction(() => allOrders.length > 0);
  await p.waitForTimeout(800);
  const n = await p.evaluate(() => allOrders.length);
  assert.ok(n <= 101, 'latest 100 + active, not all 307 (got ' + n + ')');
  // أرقام اليوم (كل المطاعم) بالسيرفر
  await p.waitForFunction(() => document.getElementById('dashStats').textContent.includes('23,000'), null, { timeout: 20000 })
    .catch(async (e) => { throw new Error('dashboard: ' + (await p.textContent('#dashStats')).replace(/\s+/g, ' ') + ' | errors: ' + p.errors.join(' ; ')); });
  assert.equal(await statOf(p, 'طلبات اليوم'), '7');
  assert.equal(await statOf(p, 'مسلّمة اليوم'), '5');
  assert.equal(await statOf(p, 'ملغية اليوم'), '1');
  assert.equal(await statOf(p, 'نشطة الآن'), '1');
  await p.screenshot({ path: 'shots/admin-dash-today.png' });
  // المطاعم: أرقام اليوم لكل مطعم
  await p.click('.dnav-btn[data-screen="scRests"]');
  await p.waitForFunction(() => /طلب اليوم/.test(document.getElementById('restList').textContent) && !document.getElementById('restList').textContent.includes('…'), null, { timeout: 20000 })
    .catch(async (e) => { throw new Error('restaurants: ' + (await p.textContent('#restList')).replace(/\s+/g, ' ').slice(0, 400)); });
  const cards = await p.$$eval('#restList .entity', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  assert.ok(cards.some((c) => c.includes('المطعم الأول') && /5\s*طلب اليوم/.test(c) && /15,000\s*مبيعات اليوم/.test(c)), cards.join(' | '));
  // تبويب الطلبات: آخر ٣٠ يوم للمطعم الأول → تنجاب من السيرفر
  await p.click('.dnav-btn[data-screen="scOrders"]');
  await p.selectOption('#ordRest', 'R1');
  await p.selectOption('#ordRange', '30');
  await p.waitForFunction(() => document.querySelectorAll('#ordersList .order-row').length === 155, null, { timeout: 20000 })
    .catch(async (e) => { throw new Error('orders tab rows: ' + (await p.evaluate(() => document.querySelectorAll('#ordersList .order-row').length))); });
  // التحليلات: فترة قديمة (كل المطاعم)
  await p.click('.dnav-btn[data-screen="scAnalytics"]');
  const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  await p.fill('#anFrom', ymd(Date.now() - 15 * DAY)); await p.fill('#anTo', ymd(Date.now()));
  await p.click('#scAnalytics .date-filter button');
  await p.waitForFunction(() => (window._lastAnalyticsOrders || []).length === 307, null, { timeout: 20000 })
    .catch(async (e) => { throw new Error('analytics: ' + (await p.evaluate(() => (window._lastAnalyticsOrders || []).length))); });
  // طلب جديد يوصل مباشرة للرئيسية
  await E.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'orders/NEWX'), { restaurantId: 'R2', status: 'pending', orderType: 'takeaway', value: 1500, createdAtMs: Date.now(), day: bagDay(Date.now()), customer: 'زبون جديد' }); });
  await p.click('.dnav-btn[data-screen="scDash"]');
  await p.waitForFunction(() => document.getElementById('dashOrders').textContent.includes('زبون جديد'), null, { timeout: 10000 });
  // تنبيه فهرس الطلبات (إذا ما مسوّى) برابط إنشائه
  assert.equal(await p.isVisible('#idxWarn'), false);
  await p.evaluate(() => ordIdxFail({ message: 'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/sora3a-system/firestore/indexes?create_composite=abc' }));
  await p.waitForSelector('#idxWarn', { state: 'visible' });
  assert.match(await p.getAttribute('#idxWarn a', 'href'), /create_composite=abc$/);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('restaurant owner: today + yesterday live; accounting for 30 days loads on demand', async () => {
  const p = await login('lrown@x.com');
  await p.waitForFunction(() => allOrders.some((o) => o.id === 'T1'));
  await p.waitForTimeout(800);
  assert.deepEqual(await p.evaluate(() => allOrders.map((o) => o.id).sort()), ['T1', 'T2', 'T3', 'T4', 'T5']);
  assert.equal(await statOf(p, 'طلبات اليوم'), '5');
  assert.equal(await statOf(p, 'مبيعات اليوم'), '15,000');
  await p.click('.dnav-btn[data-screen="scAcc"]');
  await p.selectOption('#axRange', '30');
  await p.waitForFunction(() => /165,000/.test(document.getElementById('axBody').textContent), null, { timeout: 15000 });   // ١٥٠ قديم × ١٠٠٠ + ١٥٠٠٠ اليوم
  assert.equal(await p.evaluate(() => allOrders.length), 155);
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('super admin downloads a copy of any period: Excel (CSV) and full JSON', async () => {
  const p = await login('lboss@x.com');
  await p.click('.dnav-btn[data-screen="scSecurity"]');
  await p.waitForFunction(() => document.querySelectorAll('#bkRest option').length === 3);
  await p.selectOption('#bkRest', 'R1');
  const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  await p.fill('#bkFrom', ymd(Date.now() - 30 * DAY)); await p.fill('#bkTo', ymd(Date.now()));
  const [csv] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#bkCsvBtn')]);
  const csvText = await (await import('node:fs/promises')).readFile(await csv.path(), 'utf8');
  const lines = csvText.replace(/^﻿/, '').split('\n');
  assert.equal(lines.length, 1 + 155);
  assert.match(lines[0], /"رقم الطلب","التاريخ","المطعم"/);
  assert.ok(lines.some((l) => l.includes('"ملغي"') || l.includes('"cancelled"')));
  assert.match(csv.suggestedFilename(), /^sora3a-orders-R1-.*\.csv$/);
  await p.waitForFunction(() => document.getElementById('bkStatus').textContent.includes('155'));
  const [js] = await Promise.all([p.waitForEvent('download'), p.click('#bkJsonBtn')]);
  const j = JSON.parse(await (await import('node:fs/promises')).readFile(await js.path(), 'utf8'));
  assert.equal(j.count, 155); assert.equal(j.orders.length, 155); assert.equal(j.restaurantId, 'R1');
  assert.ok(j.orders.every((o) => o.restaurantId === 'R1'));
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
