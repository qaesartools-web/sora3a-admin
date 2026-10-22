// نشر قواعد الحماية (firestore.rules) على Firebase تلقائياً — يشغّله GitHub Actions بعد ما تنجح فحوصات القواعد
//   FIREBASE_SERVICE_ACCOUNT: مفتاح حساب الخدمة (JSON) من أسرار GitHub — نفس مفتاح النسخة الاحتياطية
//   بدون مكتبات: Firebase Rules API + Firestore REST
//   node scripts/deploy-rules.mjs            ← ينشر
//   node scripts/deploy-rules.mjs --check    ← يفحص القواعد على السيرفر بدون ما ينشر
import { createSign, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API = process.env.RULES_API || 'https://firebaserules.googleapis.com/v1/';
const FS = process.env.FS_API || 'https://firestore.googleapis.com/v1/';
const TOKEN_URL = process.env.TOKEN_URL || 'https://oauth2.googleapis.com/token';
const CHECK = process.argv.includes('--check');

let SA = null;
try { SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ''); } catch (e) { SA = null; }
if (!SA || !SA.client_email || !SA.private_key) {
  console.error('❌ السر FIREBASE_SERVICE_ACCOUNT مو موجود بهذا المستودع (sora3a-admin).');
  console.error('   ضيفه: Settings ← Secrets and variables ← Actions ← New repository secret — نفس ملف المفتاح اللي بمستودع sora3a-backup.');
  process.exit(1);
}
const PROJECT = process.env.PROJECT_ID || SA.project_id || 'sora3a-system';
const RELEASE = `projects/${PROJECT}/releases/cloud.firestore`;

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
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + TOK, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (r.ok) return text ? JSON.parse(text) : {};
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    const err = new Error(`${r.status}: ${text.slice(0, 1500)}`); err.status = r.status; throw err;
  }
}
// النتيجة تبين ببرج سرعة (النسخ الاحتياطية ← قواعد الحماية)
async function report(fields) {
  const val = (v) => (typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(Math.round(v)) } : { stringValue: String(v) });
  const doc = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)])) };
  try { await call('PATCH', `${FS}projects/${PROJECT}/databases/(default)/documents/hqMeta/rules`, doc); console.log('📝 انكتبت النتيجة ببرج سرعة'); }
  catch (e) { console.warn('⚠️ ما انكتبت النتيجة ببرج سرعة:', e.message.slice(0, 200)); }
}

const source = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
const commit = (process.env.GITHUB_SHA || '').slice(0, 7);
TOK = await token();

// ١) نرفع القواعد كنسخة جديدة — Firebase يفحصها (أي خطأ بالكتابة يوقف هنا وما يتغير شي)
let ruleset;
try {
  ruleset = await call('POST', `${API}projects/${PROJECT}/rulesets`, { source: { files: [{ name: 'firestore.rules', content: source }] } });
} catch (e) {
  console.error('❌ Firebase رفض القواعد — ما انتشر شي، والقواعد القديمة باقية شغالة:\n' + e.message);
  if (!CHECK) await report({ ok: false, atMs: Date.now(), hash, commit, error: ('القواعد فيها خطأ: ' + e.message).slice(0, 300) });
  process.exit(1);
}
console.log('✅ القواعد سليمة على سيرفر Firebase:', ruleset.name);
if (CHECK) process.exit(0);

// ٢) نخليها هي الشغالة
try {
  await call('PATCH', `${API}${RELEASE}`, { release: { name: RELEASE, rulesetName: ruleset.name } });
} catch (e) {
  if (e.status !== 404) {
    console.error('❌ تعذّر تفعيل القواعد:\n' + e.message);
    await report({ ok: false, atMs: Date.now(), hash, commit, error: ('تعذّر التفعيل: ' + e.message).slice(0, 300) });
    process.exit(1);
  }
  await call('POST', `${API}projects/${PROJECT}/releases`, { name: RELEASE, rulesetName: ruleset.name });   // أول مرة بالمشروع
}
// ٣) نتأكد إنها هي الشغالة فعلاً
const rel = await call('GET', `${API}${RELEASE}`);
if (rel.rulesetName !== ruleset.name) {
  console.error('❌ القواعد الشغالة مو اللي نشرناها:', rel.rulesetName);
  await report({ ok: false, atMs: Date.now(), hash, commit, error: 'القواعد الشغالة مو اللي انتشرت' });
  process.exit(1);
}
console.log('🚀 انتشرت القواعد وصارت هي الشغالة —', hash, commit);
await report({ ok: true, atMs: Date.now(), hash, commit, ruleset: ruleset.name, error: '' });
