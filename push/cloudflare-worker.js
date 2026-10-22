// ═══════════════════════════════════════════════════════════════════════
// سرعة — سيرفر إشعارات الكابتن (Cloudflare Worker — مجاني، بدون خطة Blaze)
// يرن تلفون الكابتن بطلب الدلفري حتى والتطبيق مسكّر.
//
// الإعداد: انسخ هذا الملف كامل والصقه بمحرر الـ Worker، وأضف سر (Secret) اسمه
// FIREBASE_SERVICE_ACCOUNT قيمته محتوى ملف حساب الخدمة (json) من فايربيس.
// ═══════════════════════════════════════════════════════════════════════

// لوحة الإدارة والكاشير (GitHub Pages) + برج سرعة (أندرويد appassets، وويندوز app://)
const ALLOWED_ORIGINS = ['https://qaesartools-web.github.io', 'https://appassets.androidplatform.net'];
const CAPTAIN_URL = 'https://qaesartools-web.github.io/sora3a-captain/captain.html';

export default {
  async fetch(req, env) {
    const h = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    // تحديث برج سرعة (المستودع خاص): نمرّر ملف النسخة/المثبّت من إصدار GitHub بتوكن السيرفر
    const turl = new URL(req.url);
    if (req.method === 'GET' && turl.pathname.startsWith('/tower/')) return towerUpdate(turl, env, h);
    const { sa, key } = readServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    // افتح رابط السيرفر بالمتصفح: key = ok يعني المفتاح مضبوط، غيرها تبيّن السبب
    if (req.method === 'GET') return reply({ ok: true, service: 'sora3a-push', key, tower: env.GITHUB_TOKEN ? 'ok' : 'no_github_token' }, 200, h);
    if (req.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405, h);
    if (!sa) return reply({ ok: false, error: 'not_configured', key }, 503, h);
    try { return await handle(req, env, sa, h); }
    catch (e) { return reply({ ok: false, error: 'server_error', detail: String(e && e.message || e).slice(0, 200) }, 500, h); }
  },
};

// ── تحديث برج سرعة من إصدار GitHub الخاص (يحتاج سر GITHUB_TOKEN: توكن قراءة للمستودع) ──
const TOWER_REPO = 'qaesartools-web/sora3a-owner';
const TOWER = {
  win: { tag: 'tower-windows', file: 'sora3a-tower-setup.exe', type: 'application/octet-stream' },
  apk: { tag: 'tower-android', file: 'sora3a-tower.apk', type: 'application/vnd.android.package-archive' },
};
async function towerUpdate(url, env, h) {
  const token = env.GITHUB_TOKEN;
  if (!token) return reply({ ok: false, error: 'no_github_token' }, 503, h);
  const cfg = TOWER[url.pathname.split('/')[2]];
  if (!cfg) return reply({ ok: false, error: 'bad_platform' }, 404, h);
  const gh = { 'Authorization': 'Bearer ' + token, 'User-Agent': 'sora3a-tower', 'Accept': 'application/vnd.github+json' };
  const rel = await fetch(`https://api.github.com/repos/${TOWER_REPO}/releases/tags/${cfg.tag}`, { headers: gh });
  if (!rel.ok) return reply({ ok: false, error: 'release_' + rel.status }, 502, h);
  const want = url.searchParams.get('dl') ? cfg.file : 'version.json';
  const asset = ((await rel.json()).assets || []).find((a) => a.name === want);
  if (!asset) return reply({ ok: false, error: 'asset_missing', want }, 404, h);
  // تنزيل أصل الإصدار: أول طلب بالتوكن يرجّع تحويل (302) لرابط موقّع — نتبعه بدون التوكن
  let bin = await fetch(asset.url, { headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': 'sora3a-tower', 'Accept': 'application/octet-stream' }, redirect: 'manual' });
  if (bin.status >= 300 && bin.status < 400 && bin.headers.get('location')) bin = await fetch(bin.headers.get('location'), { headers: { 'User-Agent': 'sora3a-tower' } });
  if (!bin.ok) return new Response('asset ' + bin.status, { status: 502, headers: h });
  if (want === 'version.json') return new Response(await bin.text(), { status: 200, headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(bin.body, { status: 200, headers: { ...h, 'content-type': cfg.type, 'content-disposition': 'attachment; filename="' + cfg.file + '"', 'cache-control': 'no-store' } });
}

// يقرأ مفتاح حساب الخدمة ويتسامح مع أخطاء اللصق الشائعة (BOM، علامات تنصيص، base64)
function readServiceAccount(raw) {
  if (raw == null || raw === '') return { sa: null, key: 'missing' };
  let t = String(raw).replace(/^\uFEFF/, '').trim();
  let sa = null;
  try { sa = JSON.parse(t); } catch {}
  if (!sa && /^['"`]/.test(t) && t.slice(-1) === t[0]) { t = t.slice(1, -1).trim(); try { sa = JSON.parse(t); } catch {} }
  if (typeof sa === 'string') { try { sa = JSON.parse(sa); } catch { sa = null; } }
  if (!sa && /^[A-Za-z0-9+/=\s]+$/.test(t)) { try { sa = JSON.parse(atob(t.replace(/\s+/g, ''))); } catch {} }
  if (!sa || typeof sa !== 'object') return { sa: null, key: t.startsWith('{') ? 'bad_json_incomplete_copy' : 'not_json_paste_file_content' };
  if (!sa.private_key || !sa.client_email) return { sa: null, key: 'wrong_file_need_service_account' };
  if (!sa.project_id) return { sa: null, key: 'missing_project_id' };
  return { sa, key: 'ok' };
}

async function handle(req, env, sa, h) {
  const pid = sa.project_id;
  const emu = env.EMULATOR_HOST || ''; // للاختبار فقط
  // 1) من يطلب؟ حساب مسجّل دخول
  const idToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const uid = await verifyIdToken(idToken, pid, !!emu);
  if (!uid) return reply({ ok: false, error: 'unauthenticated' }, 401, h);

  const body = await req.json().catch(() => ({}));
  if (body && body.action === 'setPassword') return setPassword(uid, body, sa, pid, emu, h);
  const orderId = body && body.orderId;
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(orderId)) return reply({ ok: false, error: 'bad_order' }, 400, h);

  const fs = firestore(pid, emu, emu ? null : await accessToken(sa));
  const [u, o] = await Promise.all([fs.get(`users/${uid}`), fs.get(`orders/${orderId}`)]);
  if (!o) return reply({ ok: false, error: 'not_found' }, 404, h);
  const usr = u || {};

  // 2) يصير بس لطلبات مطعمه
  let allowed = usr.role === 'admin' && !usr.disabled;
  if (!allowed && !usr.disabled && ['restaurant', 'cashier'].includes(usr.role)) {
    allowed = usr.restaurantId === o.restaurantId;
    if (!allowed && usr.role === 'restaurant' && !usr.restaurantId) {
      const r = await fs.get(`restaurants/${o.restaurantId}`);
      allowed = !!r && r.userId === uid;
    }
  }
  if (!allowed) return reply({ ok: false, error: 'forbidden' }, 403, h);

  // 3) بس طلب دلفري بانتظار الكابتن، ومرة وحدة لكل تخصيص
  //    (n = وقت التخصيص من الكاشير: إعادة المحاولة نفس n فما تتكرر، وإعادة التخصيص لنفس الكابتن n جديد فيرن من جديد)
  if (o.status !== 'pending' || (o.orderType || 'delivery') !== 'delivery') return reply({ ok: true, skipped: 'not_pending' }, 200, h);
  const n = Math.floor(Number(body.n) || 0);
  const key = (o.captainId || 'all') + (n > 0 ? ':' + n : '');
  if (o.pushedFor === key) return reply({ ok: true, skipped: 'already_sent' }, 200, h);

  let captainIds;
  if (o.captainId) captainIds = [o.captainId];
  else {
    const caps = await fs.query('captains', [['restaurantId', 'EQUAL', o.restaurantId], ['available', 'EQUAL', true]]);
    const rejected = o.rejectedBy || [];
    captainIds = caps.map((c) => c.__id).filter((id) => !rejected.includes(id)).slice(0, 30);
  }
  const targets = [];
  if (captainIds.length) {
    const toks = await fs.query('pushTokens', [['captainId', 'IN', captainIds]]);
    toks.forEach((d) => { if (d.role === 'captain') (d.tokens || []).forEach((t) => targets.push({ uid: d.__id, token: t })); });
  }

  let sent = 0, failed = 0;
  const dead = {};
  if (targets.length && !emu) {
    const at = await accessToken(sa);
    const title = '🛵 طلب توصيل جديد';
    const text = `${o.restaurantName || ''} • ${o.address || ''} • أجرة ${Number(o.fee || 0).toLocaleString('en-US')} د.ع`.trim();
    const tag = 'order-' + orderId;
    await Promise.all(targets.map(async (t) => {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${pid}/messages:send`, {
        method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' },
        body: JSON.stringify({ message: {
          token: t.token,
          // رسالة data فقط: الـ Service Worker (ويب) أو تطبيق الأندرويد يعرضها ويرن لحد ما يفتحها
          data: { kind: 'order', title, body: text, link: CAPTAIN_URL, tag, orderId },
          webpush: { headers: { Urgency: 'high', TTL: '600' } },
          // تطبيق الأندرويد: أولوية عالية حتى يصحى التلفون ويرن والتطبيق مسكّر
          android: { priority: 'HIGH', ttl: '600s' },
        } }),
      });
      if (r.ok) { sent++; return; }
      failed++;
      const err = await r.text();
      if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(err)) (dead[t.uid] ||= []).push(t.token);
    }));
  }
  await fs.patch(`orders/${orderId}`, { pushedFor: key, pushedAtMs: Date.now(), pushedCount: sent });
  for (const [id, toks] of Object.entries(dead)) await fs.arrayRemove(`pushTokens/${id}`, 'tokens', toks).catch(() => {});
  return reply({ ok: true, sent, failed, targets: targets.length }, 200, h);
}

// ── كلمة سر جديدة لحساب كاشير أو صاحب مطعم ──
// فايربيس يحفظ كلمات السر مشفّرة (محد يكدر يقراها)، فالحل: كلمة سر جديدة وتنرسل للشخص.
//   المالك وفريق البرج اللي عنده «تعديل» المطاعم: أي كاشير أو صاحب مطعم
//   صاحب المطعم: كاشيرية مطعمه (وفروعه) بس
async function setPassword(uid, body, sa, pid, emu, h) {
  const target = body.uid, pass = body.password;
  if (typeof target !== 'string' || !/^[A-Za-z0-9]{6,128}$/.test(target)) return reply({ ok: false, error: 'bad_user' }, 400, h);
  if (typeof pass !== 'string' || pass.length < 8 || pass.length > 64 || pass.trim() !== pass) return reply({ ok: false, error: 'bad_password' }, 400, h);
  const fs = firestore(pid, emu, emu ? null : await accessToken(sa));
  const [me, t] = await Promise.all([fs.get(`users/${uid}`), fs.get(`users/${target}`)]);
  if (!me || me.disabled) return reply({ ok: false, error: 'forbidden' }, 403, h);
  if (!t || !['cashier', 'restaurant'].includes(t.role)) return reply({ ok: false, error: 'bad_target' }, 403, h);
  let ok = false;
  if (me.role === 'admin') ok = true;
  else if (me.role === 'hq') { const team = await fs.get(`hqTeam/${uid}`); ok = !!(team && team.perms && team.perms.rests === 'edit'); }
  else if (me.role === 'restaurant' && t.role === 'cashier' && t.restaurantId) {
    ok = [me.restaurantId, ...(me.branches || [])].filter(Boolean).includes(t.restaurantId);
    if (!ok) { const r = await fs.get(`restaurants/${t.restaurantId}`); ok = !!r && r.userId === uid; }
  }
  if (!ok) return reply({ ok: false, error: 'forbidden' }, 403, h);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${pid}/accounts:update`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await accessToken(sa) },
    body: JSON.stringify({ localId: target, password: pass }),
  });
  if (!r.ok) return reply({ ok: false, error: 'auth_failed', detail: (await r.text()).slice(0, 200) }, 502, h);
  return reply({ ok: true }, 200, h);
}

// ── أدوات ──
function cors(req) {
  const origin = req.headers.get('origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^app:\/\/[a-z0-9.-]+$/i.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0], 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' };
}
function reply(body, status, headers) { return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } }); }
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(new TextEncoder().encode(s));
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// التحقق من توكن دخول فايربيس (توقيع Google)
let jwksCache = null;
async function verifyIdToken(tok, pid, emulator) {
  const parts = (tok || '').split('.');
  if (parts.length !== 3) return null;
  let head, pl;
  try { head = JSON.parse(new TextDecoder().decode(fromB64u(parts[0]))); pl = JSON.parse(new TextDecoder().decode(fromB64u(parts[1]))); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (pl.aud !== pid || pl.iss !== 'https://securetoken.google.com/' + pid || !pl.sub || pl.exp < now || pl.iat > now + 300) return null;
  if (emulator) return pl.sub;
  if (head.alg !== 'RS256') return null;
  if (!jwksCache || jwksCache.exp < Date.now()) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    jwksCache = { keys: (await r.json()).keys || [], exp: Date.now() + 3600e3 };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return ok ? pl.sub : null;
}

// توكن وصول Google من حساب الخدمة
let atCache = null;
async function accessToken(sa) {
  if (atCache && atCache.exp > Date.now() + 60e3) return atCache.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64uStr(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit',
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', fromB64u(pem.replace(/\+/g, '-').replace(/\//g, '_')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + b64u(sig) });
  const j = await r.json();
  if (!j.access_token) throw new Error('oauth: ' + JSON.stringify(j).slice(0, 150));
  atCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return atCache.token;
}

// Firestore عبر REST
function firestore(pid, emu, token) {
  const base = (emu ? `http://${emu}` : 'https://firestore.googleapis.com') + `/v1/projects/${pid}/databases/(default)/documents`;
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + (token || 'owner') };
  const dec = (v) => {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return decFields(v.mapValue.fields || {});
    return null;
  };
  const decFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));
  const enc = (x) => typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x } : Number.isInteger(x) ? { integerValue: String(x) } : typeof x === 'number' ? { doubleValue: x } : Array.isArray(x) ? { arrayValue: { values: x.map(enc) } } : { nullValue: null };
  const docOf = (d) => ({ ...decFields(d.fields || {}), __id: d.name.split('/').pop() });
  return {
    async get(path) { const r = await fetch(`${base}/${path}`, { headers }); if (r.status === 404) return null; if (!r.ok) throw new Error('get ' + r.status); return docOf(await r.json()); },
    async query(coll, filters) {
      const fs = filters.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: f }, op, value: enc(v) } }));
      const where = fs.length === 1 ? fs[0] : { compositeFilter: { op: 'AND', filters: fs } };
      const r = await fetch(`${base}:runQuery`, { method: 'POST', headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }], where } }) });
      if (!r.ok) throw new Error('query ' + r.status);
      return (await r.json()).filter((x) => x.document).map((x) => docOf(x.document));
    },
    async patch(path, data) {
      const mask = Object.keys(data).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
      const r = await fetch(`${base}/${path}?${mask}&currentDocument.exists=true`, { method: 'PATCH', headers, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) });
      if (!r.ok) throw new Error('patch ' + r.status);
    },
    async arrayRemove(path, field, values) {
      const name = `projects/${pid}/databases/(default)/documents/${path}`;
      const r = await fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: [{ transform: { document: name, fieldTransforms: [{ fieldPath: field, removeAllFromArray: { values: values.map(enc) } }] } }] }) });
      if (!r.ok) throw new Error('commit ' + r.status);
    },
  };
}
