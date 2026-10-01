// منظومة سرعة — إشعارات فورية (تعمل حتى والتطبيق مغلق)
// تحتاج خطة Blaze في Firebase. النشر: firebase deploy --only functions
'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const db = getFirestore();
const CAPTAIN_URL = 'https://qaesartools-web.github.io/sora3a-captain/captain.html';
const REST_URL = 'https://qaesartools-web.github.io/sora3a-rest2/';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const shortId = (id) => id.substring(0, 6).toUpperCase();

// يجمع التوكنات من pushTokens حسب شرط، ويرجع [{uid, token}]
async function tokensWhere(field, op, value, role) {
  if (Array.isArray(value) && !value.length) return [];
  const roles = Array.isArray(role) ? role : [role];
  const snap = await db.collection('pushTokens').where(field, op, value).where('role', 'in', roles).get();
  const out = [];
  snap.forEach((d) => (d.get('tokens') || []).forEach((t) => out.push({ uid: d.id, token: t })));
  return out;
}

// يرسل ويحذف التوكنات المنتهية
async function send(targets, { title, body, link, tag, urgent }) {
  if (!targets.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    data: { title, body, link, tag },
    webpush: {
      headers: { Urgency: urgent ? 'high' : 'normal', TTL: '600' },
      notification: {
        title, body, tag,
        icon: link.includes('captain') ? '/sora3a-captain/icon-192.png' : '/sora3a-rest2/icon-192.png',
        requireInteraction: !!urgent,
        renotify: true,
        vibrate: [300, 100, 300, 100, 400],
        dir: 'rtl', lang: 'ar',
      },
      fcmOptions: { link },
    },
  });
  const dead = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      (dead[targets[i].uid] = dead[targets[i].uid] || []).push(targets[i].token);
    }
  });
  await Promise.all(Object.entries(dead).map(([uid, toks]) =>
    db.doc(`pushTokens/${uid}`).update({ tokens: FieldValue.arrayRemove(...toks) }).catch(() => {})));
  logger.info('push sent', { ok: res.successCount, failed: res.failureCount, tag });
}

exports.onOrderWrite = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const id = event.params.orderId;

  // 1) طلب توصيل جديد / أُعيد تعيينه → إشعار للكابتن
  const becamePending = after.status === 'pending'
    && (!before || before.status !== 'pending' || before.captainId !== after.captainId);
  if (becamePending && (after.orderType || 'delivery') === 'delivery') {
    let targets;
    if (after.captainId) {
      targets = await tokensWhere('captainId', '==', after.captainId, 'captain');
    } else {
      // بدون كابتن محدد: كل الكباتن المتاحين في المطعم عدا الرافضين
      const caps = await db.collection('captains')
        .where('restaurantId', '==', after.restaurantId).where('available', '==', true).get();
      const rejected = after.rejectedBy || [];
      const ids = caps.docs.map((d) => d.id).filter((c) => !rejected.includes(c)).slice(0, 30);
      targets = await tokensWhere('captainId', 'in', ids, 'captain');
    }
    await send(targets, {
      title: '🛵 طلب توصيل جديد',
      body: `${after.restaurantName || ''} • ${after.address || ''} • أجرة ${fmt(after.fee)} د.ع`,
      link: CAPTAIN_URL, tag: 'order-' + id, urgent: true,
    });
  }

  // 2) رفض الكابتن → إشعار للمطعم
  const newReject = after.rejectNotice && (!before || !before.rejectNotice
    || before.rejectNotice.timestamp !== after.rejectNotice.timestamp);
  if (newReject) {
    const targets = await tokensWhere('restaurantId', '==', after.restaurantId, ['restaurant', 'cashier']);
    await send(targets, {
      title: '⚠️ رفض الكابتن الطلب',
      body: `الطلب ${shortId(id)} — ${after.rejectNotice.by || ''}. اختر كابتن آخر.`,
      link: REST_URL, tag: 'reject-' + id, urgent: true,
    });
  }

  // 3) تم التسليم → إشعار للمطعم
  if (after.status === 'delivered' && before && before.status !== 'delivered' && after.captainId) {
    const targets = await tokensWhere('restaurantId', '==', after.restaurantId, ['restaurant', 'cashier']);
    await send(targets, {
      title: '✅ تم تسليم الطلب',
      body: `${shortId(id)} — ${after.captainName || ''}`,
      link: REST_URL, tag: 'done-' + id, urgent: false,
    });
  }
});
