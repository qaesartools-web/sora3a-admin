// نسخة احتياطية لبيانات «سرعة» — تشتغل كل ليلة من GitHub Actions
//  يومي: طلبات أمس + الورديات والمصروفات وطلبات المنيو وسجل العمليات لأمس   → data/daily/YYYY-MM-DD.json.gz
//  أسبوعي (الجمعة) أو --core: المطاعم والحسابات والمنيو والزبائن والكباتن…   → data/core/YYYY-MM-DD.json.gz
//  --full: كل الطلبات من أول يوم (أول مرة)                                 → data/orders/YYYY-MM.json.gz
//  --day=YYYY-MM-DD: نسخة يوم معيّن بدل أمس
// كل ملف: { kind, day, createdAt, collections: { "<مسار>": [مستندات Firestore كما هي] } }
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ROOT, list } from './firestore.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = args.out || 'data';
const BAG = 3 * 3600000;                                             // توقيت بغداد
const dayStr = (ms) => new Date(ms + BAG).toISOString().slice(0, 10);
const dayStartMs = (d) => Date.parse(d + 'T00:00:00Z') - BAG;
const day = args.day || dayStr(Date.now() - 86400000);              // أمس
const from = dayStartMs(day), to = from + 86400000;

function save(path, kind, collections) {
  const count = Object.values(collections).reduce((s, l) => s + l.length, 0);
  const body = JSON.stringify({ kind, day, createdAt: new Date().toISOString(), count, collections });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(body, { level: 9 }));
  console.log(`✅ ${path} — ${count} مستند`);
  return count;
}
const idOf = (name) => name.slice(name.lastIndexOf('/') + 1);

const restaurants = await list(ROOT, 'restaurants');
const rids = restaurants.map((d) => idOf(d.name));
console.log(`🍽️ ${rids.length} مطعم — نسخة يوم ${day}`);

// ── اليومي ──
const daily = {
  orders: await list(ROOT, 'orders', { field: 'createdAtMs', from, to }),
  webOrders: await list(ROOT, 'webOrders', { field: 'createdAtMs', from, to }),
  auditLog: await list(ROOT, 'auditLog', { field: 'atMs', from, to }),
};
for (const rid of rids) {
  const sh = await list(`${ROOT}/restaurants/${rid}`, 'shifts', { field: 'openedAtMs', from, to });
  if (sh.length) daily[`restaurants/${rid}/shifts`] = sh;
  const ex = await list(`${ROOT}/accounting/${rid}`, 'expenses', { field: 'createdAtMs', from, to });
  if (ex.length) daily[`accounting/${rid}/expenses`] = ex;
}
save(`${OUT}/daily/${day}.json.gz`, 'daily', daily);

// ── الأسبوعي: كل شي غير الطلبات (والصور) ──
const friday = new Date(from + BAG).getUTCDay() === 4;   // أمس خميس → اليوم جمعة
if (args.core || args.full || friday) {
  const core = { restaurants };
  for (const c of ['users', 'staff', 'captains', 'accounting', 'lineTokens', 'leads', 'config', 'publicMenus', 'deviceReqs']) core[c] = await list(ROOT, c);
  for (const rid of rids) {
    for (const c of ['menu', 'settings', 'loyalty', 'devices', 'customers', 'shifts']) {
      const l = await list(`${ROOT}/restaurants/${rid}`, c);
      if (l.length) core[`restaurants/${rid}/${c}`] = l;
    }
    const ex = await list(`${ROOT}/accounting/${rid}`, 'expenses');
    if (ex.length) core[`accounting/${rid}/expenses`] = ex;
  }
  save(`${OUT}/core/${day}.json.gz`, 'core', core);
}

// ── أول مرة: كل الطلبات، ملف لكل شهر ──
if (args.full) {
  const all = await list(ROOT, 'orders');
  const months = {};
  for (const d of all) {
    const t = Number((d.fields.createdAtMs || {}).integerValue ?? (d.fields.createdAtMs || {}).doubleValue ?? 0);
    const m = t ? dayStr(t).slice(0, 7) : 'no-date';
    (months[m] = months[m] || []).push(d);
  }
  for (const [m, l] of Object.entries(months)) save(`${OUT}/orders/${m}.json.gz`, 'orders-month', { orders: l });
  console.log(`📦 كل الطلبات: ${all.length}`);
}
console.log('✔️ خلصت النسخة');
