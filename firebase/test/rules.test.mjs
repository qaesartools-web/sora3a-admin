// اختبارات قواعد Firestore — تشغيل: npm test (من مجلد firebase)
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, runTransaction } from 'firebase/firestore';

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
