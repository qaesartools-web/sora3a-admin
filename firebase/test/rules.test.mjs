// اختبارات قواعد Firestore — تشغيل: npm test (من مجلد firebase)
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, runTransaction, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';

let env;
const DAY = 86400000;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'sora3a-rules-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/admin1'), { role: 'admin', email: 'a@x.com' });
    await setDoc(doc(db, 'users/staff1'), { role: 'staff', email: 's@x.com' });
    await setDoc(doc(db, 'users/rest1'), { role: 'restaurant', restaurantId: 'R1' });
    await setDoc(doc(db, 'users/rest2'), { role: 'restaurant', restaurantId: 'R2' });
    await setDoc(doc(db, 'users/restExp'), { role: 'restaurant', restaurantId: 'R3' });
    await setDoc(doc(db, 'users/cap1'), { role: 'captain', restaurantId: 'R1', captainId: 'C1' });
    await setDoc(doc(db, 'users/cap2'), { role: 'captain', restaurantId: 'R1', captainId: 'C2' });
    await setDoc(doc(db, 'users/capOther'), { role: 'captain', restaurantId: 'R2', captainId: 'C9' });
    await setDoc(doc(db, 'users/capOff'), { role: 'captain', restaurantId: 'R1', captainId: 'C3', disabled: true });
    await setDoc(doc(db, 'restaurants/R1'), { name: 'R1', userId: 'rest1', active: true, expiryMs: Date.now() + 30 * DAY, subscription: 50000 });
    await setDoc(doc(db, 'restaurants/R2'), { name: 'R2', userId: 'rest2', active: true });
    await setDoc(doc(db, 'restaurants/R3'), { name: 'R3', userId: 'restExp', active: true, expiryMs: Date.now() - DAY });
    await setDoc(doc(db, 'captains/C1'), { restaurantId: 'R1', userId: 'cap1', name: 'c1', available: true });
    await setDoc(doc(db, 'captains/C2'), { restaurantId: 'R1', userId: 'cap2', name: 'c2', available: true });
    await setDoc(doc(db, 'orders/O1'), { restaurantId: 'R1', status: 'pending', value: 10000, fee: 5000, captainId: 'C1', rejectedBy: [], phone: '07', address: 'x' });
    await setDoc(doc(db, 'orders/O2'), { restaurantId: 'R2', status: 'pending', value: 10000, rejectedBy: [] });
    await setDoc(doc(db, 'orders/O3'), { restaurantId: 'R1', status: 'accepted', value: 9000, captainId: 'C2', rejectedBy: [] });
    await setDoc(doc(db, 'tracking/O1'), { status: 'pending', restaurantName: 'R1' });
    await setDoc(doc(db, 'users/cash1'), { role: 'cashier', restaurantId: 'R1', perms: { reports: false } });
    await setDoc(doc(db, 'users/cash2'), { role: 'cashier', restaurantId: 'R1', perms: { settings: true, menu: true } });
    await setDoc(doc(db, 'users/cashExp'), { role: 'cashier', restaurantId: 'R3', perms: {} });
    await setDoc(doc(db, 'lineTokens/TOKEN_R1_LINE1_xxxxxxxxxxxxxxxx'), { restaurantId: 'R1', line: '1', label: 'خط 1', active: true });
    await setDoc(doc(db, 'lineTokens/TOKEN_R1_OFF_xxxxxxxxxxxxxxxxxxx'), { restaurantId: 'R1', line: '2', active: false });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
// طلب باركود مثل المنيو: دخول مجهول (جهاز جديد كل مرة) + ختم الحد webRate بنفس الدفعة
let qrN = 0;
const qrOrder = (d, uid = 'qr' + (++qrN)) => { const db = as(uid), b = writeBatch(db); b.set(doc(collection(db, 'webOrders')), d); b.set(doc(db, 'webRate/' + uid), { at: serverTimestamp() }); return b.commit(); };

// ── تصعيد الصلاحيات ──
test('مستخدم جديد لا يستطيع منح نفسه دور مدير', async () => {
  await assertFails(setDoc(doc(as('hacker'), 'users/hacker'), { role: 'admin' }));
});
test('الكابتن لا يستطيع تغيير دوره', async () => {
  await assertFails(updateDoc(doc(as('cap1'), 'users/cap1'), { role: 'admin' }));
});
test('المطعم لا يستطيع إنشاء حساب مدير', async () => {
  await assertFails(setDoc(doc(as('rest1'), 'users/newu'), { role: 'admin', restaurantId: 'R1', captainId: 'X' }));
});
test('المطعم ينشئ حساب كابتن لمطعمه فقط', async () => {
  await assertSucceeds(setDoc(doc(as('rest1'), 'users/newc'), { role: 'captain', restaurantId: 'R1', captainId: 'CX', name: 'n', email: 'e' }));
  await assertFails(setDoc(doc(as('rest1'), 'users/newc2'), { role: 'captain', restaurantId: 'R2', captainId: 'CY' }));
});
test('المطعم لا يستطيع الكتابة فوق حساب موجود', async () => {
  await assertFails(setDoc(doc(as('rest1'), 'users/admin1'), { role: 'captain', restaurantId: 'R1', captainId: 'C' }));
});
test('المدير يدير المستخدمين', async () => {
  await assertSucceeds(setDoc(doc(as('admin1'), 'users/x'), { role: 'staff' }));
});
test('الموظف للقراءة فقط', async () => {
  await assertSucceeds(getDoc(doc(as('staff1'), 'orders/O1')));
  await assertFails(deleteDoc(doc(as('staff1'), 'orders/O1')));
  await assertFails(updateDoc(doc(as('staff1'), 'restaurants/R1'), { active: false }));
});
test('الحساب المعطّل لا يقرأ شيئاً', async () => {
  await assertFails(getDoc(doc(as('capOff'), 'orders/O1')));
});

// ── المطاعم ──
test('المطعم يقرأ طلباته فقط', async () => {
  await assertSucceeds(getDocs(query(collection(as('rest1'), 'orders'), where('restaurantId', '==', 'R1'))));
  await assertFails(getDoc(doc(as('rest1'), 'orders/O2')));
  await assertFails(getDocs(collection(as('rest1'), 'orders')));
});
test('المطعم لا يمدد اشتراكه أو يفعّل نفسه', async () => {
  await assertFails(updateDoc(doc(as('rest1'), 'restaurants/R1'), { expiryMs: Date.now() + 999 * DAY }));
  await assertFails(updateDoc(doc(as('rest1'), 'restaurants/R1'), { active: false }));
  await assertFails(updateDoc(doc(as('rest1'), 'restaurants/R1'), { userId: 'hacker' }));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'restaurants/R1'), { phone: '0770' }));
});
test('المطعم المنتهي اشتراكه لا ينشئ طلبات', async () => {
  await assertFails(setDoc(doc(as('restExp'), 'orders/N'), { restaurantId: 'R3', status: 'delivered', value: 1 }));
  await assertSucceeds(setDoc(doc(as('rest1'), 'orders/N'), { restaurantId: 'R1', status: 'delivered', value: 1 }));
});
test('المطعم لا ينشئ طلباً باسم مطعم آخر', async () => {
  await assertFails(setDoc(doc(as('rest1'), 'orders/N'), { restaurantId: 'R2', status: 'pending', value: 1 }));
});
test('المطعم لا يحذف الطلبات (الإلغاء فقط)', async () => {
  await assertFails(deleteDoc(doc(as('rest1'), 'orders/O1')));
});

// ── الكباتن ──
test('الكابتن يقرأ طلباته والطلبات المعلقة في مطعمه فقط', async () => {
  await assertSucceeds(getDocs(query(collection(as('cap1'), 'orders'), where('captainId', '==', 'C1'))));
  await assertSucceeds(getDocs(query(collection(as('cap1'), 'orders'), where('restaurantId', '==', 'R1'), where('status', '==', 'pending'))));
  await assertFails(getDocs(query(collection(as('cap1'), 'orders'), where('restaurantId', '==', 'R1'))));
  await assertFails(getDoc(doc(as('cap1'), 'orders/O3')));
  await assertFails(getDoc(doc(as('cap1'), 'orders/O2')));
});
test('الكابتن يقبل الطلب المعيّن له', async () => {
  const db = as('cap1');
  await assertSucceeds(runTransaction(db, async (tx) => {
    const r = doc(db, 'orders/O1'); await tx.get(r);
    tx.update(r, { status: 'accepted', captainId: 'C1', captainName: 'c1', acceptedAtMs: 1, timeline: [] });
  }));
});
test('الكابتن لا يقبل طلباً معيّناً لغيره', async () => {
  await assertFails(updateDoc(doc(as('cap2'), 'orders/O1'), { status: 'accepted', captainId: 'C2' }));
});
test('الكابتن لا يغيّر السعر أو الأجرة', async () => {
  await assertFails(updateDoc(doc(as('cap1'), 'orders/O1'), { status: 'accepted', captainId: 'C1', fee: 99999 }));
});
test('الكابتن لا يقبل طلباً مقبولاً مسبقاً', async () => {
  await assertFails(updateDoc(doc(as('cap1'), 'orders/O3'), { status: 'accepted', captainId: 'C1' }));
});
test('الكابتن يرفض الطلب بإضافة نفسه فقط', async () => {
  await assertSucceeds(updateDoc(doc(as('cap1'), 'orders/O1'), { rejectedBy: ['C1'], rejectNotice: { by: 'c1' } }));
});
test('الكابتن لا يضيف غيره لقائمة الرافضين', async () => {
  await assertFails(updateDoc(doc(as('cap1'), 'orders/O1'), { rejectedBy: ['C2'] }));
});
test('مراحل التوصيل بالتسلسل وللكابتن المعيّن فقط', async () => {
  await assertSucceeds(updateDoc(doc(as('cap2'), 'orders/O3'), { status: 'pickup', pickupAtMs: 1 }));
  await assertFails(updateDoc(doc(as('cap2'), 'orders/O3'), { status: 'delivered' }));
  await assertFails(updateDoc(doc(as('cap1'), 'orders/O3'), { status: 'delivering' }));
});
test('الكابتن يغيّر توفره فقط في ملفه', async () => {
  await assertSucceeds(updateDoc(doc(as('cap1'), 'captains/C1'), { available: false }));
  await assertFails(updateDoc(doc(as('cap1'), 'captains/C1'), { restaurantId: 'R2' }));
  await assertFails(updateDoc(doc(as('cap1'), 'captains/C2'), { available: false }));
});
test('الكابتن يكتب موقعه فقط', async () => {
  await assertSucceeds(setDoc(doc(as('cap1'), 'captainLocations/C1'), { captainId: 'C1', restaurantId: 'R1', lat: 1, lng: 2 }));
  await assertFails(setDoc(doc(as('cap1'), 'captainLocations/C2'), { captainId: 'C2', restaurantId: 'R1', lat: 1, lng: 2 }));
});

// ── التتبع العام ──
test('صفحة التتبع تقرأ بالمعرّف ولا تستعرض القائمة', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'tracking/O1')));
  await assertFails(getDocs(collection(anon(), 'tracking')));
});
test('الزائر لا يقرأ الطلبات أو مواقع الكباتن', async () => {
  await assertFails(getDoc(doc(anon(), 'orders/O1')));
  await assertFails(getDoc(doc(anon(), 'captainLocations/C1')));
});
test('التتبع لا يقبل هاتف أو عنوان الزبون', async () => {
  await assertFails(setDoc(doc(as('rest1'), 'tracking/O1'), { status: 'pending', phone: '07' }));
  await assertSucceeds(setDoc(doc(as('rest1'), 'tracking/O1'), { status: 'pending', restaurantName: 'R1' }));
});

// ── التوكنات ──
test('المستخدم يسجل توكن إشعاراته فقط وبدوره الحقيقي', async () => {
  await assertSucceeds(setDoc(doc(as('cap1'), 'pushTokens/cap1'), { tokens: ['t'], role: 'captain', captainId: 'C1', restaurantId: 'R1' }));
  await assertSucceeds(setDoc(doc(as('cap1'), 'pushTokens/cap1'), { tokens: ['n'], native: 'n', role: 'captain', captainId: 'C1', restaurantId: 'R1' }));
  await assertFails(setDoc(doc(as('cap1'), 'pushTokens/cap1'), { tokens: ['n'], native: 5, role: 'captain', captainId: 'C1', restaurantId: 'R1' }));
  await assertFails(setDoc(doc(as('cap1'), 'pushTokens/cap1'), { tokens: ['t'], role: 'captain', captainId: 'C2', restaurantId: 'R1' }));
  await assertFails(setDoc(doc(as('cap1'), 'pushTokens/cap2'), { tokens: ['t'], role: 'captain', captainId: 'C2', restaurantId: 'R1' }));
});

// ── المنيو المتزامن ──
test('المطعم يكتب منيو مطعمه فقط، والكابتن يقرأ فقط', async () => {
  await assertSucceeds(setDoc(doc(as('rest1'), 'restaurants/R1/menu/main'), { cats: [] }));
  await assertFails(setDoc(doc(as('rest1'), 'restaurants/R2/menu/main'), { cats: [] }));
  await assertSucceeds(getDoc(doc(as('cap1'), 'restaurants/R1/menu/main')));
  await assertFails(setDoc(doc(as('cap1'), 'restaurants/R1/menu/main'), { cats: [] }));
});


// ── الكاشير ──
test('الكاشير يقرأ وينشئ طلبات مطعمه فقط', async () => {
  await assertSucceeds(getDocs(query(collection(as('cash1'), 'orders'), where('restaurantId', '==', 'R1'))));
  await assertSucceeds(setDoc(doc(as('cash1'), 'orders/NC'), { restaurantId: 'R1', status: 'delivered', value: 5 }));
  await assertFails(setDoc(doc(as('cash1'), 'orders/NC2'), { restaurantId: 'R2', status: 'delivered', value: 5 }));
  await assertFails(getDoc(doc(as('cash1'), 'orders/O2')));
  await assertFails(deleteDoc(doc(as('cash1'), 'orders/O1')));
});
test('الكاشير لا يعدّل المطعم أو الكباتن أو الحسابات', async () => {
  await assertFails(updateDoc(doc(as('cash1'), 'restaurants/R1'), { phone: '1' }));
  await assertFails(updateDoc(doc(as('cash1'), 'captains/C1'), { name: 'x' }));
  await assertFails(setDoc(doc(as('cash1'), 'users/newc'), { role: 'captain', restaurantId: 'R1', captainId: 'C' }));
  await assertFails(updateDoc(doc(as('cash1'), 'users/cash1'), { perms: { reports: true } }));
});
test('الإعدادات حسب الصلاحية، والورديات والمنيو للبيع مسموحة', async () => {
  await assertFails(setDoc(doc(as('cash1'), 'restaurants/R1/settings/main'), { taxPct: 0 }));
  await assertSucceeds(setDoc(doc(as('cash2'), 'restaurants/R1/settings/main'), { taxPct: 0 }));
  await assertSucceeds(setDoc(doc(as('cash1'), 'restaurants/R1/shifts/s1'), { status: 'open' }));
  await assertSucceeds(setDoc(doc(as('cash1'), 'restaurants/R1/customers/0770'), { name: 'x' }));
  await assertFails(setDoc(doc(as('cash1'), 'restaurants/R1/menuImages/i1'), { data: 'x' }));
  await assertFails(setDoc(doc(as('cash1'), 'restaurants/R2/shifts/s1'), { status: 'open' }));
  // عدّاد أرقام الطلبات اليومي (رقم واحد لكل المطعم حتى مع أكثر من كاشير)
  await assertSucceeds(setDoc(doc(as('cash1'), 'restaurants/R1/counters/tickets'), { day: '2026-10-23', n: 3 }));
  await assertSucceeds(getDoc(doc(as('cash2'), 'restaurants/R1/counters/tickets')));
  await assertFails(setDoc(doc(as('cash1'), 'restaurants/R2/counters/tickets'), { day: '2026-10-23', n: 3 }));
});
test('كاشير مطعم منتهي الاشتراك ممنوع', async () => {
  await assertFails(setDoc(doc(as('cashExp'), 'orders/NX'), { restaurantId: 'R3', status: 'delivered', value: 1 }));
});
test('صاحب المطعم يدير صلاحيات كاشيريته فقط (الإضافة من المدير الأعلى)', async () => {
  await assertFails(setDoc(doc(as('rest1'), 'users/newcash'), { role: 'cashier', restaurantId: 'R1', name: 'n', email: 'e', perms: { menu: false } }));
  await assertFails(setDoc(doc(as('rest1'), 'users/newcash2'), { role: 'cashier', restaurantId: 'R2', perms: {} }));
  await assertFails(setDoc(doc(as('rest1'), 'users/newcash3'), { role: 'admin', restaurantId: 'R1', perms: {} }));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'users/cash1'), { perms: { reports: true } }));
  await assertFails(updateDoc(doc(as('rest1'), 'users/cash1'), { role: 'admin' }));
  await assertSucceeds(getDocs(query(collection(as('rest1'), 'users'), where('restaurantId', '==', 'R1'), where('role', '==', 'cashier'))));
  await assertFails(updateDoc(doc(as('rest2'), 'users/cash1'), { perms: {} }));
});

// ── دوام الكاشير ──
const nowBag = () => (Math.floor(Date.now() / 60000) + 180) % 1440;
const wrap = (n) => ((n % 1440) + 1440) % 1440;
test('الكاشير يعمل داخل دوامه فقط (مع سماح ١٥ دقيقة بعد النهاية)', async () => {
  const n = nowBag();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users/cOn'), { role: 'cashier', restaurantId: 'R1', perms: {}, hours: { from: wrap(n - 60), to: wrap(n + 60) } });
    await setDoc(doc(db, 'users/cOff'), { role: 'cashier', restaurantId: 'R1', perms: {}, hours: { from: wrap(n + 60), to: wrap(n + 120) } });
    await setDoc(doc(db, 'users/cGrace'), { role: 'cashier', restaurantId: 'R1', perms: {}, hours: { from: wrap(n - 120), to: wrap(n - 5) } });
    await setDoc(doc(db, 'users/cLate'), { role: 'cashier', restaurantId: 'R1', perms: {}, hours: { from: wrap(n - 120), to: wrap(n - 30) } });
  });
  const sh = (u) => setDoc(doc(as(u), 'restaurants/R1/shifts/s_' + u), { status: 'open' });
  await assertSucceeds(sh('cOn'));
  await assertFails(sh('cOff'));
  await assertSucceeds(sh('cGrace'));
  await assertFails(sh('cLate'));
  // يقرأ ملفه دائماً حتى يعرف متى يفتح
  await assertSucceeds(getDoc(doc(as('cOff'), 'users/cOff')));
});
test('صاحب المطعم يحدد الدوام بقيم صحيحة فقط، والكاشير لا يغيّره', async () => {
  await assertSucceeds(updateDoc(doc(as('rest1'), 'users/cash1'), { hours: { from: 540, to: 1020 } }));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'users/cash1'), { hours: { from: 1200, to: 120 } }));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'users/cash1'), { hours: null }));
  await assertFails(updateDoc(doc(as('rest1'), 'users/cash1'), { hours: { from: 540, to: 540 } }));
  await assertFails(updateDoc(doc(as('rest1'), 'users/cash1'), { hours: { from: 540, to: 2000 } }));
  await assertFails(updateDoc(doc(as('rest1'), 'users/cash1'), { hours: { from: '9', to: 1020 } }));
  await assertFails(updateDoc(doc(as('cash1'), 'users/cash1'), { hours: null }));
  // إضافة الكاشيرية وإيقافهم وحذفهم: المدير الأعلى فقط
  await assertFails(setDoc(doc(as('rest1'), 'users/newc'), { role: 'cashier', restaurantId: 'R1', name: 'n', email: 'e', perms: {}, hours: { from: 480, to: 960 } }));
  await assertSucceeds(setDoc(doc(as('admin1'), 'users/newc'), { role: 'cashier', restaurantId: 'R1', name: 'n', email: 'e', perms: {}, hours: { from: 480, to: 960 } }));
  await assertFails(updateDoc(doc(as('rest1'), 'users/newc'), { disabled: true }), 'owner cannot stop a cashier');
  await assertSucceeds(updateDoc(doc(as('rest1'), 'users/newc'), { perms: { discount: true } }), 'owner still sets permissions');
  await assertFails(deleteDoc(doc(as('rest1'), 'users/newc')), 'owner cannot delete a cashier');
  await assertSucceeds(updateDoc(doc(as('admin1'), 'users/newc'), { disabled: true }));
  await assertSucceeds(deleteDoc(doc(as('admin1'), 'users/newc')));
});

test('تمديد الدوام: الكاشير يمدد بنفسه قرب نهاية دوامه (ساعة/ساعتين/٣/لنهاية اليوم) ويشتغل خلاله', async () => {
  const n = nowBag(), H = 3600000;
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users/cEnd'), { role: 'cashier', restaurantId: 'R1', perms: {}, hours: { from: wrap(n - 240), to: wrap(n - 30) } });
    await setDoc(doc(db, 'users/cFar'), { role: 'cashier', restaurantId: 'R1', perms: {}, hours: { from: wrap(n - 400), to: wrap(n - 180) } });
    await setDoc(doc(db, 'users/cFree'), { role: 'cashier', restaurantId: 'R1', perms: {} });
  });
  const sh = (u) => setDoc(doc(as(u), 'restaurants/R1/shifts/x_' + u + Date.now()), { status: 'open' });
  const ext = (u, ms, extra = {}) => updateDoc(doc(as(u), 'users/' + u), { hoursExt: { untilMs: Date.now() + ms, atMs: Date.now(), h: '2', ...extra } });
  await assertFails(sh('cEnd'), 'after hours + grace');
  await assertFails(ext('cEnd', 21 * H), 'more than 20 hours');
  await assertFails(ext('cEnd', -60000), 'already in the past');
  await assertFails(ext('cEnd', H, { x: 1 }), 'unknown field');
  await assertFails(updateDoc(doc(as('cEnd'), 'users/cEnd'), { hoursExt: { untilMs: Date.now() + H }, hours: null }), 'cannot touch hours');
  await assertSucceeds(ext('cEnd', 2 * H));
  await assertSucceeds(sh('cEnd'));   // يشتغل خلال التمديد
  await assertSucceeds(ext('cEnd', 3 * H), 'can extend again while extended');
  await assertFails(ext('cFar', H), 'hours ended 3h ago: no self-extension');
  await assertFails(ext('cFree', H), 'no hours set: nothing to extend');
  await assertFails(ext('cash1', H), 'not his own doc');   // cash1 يمدد لنفسه بس
  await assertFails(updateDoc(doc(as('cEnd'), 'users/cFar'), { hoursExt: { untilMs: Date.now() + H } }), 'someone else');
  // صاحب المطعم يلغي التمديد (أو يمدد) من لوحة الإدارة
  await assertSucceeds(updateDoc(doc(as('rest1'), 'users/cEnd'), { hoursExt: { untilMs: 0, atMs: Date.now(), h: 'off' } }));
  await assertFails(sh('cEnd'), 'extension cancelled');
  await assertFails(ext('cEnd', H), 'owner cancelled: no self-extension again today');
  await assertFails(updateDoc(doc(as('rest1'), 'users/cEnd'), { hoursExt: { untilMs: Date.now() + 30 * H } }), 'owner: 20h max too');
});

test('الأجهزة المعتمدة: الكاشير يشتغل بس من جهاز معتمد لمطعمه وبنفس تسجيل الدخول (جهاز واحد بنفس الوقت)', async () => {
  const OK = 'KEY_OK_aaaaaaaaaaaaaaaaaaaaaa', NEW = 'KEY_NEW_bbbbbbbbbbbbbbbbbbbbb', OTHER = 'KEY_R1_cccccccccccccccccccccc';
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'restaurants/RD'), { name: 'RD', userId: 'restD', active: true, expiryMs: Date.now() + 30 * DAY, features: { devices: true } });
    await setDoc(doc(db, 'users/restD'), { role: 'restaurant', restaurantId: 'RD' });
    await setDoc(doc(db, 'users/cdA'), { role: 'cashier', restaurantId: 'RD', perms: {} });
    await setDoc(doc(db, 'users/cdB'), { role: 'cashier', restaurantId: 'RD', perms: {} });
    await setDoc(doc(db, 'restaurants/RD/devices/' + OK), { name: 'كاشير 1', approvedAtMs: 1 });
    await setDoc(doc(db, 'restaurants/R1/devices/' + OTHER), { name: 'جهاز R1', approvedAtMs: 1 });
  });
  const ctx = (uid, t) => env.authenticatedContext(uid, { auth_time: t }).firestore();
  const sess = (db, uid, device, authTime) => setDoc(doc(db, 'sessions/' + uid), { device, authTime, restaurantId: 'RD', atMs: Date.now(), name: 'Windows' });
  const order = (db, id) => setDoc(doc(db, 'orders/' + id), { restaurantId: 'RD', status: 'delivered', value: 5 });
  const A1 = ctx('cdA', 1000), A2 = ctx('cdA', 2000);
  await assertFails(order(A1, 'D0'), 'no session yet');
  await assertFails(sess(A1, 'cdA', NEW, 1000), 'device not approved');
  await assertFails(sess(A1, 'cdA', OTHER, 1000), 'approved for another restaurant only');
  await assertFails(sess(A1, 'cdA', OK, 999), 'session must be this sign-in');
  await assertSucceeds(sess(A1, 'cdA', OK, 1000));
  await assertSucceeds(order(A1, 'D1'));
  await assertSucceeds(getDocs(query(collection(A1, 'orders'), where('restaurantId', '==', 'RD'))));
  await assertFails(order(A2, 'D2'), 'same account signed in elsewhere (home laptop) is refused');
  // الكاشير ما يكدر يقرا مفاتيح الأجهزة ولا جلسته
  await assertFails(getDocs(collection(A1, 'restaurants/RD/devices')));
  await assertFails(getDoc(doc(A1, 'restaurants/RD/devices/' + OK)));
  await assertFails(getDoc(doc(A1, 'sessions/cdA')));
  await assertFails(setDoc(doc(A1, 'restaurants/RD/devices/' + NEW), { name: 'x' }), 'cashier cannot approve a device');
  // الدخول من الجهاز الثاني (المعتمد) يطلّع الأول
  await assertSucceeds(sess(A2, 'cdA', OK, 2000));
  await assertSucceeds(order(A2, 'D3'));
  await assertFails(order(A1, 'D4'), 'the older sign-in is out');
  // طلب اعتماد جهاز جديد: الكاشير يسجّله، يقراه بالمعرّف، وما يكدر يعتمده
  const B = ctx('cdB', 3000);
  const req = { restaurantId: 'RD', code: 'K7Q2M9', platform: 'Windows • برنامج الكاشير', status: 'pending', createdAtMs: Date.now(), lastAtMs: Date.now(), lastUid: 'cdB', lastName: 'علي' };
  await assertSucceeds(setDoc(doc(B, 'deviceReqs/' + NEW), req));
  await assertSucceeds(getDoc(doc(B, 'deviceReqs/' + NEW)));
  await assertFails(getDocs(collection(B, 'deviceReqs')), 'no listing');
  await assertFails(updateDoc(doc(B, 'deviceReqs/' + NEW), { status: 'approved' }));
  await assertFails(setDoc(doc(B, 'deviceReqs/SHORT'), req), 'key too short');
  await assertFails(setDoc(doc(B, 'deviceReqs/' + 'X'.repeat(24)), { ...req, restaurantId: 'R1' }), 'only for his own restaurant');
  // شاشات المطعم بإيميل المطعم (المطبخ/الويتر): تسجّل طلب اعتماد لمطعمها بس، وتشوف إذا انعتمدت
  const SCR = 'S'.repeat(26), sreq = { ...req, platform: 'Android • شاشة المطبخ', lastUid: 'restD' };
  await assertSucceeds(setDoc(doc(as('restD'), 'deviceReqs/' + SCR), sreq));
  await assertSucceeds(updateDoc(doc(as('restD'), 'deviceReqs/' + SCR), { lastAtMs: Date.now(), lastUid: 'restD', lastName: 'المطعم', platform: 'Android • شاشة المجهز' }));
  await assertFails(updateDoc(doc(as('restD'), 'deviceReqs/' + SCR), { status: 'approved' }), 'owner cannot approve his screen');
  await assertFails(setDoc(doc(as('restD'), 'deviceReqs/' + 'T'.repeat(26)), { ...sreq, restaurantId: 'R1' }), 'screen only for his own restaurant');
  await assertSucceeds(getDoc(doc(as('restD'), 'restaurants/RD/devices/' + SCR)));
  // صاحب المطعم يشوف الأجهزة والجلسات، بس الاعتماد للمدير الأعلى
  await assertSucceeds(getDocs(collection(as('restD'), 'restaurants/RD/devices')));
  await assertSucceeds(getDoc(doc(as('restD'), 'sessions/cdA')));
  await assertFails(setDoc(doc(as('restD'), 'restaurants/RD/devices/' + NEW), { name: 'x' }), 'owner cannot approve');
  await assertSucceeds(getDocs(collection(as('admin1'), 'deviceReqs')));
  await assertSucceeds(setDoc(doc(as('admin1'), 'restaurants/RD/devices/' + NEW), { name: 'كاشير 2', approvedAtMs: Date.now() }));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'deviceReqs/' + NEW), { status: 'approved' }));
  await assertSucceeds(sess(B, 'cdB', NEW, 3000));
  await assertSucceeds(order(B, 'D5'));
  // المدير الأعلى يلغي الجهاز ← يطلع فوراً
  await assertSucceeds(deleteDoc(doc(as('admin1'), 'restaurants/RD/devices/' + NEW)));
  await assertFails(order(B, 'D6'), 'device revoked');
  // مطعم الخدمة مطفية عنده: الكاشير يشتغل عادي (والجلسة تتسجل بأي جهاز)
  await assertSucceeds(setDoc(doc(env.authenticatedContext('cash1', { auth_time: 5 }).firestore(), 'sessions/cash1'), { device: NEW, authTime: 5, restaurantId: 'R1', atMs: 1 }));
  await assertSucceeds(setDoc(doc(as('cash1'), 'orders/D7'), { restaurantId: 'R1', status: 'delivered', value: 5 }));
});

// ── خدمات المطعم (المدير الأعلى فقط) ──
test('المدير فقط يفتح ويغلق خدمات المطعم', async () => {
  await assertFails(updateDoc(doc(as('rest1'), 'restaurants/R1'), { features: { captain: true, pager: true } }));
  await assertFails(updateDoc(doc(as('staff1'), 'restaurants/R1'), { 'features.pager': false }));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'restaurants/R1'), { 'features.pager': false }));
});
test('إيقاف خدمة الكابتن: لا دلفري ولا دخول للكابتن، والصالة تعمل', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'restaurants/R1'), { features: { captain: false } }); });
  await assertFails(setDoc(doc(as('rest1'), 'orders/ND'), { restaurantId: 'R1', orderType: 'delivery', status: 'pending', value: 1000 }));
  await assertFails(setDoc(doc(as('cash1'), 'orders/ND2'), { restaurantId: 'R1', status: 'pending', value: 1000 }));
  await assertSucceeds(setDoc(doc(as('cash1'), 'orders/NS'), { restaurantId: 'R1', orderType: 'salon', status: 'delivered', value: 1000 }));
  await assertFails(getDoc(doc(as('cap1'), 'orders/O1')));
  await assertSucceeds(getDoc(doc(as('cap1'), 'restaurants/R1')));   // حتى يعرف أن الخدمة متوقفة
});
test('إيقاف خدمة الاتصال أو الواتساب يرفض مكالمات ذلك النوع فقط', async () => {
  const c = (line) => ({ token: 'TOKEN_R1_LINE1_xxxxxxxxxxxxxxxx', restaurantId: 'R1', line, number: '07701234567', status: 'ringing' });
  await env.withSecurityRulesDisabled(async (x) => { await updateDoc(doc(x.firestore(), 'restaurants/R1'), { features: { whatsapp: false } }); });
  await assertFails(setDoc(doc(anon(), 'incomingCalls/w1'), c('1 واتساب')));
  await assertSucceeds(setDoc(doc(anon(), 'incomingCalls/s1'), c('1')));
  await env.withSecurityRulesDisabled(async (x) => { await updateDoc(doc(x.firestore(), 'restaurants/R1'), { features: { calls: false } }); });
  await assertSucceeds(setDoc(doc(anon(), 'incomingCalls/w2'), c('1 واتساب')));
  await assertFails(setDoc(doc(anon(), 'incomingCalls/s2'), c('1')));
});

// ── المصروفات والحسابات ──
const ex = (o) => ({ cat: 'إيجار', amount: 5000, note: 'شهر 10', ts: 1700000000000, by: 'علي', createdAtMs: 1, ...o });
test('الكاشير يضيف مصروفاً ولا يعدّله ولا يحذفه؛ صاحب المطعم يعدّل ويحذف', async () => {
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/expenses/e1'), ex({})));
  await assertFails(updateDoc(doc(as('cash1'), 'accounting/R1/expenses/e1'), { amount: 1 }));
  await assertFails(deleteDoc(doc(as('cash1'), 'accounting/R1/expenses/e1')));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/expenses/e2'), ex({ amount: -5 })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/expenses/e3'), ex({ hack: 1 })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R2/expenses/e4'), ex({})));
  await assertSucceeds(getDocs(collection(as('cash1'), 'accounting/R1/expenses')));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'accounting/R1/expenses/e1'), { amount: 6000, editedBy: 'المالك', editedAtMs: 2 }));
  await assertSucceeds(deleteDoc(doc(as('rest1'), 'accounting/R1/expenses/e1')));
  await assertFails(getDocs(collection(as('rest2'), 'accounting/R1/expenses')));
  await assertSucceeds(getDocs(collection(as('staff1'), 'accounting/R1/expenses')));
});
// ── الموردين ودفتر الموردين والزبائن ──
const sup = (o) => ({ name: 'مورد اللحوم', phone: '07701234567', by: 'علي', byUid: 'cash1', createdAtMs: 1, ...o });
const led = (o) => ({ kind: 'cust', type: 'charge', party: 'c07701234567', partyName: 'أبو أحمد', phone: '07701234567', amount: 12000, orderId: 'O1', ts: 1700000000000, by: 'علي', byUid: 'cash1', createdAtMs: 1, ...o });
test('الموردين: الكاشير يضيف مورد باسمه؛ التعديل والحذف للمطعم بس', async () => {
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/suppliers/s1'), sup({})));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/suppliers/s2'), sup({ byUid: 'rest1' })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/suppliers/s3'), sup({ name: '' })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/suppliers/s4'), sup({ debt: 5 })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R2/suppliers/s5'), sup({})));
  await assertFails(updateDoc(doc(as('cash1'), 'accounting/R1/suppliers/s1'), { name: 'غيره' }));
  await assertFails(deleteDoc(doc(as('cash1'), 'accounting/R1/suppliers/s1')));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'accounting/R1/suppliers/s1'), { name: 'مورد اللحوم الطازجة', editedBy: 'المالك', editedAtMs: 2 }));
  await assertSucceeds(deleteDoc(doc(as('rest1'), 'accounting/R1/suppliers/s1')));
  await assertFails(getDocs(collection(as('rest2'), 'accounting/R1/suppliers')));
});
test('دفتر الزبائن والموردين: الكاشير يسجّل بس (باسمه وبأنواع معروفة)؛ التعديل والحذف للمطعم', async () => {
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/ledger/ch_O1'), led({})));
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/ledger/c1'), led({ type: 'collect', amount: 5000, method: 'drawer', shiftId: 'S1' })));
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/ledger/i1'), led({ kind: 'sup', type: 'invoice', party: 's1', partyName: 'مورد اللحوم', amount: 50000, paid: 20000, ref: 'mv:v1' })));
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/ledger/p1'), led({ kind: 'sup', type: 'pay', party: 's1', partyName: 'مورد اللحوم', amount: 30000, method: 'bank' })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x1'), led({ type: 'pay' })), 'cust has no pay');
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x2'), led({ kind: 'sup', type: 'charge' })), 'sup has no charge');
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x3'), led({ amount: 0 })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x4'), led({ kind: 'sup', type: 'invoice', amount: 1000, paid: 2000 })), 'paid > amount');
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x5'), led({ byUid: 'rest1' })), 'not in another name');
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x6'), led({ method: 'gold' })));
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1/ledger/g1'), led({ kind: 'sup', type: 'invoice', party: 's1', partyName: 'مورد الغاز', amount: 5000, paid: 0, cat: 'غاز / وقود' })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x9'), led({ cat: 'x'.repeat(41) })), 'category too long');
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1/ledger/x7'), led({ editedBy: 'x' })));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R2/ledger/x8'), led({})));
  await assertFails(updateDoc(doc(as('cash1'), 'accounting/R1/ledger/ch_O1'), { amount: 1 }));
  await assertFails(deleteDoc(doc(as('cash1'), 'accounting/R1/ledger/ch_O1')));
  await assertSucceeds(getDocs(collection(as('cash1'), 'accounting/R1/ledger')));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'accounting/R1/ledger/ch_O1'), { amount: 10000, editedBy: 'المالك', editedAtMs: 2 }));
  await assertFails(updateDoc(doc(as('rest1'), 'accounting/R1/ledger/ch_O1'), { kind: 'sup' }));
  await assertSucceeds(deleteDoc(doc(as('rest1'), 'accounting/R1/ledger/c1')));
  await assertFails(getDocs(collection(as('rest2'), 'accounting/R1/ledger')));
  await assertSucceeds(getDocs(collection(as('staff1'), 'accounting/R1/ledger')));
});
test('الكاشير لا يمسح مواد المخزون ولا يغيّر الوصفات أو المصروفات القديمة', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'accounting/R1'), { materials: [{ id: 'm1', qty: 5 }], recipes: { 'a|b': [{ mid: 'm1', q: 1 }] }, costs: {}, moves: [], expenses: [{ id: 'old', amount: 1 }] }); });
  const base = { recipes: { 'a|b': [{ mid: 'm1', q: 1 }] }, costs: {}, moves: [{ id: 'v1' }], expenses: [{ id: 'old', amount: 1 }] };
  await assertSucceeds(setDoc(doc(as('cash1'), 'accounting/R1'), { ...base, materials: [{ id: 'm1', qty: 4 }] }));        // بيع يخصم المخزون
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1'), { ...base, materials: [] }));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1'), { ...base, materials: [{ id: 'm1', qty: 4 }], expenses: [] }));
  await assertFails(setDoc(doc(as('cash1'), 'accounting/R1'), { ...base, materials: [{ id: 'm1', qty: 4 }], recipes: {} }));
  await assertSucceeds(setDoc(doc(as('rest1'), 'accounting/R1'), { ...base, materials: [], expenses: [] }));
});

// ── خطوط الاتصال والمكالمات ──
const call = (o) => ({ token: 'TOKEN_R1_LINE1_xxxxxxxxxxxxxxxx', restaurantId: 'R1', line: '1', number: '07701234567', status: 'ringing', ...o });
test('جهاز الخط يرسل المكالمة بالتوكن بدون تسجيل دخول', async () => {
  await assertSucceeds(setDoc(doc(anon(), 'incomingCalls/c1'), call({})));
});
test('توكن خاطئ أو موقوف أو لمطعم آخر مرفوض', async () => {
  await assertFails(setDoc(doc(anon(), 'incomingCalls/c2'), call({ token: 'WRONG_TOKEN_xxxxxxxxxxxxxxxxxxx' })));
  await assertFails(setDoc(doc(anon(), 'incomingCalls/c3'), call({ token: 'TOKEN_R1_OFF_xxxxxxxxxxxxxxxxxxx' })));
  await assertFails(setDoc(doc(anon(), 'incomingCalls/c4'), call({ restaurantId: 'R2' })));
  await assertFails(setDoc(doc(anon(), 'incomingCalls/c5'), call({ extra: 'x' })));
});
test('الزائر لا يقرأ المكالمات ولا التوكنات', async () => {
  await assertFails(getDoc(doc(anon(), 'lineTokens/TOKEN_R1_LINE1_xxxxxxxxxxxxxxxx')));
  await assertFails(getDocs(collection(anon(), 'incomingCalls')));
});
test('كاشير المطعم يرى ويستلم المكالمة، ومطعم آخر لا', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'incomingCalls/k1'), call({})); });
  await assertSucceeds(getDocs(query(collection(as('cash1'), 'incomingCalls'), where('restaurantId', '==', 'R1'), where('status', '==', 'ringing'))));
  await assertSucceeds(updateDoc(doc(as('cash1'), 'incomingCalls/k1'), { status: 'taken', takenBy: 'd', takenAtMs: 1 }));
  await assertFails(updateDoc(doc(as('cash1'), 'incomingCalls/k1'), { number: '1' }));
  await assertFails(getDoc(doc(as('rest2'), 'incomingCalls/k1')));
});
test('صاحب المطعم فقط يدير التوكنات', async () => {
  const t = 'NEW_TOKEN_' + 'x'.repeat(24);
  await assertSucceeds(setDoc(doc(as('rest1'), 'lineTokens/' + t), { restaurantId: 'R1', line: '3', label: 'خط 3', active: true }));
  await assertFails(setDoc(doc(as('rest1'), 'lineTokens/SHORT'), { restaurantId: 'R1', line: '3', active: true }));
  await assertFails(setDoc(doc(as('rest2'), 'lineTokens/' + t + 'y'), { restaurantId: 'R1', line: '3', active: true }));
  await assertFails(getDoc(doc(as('cash1'), 'lineTokens/' + t)));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'lineTokens/' + t), { active: false }));
});

test('leads: any visitor can send a valid trial request, only super admin reads/manages it', async () => {
  const lead = { owner: 'أحمد', restaurant: 'مطعم الذوق', phone: '07701234567', city: 'بغداد', email: 'a@b.com', kind: 'مطعم', services: ['pos', 'captain'], cashiers: 2, captains: 3, sections: 4, lines: 2, notes: 'x', wantsTrial: true, status: 'new', source: 'site', createdAt: serverTimestamp() };
  await assertSucceeds(addDoc(collection(anon(), 'leads'), lead));
  await assertSucceeds(addDoc(collection(anon(), 'leads'), { owner: 'علي', restaurant: 'كافيه', phone: '+964 770 123', status: 'new', createdAt: serverTimestamp() }));
  // حقول ممنوعة أو قيم خاطئة
  await assertFails(addDoc(collection(anon(), 'leads'), { ...lead, status: 'trial' }));
  await assertFails(addDoc(collection(anon(), 'leads'), { ...lead, restaurantId: 'R1' }));
  await assertFails(addDoc(collection(anon(), 'leads'), { ...lead, phone: '<script>' }));
  await assertFails(addDoc(collection(anon(), 'leads'), { ...lead, sections: 99 }));
  await assertFails(addDoc(collection(anon(), 'leads'), { ...lead, notes: 'x'.repeat(1001) }));
  await assertFails(addDoc(collection(anon(), 'leads'), { ...lead, createdAt: new Date(0) }));
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'leads/L1'), { ...lead, createdAt: new Date() }); });
  await assertFails(getDoc(doc(anon(), 'leads/L1')));
  await assertFails(getDoc(doc(as('rest1'), 'leads/L1')));
  await assertFails(getDocs(collection(as('staff1'), 'leads')));
  await assertSucceeds(getDocs(collection(as('admin1'), 'leads')));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'leads/L1'), { status: 'trial', restaurantId: 'R9' }));
  await assertFails(updateDoc(doc(as('rest1'), 'leads/L1'), { status: 'won' }));
  await assertSucceeds(setDoc(doc(as('admin1'), 'restaurants/R9'), { name: 'تجربة', userId: 'u9', active: true, expiryMs: Date.now() + 2 * DAY, trial: true, leadId: 'L1' }));
});

test('loyalty settings: owner/admin write, cashier only reads', async () => {
  await assertSucceeds(setDoc(doc(as('rest1'), 'restaurants/R1/loyalty/main'), { on: true, every: 5, type: 'pct', value: 40, cap: 0 }));
  await assertSucceeds(setDoc(doc(as('admin1'), 'restaurants/R1/loyalty/main'), { on: false, every: 5, type: 'pct', value: 40, cap: 0 }));
  await assertSucceeds(getDoc(doc(as('cash1'), 'restaurants/R1/loyalty/main')));
  await assertFails(setDoc(doc(as('cash1'), 'restaurants/R1/loyalty/main'), { on: true, every: 2, type: 'pct', value: 100 }));
  await assertFails(setDoc(doc(as('rest2'), 'restaurants/R1/loyalty/main'), { on: true, every: 2, type: 'pct', value: 100 }));
});

test('config: any active account reads, only super admin writes', async () => {
  await assertSucceeds(setDoc(doc(as('admin1'), 'config/push'), { url: 'https://x.netlify.app/api/notify' }));
  await assertSucceeds(getDoc(doc(as('cash1'), 'config/push')));
  await assertSucceeds(getDoc(doc(as('rest1'), 'config/push')));
  await assertFails(getDoc(doc(anon(), 'config/push')));
  await assertFails(setDoc(doc(as('rest1'), 'config/push'), { url: 'https://evil' }));
  await assertFails(setDoc(doc(as('cash1'), 'config/push'), { url: 'https://evil' }));
});

// ── المنيو الأونلاين وطلبات QR والويتر ──
const PM = { name: 'R1', on: true, modes: { table: true, pickup: true, delivery: true }, fee: 1000, tables: 10, cats: [{ cat: 'برغر', items: [{ name: 'زنكر', variants: [{ name: 'وحدة', price: 5000 }] }] }], updatedAtMs: 1 };
const WEB = (o = {}) => ({ restaurantId: 'R1', source: 'qr', mode: 'pickup', items: [{ name: 'زنكر', variant: 'وحدة', qty: 2 }], customer: 'علي', phone: '07701234567', status: 'new', total: 10000, createdAtMs: Date.now(), day: '2026-10-08', ...o });
async function seedPM(pm = PM, rid = 'R1') { await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'publicMenus/' + rid), pm)); }

test('publicMenus: أي زائر يقرأ بالمعرّف، والمطعم وكاشيره يكتبون، وغيرهم لا', async () => {
  await assertSucceeds(setDoc(doc(as('rest1'), 'publicMenus/R1'), PM));
  await assertSucceeds(getDoc(doc(anon(), 'publicMenus/R1')));
  await assertFails(getDocs(collection(anon(), 'publicMenus')));
  await assertSucceeds(setDoc(doc(as('cash1'), 'publicMenus/R1'), { ...PM, updatedAtMs: 2 }));
  await assertFails(setDoc(doc(as('rest2'), 'publicMenus/R1'), PM));
  await assertFails(setDoc(doc(anon(), 'publicMenus/R1'), PM));
  await assertFails(setDoc(doc(as('rest1'), 'publicMenus/R1'), { ...PM, subscription: 1 }), 'no private fields');
  // ساعات الدوام تنشر ويا المنيو (الزبون يشوف «مسكّر هسه»)
  await assertSucceeds(setDoc(doc(as('cash1'), 'publicMenus/R1'), { ...PM, hours: { on: true, open: 600, close: 120 } }));
  await assertFails(setDoc(doc(as('cash1'), 'publicMenus/R1'), { ...PM, hours: { on: true, open: 600, close: 1500 } }), 'minutes < 1440');
  await assertFails(setDoc(doc(as('cash1'), 'publicMenus/R1'), { ...PM, hours: { on: true, open: '10:00', close: 120 } }), 'minutes are numbers');
  await assertFails(setDoc(doc(as('cash1'), 'publicMenus/R1'), { ...PM, hours: { on: true, open: 600, close: 120, x: 1 } }));
  await assertSucceeds(setDoc(doc(as('rest1'), 'publicMenus/R1/img/i1'), { data: 'data:image/png;base64,AAAA', updatedAtMs: 1 }));
  await assertSucceeds(getDoc(doc(anon(), 'publicMenus/R1/img/i1')));
  await assertFails(setDoc(doc(anon(), 'publicMenus/R1/img/i2'), { data: 'x' }));
});

test('webOrders: الزبون يطلب بدون تسجيل دخول إذا المنيو مفعّل ونوع الطلب مسموح', async () => {
  await seedPM();
  await assertSucceeds(qrOrder(WEB()));
  await assertSucceeds(qrOrder(WEB({ mode: 'table', table: '5', phone: '' })));
  await assertSucceeds(qrOrder(WEB({ mode: 'delivery', address: 'المنصور شارع 14' })));
  await assertFails(qrOrder(WEB({ status: 'accepted' })), 'must start new');
  await assertFails(qrOrder(WEB({ phone: '12' })), 'pickup needs a phone');
  await assertFails(qrOrder(WEB({ mode: 'table', table: '' })), 'table needs a number');
  await assertFails(qrOrder(WEB({ mode: 'delivery', address: '' })), 'delivery needs an address');
  await assertFails(qrOrder(WEB({ items: [] })));
  await assertFails(qrOrder(WEB({ source: 'waiter' })), 'waiter needs a staff login');
  await assertFails(qrOrder(WEB({ price: 1 })), 'no extra fields');
  await assertFails(qrOrder(WEB({ restaurantId: 'R2' })), 'no public menu');
  await seedPM({ ...PM, modes: { table: true, pickup: false, delivery: false } });
  await assertFails(qrOrder(WEB()), 'pickup turned off');
  await seedPM({ ...PM, on: false });
  await assertFails(qrOrder(WEB({ mode: 'table', table: '1' })), 'menu off');
  await seedPM();
  await assertFails(qrOrder(WEB({ day: 'x'.repeat(11) })), 'day too long');
  await assertFails(qrOrder(WEB({ extra: 1 })), 'unknown field');
});

test('webOrders: خدمة «online» أو «captain» مطفية، أو المطعم منتهي ← مرفوض', async () => {
  await seedPM();
  await seedPM(PM, 'R3');
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'restaurants/R1'), { features: { captain: false } }));
  await assertFails(qrOrder(WEB({ mode: 'delivery', address: 'المنصور' })));
  await assertSucceeds(qrOrder(WEB()));
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'restaurants/R1'), { features: { online: false } }));
  await assertFails(qrOrder(WEB()));
  await assertFails(qrOrder(WEB({ restaurantId: 'R3' })), 'expired restaurant');
  // كل خدمة لوحدها: الباركود مطفي والويتر شغّال ← الويتر يطلب عادي؛ الويتر مطفي ← مرفوض
  const W = (id) => setDoc(doc(as('cash1'), 'webOrders/' + id), WEB({ source: 'waiter', mode: 'table', table: '2', phone: '', waiterUid: 'cash1' }));
  await assertSucceeds(W('SV1'));
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'restaurants/R1'), { features: { online: true, waiter: false } }));
  await assertFails(W('SV2'), 'waiter service off');
  await assertSucceeds(qrOrder(WEB()));
});

test('webOrders: الويتر (موظف) يطلب لطاولة باسمه، والزبون يتابع بالمعرّف بس', async () => {
  await seedPM({ ...PM, on: false });
  await assertSucceeds(setDoc(doc(as('cash1'), 'webOrders/W1'), WEB({ source: 'waiter', mode: 'table', table: '3', phone: '', waiter: 'علي', waiterUid: 'cash1' })));
  await assertFails(setDoc(doc(as('cash1'), 'webOrders/W2'), WEB({ source: 'waiter', mode: 'table', table: '3', phone: '', waiterUid: 'someone' })));
  await assertFails(setDoc(doc(as('cash1'), 'webOrders/W3'), WEB({ source: 'waiter', mode: 'pickup', waiterUid: 'cash1' })));
  await assertFails(setDoc(doc(as('rest2'), 'webOrders/W4'), WEB({ source: 'waiter', mode: 'table', table: '3', phone: '', waiterUid: 'rest2' })));
  await assertSucceeds(getDoc(doc(anon(), 'webOrders/W1')));
  await assertFails(getDocs(collection(anon(), 'webOrders')));
  await assertSucceeds(getDocs(query(collection(as('cash1'), 'webOrders'), where('restaurantId', '==', 'R1'))));
  await assertFails(getDocs(query(collection(as('rest2'), 'webOrders'), where('restaurantId', '==', 'R1'))));
});

test('webOrders: الكاشير يستلم مرة وحدة، بعدها تتحدث المرحلة بس؛ والزبون ما يغيّر شي', async () => {
  await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'webOrders/W1'), WEB()));
  await assertFails(updateDoc(doc(anon(), 'webOrders/W1'), { status: 'accepted' }));
  await assertFails(updateDoc(doc(as('rest2'), 'webOrders/W1'), { status: 'accepted' }));
  await assertFails(updateDoc(doc(as('cash1'), 'webOrders/W1'), { status: 'accepted', total: 1 }), 'cannot change the order');
  await assertSucceeds(updateDoc(doc(as('cash1'), 'webOrders/W1'), { status: 'accepted', acceptedBy: 'dev1', acceptedAtMs: 1 }));
  await assertFails(updateDoc(doc(as('cash2'), 'webOrders/W1'), { acceptedBy: 'dev2' }), 'second device cannot re-claim');
  await assertFails(updateDoc(doc(as('cash2'), 'webOrders/W1'), { status: 'rejected' }));
  await assertSucceeds(updateDoc(doc(as('cash2'), 'webOrders/W1'), { orderId: 'O9', stage: 'ready', stageAtMs: 2, ticket: '12' }));
  await assertFails(deleteDoc(doc(as('cash1'), 'webOrders/W1')));
  await assertSucceeds(deleteDoc(doc(as('rest1'), 'webOrders/W1')));
  // الرفض مع السبب (مرة وحدة، ومن الجديد بس)
  await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'webOrders/W2'), WEB()));
  await assertFails(updateDoc(doc(as('rest2'), 'webOrders/W2'), { status: 'rejected', reason: 'x' }));
  await assertSucceeds(updateDoc(doc(as('rest1'), 'webOrders/W2'), { status: 'rejected', reason: 'الشاورما خلصت' }));
  await assertFails(updateDoc(doc(as('cash1'), 'webOrders/W2'), { status: 'accepted' }), 'rejected stays rejected');
});

// ── الفروع ──
async function seedBranches() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    // صاحب R1 يملك فرعين: R2 (نشط) و R3 (منتهي)
    await setDoc(doc(db, 'users/multi'), { role: 'restaurant', restaurantId: 'R1', branches: ['R2', 'R3'] });
    await setDoc(doc(db, 'restaurants/R1/menu/main'), { cats: [] });
    await setDoc(doc(db, 'restaurants/R2/menu/main'), { cats: [] });
    await setDoc(doc(db, 'restaurants/R4'), { name: 'R4', userId: 'x', active: true });
    await setDoc(doc(db, 'orders/O4'), { restaurantId: 'R4', status: 'pending', value: 1 });
  });
}
test('الفروع: صاحب المطعم يدير كل فروعه النشطة (طلبات، منيو، كاشيرية، كباتن، خطوط)', async () => {
  await seedBranches();
  const m = as('multi');
  await assertSucceeds(getDoc(doc(m, 'restaurants/R2')));
  await assertSucceeds(getDoc(doc(m, 'restaurants/R3')), 'can see an expired branch (to show its status)');
  await assertSucceeds(getDocs(query(collection(m, 'orders'), where('restaurantId', '==', 'R2'))));
  await assertSucceeds(getDoc(doc(m, 'orders/O2')));
  await assertSucceeds(updateDoc(doc(m, 'orders/O2'), { status: 'cancelled' }));
  await assertFails(updateDoc(doc(m, 'orders/O2'), { restaurantId: 'R4' }), 'cannot move an order to another restaurant');
  await assertSucceeds(setDoc(doc(m, 'orders/N2'), { restaurantId: 'R2', value: 5000, orderType: 'salon' }));
  await assertSucceeds(setDoc(doc(m, 'restaurants/R2/menu/main'), { cats: [{ cat: 'x' }] }));
  await assertSucceeds(updateDoc(doc(m, 'restaurants/R2'), { name: 'فرع زيونة' }));
  await assertFails(updateDoc(doc(m, 'restaurants/R2'), { expiryMs: Date.now() + 400 * DAY }), 'subscription stays with super admin');
  await assertFails(setDoc(doc(m, 'users/newCash'), { email: 'c@x.com', role: 'cashier', name: 'ك', restaurantId: 'R2', perms: {} }), 'cashiers are added by the super admin only');
  await assertSucceeds(getDocs(query(collection(m, 'users'), where('restaurantId', '==', 'R2'), where('role', '==', 'cashier'))));
  await assertSucceeds(setDoc(doc(m, 'captains/CB'), { restaurantId: 'R2', name: 'كابتن الفرع' }));
  await assertSucceeds(setDoc(doc(m, 'users/newCap'), { email: 'k@x.com', role: 'captain', name: 'ك', restaurantId: 'R2', captainId: 'CB' }));
  await assertSucceeds(setDoc(doc(m, 'lineTokens/TOKEN_R2_LINE1_xxxxxxxxxxxxxxxx'), { restaurantId: 'R2', line: '1', label: '', active: true }));
  await assertSucceeds(setDoc(doc(m, 'pushTokens/multi'), { tokens: ['t'], role: 'restaurant', captainId: '', restaurantId: 'R2', updatedAtMs: 1 }));
  // ولا يزال يدير مطعمه الأساسي
  await assertSucceeds(setDoc(doc(m, 'restaurants/R1/menu/main'), { cats: [] }));
});
test('الفروع: الفرع المنتهي مقفول، ومطعم مو من فروعه ممنوع، وما يگدر يضيف فروع لنفسه', async () => {
  await seedBranches();
  const m = as('multi');
  await assertFails(setDoc(doc(m, 'orders/N3'), { restaurantId: 'R3', value: 1, orderType: 'salon' }), 'expired branch');
  await assertFails(setDoc(doc(m, 'restaurants/R3/menu/main'), { cats: [] }), 'expired branch');
  await assertFails(getDoc(doc(m, 'restaurants/R4')));
  await assertFails(getDoc(doc(m, 'orders/O4')));
  await assertFails(getDocs(query(collection(m, 'orders'), where('restaurantId', '==', 'R4'))));
  await assertFails(setDoc(doc(m, 'orders/N4'), { restaurantId: 'R4', value: 1, orderType: 'salon' }));
  await assertFails(setDoc(doc(m, 'users/c4'), { email: 'c@x.com', role: 'cashier', name: 'ك', restaurantId: 'R4', perms: {} }));
  await assertFails(updateDoc(doc(m, 'users/multi'), { branches: ['R2', 'R3', 'R4'] }), 'only super admin links branches');
  await assertFails(updateDoc(doc(m, 'users/multi'), { restaurantId: 'R4' }));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'users/multi'), { branches: ['R2', 'R3', 'R4'] }));
  await assertSucceeds(getDoc(doc(m, 'orders/O4')), 'after super admin links it');
  // صاحب الفرع الأصلي (rest2) يبقى يدير فرعه، وكاشير الفرع الأساسي ما يدخل للفروع
  await assertSucceeds(getDocs(query(collection(as('rest2'), 'orders'), where('restaurantId', '==', 'R2'))));
  await assertFails(getDocs(query(collection(as('cash1'), 'orders'), where('restaurantId', '==', 'R2'))));
});

// ══ برنامج المالك: أجهزة معتمدة + جلسة لكل جهاز + صلاحيات الفريق لكل قسم ══
const AT = 1700000000;   // auth_time (وقت تسجيل الدخول) بالتوكن
const hqAs = (uid, at = AT) => env.authenticatedContext(uid, { auth_time: at }).firestore();
const K_OWN = 'OWNERKEY_aaaaaaaaaaaaaaaaaaaaaaaa', K_HQ1 = 'HQ1KEY_bbbbbbbbbbbbbbbbbbbbbbbbbb', K_NEW = 'NEWKEY_cccccccccccccccccccccccccc';
async function seedHq({ ownerDev = true, ownerSess = true, hq1Dev = true, hq1Sess = true } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/hq1'), { role: 'hq', email: 'h1@x.com', name: 'سجاد' });
    await setDoc(doc(db, 'hqTeam/hq1'), { name: 'سجاد', perms: { overview: 'view', rests: 'view', money: 'edit', trials: 'hide' } });
    await setDoc(doc(db, 'users/hq2'), { role: 'hq', email: 'h2@x.com', name: 'زينب' });
    await setDoc(doc(db, 'hqTeam/hq2'), { name: 'زينب', perms: { rests: 'edit', trials: 'edit', devices: 'edit' } });
    await setDoc(doc(db, 'leads/L1'), { owner: 'x', restaurant: 'y', phone: '0770', status: 'new' });
    if (ownerDev) { await setDoc(doc(db, 'hqDevices/' + K_OWN), { uid: 'admin1', name: 'لابتوب' }); await setDoc(doc(db, 'hqMeta/boot'), { uid: 'admin1', key: K_OWN, atMs: 1 }); }
    if (ownerSess) await setDoc(doc(db, `hqSessions/admin1/t/${AT}`), { key: K_OWN, atMs: 1 });
    if (hq1Dev) { await setDoc(doc(db, 'hqDevices/' + K_HQ1), { uid: 'hq1' }); await setDoc(doc(db, 'hqDevices/HQ2KEY_dddddddddddddddddddddddddd'), { uid: 'hq2' }); }
    if (hq1Sess) { await setDoc(doc(db, `hqSessions/hq1/t/${AT}`), { key: K_HQ1, atMs: 1 }); await setDoc(doc(db, `hqSessions/hq2/t/${AT}`), { key: 'HQ2KEY_dddddddddddddddddddddddddd', atMs: 1 }); }
  });
}

test('برنامج المالك: أول جهاز للمالك يعتمد نفسه مرة وحدة بس', async () => {
  await seedHq({ ownerDev: false, ownerSess: false, hq1Dev: false, hq1Sess: false });
  const a = hqAs('admin1');
  const boot = (key) => { const b = writeBatch(a); b.set(doc(a, 'hqDevices/' + key), { uid: 'admin1', name: 'لابتوب', platform: 'windows', code: 'ABC123', approvedAtMs: 1, by: 'boot' }); b.set(doc(a, 'hqMeta/boot'), { uid: 'admin1', key, atMs: 1 }); return b.commit(); };
  await assertFails(setDoc(doc(a, 'hqDevices/' + K_OWN), { uid: 'admin1' }), 'without boot doc');
  await assertSucceeds(boot(K_OWN));
  await assertFails(boot(K_NEW), 'boot only once');
  // الفريق ما يكدرون يسوون boot
  await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'hqMeta/boot')); });
  const h = hqAs('hq1');
  const b = writeBatch(h); b.set(doc(h, 'hqDevices/' + K_HQ1), { uid: 'hq1' }); b.set(doc(h, 'hqMeta/boot'), { uid: 'hq1', key: K_HQ1, atMs: 1 });
  await assertFails(b.commit());
});

test('برنامج المالك: الجلسة بس بمفتاح معتمد لنفس الحساب ولنفس تسجيل الدخول', async () => {
  await seedHq({ ownerSess: false, hq1Sess: false });
  const a = hqAs('admin1');
  await assertSucceeds(setDoc(doc(a, `hqSessions/admin1/t/${AT}`), { key: K_OWN, atMs: 1, platform: 'windows' }));
  await assertFails(setDoc(doc(a, `hqSessions/admin1/t/${AT + 5}`), { key: K_OWN, atMs: 1 }), 'wrong auth_time');
  await assertFails(setDoc(doc(a, `hqSessions/admin1/t/${AT}`), { key: K_NEW, atMs: 1 }), 'unapproved key');
  await assertFails(setDoc(doc(hqAs('hq1'), `hqSessions/hq1/t/${AT}`), { key: K_OWN, atMs: 1 }), "someone else's key");
  await assertFails(setDoc(doc(hqAs('hq1'), `hqSessions/admin1/t/${AT}`), { key: K_HQ1, atMs: 1 }));
  // مفتاح الجهاز ما يقراه أحد بدون ما يعرفه، والجهاز يقرا مستنده
  await assertSucceeds(getDoc(doc(hqAs('hq1'), 'hqDevices/' + K_HQ1)));
  await assertFails(getDoc(doc(hqAs('hq1'), 'hqDevices/' + K_OWN)));
  await assertFails(getDocs(collection(hqAs('hq1'), 'hqDevices')));
});

test('برنامج المالك: المالك بدون جهاز معتمد ما يعدّل الفريق — ومن جهازه يعدّل', async () => {
  await seedHq({ ownerSess: false });
  const team = { name: 'حسين', email: 'h3@x.com', job: 'دعم', perms: { rests: 'view', money: 'hide' }, createdAtMs: 1 };
  await assertFails(setDoc(doc(hqAs('admin1'), 'hqTeam/hq3'), team), 'no session');
  await assertFails(setDoc(doc(hqAs('admin1', AT + 9), 'hqTeam/hq3'), team), 'other login');
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `hqSessions/admin1/t/${AT}`), { key: K_OWN, atMs: 1 }); });
  await assertSucceeds(setDoc(doc(hqAs('admin1'), 'hqTeam/hq3'), team));
  await assertFails(setDoc(doc(hqAs('admin1'), 'hqTeam/hq4'), { ...team, perms: { rests: 'owner' } }), 'bad level');
  await assertFails(setDoc(doc(hqAs('admin1'), 'hqTeam/hq4'), { ...team, perms: { team: 'edit' } }), 'team section is owner-only');
  await assertFails(setDoc(doc(hqAs('hq2'), 'hqTeam/hq2'), { ...team, perms: { money: 'edit' } }), 'member cannot grant himself');
});

test('برنامج المالك: صلاحيات الفريق لكل قسم (مشاهدة / تعديل / مخفي)', async () => {
  await seedHq();
  const h1 = hqAs('hq1'), h2 = hqAs('hq2');
  const pay = { restaurantId: 'R1', restaurantName: 'R1', amount: 50000, months: 1, method: 'كاش', by: 'سجاد', byUid: 'hq1', atMs: 1, day: '2026-10-10' };
  // سجاد: الفلوس تعديل، المطاعم مشاهدة، التجارب مخفية
  await assertSucceeds(getDocs(collection(h1, 'hqPayments')));
  await assertSucceeds(setDoc(doc(h1, 'hqPayments/P1'), pay));
  await assertFails(setDoc(doc(h1, 'hqPayments/P2'), { ...pay, byUid: 'admin1' }), 'byUid must be him');
  await assertSucceeds(getDoc(doc(h1, 'restaurants/R1')));
  await assertSucceeds(updateDoc(doc(h1, 'restaurants/R1'), { expiryMs: Date.now() + 60 * DAY, expiry: '2026-12-10' }), 'money extends subscription');
  await assertFails(updateDoc(doc(h1, 'restaurants/R1'), { name: 'غيره' }), 'rests view only');
  await assertFails(updateDoc(doc(h1, 'restaurants/R1'), { features: { captain: false } }));
  await assertSucceeds(getDocs(query(collection(h1, 'users'), where('restaurantId', '==', 'R1'), where('role', '==', 'cashier'))));
  await assertFails(setDoc(doc(h1, 'users/newc'), { role: 'cashier', restaurantId: 'R1', email: 'c@x.com' }), 'rests view only');
  await assertFails(getDocs(collection(h1, 'leads')), 'trials hidden');
  await assertSucceeds(getDocs(query(collection(h1, 'orders'), where('restaurantId', '==', 'R1'))), 'overview view');
  // زينب: المطاعم والتجارب والأجهزة تعديل، الفلوس مخفية
  await assertFails(getDocs(collection(h2, 'hqPayments')));
  await assertSucceeds(updateDoc(doc(h2, 'restaurants/R1'), { features: { captain: false } }));
  await assertSucceeds(setDoc(doc(h2, 'users/newc'), { role: 'cashier', restaurantId: 'R1', email: 'c@x.com', name: 'ك', perms: {} }));
  await assertFails(setDoc(doc(h2, 'users/newa'), { role: 'admin' }), 'cannot create admins');
  await assertFails(setDoc(doc(h2, 'users/newh'), { role: 'hq' }), 'cannot create team accounts');
  await assertFails(updateDoc(doc(h2, 'users/admin1'), { disabled: true }), 'cannot touch the owner');
  await assertFails(updateDoc(doc(h2, 'users/cash1'), { role: 'admin' }), 'cannot promote');
  await assertSucceeds(updateDoc(doc(h2, 'users/cash1'), { disabled: true }));
  await assertSucceeds(updateDoc(doc(h2, 'leads/L1'), { status: 'contacted' }));
  await assertSucceeds(setDoc(doc(h2, 'hqNotes/N1'), { restaurantId: 'R1', text: 'اتصلت وياه', by: 'زينب', byUid: 'hq2', atMs: 1 }));
  await assertFails(getDocs(collection(h1, 'auditLog')), 'log hidden for سجاد');
  // خارطة الكباتن: اللي يشوف المطاعم يشوف مواقع الكباتن، وساعات الدوام يعدّلها اللي يعدّل المطاعم
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'captainLocations/C1'), { captainId: 'C1', restaurantId: 'R1', lat: 33.3, lng: 44.4, timestamp: 1 }); });
  await assertSucceeds(getDocs(collection(h1, 'captainLocations')), 'rests view → captains map');
  await assertFails(updateDoc(doc(h1, 'restaurants/R1'), { hours: { on: true, open: 600, close: 120 } }), 'rests view only');
  await assertSucceeds(updateDoc(doc(h2, 'restaurants/R1'), { hours: { on: true, open: 600, close: 120 } }));
});

test('برنامج المالك: بدون جهاز معتمد أو بعد إلغاء الجهاز = ماكو صلاحية', async () => {
  await seedHq({ hq1Sess: false });
  await assertFails(getDocs(collection(hqAs('hq1'), 'hqPayments')), 'no session');
  await assertFails(getDoc(doc(hqAs('hq1'), 'restaurants/R1')), 'no session');
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `hqSessions/hq1/t/${AT}`), { key: K_HQ1, atMs: 1 }); });
  await assertSucceeds(getDocs(collection(hqAs('hq1'), 'hqPayments')));
  await assertFails(getDocs(collection(hqAs('hq1', AT + 1), 'hqPayments')), 'another login on another device');
  // المالك يلغي جهاز سجاد ← ينقفل فوراً
  await assertSucceeds(deleteDoc(doc(hqAs('admin1'), 'hqDevices/' + K_HQ1)));
  await assertFails(getDocs(collection(hqAs('hq1'), 'hqPayments')), 'device revoked');
  // حساب hq انشال من الفريق، أو انوقف ← ينقفل حتى لو جهازه معتمد
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `hqSessions/hq2/t/${AT}`), { key: 'HQ2KEY_dddddddddddddddddddddddddd', atMs: 1 }); });
  await assertSucceeds(getDoc(doc(hqAs('hq2'), 'restaurants/R1')));
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'users/hq2'), { disabled: true }); });
  await assertFails(getDoc(doc(hqAs('hq2'), 'restaurants/R1')), 'disabled');
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'users/hq2'), { disabled: false }); await deleteDoc(doc(ctx.firestore(), 'hqTeam/hq2')); });
  await assertFails(getDoc(doc(hqAs('hq2'), 'restaurants/R1')), 'removed from team');
});

test('برنامج المالك: طلب اعتماد جهاز — الفريق يطلب، والمالك بس يعتمد', async () => {
  await seedHq();
  const req = { uid: 'hq1', name: 'سجاد', email: 'h1@x.com', platform: 'android', code: 'Q7K2MX', createdAtMs: 1, lastAtMs: 1 };
  await assertSucceeds(setDoc(doc(hqAs('hq1'), 'hqDeviceReqs/' + K_NEW), req));
  await assertFails(setDoc(doc(hqAs('hq2'), 'hqDeviceReqs/' + K_NEW), { ...req, uid: 'hq2' }), "cannot take over another's request");
  await assertFails(setDoc(doc(as('cash1'), 'hqDeviceReqs/CASHKEY_eeeeeeeeeeeeeeeeeeeeeeee'), { ...req, uid: 'cash1' }), 'cashiers cannot ask');
  await assertFails(getDocs(collection(hqAs('hq1'), 'hqDeviceReqs')), 'members cannot list');
  await assertFails(setDoc(doc(hqAs('hq2'), 'hqDevices/' + K_NEW), { uid: 'hq1' }), 'members cannot approve devices');
  await assertSucceeds(getDocs(collection(hqAs('admin1'), 'hqDeviceReqs')));
  const a = hqAs('admin1'), b = writeBatch(a);
  b.set(doc(a, 'hqDevices/' + K_NEW), { uid: 'hq1', name: 'تلفون سجاد', platform: 'android', code: 'Q7K2MX', approvedAtMs: 1, by: 'a@x.com' });
  b.delete(doc(a, 'hqDeviceReqs/' + K_NEW));
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(doc(hqAs('hq1', AT + 7), `hqSessions/hq1/t/${AT + 7}`), { key: K_NEW, atMs: 2, platform: 'android' }), 'second device, own session');
});

test('برنامج المالك: المطاعم والكاشيرية والكباتن ما يشوفون بيانات البرنامج', async () => {
  await seedHq();
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'hqPayments/P1'), { restaurantId: 'R1', amount: 1 }); await setDoc(doc(ctx.firestore(), 'hqNotes/N1'), { restaurantId: 'R1', text: 'x' }); });
  for (const u of ['rest1', 'cash1', 'cap1', 'staff1']) {
    await assertFails(getDoc(doc(as(u), 'hqPayments/P1')), u);
    await assertFails(getDocs(query(collection(as(u), 'hqNotes'), where('restaurantId', '==', 'R1'))), u);
    await assertFails(getDoc(doc(as(u), 'hqTeam/hq1')), u);
    await assertFails(getDoc(doc(as(u), 'hqMeta/backup')), u);
    await assertFails(getDoc(doc(as(u), 'hqMeta/rules')), u);
  }
  // نتيجة نشر القواعد التلقائي: يشوفها اللي يشوف النسخ الاحتياطية، ومحد يكتبها غير GitHub (حساب الخدمة)
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'hqMeta/rules'), { ok: true, atMs: 1 }); });
  await assertFails(getDoc(doc(hqAs('hq1'), 'hqMeta/rules')), 'no backups permission');
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'hqTeam/hq1'), { name: 'سجاد', perms: { overview: 'view', backups: 'view' } }); });
  await assertSucceeds(getDoc(doc(hqAs('hq1'), 'hqMeta/rules')));
  await assertFails(setDoc(doc(hqAs('admin1'), 'hqMeta/rules'), { ok: true, atMs: 2 }), 'only GitHub writes it');
  // فريق التجارب: يفتح تجربة لمطعم جديد (trial = true) بس، وما يحذف مطاعم
  const h2 = hqAs('hq2');
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'hqTeam/hq2'), { name: 'زينب', perms: { trials: 'edit' } }); });
  await assertSucceeds(setDoc(doc(h2, 'restaurants/T1'), { name: 'تجربة', trial: true, active: true }));
  await assertFails(setDoc(doc(h2, 'restaurants/T2'), { name: 'مو تجربة', active: true }));
  await assertSucceeds(updateDoc(doc(h2, 'restaurants/T1'), { expiryMs: 5, expiry: '2026-12-01' }));
  await assertFails(deleteDoc(doc(h2, 'restaurants/T1')));
  await assertSucceeds(setDoc(doc(h2, 'users/trialOwner'), { role: 'restaurant', restaurantId: 'T1', email: 't@x.com' }));
});

// ── شاشات المطبخ المربوطة برمز (بدون إيميل المطعم) ──
test('شاشة المطبخ: تطلع رمز، صاحب المطعم يربطها لمطعمه بس، وتشوف طلباته وتعلّم «جاهز» بس', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'orders/K1'), { restaurantId: 'R1', status: 'delivered', kitchen: 'new', value: 9000, kSec: { grill: { n: 1, readyAt: 0 } } });
    await setDoc(doc(ctx.firestore(), 'orders/K2'), { restaurantId: 'R1', status: 'preparing', kitchen: 'new', value: 5000 });
    await setDoc(doc(ctx.firestore(), 'restaurants/R1/settings/main'), { sections: [{ id: 'grill', name: 'الشوي' }] });
    await setDoc(doc(ctx.firestore(), 'restaurants/R1/menu/main'), { cats: [] });
  });
  const S = as('scrA');   // جلسة «مجهولة» (ماكو حساب بـ users)
  const pair = { uid: 'scrA', atMs: Date.now(), platform: 'Android • شاشة المجهز', kind: 'kitchen' };
  await assertSucceeds(setDoc(doc(S, 'screenPairs/AB12CD'), pair));
  await assertFails(setDoc(doc(as('scrB'), 'screenPairs/ZZ99ZZ'), { ...pair }), 'only for its own uid');
  await assertFails(setDoc(doc(as('scrB'), 'screenPairs/AB12CD'), { ...pair, uid: 'scrB' }), 'cannot take another screen code');
  // قبل الربط: ما تشوف شي
  await assertSucceeds(getDoc(doc(S, 'screens/scrA')));
  await assertFails(getDoc(doc(S, 'orders/K1')));
  await assertFails(getDoc(doc(S, 'restaurants/R1')));
  // صاحب المطعم يقرا الرمز ويربطها لمطعمه — بدون اعتماد (الاعتماد للبرج)
  const scr = { restaurantId: 'R1', code: 'AB12CD', kind: 'kitchen', name: 'المطبخ', platform: pair.platform, pairedBy: 'owner', approved: false, atMs: Date.now(), by: 'r1@x.com' };
  await assertSucceeds(getDoc(doc(as('rest1'), 'screenPairs/AB12CD')));
  await assertFails(setDoc(doc(as('rest1'), 'screens/scrA'), { ...scr, approved: true }), 'owner cannot approve');
  await assertFails(setDoc(doc(as('rest1'), 'screens/scrA'), { ...scr, restaurantId: 'R2' }), 'owner pairs only his restaurant');
  await assertFails(setDoc(doc(as('rest1'), 'screens/scrX'), { ...scr }), 'code must belong to that screen');
  await assertFails(setDoc(doc(as('cash1'), 'screens/scrA'), { ...scr }), 'cashier cannot pair');
  await assertSucceeds(setDoc(doc(as('rest1'), 'screens/scrA'), scr));
  await assertFails(updateDoc(doc(as('rest1'), 'screens/scrA'), { approved: true }), 'owner cannot approve later');
  await assertSucceeds(updateDoc(doc(as('rest1'), 'screens/scrA'), { name: 'شاشة الشوي' }));
  await assertFails(updateDoc(doc(S, 'screens/scrA'), { approved: true }), 'screen cannot approve itself');
  // الأجهزة المعتمدة مطفية: تشتغل مباشرة — طلبات مطعمها وإعداداته بس
  await assertSucceeds(getDoc(doc(S, 'restaurants/R1')));
  await assertSucceeds(getDoc(doc(S, 'restaurants/R1/settings/main')));
  await assertFails(getDoc(doc(S, 'restaurants/R1/menu/main')), 'only settings');
  await assertSucceeds(getDocs(query(collection(S, 'orders'), where('restaurantId', '==', 'R1'))));
  await assertFails(getDoc(doc(S, 'orders/O2')), 'other restaurant');
  await assertFails(getDocs(query(collection(S, 'orders'), where('restaurantId', '==', 'R2'))));
  await assertFails(getDoc(doc(S, 'users/rest1')));
  // «جاهز»: قسم، أو الطلب كله، أو أونلاين قيد التحضير ← جاهز
  await assertSucceeds(updateDoc(doc(S, 'orders/K1'), { kSec: { grill: { n: 1, readyAt: 5 } } }));
  await assertSucceeds(updateDoc(doc(S, 'orders/K1'), { kitchen: 'ready', kitchenReadyAt: 6 }));
  await assertSucceeds(updateDoc(doc(S, 'orders/K2'), { kitchen: 'ready', kitchenReadyAt: 6, status: 'ready', readyAt: 6 }));
  await assertFails(updateDoc(doc(S, 'orders/K1'), { value: 1 }), 'no prices');
  await assertFails(updateDoc(doc(S, 'orders/K1'), { status: 'cancelled' }), 'no cancel');
  await assertFails(setDoc(doc(S, 'orders/NEW'), { restaurantId: 'R1', value: 1, status: 'delivered' }), 'no new orders');
  await assertFails(deleteDoc(doc(S, 'orders/K1')));
  // الأجهزة المعتمدة شغّالة: اللي ربطها صاحب المطعم توكف لحد ما يعتمدها البرج
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'restaurants/R1'), { features: { devices: true } }); });
  await assertFails(getDoc(doc(S, 'orders/K1')), 'waits for approval');
  await assertFails(getDoc(doc(S, 'restaurants/R1')));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'screens/scrA'), { approved: true }));
  await assertSucceeds(getDoc(doc(S, 'orders/K1')));
  // البرج يربط شاشة ثانية معتمدة مباشرة
  await assertSucceeds(setDoc(doc(as('scrB'), 'screenPairs/QW34ER'), { ...pair, uid: 'scrB' }));
  await assertSucceeds(setDoc(doc(as('admin1'), 'screens/scrB'), { ...scr, code: 'QW34ER', pairedBy: 'hq', approved: true }));
  await assertSucceeds(getDoc(doc(as('scrB'), 'orders/K1')));
  // المطعم منتهي الاشتراك: الشاشة توكف
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'restaurants/R1'), { expiryMs: Date.now() - DAY }); });
  await assertFails(getDoc(doc(as('scrB'), 'orders/K1')), 'expired restaurant');
  // صاحب المطعم يشوف شاشاته ويفصلها، وما يشوف شاشات غيره
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'restaurants/R1'), { expiryMs: Date.now() + DAY }); });
  await assertSucceeds(getDocs(query(collection(as('rest1'), 'screens'), where('restaurantId', '==', 'R1'))));
  await assertFails(getDocs(query(collection(as('rest2'), 'screens'), where('restaurantId', '==', 'R1'))));
  await assertFails(deleteDoc(doc(as('rest2'), 'screens/scrA')));
  await assertSucceeds(deleteDoc(doc(as('rest1'), 'screens/scrA')));
  await assertFails(getDoc(doc(S, 'orders/K1')), 'unlinked');
});

test('خدمات المطعم: صاحب المطعم يوقف خدمة شغّلها البرج (svcOff) ويرجّعها — وما يكدر يشغّل خدمة البرج طافيها', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'restaurants/R1'), { features: { captain: true, devices: true } }); });
  await assertSucceeds(updateDoc(doc(as('rest1'), 'restaurants/R1'), { 'svcOff.captain': true }));
  // الكابتن يوكف (نفس لما البرج يطفيها)
  await assertFails(getDoc(doc(as('cap1'), 'orders/O1')), 'captain paused by owner');
  await assertFails(setDoc(doc(as('rest1'), 'orders/DLV'), { restaurantId: 'R1', value: 1, orderType: 'delivery' }), 'no delivery while paused');
  await assertSucceeds(updateDoc(doc(as('rest1'), 'restaurants/R1'), { 'svcOff.captain': false }));
  await assertSucceeds(getDoc(doc(as('cap1'), 'orders/O1')));
  // تشغيل الخدمة نفسها (features) للبرج بس — وإيقاف «الأجهزة المعتمدة» من صاحب المطعم ما يأثر
  await assertFails(updateDoc(doc(as('rest1'), 'restaurants/R1'), { 'features.kitchen': true }));
  await assertFails(updateDoc(doc(as('rest2'), 'restaurants/R1'), { 'svcOff.captain': true }), 'other owner');
  await assertFails(updateDoc(doc(as('cash1'), 'restaurants/R1'), { 'svcOff.captain': true }), 'cashier');
});

test('تلفون الويتر المربوط برمز: يشوف المنيو ويرسل طلب طاولة باسمه بس — وما يشوف الطلبات؛ وشاشة المطبخ ما ترسل طلبات ويتر', async () => {
  const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'orders/K1'), { restaurantId: 'R1', status: 'delivered', kitchen: 'new', value: 9000 });
    await setDoc(doc(db, 'restaurants/R1/menu/main'), { cats: [] });
    await setDoc(doc(db, 'restaurants/R1/settings/main'), { tables: 8 });
    await setDoc(doc(db, 'screenPairs/WA23CD'), { uid: 'wA', kind: 'waiter', atMs: 1 });
    await setDoc(doc(db, 'screens/wA'), { restaurantId: 'R1', code: 'WA23CD', kind: 'waiter', name: 'علي', pairedBy: 'hq', approved: true, atMs: 1 });
    await setDoc(doc(db, 'screens/sK'), { restaurantId: 'R1', code: 'SK23CD', kind: 'kitchen', name: 'المجهز', pairedBy: 'hq', approved: true, atMs: 1 });
  });
  const W = as('wA'), K = as('sK');
  const wo = (uid) => ({ restaurantId: 'R1', source: 'waiter', mode: 'table', table: '5', items: [{ name: 'برغر', qty: 1, price: 6000 }], status: 'new', total: 6000, createdAtMs: Date.now(), waiter: 'علي', waiterUid: uid, day });
  await assertSucceeds(getDoc(doc(W, 'restaurants/R1')));
  await assertSucceeds(getDoc(doc(W, 'restaurants/R1/settings/main')));
  await assertSucceeds(getDoc(doc(W, 'restaurants/R1/menu/main')));
  await assertSucceeds(getDoc(doc(W, 'restaurants/R1/menuImages/i1')));
  await assertSucceeds(setDoc(doc(W, 'webOrders/W1'), wo('wA')));
  await assertFails(setDoc(doc(W, 'webOrders/W2'), wo('someoneElse')), 'only as itself');
  await assertSucceeds(getDocs(query(collection(W, 'webOrders'), where('restaurantId', '==', 'R1'), where('waiterUid', '==', 'wA'))));
  await assertFails(getDocs(query(collection(W, 'webOrders'), where('restaurantId', '==', 'R1'))), 'only its own orders');
  await assertFails(getDoc(doc(W, 'orders/K1')), 'waiter phone does not read orders');
  await assertFails(updateDoc(doc(W, 'orders/K1'), { kitchen: 'ready', kitchenReadyAt: 1 }), 'waiter phone does not mark ready');
  await assertFails(getDoc(doc(W, 'restaurants/R1/accounting/x')));
  // شاشة المطبخ: الطلبات نعم، المنيو وطلبات الويتر لا
  await assertSucceeds(getDoc(doc(K, 'orders/K1')));
  await assertFails(getDoc(doc(K, 'restaurants/R1/menu/main')));
  await assertFails(setDoc(doc(K, 'webOrders/K9'), wo('sK')), 'kitchen screen cannot send waiter orders');
  // صاحب المطعم يوقف الويتر ← ما يرسل
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'restaurants/R1'), { svcOff: { waiter: true } }); });
  await assertFails(setDoc(doc(W, 'webOrders/W3'), wo('wA')), 'waiter paused by owner');
});

test('صورة التسليم: الكابتن يعيد «تم التسليم» إذا انقطع بالنص (الصورة انحفظت والطلب ما تحدّث) — بس قبل ما يتسلّم الطلب، وبس كابتن الطلب', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'orders/O3'), { status: 'delivering' }); });
  const img = (s) => ({ image: 'data:image/jpeg;base64,' + s, capturedAtMs: Date.now(), captainId: 'C2', captainName: 'c2' });
  await assertSucceeds(setDoc(doc(as('cap2'), 'deliveryProofs/O3'), img('AAAA')));
  // المحاولة الثانية بعد ما انقطع النت: نفس الصورة تنكتب من جديد
  await assertSucceeds(setDoc(doc(as('cap2'), 'deliveryProofs/O3'), img('BBBB')));
  await assertFails(setDoc(doc(as('cap1'), 'deliveryProofs/O3'), img('CCCC')), 'another captain cannot replace it');
  await assertFails(setDoc(doc(as('cap2'), 'deliveryProofs/O3'), { ...img('D'), image: 5 }), 'image must be text');
  // بعد التسليم: الصورة ثابتة
  await assertSucceeds(updateDoc(doc(as('cap2'), 'orders/O3'), { status: 'delivered', deliveredAt: 1, deliveredAtMs: Date.now(), hasProof: true }));
  await assertFails(setDoc(doc(as('cap2'), 'deliveryProofs/O3'), img('EEEE')), 'proof is fixed once delivered');
});

test('منيو الباركود: طلب واحد لكل جهاز كل 20 ثانية — بدون ختم الحد أو بدون دخول ← مرفوض', async () => {
  await seedPM();
  await assertSucceeds(qrOrder(WEB(), 'dev1'));
  await assertFails(qrOrder(WEB(), 'dev1'), 'same device again within 20s');
  await assertSucceeds(qrOrder(WEB(), 'dev2'), 'another device is fine');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB()), 'no login');
  await assertFails(addDoc(collection(as('dev3'), 'webOrders'), WEB()), 'order without the rate stamp');
  await assertFails(setDoc(doc(as('dev3'), 'webRate/dev4'), { at: serverTimestamp() }), 'only its own stamp');
  await assertFails(setDoc(doc(as('dev3'), 'webRate/dev3'), { at: 5 }), 'stamp is the server time');
  // بعد 20 ثانية: الختم القديم يسمح بطلب جديد
  await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'webRate/dev1'), { at: new Date(Date.now() - 25000) }));
  await assertSucceeds(qrOrder(WEB(), 'dev1'));
});

// ── شبكة المطعم (بنت أو بدون نت): الرمز السري lan/key ──
//  الكاشير وشاشات المطعم المربوطة يقرونه (يتصافحون بيه على الواي فاي)؛ يسويه صاحب المطعم أو كاشير عنده صلاحية الإعدادات
test('شبكة المطعم: الرمز السري يقراه الكاشير وشاشة المطبخ المربوطة، وما يشوفه الكابتن أو مطعم ثاني', async () => {
  const KEY = { key: 'a'.repeat(64), atMs: 1 };
  await assertFails(setDoc(doc(as('cash1'), 'restaurants/R1/lan/key'), KEY), 'cashier without settings permission cannot create it');
  await assertSucceeds(setDoc(doc(as('rest1'), 'restaurants/R1/lan/key'), KEY));
  await assertSucceeds(setDoc(doc(as('cash2'), 'restaurants/R1/lan/key'), KEY));
  await assertFails(setDoc(doc(as('rest2'), 'restaurants/R1/lan/key'), KEY));
  await assertSucceeds(getDoc(doc(as('cash1'), 'restaurants/R1/lan/key')));
  await assertSucceeds(getDoc(doc(as('rest1'), 'restaurants/R1/lan/key')));
  await assertFails(getDoc(doc(as('cap1'), 'restaurants/R1/lan/key')), 'captain cannot read the LAN key');
  await assertFails(getDoc(doc(as('rest2'), 'restaurants/R1/lan/key')));
  await assertFails(getDoc(doc(anon(), 'restaurants/R1/lan/key')));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'screens/scrK'), { restaurantId: 'R1', kind: 'kitchen', approved: true, code: 'ABCDEF' });
    await setDoc(doc(ctx.firestore(), 'screens/scrO'), { restaurantId: 'R2', kind: 'kitchen', approved: true, code: 'ABCDEG' });
  });
  await assertSucceeds(getDoc(doc(as('scrK'), 'restaurants/R1/lan/key')), 'linked kitchen screen reads its restaurant key');
  await assertFails(getDoc(doc(as('scrO'), 'restaurants/R1/lan/key')), 'another restaurant screen cannot');
  await assertFails(setDoc(doc(as('scrK'), 'restaurants/R1/lan/key'), KEY), 'screens cannot change it');
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'screens/scrW'), { restaurantId: 'R1', kind: 'waiter', approved: true, code: 'ABCDEH' }); });
  await assertFails(getDoc(doc(as('scrW'), 'restaurants/R1/lan/key')), 'waiter phone does not get the LAN key');
  // الكابتن بعده يقرا باقي بيانات مطعمه (المنيو والإعدادات) مثل قبل
  await assertSucceeds(getDoc(doc(as('cap1'), 'restaurants/R1/settings/main')));
});
