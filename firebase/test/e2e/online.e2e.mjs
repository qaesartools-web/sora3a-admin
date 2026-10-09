// منيو QR + الطلب الأونلاين: الزبون يطلب من menu.html ← الكاشير يقبل ← المطبخ ← الزبون يتابع
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B, U = {};
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), p)); v = s.exists() ? s.data() : null; }); return v; };
const write = async (p, d) => { await E.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), p), d); }); };
const list = async (col, k, v) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where(k, '==', v))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));
const IMG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MENU = 'http://localhost:5050/sora3a-rest2/menu.html?r=RQ';

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  U.owner = await signUp('qr@x.com', 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', U.owner), { role: 'restaurant', restaurantId: 'RQ', email: 'qr@x.com' });
    await setDoc(doc(db, 'restaurants/RQ'), { name: 'مطعم الكود', area: 'الكرادة', phone: '07701234567', userId: U.owner, active: true });
    await setDoc(doc(db, 'restaurants/RQ/menuImages/img1'), { data: IMG, updatedAtMs: 1 });
    await setDoc(doc(db, 'restaurants/RQ/menu/main'), { updatedAtMs: 1, device: 'seed', cats: [
      { cat: 'شاورما', emoji: '🌯', items: [
        { name: 'شاورما لحم', imgId: 'img1', variants: [{ name: 'صغير', price: 3000 }, { name: 'كبير', price: 5000 }] },
        { name: 'شاورما دجاج', variants: [{ name: 'وحدة', price: 2500 }] }] },
      { cat: 'مشروبات', emoji: '🥤', items: [{ name: 'بيبسي', variants: [{ name: 'وحدة', price: 1000 }] }, { name: 'عصير', stock: 0, variants: [{ name: 'وحدة', price: 2000 }] }] }] });
    await setDoc(doc(db, 'restaurants/RQ/settings/main'), { tables: 6, defaultFee: 2000, updatedAtMs: 1 });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function posLogin(p) {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'qr@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#prods .prod', { timeout: 15000 });
}
async function openOnlineSettings(p) {
  await p.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await p.waitForSelector('#stOnOn');
}
let cashier;   // جهاز الكاشير يبقى مفتوح طول الاختبارات

test('owner turns on the online menu: public menu + photos published, link and table QR codes', async () => {
  cashier = await page(B, { w: 1280, h: 900 });
  await posLogin(cashier);
  await openOnlineSettings(cashier);
  assert.equal(await cashier.isChecked('#stOnOn'), false);
  assert.equal(await cashier.isChecked('#stOnDev'), true, 'desk device takes auto orders by default');
  await cashier.check('#stOnOn');
  await cashier.check('#stOnDeliv');
  await cashier.fill('#stOnNote', 'التوصيل لحد ١٢ بالليل');
  await cashier.screenshot({ path: 'shots/online-settings.png', fullPage: true });
  await cashier.click('button >> text=حفظ الإعدادات');
  const pm = await until(() => read('publicMenus/RQ'));
  assert.ok(pm, 'public menu published');
  assert.equal(pm.on, true);
  assert.deepEqual(pm.modes, { table: true, pickup: true, delivery: true });
  assert.equal(pm.name, 'مطعم الكود'); assert.equal(pm.fee, 2000); assert.equal(pm.tables, 6);
  assert.equal(pm.note, 'التوصيل لحد ١٢ بالليل');
  const lahm = pm.cats[0].items[0];
  assert.deepEqual(lahm.variants, [{ name: 'صغير', price: 3000 }, { name: 'كبير', price: 5000 }]);
  assert.equal(lahm.imgId, 'img1');
  assert.equal(pm.cats[1].items[1].out, true, 'out of stock flagged');
  assert.equal(JSON.stringify(pm).includes('cost'), false);
  const img = await until(() => read('publicMenus/RQ/img/img1'));
  assert.equal(img && img.data, IMG);
  const st = await read('restaurants/RQ/settings/main');
  assert.equal(st.online.on, true); assert.equal(st.online.delivery, true);
  // الرابط + QR الطاولات
  const link = await cashier.inputValue('#stOnLink');
  assert.equal(link, 'http://localhost:5050/sora3a-rest2/menu.html?r=RQ');
  await cashier.click('button >> text=QR الطاولات');
  const sheet = await until(() => cashier.evaluate(() => { const f = document.getElementById('qrFr'); return f && f.srcdoc; }));
  assert.equal((sheet.match(/<svg/g) || []).length, 6);
  assert.ok(sheet.includes('طاولة 6') && sheet.includes('مطعم الكود'));
  const v = await page(B, { w: 900, h: 1200 }); await v.setContent(sheet); await v.screenshot({ path: 'shots/online-qr-sheet.png' }); await v.context().close();
  assert.deepEqual(clean(cashier), []);
});

test('table QR: customer orders from table 4 → cashier accepts → kitchen ticket → customer sees preparing then ready', async () => {
  const c = await page(B, { w: 390, h: 844 });
  await c.goto(MENU + '&t=4');
  await c.waitForSelector('.it');
  assert.equal(await c.textContent('#rName'), 'مطعم الكود');
  assert.ok((await c.textContent('#rPill')).includes('طاولة 4'));
  assert.ok((await c.textContent('#banners')).includes('التوصيل لحد'));
  await until(() => c.evaluate(() => /url\(/.test(document.querySelector('[data-img="img1"]').style.backgroundImage)));
  assert.equal(await c.locator('.it.out .add').count(), 0, 'no add button on sold-out');
  await c.screenshot({ path: 'shots/online-menu-phone.png' });
  // صنف بأكثر من حجم: يفتح النافذة
  await c.click('.it >> text=شاورما لحم');
  await c.waitForSelector('#itemSh.on');
  await c.click('#itemSh [data-v="1"]');
  await c.click('#itemSh [data-q="1"]');
  await c.fill('#iNote', 'بدون طماطة');
  assert.ok((await c.textContent('#iAdd')).includes('10,000'));
  await c.screenshot({ path: 'shots/online-item-sheet.png' });
  await c.click('#iAdd');
  // صنف بسعر واحد: يضاف بضغطة
  await c.click('[data-add="1:0"]');
  assert.equal(await c.textContent('#barN'), '3');
  await c.click('#barBtn');
  await c.waitForSelector('#cartSh.on');
  assert.equal(await c.locator('#cPhone').count(), 0, 'table orders need no phone');
  await c.fill('#cNote', 'بسرعة رجاءً');
  await c.screenshot({ path: 'shots/online-cart-table.png' });
  await c.click('#cSend');
  await c.waitForSelector('#stView .st h2');
  assert.ok((await c.textContent('#stView')).includes('بانتظار تأكيد المطعم'));
  const [w] = await until(() => list('webOrders', 'restaurantId', 'RQ').then((r) => (r.length ? r : null)));
  assert.equal(w.mode, 'table'); assert.equal(w.table, '4'); assert.equal(w.source, 'qr'); assert.equal(w.status, 'new');
  assert.deepEqual(w.items, [{ name: 'شاورما لحم', variant: 'كبير', price: 5000, qty: 2, note: 'بدون طماطة' }, { name: 'بيبسي', variant: 'وحدة', price: 1000, qty: 1 }]);
  // الكاشير: بطاقة الطلب + قبول
  await cashier.evaluate(() => goTab('cashier'));
  await cashier.waitForSelector('#webBox .web-card');
  const card = await cashier.textContent('#webBox .web-card');
  assert.ok(card.includes('طاولة 4') && card.includes('شاورما لحم') && card.includes('11,000'), card);
  await cashier.waitForTimeout(400);
  await cashier.screenshot({ path: 'shots/online-cashier-card.png' });
  await cashier.click('#webBox .call-go');
  await until(async () => (await cashier.locator('#webBox .web-card').count()) === 0);
  const o = await until(async () => (await list('orders', 'restaurantId', 'RQ')).find((x) => x.webId === w.id));
  assert.equal(o.orderType, 'salon'); assert.equal(o.tableNo, 4); assert.equal(o.customer, 'طاولة 4');
  assert.equal(o.source, 'qr'); assert.equal(o.payment.method, 'later'); assert.equal(o.value, 11000);
  assert.equal(o.note, 'بسرعة رجاءً'); assert.equal(o.kitchen, 'new');
  const slip = await cashier.evaluate(() => document.getElementById('prtFr').srcdoc);
  assert.ok(slip.includes('QR') && slip.includes('شاورما لحم [بدون طماطة]') && !slip.includes('الإجمالي النهائي'), 'kitchen ticket only');
  const w2 = await until(async () => { const d = await read('webOrders/' + w.id); return d.orderId ? d : null; });
  assert.equal(w2.status, 'accepted'); assert.equal(w2.orderId, o.id); assert.equal(w2.ticket, String(o.ticketNo)); assert.equal(w2.stage, 'preparing');
  await c.waitForSelector('#stView .tk');
  assert.ok((await c.textContent('#stView')).includes('طلبك يتحضر'));
  assert.equal(await c.textContent('#stView .tk b'), '#' + o.ticketNo);
  // المطبخ يخلص ← الزبون يشوف «جاهز»
  await cashier.evaluate((id) => kdsDone(id), o.id);
  await until(async () => (await read('webOrders/' + w.id)).stage === 'ready');
  await c.waitForFunction(() => document.querySelector('#stView h2').textContent.includes('طلبك جاهز'));
  assert.ok((await c.textContent('#stView')).includes('راح يوصلك للطاولة'));
  await c.screenshot({ path: 'shots/online-status-ready.png' });
  // التحصيل ← تم
  await write('orders/' + o.id, { payment: { method: 'cash', cash: 11000, card: 0 } });
  await until(async () => (await read('webOrders/' + w.id)).stage === 'done');
  await c.waitForFunction(() => document.querySelector('#stView h2').textContent.includes('بالعافية'));
  // إعادة فتح الصفحة: يكمل على نفس الطلب
  await c.reload(); await c.waitForSelector('#stView .st h2');
  assert.ok((await c.textContent('#stView')).includes('بالعافية'));
  await c.click('#again'); await c.waitForSelector('.it');
  assert.deepEqual(clean(c), []);
  await c.context().close();
});

test('pickup from home: name + phone required, cashier rejects one with a reason and accepts another as held takeaway', async () => {
  const c = await page(B, { w: 390, h: 844 });
  await c.goto(MENU);
  await c.waitForSelector('.it');
  assert.equal(await c.textContent('#rPill'), '');
  await c.click('[data-add="0:1"]');
  await c.click('#barBtn');
  await c.waitForSelector('#cartSh.on');
  assert.equal(await c.locator('#cartSh [data-m]').count(), 2);
  await c.click('#cSend');
  assert.ok((await c.textContent('#cErr')).includes('اسمك'));
  await c.fill('#cName', 'أبو حسن'); await c.fill('#cPhone', '٠٧٧٠١١١٢٢٣٣');
  await c.click('#cSend');
  await c.waitForSelector('#stView .st h2');
  const w = await until(async () => (await list('webOrders', 'restaurantId', 'RQ')).find((x) => x.mode === 'pickup'));
  assert.equal(w.phone, '07701112233'); assert.equal(w.customer, 'أبو حسن');
  await cashier.waitForSelector('#webBox .web-card');
  await cashier.click('#webBox button >> text=رفض');
  await cashier.waitForSelector('#acOv.on');
  await cashier.fill('#acf_reason', 'الشاورما خلصت');
  await cashier.click('#acDlgOk');
  await until(async () => (await read('webOrders/' + w.id)).status === 'rejected');
  await c.waitForFunction(() => document.querySelector('#stView h2').textContent.includes('اعتذر'));
  assert.ok((await c.textContent('#stView')).includes('الشاورما خلصت'));
  // طلب ثاني: الاسم والرقم محفوظين
  await c.click('#again'); await c.waitForSelector('.it');
  await c.click('[data-add="1:0"]'); await c.click('#barBtn'); await c.waitForSelector('#cartSh.on');
  assert.equal(await c.inputValue('#cName'), 'أبو حسن');
  assert.equal(await c.inputValue('#cPhone'), '07701112233');
  await c.click('#cSend'); await c.waitForSelector('#stView .st h2');
  const w2 = await until(async () => (await list('webOrders', 'restaurantId', 'RQ')).find((x) => x.mode === 'pickup' && x.status === 'new'));
  await cashier.waitForSelector('#webBox .web-card');
  await cashier.click('#webBox .call-go');
  const o = await until(async () => (await list('orders', 'restaurantId', 'RQ')).find((x) => x.webId === w2.id));
  assert.equal(o.orderType, 'takeaway'); assert.equal(o.held, true); assert.equal(o.status, 'preparing');
  assert.equal(o.customer, 'أبو حسن'); assert.equal(o.phone, '07701112233');
  await c.waitForFunction(() => document.querySelector('#stView h2').textContent.includes('يتحضر'));
  // جاهز للاستلام ثم التسليم
  await cashier.evaluate((id) => kdsDone(id), o.id);
  await c.waitForFunction(() => document.querySelector('#stView h2').textContent.includes('جاهز'));
  assert.ok((await c.textContent('#stView')).includes('استلمه من الكاونتر'));
  assert.deepEqual(clean(c), []);
  await c.context().close();
});

test('delivery: address required, goes to all captains, customer gets the live tracking link', async () => {
  const c = await page(B, { w: 390, h: 844 });
  await c.goto(MENU);
  await c.waitForSelector('.it');
  await c.click('[data-add="0:1"]'); await c.click('#barBtn'); await c.waitForSelector('#cartSh.on');
  await c.click('#cartSh [data-m="delivery"]');
  assert.ok((await c.textContent('#cartSh .sum')).includes('4,500'), 'fee added');
  await c.fill('#cName', 'زهراء'); await c.fill('#cPhone', '07809998877');
  await c.click('#cSend');
  assert.ok((await c.textContent('#cErr')).includes('العنوان'));
  await c.fill('#cAddr', 'زيونة، قرب جامع الرحمن');
  await c.screenshot({ path: 'shots/online-cart-delivery.png' });
  await c.click('#cSend'); await c.waitForSelector('#stView .st h2');
  const w = await until(async () => (await list('webOrders', 'restaurantId', 'RQ')).find((x) => x.mode === 'delivery'));
  assert.equal(w.address, 'زيونة، قرب جامع الرحمن');
  await cashier.waitForSelector('#webBox .web-card');
  assert.ok((await cashier.textContent('#webBox .web-card')).includes('4,500'));
  await cashier.click('#webBox .call-go');
  const o = await until(async () => (await list('orders', 'restaurantId', 'RQ')).find((x) => x.webId === w.id));
  assert.equal(o.orderType, 'delivery'); assert.equal(o.status, 'pending'); assert.equal(o.captainId, null);
  assert.equal(o.fee, 2000); assert.equal(o.address, 'زيونة، قرب جامع الرحمن');
  assert.equal((await read('tracking/' + o.id)).status, 'pending');
  const wl = await until(async () => { const d = await read('webOrders/' + w.id); return d.trackId ? d : null; });
  assert.equal(wl.trackId, o.id);
  // الكابتن طلع بالطلب
  await write('orders/' + o.id, { status: 'delivering', captainId: 'C1', captainName: 'كرار' });
  await c.waitForSelector('#stView a[href*="sora3a-captain/?order="]');
  assert.ok((await c.getAttribute('#stView a[href*="sora3a-captain"]', 'href')).endsWith('?order=' + o.id));
  assert.ok((await c.textContent('#stView h2')).includes('الكابتن بالطريق'));
  await c.screenshot({ path: 'shots/online-status-onway.png' });
  await write('orders/' + o.id, { status: 'delivered' });
  await c.waitForFunction(() => document.querySelector('#stView h2').textContent.includes('وصلك'));
  assert.deepEqual(clean(c), []);
  await c.context().close();
});

test('auto mode: table orders go straight to the kitchen on the cashier device (no tap)', async () => {
  await openOnlineSettings(cashier);
  await cashier.check('#stOnAuto');
  await cashier.click('button >> text=حفظ الإعدادات');
  await until(async () => (await read('publicMenus/RQ')).autoTable === true);
  const c = await page(B, { w: 390, h: 844 });
  await c.goto(MENU + '&t=2');
  await c.waitForSelector('.it');
  await c.click('[data-add="1:0"]'); await c.click('#barBtn'); await c.waitForSelector('#cartSh.on');
  await c.click('#cSend');
  const w = await until(async () => (await list('webOrders', 'restaurantId', 'RQ')).find((x) => x.table === '2'));
  const o = await until(async () => (await list('orders', 'restaurantId', 'RQ')).find((x) => x.webId === w.id));
  assert.equal(o.tableNo, 2);
  await c.waitForFunction(() => document.querySelector('#stView h2') && document.querySelector('#stView h2').textContent.includes('يتحضر'));
  assert.equal(await cashier.locator('#webBox .web-card').count(), 0);
  await c.context().close();
});

test('view-only menu: customers browse what is available, no ordering, clear message', async () => {
  await openOnlineSettings(cashier);
  await cashier.check('#stOnView');
  await cashier.click('button >> text=حفظ الإعدادات');
  const pm = await until(async () => { const d = await read('publicMenus/RQ'); return d && d.on && !d.modes.table && !d.modes.pickup ? d : null; });
  assert.deepEqual(pm.modes, { table: false, pickup: false, delivery: false });
  assert.equal((await read('restaurants/RQ/settings/main')).online.viewOnly, true);
  const c = await page(B, { w: 390, h: 844 });
  await c.goto(MENU + '&t=3');
  await c.waitForSelector('.it');
  assert.ok((await c.textContent('#banners')).includes('📖 هذا منيو المطعم'));
  assert.equal((await c.textContent('#banners')).includes('مو مستقبل'), false);
  assert.equal(await c.locator('.add').count(), 0);
  assert.equal(await c.locator('.it.out').count(), 1, 'sold-out item still marked');
  await c.screenshot({ path: 'shots/online-menu-viewonly.png' });
  assert.deepEqual(clean(c), []);
  await c.context().close();
  await openOnlineSettings(cashier);
  await cashier.uncheck('#stOnView');
  await cashier.click('button >> text=حفظ الإعدادات');
  await until(async () => (await read('publicMenus/RQ')).modes.table === true);
});

test('owner pauses online orders / super admin turns the service off → customers can only browse', async () => {
  await openOnlineSettings(cashier);
  await cashier.uncheck('#stOnOn');
  await cashier.click('button >> text=حفظ الإعدادات');
  await until(async () => (await read('publicMenus/RQ')).on === false);
  const c = await page(B, { w: 390, h: 844 });
  await c.goto(MENU + '&t=3');
  await c.waitForSelector('.it');
  assert.ok((await c.textContent('#banners')).includes('مو مستقبل طلبات'));
  assert.equal(await c.locator('.add').count(), 0);
  // يرجّعها صاحب المطعم ثم المدير الأعلى يطفي الخدمة
  await cashier.check('#stOnOn'); await cashier.click('button >> text=حفظ الإعدادات');
  await c.waitForSelector('.add');
  await write('restaurants/RQ', { features: { online: false } });
  await until(async () => (await read('publicMenus/RQ')).on === false);
  await c.waitForFunction(() => !document.querySelector('.add'));
  await cashier.evaluate(() => { goTab('menu'); showMTab('settings'); });
  await cashier.waitForSelector('#mSetSec >> text=الخدمة موقوفة لمطعمك');
  assert.equal(await cashier.locator('#stOnOn').count(), 0);
  assert.deepEqual(clean(c), []);
  assert.deepEqual(clean(cashier), []);
  await c.context().close();
  await cashier.context().close();
});
