// إعدادات مشروع Firebase اللي تأثر على الكلفة — يشغّلها GitHub Actions بنفس مفتاح نشر القواعد (FIREBASE_SERVICE_ACCOUNT)
//   node scripts/project-settings.mjs          ← يفحص بس ويكتب النتيجة
//   node scripts/project-settings.mjs --apply  ← وفوكها يطوّل مدة رمز الحماية (App Check) لـ12 ساعة
//   • مدة رمز الحماية: كل تجديد = فحص reCAPTCHA. المجاني 10 آلاف بالشهر، وبعدها 8 دولار. ساعة ← 12 ساعة = فحوصات أقل بهواية
//   • الدفع حسب الاستخدام: بدونه المشروع يوكف إذا عبر الحد اليومي المجاني (50 ألف قراءة / 20 ألف كتابة)
//   • منطقة قاعدة البيانات: تحدد السعر (منطقة وحدة أرخص بالنص من «أكثر من منطقة»)
import { createSign } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const APPLY = process.argv.includes('--apply');
const WEB_APP = process.env.WEB_APP_ID || '1:516304449260:web:0110ba6c2621d6a16dbfc9';   // تطبيق الويب الوحيد (كل الصفحات وتطبيقات الأندرويد)
const TTL = '43200s';   // 12 ساعة

let SA = null;
try { SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ''); } catch (e) { SA = null; }
if (!SA || !SA.client_email || !SA.private_key) { console.error('❌ السر FIREBASE_SERVICE_ACCOUNT مو موجود بهذا المستودع.'); process.exit(1); }
const PROJECT = process.env.PROJECT_ID || SA.project_id || 'sora3a-system';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function token() {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + claims).sign(SA.private_key);
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claims + '.' + b64u(sig) });
  const j = await r.json();
  if (!j.access_token) throw new Error('تعذّر تسجيل الدخول بحساب الخدمة: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}
let TOK = '';
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + TOK, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (r.ok) return text ? JSON.parse(text) : {};
  let msg = text.slice(0, 300);
  try { msg = JSON.parse(text).error.message.slice(0, 300); } catch (e) {}
  const err = new Error(`${r.status}: ${msg}`); err.status = r.status; throw err;
}
const lines = [];
const out = (s) => { console.log(s); lines.push(s); };
const why = (e) => (e.status === 403 ? 'حساب الخدمة ما عنده صلاحية — يتسوّى من Firebase Console' : e.message);

TOK = await token();
out(`## إعدادات مشروع ${PROJECT}`);

// ١) منطقة قاعدة البيانات
try {
  const d = await call('GET', `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`);
  const multi = /^(nam|eur)\d/.test(d.locationId || '');
  out(`- 📍 قاعدة البيانات: \`${d.locationId}\` — ${multi ? 'أكثر من منطقة (السعر الأعلى)' : 'منطقة وحدة (السعر الأرخص)'}`);
} catch (e) { out(`- 📍 قاعدة البيانات: ما گدرنا نقرا المنطقة — ${why(e)}`); }

// ٢) الدفع حسب الاستخدام
try {
  const b = await call('GET', `https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`);
  out(b.billingEnabled ? '- 💳 الدفع حسب الاستخدام: **مفعّل** ✅' : '- 💳 الدفع حسب الاستخدام: **مو مفعّل** ⚠️ — المشروع يوكف إذا عبر الحد اليومي المجاني');
} catch (e) { out(`- 💳 الدفع حسب الاستخدام: ما گدرنا نتأكد — ${why(e)}`); }

// ٣) مدة رمز الحماية
const cfgUrl = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}/apps/${WEB_APP}/recaptchaEnterpriseConfig`;
try {
  let c = await call('GET', cfgUrl);
  out(`- 🛡️ مدة رمز الحماية هسه: \`${c.tokenTtl || 'الافتراضي (ساعة)'}\``);
  if (APPLY && c.tokenTtl !== TTL) {
    c = await call('PATCH', cfgUrl + '?updateMask=tokenTtl', { tokenTtl: TTL });
    out(`- 🛡️ صارت: \`${c.tokenTtl}\` (12 ساعة) ✅`);
  } else if (c.tokenTtl === TTL) out('- 🛡️ مضبوطة على 12 ساعة ✅');
} catch (e) { out(`- 🛡️ مدة رمز الحماية: ما گدرنا ${APPLY ? 'نغيّرها' : 'نقراها'} — ${why(e)}`); }

if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
