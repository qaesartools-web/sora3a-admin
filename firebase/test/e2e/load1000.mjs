// اختبار تحمّل: 1000 طلب على كل التطبيقات بنفس الوقت — على المحاكي، بنفس كود التطبيقات الحقيقي ومتصفحات حقيقية.
//   500 دلفري (450 من كاشير الدلفري بالتلفون + 50 من منيو الباركود)
//   250 صالة  (150 من كاشير الصالة + 70 من تطبيق الويتر + 30 من باركود الطاولة)
//   250 سفري  (100 سفري فوري + 100 قيد التحضير من الكاشير + 50 استلام من الباركود)
// الأجهزة: كاشير دلفري، كاشير صالة وسفري، شاشة المجهز، 8 كباتن، الويتر، زبائن الباركود، برج سرعة، لوحة إدارة المطعم.
// يقيس: سرعة الطلبات، وقت وصول الطلب لكل شاشة، ذاكرة وتعليق الصفحات، سرعة الشاشات بـ1000 طلب، وتطابق الأرقام بالنهاية.
// تشغيل (من مجلد firebase):
//   npx firebase emulators:exec --only auth,firestore --project sora3a-system "cd test/e2e && SORA3A_ROOT=/home/user CHROME_PATH=/opt/pw-browsers/chromium node load1000.mjs"
//   SCALE=0.05 للتجربة السريعة (50 طلب بنفس النسب)
import { doc, setDoc, getDocs, collection, query, where, writeBatch } from 'firebase/firestore';
import { writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { serve, env, signUp, clearAuth, browser, page, ROOTS } from './harness.mjs';

const SCALE = Number(process.env.SCALE || 1);
const n = (x) => Math.max(1, Math.round(x * SCALE));
const N = { delivCash: n(450), delivQR: n(50), salonCash: n(150), salonWaiter: n(70), salonQR: n(30), quick: n(100), hold: n(100), pickupQR: n(50) };
// PRELOAD=850: اليوم يبدي بهالعدد من الطلبات المكتملة (مطعم مزدحم من الصبح) — وبعدين الطلبات الحية فوقها، فكل الشاشات تشتغل بـ1000 طلب باليوم
const PRELOAD = Math.max(0, Number(process.env.PRELOAD || 0));
const TOTAL = Object.values(N).reduce((a, b) => a + b, 0) + PRELOAD;
// INJECT=0.7: هاي النسبة من طلبات الكاشير (دلفري، صالة، سفري فوري) تنكتب بالسيرفر مباشرة مثل كاشيرية إضافية
//   (جهاز الاختبار 4 معالجات بس) — وكل الشاشات (المجهز، الكباتن، الكاشير، البرج، الإدارة) لازم تستلمها وتعالجها
const INJECT = Math.min(Math.max(Number(process.env.INJECT || 0), 0), 0.95), INJ_MIN = Number(process.env.INJ_MIN || 40);
const I = { delivCash: Math.round(N.delivCash * INJECT), salonCash: Math.round(N.salonCash * INJECT), quick: Math.round(N.quick * INJECT) };
const CAPS = Number(process.env.CAPS || 5), RID = 'RL', DEADLINE = Date.now() + Number(process.env.MAX_MIN || 150) * 60000;
const OUT = process.env.OUT || '/tmp/load1000';
const FRAME_MS = Number(process.env.FRAME_MS || 10000);
// إيقاع الطلبات: كل كاشير طلب كل PACE_MS تقريباً (المحاكي عملية وحدة ما تتحمل سرعة غير واقعية؛ مطعم مزدحم ≈ طلب كل دقيقة لكل كاشير)
const PACE_MS = Number(process.env.PACE_MS || 3500);   // صورة لكل شاشة كل 10 ثواني ← فيديو «كل الشاشات سوا»
const BASE = 'http://localhost:5050/sora3a-rest2/';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const bagDay = (ms = Date.now()) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ضغطة على أول عنصر يطابق، ويتلقّى من جديد إذا انرسم (مثل الإنسان) — ترجع false إذا ماكو أو ما انضغط
const tap = async (p, sel, timeout = 5000) => { const l = p.locator(sel).first(); if (!(await l.count())) return false; try { await l.click({ timeout }); return true; } catch (e) { return false; } };
const T0 = Date.now(), secs = () => Math.round((Date.now() - T0) / 1000);
const log = (...a) => console.log(`[${String(secs()).padStart(4)}s]`, ...a);
const rnd = (k) => Math.floor(Math.random() * k);

let E, B, srv, towerSrv, TB;
const read = async (col, f, v) => { let r; await E.withSecurityRulesDisabled(async (c) => { const s = await getDocs(query(collection(c.firestore(), col), where(f, '==', v))); r = s.docs.map((d) => ({ id: d.id, ...d.data() })); }); return r; };
const put = (p, d) => E.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), p), d));

// ── المنيو: 20 صنف (أغلبها سعر واحد) ──
const MENU = [
  { cat: 'برغر', emoji: '🍔', items: [['كلاسك برغر', 6000], ['زنكر', 7000], ['تشيز برغر', 6500], ['دبل برغر', 9000], ['برغر دجاج', 5500]] },
  { cat: 'شاورما', emoji: '🌯', items: [['شاورما لحم', 4000], ['شاورما دجاج', 3500], ['صحن شاورما', 8000], ['عربي دجاج', 5000]] },
  { cat: 'بيتزا', emoji: '🍕', items: [['بيتزا خضار', 7000], ['بيتزا لحم', 9000], ['بيتزا دجاج', 8000]] },
  { cat: 'مشروبات', emoji: '🥤', items: [['بيبسي', 1000], ['لبن', 750], ['ماء', 500], ['عصير برتقال', 2000], ['شاي', 500]] },
  { cat: 'حلويات', emoji: '🍰', items: [['كنافة', 3000], ['تشيز كيك', 3500], ['آيس كريم', 2000]] },
].map((c) => ({ cat: c.cat, emoji: c.emoji, items: c.items.map(([name, price]) => ({ name, variants: [{ name: 'وحدة', price }] })) }));
const ITEMS = MENU.flatMap((c) => c.items.map((i) => i.name));

// كل صفحة: أول مرة يبين فيها كل طلب (حتى نقيس وقت الوصول) + التعليقات الطويلة (long tasks)
const PROBE = () => {
  window.__seen = {}; window.__lt = { n: 0, ms: 0, max: 0 };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lt.n++; window.__lt.ms += e.duration; window.__lt.max = Math.max(window.__lt.max, e.duration); })).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const mark = (id) => { if (id && !window.__seen[id]) window.__seen[id] = Date.now(); };
  const scan = (el) => {
    if (!el || el.nodeType !== 1) return;
    const one = (x) => { mark(x.getAttribute('data-done')); mark(x.getAttribute('data-oid')); const oc = x.getAttribute('onclick') || ''; const m = /(?:webAccept|openChangeCapForOrder|holdOpen)\('([^']+)'\)/.exec(oc); if (m) mark(m[1]); };
    one(el); el.querySelectorAll && el.querySelectorAll('[data-done],[data-oid],[onclick]').forEach(one);
  };
  new MutationObserver((ms) => ms.forEach((m) => { if (m.type === 'attributes') scan(m.target); else m.addedNodes.forEach(scan); }))
    .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-oid', 'data-done'] });
};
// أجهزة الاختبار كلها على 4 معالجات بس: الحركات (animation) تنعرض بسرعة حتى ما تاكل المعالج — منطق التطبيق ما يتغير
const CALM = () => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important}'; document.head.appendChild(s); });
async function dev(opts) { const p = await page(B, opts); p.setDefaultTimeout(12000); await p.context().addInitScript(PROBE); await p.context().addInitScript(CALM); countReqs(p); return p; }
// كم طلب يرسل كل جهاز للسيرفر (قراءة/استماع/كتابة) — تطبيق «يلح» على السيرفر يكلّف قراءات بالـFirebase الحقيقي
function countReqs(p) {
  p.reqs = { listen: 0, write: 0, other: 0 };
  p.on('request', (r) => { const u = r.url(); if (!/127\.0\.0\.1:8080|localhost:8080/.test(u)) return; if (/Listen\/channel/.test(u)) p.reqs.listen++; else if (/Write\/channel|:commit|:batchWrite/.test(u)) p.reqs.write++; else p.reqs.other++; });
}
const metrics = (p) => p.evaluate(() => ({ heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, dom: document.getElementsByTagName('*').length, lt: window.__lt })).catch(() => null);

// ── التجهيز ──
async function seed() {
  await E.clearFirestore(); await clearAuth();
  const U = { owner: await signUp('owner@load.iq', 'secret123'), cashD: await signUp('deliv@load.iq', 'secret123'), cashS: await signUp('hall@load.iq', 'secret123'), admin: await signUp('boss@load.iq', 'secret123'),
    cashD2: await signUp('deliv2@load.iq', 'secret123'), cashS2: await signUp('hall2@load.iq', 'secret123') };
  for (let i = 1; i <= CAPS; i++) U['c' + i] = await signUp(`cap${i}@load.iq`, 'secret123');
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore(), S = (p, d) => setDoc(doc(db, p), d);
    await S('users/' + U.admin, { role: 'admin', email: 'boss@load.iq', name: 'المدير' });
    await S('users/' + U.owner, { role: 'restaurant', restaurantId: RID, email: 'owner@load.iq', name: 'صاحب المطعم' });
    const base = { discount: true, cancel: true, inventory: false, menu: false, settings: false, pager: false };
    await S('users/' + U.cashD, { role: 'cashier', restaurantId: RID, email: 'deliv@load.iq', name: 'كاشير الدلفري', perms: { ...base, oDeliv: true, oSalon: false, oTake: false, oHold: false } });
    await S('users/' + U.cashS, { role: 'cashier', restaurantId: RID, email: 'hall@load.iq', name: 'كاشير الصالة', perms: { ...base, oDeliv: false, oSalon: true, oTake: true, oHold: true } });
    await S('users/' + U.cashD2, { role: 'cashier', restaurantId: RID, email: 'deliv2@load.iq', name: 'كاشير الدلفري 2', perms: { ...base, oDeliv: true, oSalon: false, oTake: false, oHold: false } });
    await S('users/' + U.cashS2, { role: 'cashier', restaurantId: RID, email: 'hall2@load.iq', name: 'كاشير الصالة 2', perms: { ...base, oDeliv: false, oSalon: true, oTake: true, oHold: true } });
    await S('restaurants/' + RID, { name: 'مطعم التحمّل', area: 'الكرادة', phone: '07701112233', userId: U.owner, active: true, subscription: 100000, expiry: bagDay(Date.now() + 30 * 86400000), expiryMs: Date.now() + 30 * 86400000,
      features: { captain: true, kitchen: true, waiter: true, online: true } });
    await S(`restaurants/${RID}/settings/main`, { tables: 30, defaultFee: 3000, receiptTitle: 'مطعم التحمّل', online: { on: true, table: true, pickup: true, delivery: true }, updatedAtMs: 1 });
    await S(`restaurants/${RID}/menu/main`, { cats: MENU, updatedAtMs: 1, device: 'seed' });
    await S('publicMenus/' + RID, { name: 'مطعم التحمّل', area: 'الكرادة', phone: '07701112233', on: true, modes: { table: true, pickup: true, delivery: true }, fee: 3000, tables: 30, note: '', autoTable: false,
      cats: MENU.map((c) => ({ cat: c.cat, emoji: c.emoji, items: c.items.map((i) => ({ name: i.name, variants: i.variants })) })), updatedAtMs: Date.now() });
    for (let i = 1; i <= CAPS; i++) {
      await S('users/' + U['c' + i], { role: 'captain', restaurantId: RID, captainId: 'C' + i, email: `cap${i}@load.iq`, name: 'كابتن ' + i });
      await S('captains/C' + i, { restaurantId: RID, userId: U['c' + i], name: 'كابتن ' + i, phone: '0780000000' + i, available: true });
    }
  });
  return U;
}

async function posLogin(p, email) {
  await p.goto(BASE + 'index.html');
  await p.waitForSelector('#loginPage', { state: 'visible', timeout: 20000 });
  await p.fill('#inEmail', email); await p.fill('#inPass', 'secret123'); await p.click('#loginBtn');
  const t = Date.now();
  await p.waitForSelector('#prods .prod', { timeout: 120000 });
  // وقت فتح الكاشير مع طلبات اليوم كلها (PRELOAD) + كم طلب حمّل + تعليق الصفحة
  const lt = await p.evaluate(() => ({ orders: (window.orders || []).length, lt: window.__lt })).catch(() => ({}));
  log(`🔑 ${email}: الكاشير فتح خلال ${((Date.now() - t) / 1000).toFixed(1)} ثانية • طلبات محمّلة ${lt.orders} • تعليق ${lt.lt ? Math.round(lt.lt.ms) + 'ms (أطول ' + Math.round(lt.lt.max) + ')' : '-'}`);
  (S.open = S.open || []).push({ email, sec: (Date.now() - t) / 1000, orders: lt.orders, ltMs: lt.lt && Math.round(lt.lt.ms) });
  await p.waitForTimeout(1500);
  // فتح وردية (رصيد 0) حتى نطابق الدرج بالنهاية
  try {
    await p.evaluate(() => goTab('shift')); await p.waitForSelector('#shOpenCash', { state: 'attached', timeout: 15000 });
    await p.evaluate(() => { document.getElementById('shOpenCash').value = '0'; return shiftOpen(); }); await p.waitForTimeout(500);
    await p.evaluate(() => goTab('cashier'));
  } catch (e) {
    await p.screenshot({ path: OUT + '_login-' + email.split('@')[0] + '.png' }).catch(() => {});
    console.log('DBG shift', email, await p.evaluate(() => ({ on: document.getElementById('shiftScreen').classList.contains('on'), body: document.getElementById('shiftBody').innerHTML.slice(0, 160), overlays: [...document.querySelectorAll('.on')].map((x) => x.id || x.className).slice(0, 12) })).catch((x) => String(x)));
    throw e;
  }
}
async function pairScreen(p, url, kind, name) {
  await p.goto(url);
  await p.waitForSelector('#pairCode', { timeout: 20000 });
  const code = (await p.textContent('#pairCode')).trim();
  let pr = null;
  for (let i = 0; i < 80 && !pr; i++) {
    await E.withSecurityRulesDisabled(async (c) => { const { getDoc } = await import('firebase/firestore'); const s = await getDoc(doc(c.firestore(), 'screenPairs/' + code)); pr = s.exists() ? s.data() : null; });
    if (!pr) await sleep(250);
  }
  await put('screens/' + pr.uid, { restaurantId: RID, restName: 'مطعم التحمّل', code, kind: pr.kind || kind, name, pairedBy: 'hq', approved: true, atMs: Date.now() });
}
// يختار قسم عشوائي (إذا الصفحة بيها أقسام) وبعدين صنف من الظاهر بالشاشة
async function addItems(p, sel, k, catSel) {
  for (let j = 0; j < k; j++) {
    if (catSel) { const nc = await p.locator(catSel).count(); if (nc) await p.locator(catSel).nth(rnd(nc)).click(); }
    const loc = p.locator(sel + ':visible'); await loc.first().waitFor({ timeout: 8000 });
    await loc.nth(rnd(await loc.count())).click();
  }
}

let TILES = [];
const S = { made: { D: 0, S: 0, W: 0, QR: 0, I: 0 }, err: [], phase: 'run', capIdx: 0 };
const nextCap = () => 'C' + ((S.capIdx++ % CAPS) + 1);
const safe = (name, fn) => fn().catch((e) => { S.err.push(name + ': ' + String(e.message || e).split('\n')[0]); });

// ── كاشير الدلفري: يقبل طلبات الباركود، يحوّل الجاهز للكابتن، يسوي طلبات التلفون، ويستلم فلوس الكباتن ──
async function cashierD(p, quota, settles, tag) {
  let made = 0, phoneN = tag * 100000;
  const assign = async (id) => {
    await p.evaluate((id) => openChangeCapForOrder(id), id);
    await p.waitForSelector('#delivOv.on #capList .capcard', { timeout: 10000 });
    const cc = '#cc_' + nextCap();
    await p.click(cc); await p.waitForSelector(cc + '.on', { timeout: 5000 });
    await p.click('#confCapBtn');
    await p.waitForFunction(() => !document.getElementById('delivOv').classList.contains('on'), null, { timeout: 10000 });
  };
  while (Date.now() < DEADLINE && S.phase === 'run') {
    // نافذة بقت مفتوحة من محاولة فاشلة ← نسدها حتى ما تغطي الشاشة
    if (await p.evaluate(() => document.getElementById('delivOv').classList.contains('on') || document.getElementById('payOv').classList.contains('on'))) {
      S.err.push('D.leftOpen'); await p.evaluate(() => { closeDeliv(); if (window.payClose) payClose(); }); continue;
    }
    // 1) طلب باركود دلفري جديد ← قبول
    if (await tap(p, '#webBox .web-card .call-go:not([disabled])')) { await sleep(300); continue; }
    // 2) دلفري جهز بالمطبخ وينتظر كابتن (باركود)
    const wait = await p.evaluate(() => { const o = orders.find((x) => x.awaitCap && !x.captainId && x.orderType === 'delivery' && x.status !== 'cancelled' && (x.kitchen === 'ready' || x.status === 'ready')); return o && o.id; });
    if (wait) { await safe('D.assignQR', () => assign(wait)); continue; }
    // 3) فلوس الكباتن: كل 15 طلب واصل
    const due = await p.evaluate(() => orders.filter((o) => o.orderType === 'delivery' && o.status === 'delivered' && o.capSettled === false).map((o) => o.id));
    if (settles && (due.length >= 15 || (due.length && made >= quota))) {
      await safe('D.settle', async () => {
        await p.evaluate(() => goTab('capPay'));
        for (const id of due.slice(0, 30)) await tap(p, `[data-cap-order="${id}"] button`, 3000);
        await p.evaluate(() => goTab('cashier'));
      });
      continue;
    }
    // 4) طلب دلفري بالتلفون
    if (made < quota) {
      const phone = '0771' + String(1000000 + phoneN++).slice(1);
      await safe('D.create', async () => {
        await addItems(p, '#prods .prod', 1 + rnd(3), '.cb');
        await p.click('#sendBtn'); await p.click('#typeOv .otype[data-t="delivery"]');
        await p.waitForSelector('#delivOv.on');
        await p.fill('#dName', 'زبون ' + phoneN); await p.fill('#dPhone', phone); await p.fill('#dAddr', 'الكرادة شارع ' + (1 + rnd(90)));
        await p.click('#confCapBtn');
        const h = await p.waitForFunction((ph) => { const o = orders.find((x) => x.phone === ph && x.awaitCap && !x.captainId); return o && o.id; }, phone, { timeout: 15000 });
        await assign(await h.jsonValue());
        made++; S.made.D++;
      });
      await sleep(PACE_MS * (0.6 + Math.random() * 0.8));
      continue;
    }
    if (S.allIn) { const left = await p.evaluate(() => orders.filter((o) => o.orderType === 'delivery' && o.capSettled === false && o.status !== 'cancelled').length); if (!left) break; }
    await sleep(500);
  }
}

// ── كاشير الصالة والسفري: يقبل طلبات الويتر والباركود، يسلّم الجاهز ويستلم المبلغ، ويسوي طلبات صالة/سفري ──
async function cashierS(p, queue) {
  while (Date.now() < DEADLINE && S.phase === 'run') {
    if (await p.evaluate(() => ['payOv', 'acOv', 'viewOv'].some((id) => { const e = document.getElementById(id); return e && e.classList.contains('on'); }))) {
      S.err.push('S.leftOpen'); await p.evaluate(() => { if (window.payClose) payClose(); if (window.acClose) acClose(); if (window.viewClose) viewClose(); }); continue;
    }
    if (await tap(p, '#webBox .web-card .call-go:not([disabled])')) { await sleep(300); continue; }
    // جاهز من المطبخ وما مدفوع (سفري قيد التحضير، طاولة ويتر/باركود، استلام باركود) ← تسليم + استلام المبلغ
    const rd = await p.evaluate(() => { const o = orders.find((x) => x.held && x.status === 'ready' && x.orderType !== 'delivery'); return o && o.id; });
    if (rd) {
      await safe('S.handover', async () => {
        await p.evaluate((id) => holdOpen(id), rd);
        await p.click('button.confbtn:has-text("استلام المبلغ"), button.confbtn:has-text("تسليم للزبون")');
        await p.waitForSelector('#payOv.on', { timeout: 8000 }); await p.click('#payOk');
        await p.waitForFunction((id) => { const o = orders.find((x) => x.id === id); return !o || o.status === 'delivered'; }, rd, { timeout: 15000 });
      });
      continue;
    }
    if (queue.length) {
      const t = queue.pop();
      await safe('S.create.' + t, async () => {
        await addItems(p, '#prods .prod', 1 + rnd(3), '.cb');
        await p.click('#sendBtn'); await p.click(`#typeOv .otype[data-t="${t}"]`);
        if (t === 'takeaway') { await p.waitForSelector('#acOv.on'); await p.fill('#acf_name', 'سفري ' + (S.made.S + 1)); await p.click('#acDlgOk'); }
        else {
          await p.waitForSelector('#payOv.on');
          if (t === 'salon' && await p.$('#payTableSel')) await p.selectOption('#payTableSel', String(1 + rnd(30)));
          await p.click('#payOk');
        }
        S.made.S++;
      });
      await sleep(PACE_MS * (0.6 + Math.random() * 0.8));
      continue;
    }
    if (S.allIn) { const left = await p.evaluate(() => orders.filter((o) => o.orderType !== 'delivery' && o.status !== 'delivered' && o.status !== 'cancelled').length); if (!left) break; }
    await sleep(500);
  }
}

// ── شاشة المجهز: «جاهز» لأقدم طلب ──
async function kitchen(p) {
  while (Date.now() < DEADLINE && S.phase === 'run') {
    if (await tap(p, '.card [data-done]')) { await sleep(120); continue; }
    if (S.allIn && S.kitchenIdle) break;
    await sleep(400);
  }
}

// ── الكابتن: يقبل، يستلم، ينطلق، يصوّر، يسلّم ──
async function captain(p) {
  while (Date.now() < DEADLINE && S.phase === 'run') {
    // نافذة «أرسل رابط التتبع» ممكن تطلع متأخرة (السيرفر بطيء) ← نتخطاها
    if (await p.$('#waSheet.show')) { await tap(p, '#waSkip', 3000); continue; }
    if (await p.$('#incoming.show')) { await safe('C.accept', async () => { await p.click('#acceptBtn'); const wa = await p.waitForSelector('#waSheet.show', { timeout: 2500 }).catch(() => null); if (wa) await p.click('#waSkip'); }); continue; }
    if (await tap(p, '#tab-active [data-act="pickup"], #tab-active [data-act="deliver"], #tab-active [data-act="done"]')) { await sleep(250); continue; }
    const ph = await p.$('#tab-active input[data-photo]');
    if (ph) { await safe('C.photo', () => ph.setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG })); await sleep(250); continue; }
    if (S.allIn && S.capIdle) break;
    await sleep(400);
  }
}

// ── الويتر: طاولة ← أصناف ← إرسال ──
async function waiter(p) {
  for (let i = 0; i < N.salonWaiter && Date.now() < DEADLINE; i++) {
    await safe('W.order', async () => {
      await p.click('.tab[data-tab="tables"]').catch(() => {});
      await p.click(`.tb[data-t="${1 + rnd(30)}"]`);
      await p.waitForSelector('.it');
      await addItems(p, '.it', 1 + rnd(3), '#cats .chip');
      if (await p.$('#itemSh.on')) await p.click('#iAdd');
      await p.click('#barBtn'); await p.waitForSelector('#cartSh.on'); await p.click('#cSend');
      await p.waitForSelector('#vOrders:not([hidden])', { timeout: 10000 });
      S.made.W++;
    });
    await sleep(PACE_MS * 3 * (0.6 + Math.random() * 0.8));
  }
}

// ── زبون الباركود: طاولة / استلام / توصيل ──
async function qrCustomer(p, jobs) {
  let first = true;
  for (const [mode, k] of jobs) {
    if (Date.now() > DEADLINE) break;
    await safe('QR.' + mode, async () => {
      // كل طلب = زبون جديد يفتح رابط الباركود (طاولة أو المنيو العام)
      await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }).catch(() => {});
      await p.goto(BASE + 'menu.html?r=' + RID + (mode === 'table' ? '&t=' + (1 + rnd(30)) : '')); first = false;
      await p.waitForSelector('.it [data-add]', { timeout: 15000 });
      await addItems(p, '[data-add]', 1 + rnd(3));
      await p.click('#barBtn'); await p.waitForSelector('#cartSh.on');
      if (mode !== 'table') {
        await p.click(`#cartSh [data-m="${mode}"]`);
        await p.fill('#cName', 'زبون باركود ' + k); await p.fill('#cPhone', '0782' + String(1000000 + k).slice(1));
        if (mode === 'delivery') await p.fill('#cAddr', 'زيونة قرب الجامع ' + k);
      }
      await p.click('#cSend');
      if (mode !== 'table' && await p.$('#cAddr:visible') && mode === 'delivery' && !(await p.inputValue('#cAddr'))) { await p.fill('#cAddr', 'زيونة ' + k); await p.click('#cSend'); }
      await p.waitForSelector('#stView .st h2', { timeout: 15000 });
      S.made.QR++;
    });
    await sleep(PACE_MS * 2 * (0.6 + Math.random() * 0.8));
  }
  return p;
}

// ── طلبات اليوم من قبل (PRELOAD): مكتملة، أرقامها 1..PRELOAD، موزعة على ساعات اليوم، والدلفري على الكباتن ──
async function preload() {
  if (!PRELOAD) return;
  const all = MENU.flatMap((c) => c.items), now = Date.now();
  const dayStart = Date.parse(bagDay(now) + 'T00:00:00+03:00'), from = Math.max(dayStart + 30 * 60000, now - 10 * 3600000), to = now - 5 * 60000;
  const types = Array.from({ length: PRELOAD }, (_, i) => (i % 4 < 2 ? 'delivery' : i % 4 === 2 ? 'salon' : 'takeaway'));
  await E.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (let b = 0; b < PRELOAD; b += 400) {
      const batch = writeBatch(db);
      for (let i = b; i < Math.min(PRELOAD, b + 400); i++) {
        const t = from + Math.round(((to - from) * i) / PRELOAD), type = types[i];
        const items = Array.from({ length: 1 + rnd(3) }, () => { const it = all[rnd(all.length)]; return { name: it.name, variant: 'وحدة', price: it.variants[0].price, qty: 1 + rnd(2), cost: 0 }; });
        const sub = items.reduce((a, x) => a + x.price * x.qty, 0);
        const o = { restaurantId: RID, restaurantName: 'مطعم التحمّل', orderType: type, items, notes: items.map((x) => `${x.name}(وحدة)×${x.qty}`).join(', '),
          subtotal: sub, discount: 0, service: 0, tax: 0, value: sub, inv: true, kitchen: 'ready', createdAt: new Date(t).toISOString(), createdAtMs: t,
          shiftId: null, device: 'preload', inject: true, day: bagDay(t), ticketNo: i + 1, status: 'delivered', deliveredAt: t + 20 * 60000, deliveredAtMs: t + 20 * 60000,
          timeline: [{ status: 'delivered', time: '', text: 'تم إنشاء الطلب' }] };
        if (type === 'delivery') { const k = 1 + (i % CAPS); Object.assign(o, { customer: 'زبون ' + (i + 1), phone: '0773' + String(1000000 + i).slice(1), address: 'زيونة شارع ' + (1 + rnd(90)), fee: 3000,
          captainId: 'C' + k, captainName: 'كابتن ' + k, commission: Math.round(sub * 0.1), deliveryProof: null, rejectedBy: [], payment: { method: 'cod' }, capSettled: true, hasProof: true }); }
        else Object.assign(o, { payment: { method: 'cash', cash: sub, card: 0 }, customer: type === 'salon' ? 'صالة #' + (i + 1) : 'سفري', ...(type === 'salon' ? { salonNum: i + 1 } : {}) });
        batch.set(doc(db, 'orders/PRE' + String(i).padStart(4, '0')), o);
      }
      await batch.commit();
    }
  });
  log(`📦 اليوم يبدي بـ${PRELOAD} طلب مكتمل (من ${new Date(from + 3 * 3600000).toISOString().slice(11, 16)} لهسه بتوقيت بغداد)`);
}

// ── مولّد الطلبات الإضافية (INJECT): نفس شكل طلب الكاشير — دلفري لكابتن، صالة وسفري فوري مدفوعة — والمجهز يعلّمها جاهز ──
async function injector() {
  const jobs = [...Array(I.delivCash).fill('delivery'), ...Array(I.salonCash).fill('salon'), ...Array(I.quick).fill('takeaway')].sort(() => Math.random() - 0.5);
  if (!jobs.length) return;
  log(`➕ مولّد: ${jobs.length} طلب خلال ${INJ_MIN} دقيقة (${I.delivCash} دلفري • ${I.salonCash} صالة • ${I.quick} سفري فوري)`);
  const gap = (INJ_MIN * 60000) / jobs.length, t0 = Date.now(), all = MENU.flatMap((c) => c.items);
  for (let i = 0; i < jobs.length && Date.now() < DEADLINE && S.phase === 'run'; i++) {
    await sleep(Math.max(0, t0 + i * gap - Date.now()));
    const type = jobs[i], items = Array.from({ length: 1 + rnd(3) }, () => { const it = all[rnd(all.length)]; return { name: it.name, variant: 'وحدة', price: it.variants[0].price, qty: 1 + rnd(2), cost: 0 }; });
    const sub = items.reduce((a, x) => a + x.price * x.qty, 0), now = Date.now(), tk = 5001 + i;
    const o = { restaurantId: RID, restaurantName: 'مطعم التحمّل', orderType: type, items, notes: items.map((c) => `${c.name}(وحدة)×${c.qty}`).join(', '),
      subtotal: sub, discount: 0, service: 0, tax: 0, value: sub, inv: true, kitchen: 'new', createdAt: new Date(now).toISOString(), createdAtMs: now,
      shiftId: null, device: 'inject', inject: true, day: bagDay(now), ticketNo: tk };
    if (type === 'delivery') {
      const k = 1 + rnd(CAPS);
      Object.assign(o, { status: 'pending', customer: 'زبون ' + tk, phone: '0772' + String(1000000 + i).slice(1), address: 'المنصور شارع ' + (1 + rnd(90)), fee: 3000,
        captainId: 'C' + k, captainName: 'كابتن ' + k, commission: Math.round(sub * 0.1), deliveryProof: null, rejectedBy: [], payment: { method: 'cod' }, capSettled: false });
    } else Object.assign(o, { status: 'delivered', deliveredAt: now, payment: { method: 'cash', cash: sub, card: 0 }, customer: type === 'salon' ? 'صالة #' + tk : 'سفري', ...(type === 'salon' ? { salonNum: tk } : {}) });
    o.timeline = [{ status: o.status, time: '', text: 'تم إنشاء الطلب' }];
    try { await put('orders/INJ' + String(i).padStart(4, '0') + Math.random().toString(36).slice(2, 8), o); S.made.I++; } catch (e) { S.err.push('I.put: ' + String(e.message).slice(0, 80)); }
  }
}

// وضع القياس (FANOUT=1): نفتح الأجهزة مجموعة مجموعة ونقيس زمن كتابة طلب بالسيرفر بعد كل مجموعة
const FANOUT = process.env.FANOUT === '1', fan = [];
async function probeWrite(label) {
  if (!FANOUT) return;
  await sleep(4000);
  const ms = [];
  for (let i = 0; i < 12; i++) {
    const id = 'PRB' + Date.now() + i, t = Date.now();
    await fetch(`http://127.0.0.1:8080/v1/projects/sora3a-system/databases/(default)/documents/orders/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { restaurantId: { stringValue: RID }, orderType: { stringValue: 'takeaway' }, status: { stringValue: 'delivered' }, value: { integerValue: '1000' }, kitchen: { stringValue: 'ready' }, day: { stringValue: bagDay() }, createdAtMs: { integerValue: String(Date.now()) } } }) });
    ms.push(Date.now() - t); await sleep(250);
  }
  const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
  fan.push([label, avg, Math.max(...ms)]); log(`📏 ${label}: كتابة طلب ${avg}ms (أقصى ${Math.max(...ms)})`);
}
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const dist = (a) => a.length ? { n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) } : { n: 0 };
const fmt = (x) => Math.round(x).toLocaleString('en-US');

async function main() {
  srv = await serve(); E = await (env()); B = await browser();
  log(`تجهيز: ${TOTAL} طلب (SCALE=${SCALE})`, JSON.stringify(N));
  await seed(); await preload();
  // ── الأجهزة ──
  await probeWrite('بدون أجهزة');
  const D = await dev({ w: 1280, h: 860 }); await posLogin(D, 'deliv@load.iq');
  const Sx = await dev({ w: 1280, h: 860 }); await posLogin(Sx, 'hall@load.iq');
  const D2 = await dev({ w: 1280, h: 860 }); await posLogin(D2, 'deliv2@load.iq');
  const S2 = await dev({ w: 1280, h: 860 }); await posLogin(S2, 'hall2@load.iq');
  await probeWrite('+ كاشيرين');
  const K = await dev({ w: 1280, h: 800 }); await pairScreen(K, BASE + 'kitchen.html', 'kitchen', 'المجهز'); await K.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await probeWrite('+ المجهز');
  const W = await dev({ w: 390, h: 844 }); await pairScreen(W, BASE + 'waiter.html', 'waiter', 'علي'); await W.waitForSelector('.tb', { timeout: 20000 });
  await probeWrite('+ الويتر');
  const C = [];
  for (let i = 1; i <= CAPS; i++) {
    const p = await dev({ notif: true }); await p.goto('http://localhost:5050/sora3a-captain/captain.html');
    await p.fill('#email', `cap${i}@load.iq`); await p.fill('#password', 'secret123'); await p.click('#loginBtn');
    await p.waitForSelector('#tab-active', { timeout: 20000 }); C.push(p);
  }
  await probeWrite(`+ ${CAPS} كباتن`);
  // لوحة إدارة المطعم
  const A = await dev({ w: 1280, h: 900 });
  await A.goto('http://localhost:5050/sora3a-admin/index.html');
  await A.waitForSelector('#loginPage', { state: 'visible', timeout: 20000 });
  await A.fill('#lEmail', 'owner@load.iq'); await A.fill('#lPass', 'secret123'); await A.click('#lBtn');
  await A.waitForSelector('#appPage', { state: 'visible', timeout: 20000 });
  await probeWrite('+ لوحة الإدارة');
  // برج سرعة (مستودع sora3a-owner بنفس المحاكي)
  let Tw = null;
  try {
    const kit = await import(path.join(path.dirname(ROOTS['sora3a-admin']), 'sora3a-owner/test/kit.mjs'));
    towerSrv = await kit.serve(); TB = await kit.browser();
    Tw = await kit.device(TB, { key: 'LOADTESTLAPTOPKEY_xxxxxxxxxxxxxxxxxxx' }); await Tw.context().addInitScript(PROBE); countReqs(Tw);
    await kit.login(Tw, 'boss@load.iq');
    try { await Tw.waitForSelector('[data-boot]', { timeout: 8000 }); await Tw.click('[data-boot]'); } catch (e) {}
    await Tw.waitForSelector('.app .view[data-v="overview"]', { timeout: 20000 });
  } catch (e) { S.err.push('tower: ' + e.message); Tw = null; }
  await probeWrite('+ البرج');
  const Q1 = await dev({ w: 390, h: 844 }), Q2 = await dev({ w: 390, h: 844 });
  for (const q of [Q1, Q2]) await q.goto(BASE + 'menu.html?r=' + RID);
  await probeWrite('+ زبونين باركود');
  if (FANOUT) { console.log('FANOUT ' + JSON.stringify(fan)); await B.close(); if (TB) await TB.close(); process.exit(0); }
  // لوحة عدّادات حيّة (تطلع بالفيديو)
  const Dash = await dev({ w: 960, h: 600 });
  await Dash.setContent(`<html dir="rtl"><body style="margin:0;background:#0b1220;color:#fff;font-family:Tajawal,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;gap:18px">
    <div style="font-size:30px;font-weight:800">⚡ اختبار التحمّل — سرعة</div>
    <div id="big" dir="ltr" style="font-size:96px;font-weight:900;color:#f5c451">0 / ${TOTAL}</div><div style="font-size:26px;color:#9fb3ff">طلب مسجّل</div>
    <div id="rows" style="font-size:28px;line-height:1.7;text-align:center"></div></body></html>`);
  globalThis.dashUpdate = async (os, end) => {
    const c = (t) => os.filter((o) => (o.orderType || 'delivery') === t).length;
    const done = os.filter((o) => o.status === 'delivered' && (o.orderType !== 'delivery' || o.capSettled === true)).length;
    const mm = Math.floor(secs() / 60), ss = String(secs() % 60).padStart(2, '0');
    await Dash.evaluate(([a, b]) => { document.getElementById('big').textContent = a; document.getElementById('rows').innerHTML = b; },
      [`${os.length} / ${TOTAL}`, `🏍️ دلفري ${c('delivery')} • 🪑 صالة ${c('salon')} • 🥡 سفري ${c('takeaway')}<br>✅ مكتملة ${done} • 🍳 بالمطبخ ${os.filter((o) => o.kitchen !== 'ready').length}<br>⏱️ ${mm}:${ss}${end ? ' — خلص ✅' : ''}`]).catch(() => {});
  };
  const devices = { 'كاشير الدلفري': D, 'كاشير الدلفري 2': D2, 'كاشير الصالة': Sx, 'كاشير الصالة 2': S2, 'المجهز': K, 'الويتر': W, 'لوحة الإدارة': A, ...(Tw ? { 'البرج': Tw } : {}), ...Object.fromEntries(C.map((p, i) => ['كابتن ' + (i + 1), p])) };
  S.devices = { ...devices, 'زبون باركود 1': Q1, 'زبون باركود 2': Q2 };
  const m0 = {}; for (const [k, p] of Object.entries(devices)) m0[k] = await metrics(p);
  TILES = [['Cashier - Delivery 1', D], ['Cashier - Delivery 2', D2], ['Cashier - Hall 1', Sx], ['Cashier - Hall 2', S2], ['Kitchen display', K], ['Tower', Tw || Dash], ['Admin panel', A], ['Live counters', Dash], ['Waiter app', W], ['QR menu customer 1', Q1],
    ['QR menu customer 2', Q2], ...C.slice(0, 5).map((p, i) => ['Captain ' + (i + 1), p])].filter(([, p]) => p).slice(0, 16);
  log('كل الأجهزة جاهزة:', Object.keys(devices).length, 'جهاز');

  // ── التشغيل ──
  const tRun = Date.now();
  const qrJobs = [...Array(N.salonQR).fill('table'), ...Array(N.pickupQR).fill('pickup'), ...Array(N.delivQR).fill('delivery')].sort(() => Math.random() - 0.5).map((m, i) => [m, i + 1]);
  const half = Math.ceil(qrJobs.length / 2);
  const hallQ = [...Array(N.salonCash - I.salonCash).fill('salon'), ...Array(N.quick - I.quick).fill('quick'), ...Array(N.hold).fill('takeaway')].sort(() => Math.random() - 0.5);
  const dUI = N.delivCash - I.delivCash, dHalf = Math.ceil(dUI / 2);
  const runners = [cashierD(D, dHalf, true, 1), cashierD(D2, dUI - dHalf, false, 2), cashierS(Sx, hallQ.slice(0, Math.ceil(hallQ.length / 2))), cashierS(S2, hallQ.slice(Math.ceil(hallQ.length / 2))), kitchen(K), ...C.map(captain), waiter(W), qrCustomer(Q1, qrJobs.slice(0, half)), qrCustomer(Q2, qrJobs.slice(half)), injector()];
  // ── تصوير كل الشاشات كل FRAME_MS ←  فيديو واحد بالنهاية ──
  const FR = OUT + '_frames', BLACK = FR + '/black.jpg';
  mkdirSync(FR, { recursive: true });
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x0b1220:s=480x300', '-frames:v', '1', BLACK]); } catch (e) {}
  TILES.forEach((_, i) => mkdirSync(`${FR}/t${i}`, { recursive: true }));
  let frame = 0, shooting = false;
  const shoot = async () => {
    if (shooting) return; shooting = true;
    const f = String(++frame).padStart(5, '0');
    await Promise.all(TILES.map(async ([, p], i) => {
      const out = `${FR}/t${i}/${f}.jpg`;
      try { await p.screenshot({ type: 'jpeg', quality: 50, path: out, timeout: 6000, scale: 'css' }); }
      catch (e) { const prev = `${FR}/t${i}/${String(frame - 1).padStart(5, '0')}.jpg`; copyFileSync(existsSync(prev) ? prev : BLACK, out); }
    }));
    shooting = false;
  };
  await shoot();
  const cam = setInterval(shoot, FRAME_MS);
  const progress = [];
  const tick = setInterval(async () => {
    const os = await read('orders', 'restaurantId', RID).catch(() => []);
    const web = await read('webOrders', 'restaurantId', RID).catch(() => []);
    const done = os.filter((o) => o.status === 'delivered' && (o.orderType !== 'delivery' || o.capSettled === true)).length;
    const kNew = os.filter((o) => o.kitchen !== 'ready').length;
    S.allIn = os.length >= TOTAL && web.every((w) => w.status !== 'new');
    S.kitchenIdle = S.allIn && kNew === 0;
    S.capIdle = S.allIn && !os.some((o) => o.orderType === 'delivery' && o.status !== 'delivered' && o.status !== 'cancelled');
    const reqs = Object.fromEntries(Object.entries(S.devices || {}).map(([k, p]) => [k, p.reqs ? p.reqs.listen + p.reqs.write + p.reqs.other : 0]));
    const row = { t: secs(), orders: os.length, done, kitchenWaiting: kNew, made: { ...S.made }, errors: S.err.length, reqs };
    progress.push(row);
    globalThis.dashUpdate && dashUpdate(os);
    if (S.err.length > (S.errShown || 0)) { S.err.slice(S.errShown || 0).slice(-5).forEach((e) => log('  ⚠️', e)); S.errShown = S.err.length; }
    if (row.t % 60 < 15) log('  📡 طلبات السيرفر (أكثر 5):', Object.entries(reqs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ' ' + v).join(' • '));
    log(`طلبات ${os.length}/${TOTAL} • مكتملة ${done} • بالمطبخ ${kNew} • كاشير د ${S.made.D} ص ${S.made.S} • ويتر ${S.made.W} • باركود ${S.made.QR} • مولّد ${S.made.I} • أخطاء ${S.err.length}`);
    if (done >= TOTAL) S.phase = 'done';
  }, 15000);
  await Promise.all(runners);
  S.phase = 'done'; clearInterval(tick);
  await dashUpdate(await read('orders', 'restaurantId', RID).catch(() => []), true);
  await sleep(2500); await shoot(); await shoot(); clearInterval(cam);
  const tEnd = Date.now();
  log('خلص التشغيل خلال', Math.round((tEnd - tRun) / 1000), 'ثانية');
  await sleep(4000);

  // ── التحقق ──
  const os = await read('orders', 'restaurantId', RID), web = await read('webOrders', 'restaurantId', RID);
  const by = (t) => os.filter((o) => (o.orderType || 'delivery') === t);
  const sum = (a, f = (o) => o.value || 0) => a.reduce((s, o) => s + f(o), 0);
  const live = os.filter((o) => o.status !== 'cancelled');
  const R = { scale: SCALE, planned: N, total: TOTAL, runSeconds: Math.round((tEnd - tRun) / 1000), errors: S.err, progress };
  R.firestore = {
    orders: os.length, cancelled: os.length - live.length,
    delivery: by('delivery').length, salon: by('salon').length, takeaway: by('takeaway').length,
    notDelivered: os.filter((o) => o.status !== 'delivered').map((o) => [o.id, o.orderType, o.status]).slice(0, 20),
    unsettledDelivery: by('delivery').filter((o) => o.capSettled !== true).length,
    unpaid: os.filter((o) => o.orderType !== 'delivery' && (!o.payment || o.payment.method === 'later')).length,
    kitchenNotReady: os.filter((o) => o.kitchen !== 'ready').length,
    duplicateTickets: os.length - new Set(os.map((o) => o.ticketNo)).size,
    sales: sum(live), fees: sum(by('delivery'), (o) => o.fee || 0),
    webOrders: web.length, webNotLinked: web.filter((w) => w.status === 'new').length,
    bySource: { waiter: os.filter((o) => o.source === 'waiter').length, qr: os.filter((o) => o.source === 'qr').length, cashier: os.filter((o) => !o.source).length },
  };
  // الكاشيرين: الوردية والتقرير اليومي
  const shiftOf = (p) => p.evaluate(async () => { goTab('shift'); await new Promise((r) => setTimeout(r, 400)); const v = [...document.querySelectorAll('#shiftBody .sh-stat')].map((s) => [s.querySelector('span').textContent.trim(), s.querySelector('b').textContent.trim()]); goTab('cashier'); return Object.fromEntries(v); });
  const day = (p) => p.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); const t = performance.now(); const r = dailyCalc(d.getTime(), d.getTime() + 86400000); return { n: r.n, sales: r.sales, cash: r.cash, cod: r.cod, later: r.later, ms: Math.round(performance.now() - t), loaded: orders.length }; });
  R.cashiers = {};
  for (const [k, p] of [['دلفري 1', D], ['دلفري 2', D2], ['صالة 1', Sx], ['صالة 2', S2]]) R.cashiers[k] = { shift: await shiftOf(p), day: await day(p) };
  const num = (v) => Number(String(v || '0').replace(/[^\d]/g, '')) || 0;
  R.shiftTotals = { delivSales: num(R.cashiers['دلفري 1'].shift['صافي المبيعات']) + num(R.cashiers['دلفري 2'].shift['صافي المبيعات']), hallSales: num(R.cashiers['صالة 1'].shift['صافي المبيعات']) + num(R.cashiers['صالة 2'].shift['صافي المبيعات']),
    delivCash: num(R.cashiers['دلفري 1'].shift['النقد المتوقع بالدرج']) + num(R.cashiers['دلفري 2'].shift['النقد المتوقع بالدرج']), hallCash: num(R.cashiers['صالة 1'].shift['النقد المتوقع بالدرج']) + num(R.cashiers['صالة 2'].shift['النقد المتوقع بالدرج']) };
  const own = (t) => by(t).filter((o) => !o.inject);   // طلبات المولّد ما تنحسب بوردية كاشير
  R.expect = { delivSales: sum(own('delivery')), hallSales: sum([...own('salon'), ...own('takeaway')]), hallCash: sum([...own('salon'), ...own('takeaway')], (o) => (o.payment && o.payment.cash) || 0) };
  R.firestore.injected = os.filter((o) => o.inject).length; R.cashierOpen = S.open;
  R.firestore.duplicateTicketsCashier = (() => { const c = os.filter((o) => !o.inject && o.ticketNo); return c.length - new Set(c.map((o) => o.ticketNo)).size; })();
  // الكباتن: «اليوم» و«الأرباح» لكل كابتن مقابل السيرفر
  R.captains = [];
  for (let i = 0; i < C.length; i++) {
    const mine = by('delivery').filter((o) => o.captainId === 'C' + (i + 1) && o.status === 'delivered');
    R.captains.push({ cap: i + 1, appToday: (await C[i].textContent('#sToday')).trim(), appEarn: (await C[i].textContent('#sEarn')).trim(), server: mine.length, serverFees: sum(mine, (o) => o.fee || 0) });
  }
  // لوحة الإدارة: طلبات ومبيعات اليوم
  const statOf = (label) => A.evaluate((l) => { const s = [...document.querySelectorAll('#dashStats .stat')].find((x) => x.textContent.includes(l)); return s && s.querySelector('.stat-v').textContent.trim(); }, label);
  R.admin = { ordersToday: await statOf('طلبات اليوم'), salesToday: await statOf('مبيعات اليوم') };
  let t = Date.now(); await A.click('.dnav-btn[data-screen="scAcc"]');
  await A.waitForFunction((v) => (document.getElementById('axBody') || {}).textContent && document.getElementById('axBody').textContent.includes(v), fmt(R.firestore.sales), { timeout: 30000 }).catch(() => {});
  R.admin.reportMs = Date.now() - t; R.admin.reportHasTotal = (await A.textContent('#axBody')).includes(fmt(R.firestore.sales));
  // البرج
  if (Tw) {
    R.tower = { hero: (await Tw.textContent('.hero-num').catch(() => '')).trim() };
    t = Date.now(); await Tw.click('[data-go="orders"]').catch(() => {}); await Tw.waitForSelector('.view[data-v="orders"]', { timeout: 20000 }).catch(() => {}); await Tw.waitForTimeout(300); R.tower.ordersPageMs = Date.now() - t;
  }
  // سرعة الشاشات بـكل الطلبات
  R.render = {};
  for (const [k, p] of [['كاشير الدلفري', D], ['كاشير الصالة', Sx]]) R.render[k] = await p.evaluate(async () => { const t = performance.now(); goTab('orders'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const ms = performance.now() - t; goTab('cashier'); return Math.round(ms); });
  // وقت الوصول (من إنشاء الطلب لحد ما يبين بالجهاز الثاني)
  const seen = async (p) => p.evaluate(() => window.__seen || {});
  const kSeen = await seen(K), lat = { kitchen: [], captain: [], cashierWeb: [] };
  os.forEach((o) => { if (kSeen[o.id] && o.createdAtMs) lat.kitchen.push(kSeen[o.id] - o.createdAtMs); });
  for (const p of C) { const s = await seen(p); os.forEach((o) => { if (s[o.id] && o.assignedAtMs) lat.captain.push(s[o.id] - o.assignedAtMs); }); }
  const sS = { ...(await seen(Sx)), ...(await seen(S2)), ...(await seen(D)), ...(await seen(D2)) };
  web.forEach((w) => { if (sS[w.id] && w.createdAtMs) lat.cashierWeb.push(sS[w.id] - w.createdAtMs); });
  R.latencyMs = { 'كاشير ← المطبخ': dist(lat.kitchen), 'كاشير ← الكابتن': dist(lat.captain), 'زبون/ويتر ← الكاشير': dist(lat.cashierWeb) };
  // ذاكرة وتعليق الصفحات (قبل ← بعد)
  R.pages = {};
  for (const [k, p] of Object.entries(devices)) { const m1 = await metrics(p); R.pages[k] = { heapMB: [m0[k] && m0[k].heapMB, m1 && m1.heapMB], dom: [m0[k] && m0[k].dom, m1 && m1.dom], longTasks: m1 && m1.lt && { n: m1.lt.n, totalMs: Math.round(m1.lt.ms), maxMs: Math.round(m1.lt.max) }, serverRequests: p.reqs, pageErrors: p.errors.filter((e) => !/favicon|Failed to load resource|vibrate|AudioContext|serviceWorker|ServiceWorker|messaging|integrity|digest|net::ERR|WebChannel/i.test(e)).slice(0, 5) }; }
  // صور نهائية لكل تطبيق وهو عليه كل الطلبات
  const SH = OUT + '_shots'; mkdirSync(SH, { recursive: true });
  for (const p of [D, D2, Sx, S2]) await p.evaluate(() => goTab('orders')); await C[0].click('.nav button[data-tab="history"]').catch(() => {});
  if (Tw) await Tw.click('[data-go="overview"]').catch(() => {});
  await sleep(1500);
  for (const [k, p] of TILES) await p.screenshot({ path: `${SH}/${k.replace(/[^A-Za-z0-9]+/g, '-')}.png` }).catch(() => {});
  // الفيديو: 16 شاشة بشبكة 4×4، 6 صور بالثانية
  try {
    const W0 = 480, H0 = 300, args = ['-y', '-loglevel', 'error'];
    TILES.forEach((_, i) => args.push('-framerate', '6', '-i', `${FR}/t${i}/%05d.jpg`));
    const f = TILES.map(([label], i) => `[${i}:v]scale=${W0}:${H0}:force_original_aspect_ratio=decrease,pad=${W0}:${H0}:(ow-iw)/2:(oh-ih)/2:color=0x0b1220,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${label.replace(/'/g, '')}':x=6:y=6:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4[v${i}]`);
    f.push(TILES.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${TILES.length}:layout=${TILES.map((_, i) => `${(i % 4) * W0}_${Math.floor(i / 4) * H0}`).join('|')}:fill=0x0b1220[out]`);
    args.push('-filter_complex', f.join(';'), '-map', '[out]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT + '_wall.mp4');
    execFileSync('ffmpeg', args, { stdio: 'inherit' });
    R.video = OUT + '_wall.mp4'; R.frames = frame;
  } catch (e) { S.err.push('video: ' + e.message); }
  writeFileSync(OUT + '.json', JSON.stringify(R, null, 1));
  log('النتيجة:', OUT + '.json');
  console.log(JSON.stringify({ firestore: R.firestore, shiftTotals: R.shiftTotals, expect: R.expect, captains: R.captains, admin: R.admin, tower: R.tower, render: R.render, latencyMs: R.latencyMs, errors: S.err.slice(0, 15) }, null, 1));
  await B.close(); if (TB) await TB.close(); srv.close(); if (towerSrv) towerSrv.close(); await E.cleanup();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
