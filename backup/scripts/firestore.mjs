// اتصال بسيط بـ Firestore (REST) بحساب الخدمة — بدون مكتبات
// FIREBASE_SERVICE_ACCOUNT: ملف مفتاح حساب الخدمة (JSON) من أسرار GitHub
// FIRESTORE_EMULATOR_HOST: للتجربة على المحاكي فقط
import { createSign } from 'node:crypto';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
let SA = null;
if (!EMU) {
  try { SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ''); } catch (e) { SA = null; }
  if (!SA || !SA.client_email || !SA.private_key) {
    console.error('❌ السر FIREBASE_SERVICE_ACCOUNT مو موجود أو مو صحيح — ضيفه من Settings ← Secrets and variables ← Actions');
    process.exit(1);
  }
}
export const PROJECT = process.env.PROJECT_ID || (SA && SA.project_id) || 'sora3a-system';
export const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `${EMU ? 'http://' + EMU : 'https://firestore.googleapis.com'}/v1/`;

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let tok = null, tokExp = 0;
async function token() {
  if (EMU) return 'owner';
  if (tok && Date.now() < tokExp - 60000) return tok;
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + claims).sign(SA.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claims + '.' + b64u(sig) });
  const j = await r.json();
  if (!j.access_token) throw new Error('تعذّر تسجيل الدخول بحساب الخدمة: ' + JSON.stringify(j));
  tok = j.access_token; tokExp = Date.now() + (j.expires_in || 3600) * 1000;
  return tok;
}

export async function api(path, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.ok) return r.json();
    const t = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    throw new Error(`Firestore ${r.status}: ${t.slice(0, 500)}`);
  }
}

const num = (v) => (Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v });

// كل مستندات مجموعة (تحت parent)، وإذا field: بس اللي field بين from و to — صفحات من ٥٠٠
export async function list(parent, collectionId, { field, from, to } = {}) {
  const out = [];
  let cursor = null;
  for (;;) {
    const sq = { from: [{ collectionId }], limit: 500 };
    if (field) {
      sq.where = { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: num(from) } },
        { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN', value: num(to) } }] } };
      sq.orderBy = [{ field: { fieldPath: field }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
    } else sq.orderBy = [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
    if (cursor) sq.startAt = { values: cursor, before: false };
    const res = await api(`${parent}:runQuery`, { structuredQuery: sq });
    const docs = res.filter((r) => r.document).map((r) => r.document);
    out.push(...docs);
    if (docs.length < 500) break;
    const last = docs[docs.length - 1];
    cursor = field ? [last.fields[field], { referenceValue: last.name }] : [{ referenceValue: last.name }];
  }
  return out;
}

// نكتب مستندات (نسخة كاملة لكل مستند). missingOnly: بس اللي انحذفت (ما نغطي على تعديلات أحدث)
export async function write(docs, { missingOnly = true } = {}) {
  let done = 0, skipped = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const writes = docs.slice(i, i + 400).map((d) => ({ update: { name: d.name, fields: d.fields || {} }, ...(missingOnly ? { currentDocument: { exists: false } } : {}) }));
    const r = await api(`${ROOT}:batchWrite`, { writes });
    (r.status || []).forEach((s) => { if (!s.code) done++; else skipped++; });
  }
  return { done, skipped };
}
