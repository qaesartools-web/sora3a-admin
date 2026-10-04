// سرعة — يرسل إشعار للكابتن لما يوصل طلب دلفري (يرن حتى والتطبيق مسكّر)
// يحتاج متغير البيئة FIREBASE_SERVICE_ACCOUNT (ملف حساب الخدمة من فايربيس) — ما يحتاج خطة Blaze
import type { Config, Context } from "@netlify/functions";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const ALLOWED_ORIGINS = ["https://qaesartools-web.github.io"];
const CAPTAIN_URL = "https://qaesartools-web.github.io/sora3a-captain/captain.html";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}

function ensureAdmin(): boolean {
  if (getApps().length) return true;
  const raw = Netlify.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) return false;
  initializeApp({ credential: cert(JSON.parse(raw)) });
  return true;
}

const fmt = (n: unknown) => Number(n || 0).toLocaleString("en-US");

export default async (req: Request, _context: Context) => {
  const h = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405, h);
  if (!ensureAdmin()) return reply({ ok: false, error: "not_configured" }, 503, h);

  // 1) من يطلب؟ لازم يكون حساب مسجّل دخول (صاحب مطعم / كاشير / مدير)
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let uid: string;
  try { uid = (await getAuth().verifyIdToken(idToken)).uid; }
  catch { return reply({ ok: false, error: "unauthenticated" }, 401, h); }

  const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: unknown };
  if (typeof orderId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(orderId)) return reply({ ok: false, error: "bad_order" }, 400, h);

  const db = getFirestore();
  const [userSnap, orderSnap] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`orders/${orderId}`).get()]);
  if (!orderSnap.exists) return reply({ ok: false, error: "not_found" }, 404, h);
  const u = userSnap.data() || {};
  const o = orderSnap.data() || {};

  // 2) يصير بس لطلبات مطعمه
  let allowed = u.role === "admin" && !u.disabled;
  if (!allowed && !u.disabled && ["restaurant", "cashier"].includes(u.role)) {
    allowed = u.restaurantId === o.restaurantId;
    if (!allowed && u.role === "restaurant" && !u.restaurantId) {
      const r = await db.doc(`restaurants/${o.restaurantId}`).get();
      allowed = r.exists && r.get("userId") === uid;
    }
  }
  if (!allowed) return reply({ ok: false, error: "forbidden" }, 403, h);

  // 3) بس طلب دلفري بانتظار الكابتن، ومرة وحدة لكل كابتن
  if (o.status !== "pending" || (o.orderType || "delivery") !== "delivery") return reply({ ok: true, skipped: "not_pending" }, 200, h);
  const key = o.captainId || "all";
  if (o.pushedFor === key) return reply({ ok: true, skipped: "already_sent" }, 200, h);

  let captainIds: string[];
  if (o.captainId) captainIds = [o.captainId];
  else {
    const caps = await db.collection("captains").where("restaurantId", "==", o.restaurantId).where("available", "==", true).get();
    const rejected: string[] = o.rejectedBy || [];
    captainIds = caps.docs.map((d) => d.id).filter((c) => !rejected.includes(c)).slice(0, 30);
  }
  const targets: { uid: string; token: string }[] = [];
  if (captainIds.length) {
    const toks = await db.collection("pushTokens").where("captainId", "in", captainIds).get();
    toks.forEach((d) => { if (d.get("role") === "captain") (d.get("tokens") || []).forEach((t: string) => targets.push({ uid: d.id, token: t })); });
  }
  if (!targets.length) {
    await orderSnap.ref.update({ pushedFor: key, pushedAtMs: Date.now(), pushedCount: 0 });
    return reply({ ok: true, sent: 0, note: "no_tokens" }, 200, h);
  }

  const title = "🛵 طلب توصيل جديد";
  const body = `${o.restaurantName || ""} • ${o.address || ""} • أجرة ${fmt(o.fee)} د.ع`.trim();
  const tag = "order-" + orderId;
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    data: { title, body, link: CAPTAIN_URL, tag, orderId },
    webpush: {
      headers: { Urgency: "high", TTL: "600" },
      notification: {
        title, body, tag,
        icon: "/sora3a-captain/icon-192.png", badge: "/sora3a-captain/icon-192.png",
        requireInteraction: true, renotify: true, vibrate: [400, 150, 400, 150, 600], dir: "rtl", lang: "ar",
      },
      fcmOptions: { link: CAPTAIN_URL },
    },
  });

  // تنظيف التوكنات المنتهية
  const dead: Record<string, string[]> = {};
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") (dead[targets[i].uid] ||= []).push(targets[i].token);
  });
  await Promise.all([
    orderSnap.ref.update({ pushedFor: key, pushedAtMs: Date.now(), pushedCount: res.successCount }),
    ...Object.entries(dead).map(([id, t]) => db.doc(`pushTokens/${id}`).update({ tokens: FieldValue.arrayRemove(...t) }).catch(() => {})),
  ]);
  return reply({ ok: true, sent: res.successCount, failed: res.failureCount }, 200, h);
};

export const config: Config = { path: "/api/notify" };
