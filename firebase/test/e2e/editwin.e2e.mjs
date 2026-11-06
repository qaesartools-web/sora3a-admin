// نافذة تعديل الطلب بالكاشير: على قد الشاشة (بدون تمرير الصفحة)، الطلب فوك/يم الأصناف،
// والقوائم تنسحب بالماوس (شاشات الكاشير اللمس اللي تشتغل كماوس ما تمرر بالسحب)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { serve, env, signUp, clearAuth, browser, page } from './harness.mjs';

let srv, E, B;
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 200)); } };
const read = async (p) => { let v; await E.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const clean = (p) => p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|integrity|digest|messaging|serviceWorker|ServiceWorker|AudioContext/i.test(e));

before(async () => {
  srv = await serve(); E = await env(); B = await browser();
  await E.clearFirestore(); await clearAuth();
  const u = await signUp('edw@x.com', 'secret123');
  const big = Array.from({ length: 40 }, (_, i) => ({ name: 'صنف ' + (i + 1), variants: [{ name: 'وحدة', price: 1000 + i * 250 }] }));
  const cats = [{ cat: 'الوجبات الرئيسية', emoji: '🍔', items: big },
    ...['المقبلات', 'السلطات', 'المشروبات الباردة', 'المشروبات الحارة', 'الحلويات', 'العروض', 'وجبات الأطفال', 'الإضافات', 'الصوصات']
      .map((c, k) => ({ cat: c, emoji: '🍽️', items: [{ name: c + ' ١', variants: [{ name: 'وحدة', price: 1500 + k * 100 }] }] }))];
  await E.withSecurityRulesDisabled(async (c) => { const db = c.firestore();
    await setDoc(doc(db, 'users', u), { role: 'restaurant', restaurantId: 'RW', email: 'edw@x.com' });
    await setDoc(doc(db, 'restaurants/RW'), { name: 'مطعم النافذة', userId: u, active: true });
    await setDoc(doc(db, 'restaurants/RW/menu/main'), { updatedAtMs: 1, device: 'seed', cats });
    const t = Date.now() - 600000;
    // طلب منتهي ومدفوع بالبطاقة — هم يتعدّل
    await setDoc(doc(db, 'orders/W1'), { restaurantId: 'RW', orderType: 'salon', table: '4', status: 'delivered', createdAtMs: t, deliveredAt: t + 60000, num: 5,
      customer: 'طاولة 4', items: [{ name: 'صنف 1', variant: 'وحدة', price: 1000, qty: 1 }, { name: 'صنف 2', variant: 'وحدة', price: 1250, qty: 2 }],
      value: 3500, payment: { method: 'card', cash: 0, card: 3500 } });
    // طلبين منتهين مرّوا على المطبخ (الزبون رجع يريد يضيف / الكاشير يصحح الحساب)
    for (const id of ['K1', 'K2']) await setDoc(doc(db, 'orders/' + id), { restaurantId: 'RW', orderType: 'takeaway', status: 'delivered', createdAtMs: t, deliveredAt: t + 60000,
      kitchen: 'ready', customer: 'سفري ' + id, items: [{ name: 'صنف 1', variant: 'وحدة', price: 1000, qty: 1 }], value: 1000, payment: { method: 'cash', cash: 1000, card: 0 } });
  });
});
after(async () => { await B?.close(); srv?.close(); await E?.cleanup(); setTimeout(() => process.exit(0), 200).unref(); });

async function login(p) {
  await p.goto('http://localhost:5050/sora3a-rest2/index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 15000 });
  await p.fill('#inEmail', 'edw@x.com'); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  await p.waitForSelector('#appPage.show', { timeout: 15000 });
  await p.waitForSelector('#prods .prod');
}
// الماوس ينسحب على العنصر من تحت لفوك (مثل الإصبع على شاشة الكاشير)
async function drag(p, sel, dy = 260) {
  const b = await p.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height - 30;
  await p.mouse.move(x, y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(x, y - (dy * i) / 10);
  await p.mouse.up();
}
const fits = (p) => p.evaluate(() => { const r = document.getElementById('edBox').getBoundingClientRect(), d = document.scrollingElement;
  return { top: r.top, bottom: r.bottom, vh: innerHeight, docScroll: d.scrollHeight - d.clientHeight,
    grid: (() => { const g = document.getElementById('edGrid'); return { sh: g.scrollHeight, ch: g.clientHeight }; })(),
    cats: (() => { const c = document.getElementById('edCats'); return { sw: c.scrollWidth, cw: c.clientWidth }; })(),
    lines: document.querySelectorAll('#edOrder .ed-line').length }; });

test('edit window fits one screen: order beside the items, only the items list scrolls, and it scrolls by mouse drag', async () => {
  const p = await page(B, { w: 1366, h: 768 });
  await login(p);
  // القائمة الرئيسية هم تنسحب بالماوس، والسحب ما يضيف صنف
  const prodsScroll = await p.evaluate(() => { const g = document.getElementById('prods'); return g.scrollHeight > g.clientHeight; });
  if (prodsScroll) {
    await drag(p, '#prods');
    assert.ok(await p.evaluate(() => document.getElementById('prods').scrollTop > 50), 'the menu scrolled by drag');
    assert.equal(await p.evaluate(() => cart.length), 0, 'a drag is not a tap');
  }
  await p.evaluate(() => ordEdit('W1'));
  await p.waitForSelector('#edOv.on');
  assert.match(await p.textContent('#edBox .ed-tit'), /طاولة 4.*مسلّم/);
  let f = await fits(p);
  assert.ok(f.top >= 0 && f.bottom <= f.vh + 1, `edit box inside the screen ${JSON.stringify(f)}`);
  assert.ok(f.docScroll <= 1, 'the page itself does not scroll');
  assert.ok(f.grid.sh > f.grid.ch + 100, 'only the items list scrolls');
  assert.ok(f.cats.sw <= f.cats.cw + 1, 'all categories show (they wrap, no sideways scroll)');
  assert.equal(f.lines, 2);
  // الطلب يم الأصناف (مو فوكها) بالشاشة العريضة
  const side = await p.evaluate(() => { const a = document.getElementById('edOrder').getBoundingClientRect(), b = document.querySelector('#edBox .ed-pick').getBoundingClientRect(); return Math.abs(a.top - b.top) < 40; });
  assert.ok(side, 'order panel beside the items');
  assert.equal(await p.locator('#edBox .ed-act button >> text=إلغاء الطلب').count(), 1, 'cancel is inside the window');
  // سحب = تمرير بدون إضافة
  await drag(p, '#edGrid');
  assert.ok(await p.evaluate(() => document.getElementById('edGrid').scrollTop > 50), 'items list scrolled by drag');
  assert.equal((await fits(p)).lines, 2, 'a drag does not add an item');
  // ضغطة عادية = تضيف
  await p.click('#edGrid [data-ed-it="0-39"]');
  await p.waitForSelector('#edOrder .ed-line.ed-line-new');
  assert.equal((await fits(p)).lines, 3);
  assert.match(await p.textContent('#edOrder .ed-paid'), /استلم من الزبون 10,750/);
  await p.waitForTimeout(300); await p.screenshot({ path: 'shots/pos-edit-window.png' });
  await p.click('#edOrder .confbtn');
  await p.waitForSelector('#edOv.on', { state: 'detached', timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('edOv').classList.contains('on'));
  const o = await until(async () => { const x = await read('orders/W1'); return x.value === 14250 ? x : null; });
  assert.ok(o, 'saved');
  assert.equal(o.payment.card, 14250, 'card payment follows the new total');
  assert.equal(o.status, 'delivered', 'a finished order stays finished');
  assert.deepEqual(clean(p), []);
  await p.context().close();
});

test('small screens: the order sits above the items and the window still fits', async () => {
  for (const [w, h] of [[1024, 768], [800, 600], [390, 844]]) {
    const p = await page(B, { w, h });
    await login(p);
    await p.evaluate(() => ordEdit('W1'));
    await p.waitForSelector('#edOv.on');
    const f = await fits(p);
    assert.ok(f.top >= 0 && f.bottom <= f.vh + 1, `${w}x${h} edit box inside the screen ${JSON.stringify(f)}`);
    assert.ok(f.docScroll <= 1, `${w}x${h} the page itself does not scroll`);
    assert.ok(f.grid.ch >= 110, `${w}x${h} room for at least one full row of items ${JSON.stringify(f.grid)}`);
    if (h > 680 && w > 720) assert.ok(f.cats.sw <= f.cats.cw + 1, `${w}x${h} categories wrap`);
    else {
      // شاشة قصيرة/ضيقة: الأقسام سطر واحد ينسحب للجنب بالماوس، والسحب ما يبدّل القسم
      assert.ok(f.cats.sw > f.cats.cw, `${w}x${h} categories in one sideways row`);
      const b = await p.locator('#edCats').boundingBox(), y = b.y + b.height / 2, x = b.x + 40;
      await p.mouse.move(x, y); await p.mouse.down();
      for (let i = 1; i <= 10; i++) await p.mouse.move(x + 20 * i, y);
      await p.mouse.up();
      assert.ok(await p.evaluate(() => Math.abs(document.getElementById('edCats').scrollLeft) > 40), `${w}x${h} categories scrolled sideways`);
      assert.equal(await p.evaluate(() => edState.cat || 0), 0, 'a drag does not switch the category');
    }
    if (w <= 720) {
      const above = await p.evaluate(() => document.getElementById('edOrder').getBoundingClientRect().bottom <= document.querySelector('#edBox .ed-pick').getBoundingClientRect().top + 2);
      assert.ok(above, `${w}x${h} order above the items`);
    }
    await p.waitForTimeout(500); await p.screenshot({ path: `shots/pos-edit-window-${w}.png` });
    await p.evaluate(() => edClose());
    assert.deepEqual(clean(p), []);
    await p.context().close();
  }
});

test('finished order + new item: the cashier picks «to the kitchen» (default) or «account fix only»', async () => {
  const p = await page(B, { w: 1366, h: 768 });
  await login(p);
  for (const [id, pick] of [['K1', 'k'], ['K2', 'n']]) {
    await p.evaluate((i) => ordEdit(i), id);
    await p.waitForSelector('#edOv.on');
    assert.equal(await p.locator('#edOrder .ed-kt').count(), 0, 'no choice until an item is added');
    await p.click('#edGrid [data-ed-it="0-1"]');
    await p.waitForSelector('#edOrder .ed-kt');
    assert.equal(await p.inputValue('#edOrder .ed-kt'), 'k', 'default: added items go to the kitchen');
    if (pick === 'n') await p.selectOption('#edOrder .ed-kt', 'n');
    assert.match(await p.textContent('#edOrder .ed-paid'), /استلم من الزبون 1,250/);
    await p.click('#edOrder .confbtn');
    const o = await until(async () => { const x = await read('orders/' + id); return x.value === 2250 ? x : null; });
    assert.ok(o, id + ' saved');
    assert.equal(o.status, 'delivered');
    assert.equal(o.payment.cash, 2250);
    assert.equal(o.kitchen, pick === 'k' ? 'new' : 'ready', id + ' kitchen state');
    assert.equal(o.kEdits.at(-1).add[0].name, 'صنف 2');
  }
  assert.deepEqual(clean(p), []);
  await p.context().close();
});
