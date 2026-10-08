// اختبارات قواعد Firestore — تشغيل: npm test (من مجلد firebase)
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, runTransaction, addDoc, serverTimestamp } from 'firebase/firestore';

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
});
test('كاشير مطعم منتهي الاشتراك ممنوع', async () => {
  await assertFails(setDoc(doc(as('cashExp'), 'orders/NX'), { restaurantId: 'R3', status: 'delivered', value: 1 }));
});
test('صاحب المطعم يدير كاشيريته فقط', async () => {
  await assertSucceeds(setDoc(doc(as('rest1'), 'users/newcash'), { role: 'cashier', restaurantId: 'R1', name: 'n', email: 'e', perms: { menu: false } }));
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
  await assertSucceeds(setDoc(doc(as('rest1'), 'users/newc'), { role: 'cashier', restaurantId: 'R1', name: 'n', email: 'e', perms: {}, hours: { from: 480, to: 960 } }));
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
  await assertSucceeds(setDoc(doc(as('rest1'), 'publicMenus/R1/img/i1'), { data: 'data:image/png;base64,AAAA', updatedAtMs: 1 }));
  await assertSucceeds(getDoc(doc(anon(), 'publicMenus/R1/img/i1')));
  await assertFails(setDoc(doc(anon(), 'publicMenus/R1/img/i2'), { data: 'x' }));
});

test('webOrders: الزبون يطلب بدون تسجيل دخول إذا المنيو مفعّل ونوع الطلب مسموح', async () => {
  await seedPM();
  await assertSucceeds(addDoc(collection(anon(), 'webOrders'), WEB()));
  await assertSucceeds(addDoc(collection(anon(), 'webOrders'), WEB({ mode: 'table', table: '5', phone: '' })));
  await assertSucceeds(addDoc(collection(anon(), 'webOrders'), WEB({ mode: 'delivery', address: 'المنصور شارع 14' })));
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ status: 'accepted' })), 'must start new');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ phone: '12' })), 'pickup needs a phone');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ mode: 'table', table: '' })), 'table needs a number');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ mode: 'delivery', address: '' })), 'delivery needs an address');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ items: [] })));
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ source: 'waiter' })), 'waiter needs a staff login');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ price: 1 })), 'no extra fields');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ restaurantId: 'R2' })), 'no public menu');
  await seedPM({ ...PM, modes: { table: true, pickup: false, delivery: false } });
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB()), 'pickup turned off');
  await seedPM({ ...PM, on: false });
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ mode: 'table', table: '1' })), 'menu off');
  await seedPM();
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ day: 'x'.repeat(11) })), 'day too long');
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ extra: 1 })), 'unknown field');
});

test('webOrders: خدمة «online» أو «captain» مطفية، أو المطعم منتهي ← مرفوض', async () => {
  await seedPM();
  await seedPM(PM, 'R3');
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'restaurants/R1'), { features: { captain: false } }));
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ mode: 'delivery', address: 'المنصور' })));
  await assertSucceeds(addDoc(collection(anon(), 'webOrders'), WEB()));
  await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'restaurants/R1'), { features: { online: false } }));
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB()));
  await assertFails(addDoc(collection(anon(), 'webOrders'), WEB({ restaurantId: 'R3' })), 'expired restaurant');
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
  await assertSucceeds(setDoc(doc(m, 'users/newCash'), { email: 'c@x.com', role: 'cashier', name: 'ك', restaurantId: 'R2', perms: {} }));
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
