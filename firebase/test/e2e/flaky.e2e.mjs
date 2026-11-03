// «اللحظة اللي بين»: الواي فاي متصل بس النت ما يجاوب — الطلبات للسيرفر تبقى معلّقة (لا تنجح ولا تفشل)،
//  والمتصفح يحسب نفسه «متصل». بهاي اللحظة التطبيقات لازم تبقى سلسة: كل عملية تخلص خلال ثواني (ما تنتظر السيرفر)،
//  ومن يرجع النت كلشي يترفع مرة وحدة بدون تكرار
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 300)); } };
const all = async (col = 'orders') => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where('restaurantId', '==', 'RF'))); v = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return v; };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const day = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const NET = /127\.0\.0\.1:(8080|9099)|localhost:(8080|9099)/;
// الواي فاي متصل والنت ما يجاوب: كل طلب للسيرفر يبقى معلّق، والاتصال المفتوح ينقطع ويعيد يتصل (ويعلك)
async function stall(p) { await p.context().route(NET, () => {}); await p.evaluate(() => window.dispatchEvent(new Event('online'))); }
async function heal(p) { await p.context().unroute(NET); await p.evaluate(() => window.dispatchEvent(new Event('online'))); }
// الصفحة نفسها تجاوب فوراً (ما معلّكة)
const snappy = async (p) => { const t = Date.now(); await p.evaluate(() => 1); return Date.now() - t; };
const timed = async (label, fn, max) => { const t = Date.now(); await fn(); const ms = Date.now() - t; assert.ok(ms < max, label + ' took ' + ms + 'ms'); return ms; };

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const uid = await signUp('flaky@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', uid), { role: 'restaurant', restaurantId: 'RF', email: 'flaky@x.com', name: 'أبو علي' });
    await setDoc(doc(db, 'restaurants/RF'), { name: 'مطعم النت الضعيف', userId: uid, active: true, features: { online: true, kitchen: true } });
    await setDoc(doc(db, 'restaurants/RF/menu/main'), { updatedAtMs: 1, device: 's', cats: [{ cat: 'برغر', emoji: '🍔', items: [{ name: 'كلاسك', variants: [{ name: 'وحدة', price: 3000 }] }, { name: 'زنكر', variants: [{ name: 'وحدة', price: 4000 }] }] }] });
    await setDoc(doc(db, 'restaurants/RF/settings/main'), { tables: 6, online: { on: true, table: true, pickup: true, delivery: false }, updatedAtMs: 1 });
    await setDoc(doc(db, 'publicMenus/RF'), { on: true, name: 'مطعم النت الضعيف', modes: { table: true, pickup: true, delivery: false }, tables: 6, cats: [] });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

test('cashier stays smooth in the moment between no internet and internet (WiFi up, internet not answering): sell, hold, ready, accept a QR order, cancel — each in seconds; then it all syncs once', async () => {
  const p = await page(B, { w: 1280, h: 860 });
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'flaky@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
  // طلب باركود طاولة ينتظر القبول (وصل قبل ما يعلك النت)
  await E.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'webOrders/QRFLAKYaaaaaaaaaaaa'), { restaurantId: 'RF', source: 'qr', mode: 'table', table: '2', items: [{ name: 'زنكر', variant: 'وحدة', qty: 1 }], customer: '', phone: '', status: 'new', total: 4000, createdAtMs: Date.now(), day: day() }));
  await p.waitForSelector('#webBox .web-card', { timeout: 15000 });
  await p.waitForTimeout(2500);   // الكاش المحلي وأرقام الطلبات جاهزة
  // ── النت يعلك
  await stall(p);
  // صالة مدفوعة
  await timed('paid salon order', async () => {
    await p.click('#prods .prod >> nth=0');
    await p.click('#sendBtn'); await p.keyboard.press('1');
    await p.waitForSelector('#payOv.on', { timeout: 5000 }); await p.click('#payOk');
    await p.waitForFunction(() => cart.length === 0 && document.getElementById('prtFr').srcdoc.includes('الإجمالي'), null, { timeout: 8000 });
  }, 8000);
  assert.ok(await snappy(p) < 500, 'page answers at once');
  // سفري قيد التحضير ← جاهز
  await timed('held takeaway', async () => {
    await p.click('#prods .prod >> nth=1');
    await p.click('#sendBtn'); await p.keyboard.press('3'); await p.click('#acDlgOk');
    await p.waitForFunction(() => orders.some((o) => o.held && o.status === 'preparing'), null, { timeout: 8000 });
  }, 8000);
  const heldId = await p.evaluate(() => orders.find((o) => o.held).id);
  await timed('ready', async () => { await p.evaluate((id) => kdsDone(id), heldId); await p.waitForFunction((id) => orders.find((o) => o.id === id).status === 'ready', heldId, { timeout: 8000 }); }, 8000);
  // قبول طلب الباركود
  await timed('accept QR order', async () => {
    await p.click('#webBox .web-card .call-go');
    await p.waitForFunction(() => orders.some((o) => o.webId === 'QRFLAKYaaaaaaaaaaaa'), null, { timeout: 10000 });
  }, 10000);
  assert.ok(await snappy(p) < 500, 'page answers at once');
  // إلغاء طلب (نافذة السبب ← تأكيد)
  const salonId = await p.evaluate(() => orders.find((o) => !o.held && !o.webId).id);
  await timed('cancel', async () => {
    await p.evaluate((id) => ordCancel(id), salonId);
    await p.waitForSelector('#acOv.on'); await p.click('#acDlgOk');
    await p.waitForFunction((id) => orders.find((o) => o.id === id).status === 'cancelled', salonId, { timeout: 8000 });
  }, 8000);
  // ── يرجع النت: كلشي يترفع مرة وحدة
  await heal(p);
  const synced = await until(async () => { const o = await all(); return o.length === 3 && o.some((x) => x.webId === 'QRFLAKYaaaaaaaaaaaa') && o.some((x) => x.held && x.status === 'ready') && o.some((x) => x.status === 'cancelled') ? o : null; }, 45000);
  assert.ok(synced, 'everything reached the server once the internet answered');
  assert.equal((await read('webOrders/QRFLAKYaaaaaaaaaaaa')).status, 'accepted');
  await p.waitForTimeout(3000);
  assert.equal((await all()).length, 3, 'no duplicates');
  await p.context().close();
});
