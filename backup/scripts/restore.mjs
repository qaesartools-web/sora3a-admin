// استرجاع من نسخة احتياطية
//   node scripts/restore.mjs data/daily/2026-10-09.json.gz                    ← تجربة بس: يعرض شنو راح يرجع (ما يكتب شي)
//   node scripts/restore.mjs <ملف> --mode=missing                              ← يرجّع بس المستندات المحذوفة (الأسلم)
//   node scripts/restore.mjs <ملف> --mode=overwrite                            ← يرجّع النسخة فوق الموجود (يمسح التعديلات الأحدث!)
//   --only=orders,restaurants/R1/shifts                                       ← بس هذني المجموعات
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { ROOT, write } from './firestore.mjs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const mode = args.mode || 'dry';
const only = args.only ? String(args.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
if (!files.length) { console.error('اكتب مسار ملف النسخة'); process.exit(1); }
if (!['dry', 'missing', 'overwrite'].includes(mode)) { console.error('mode لازم يكون dry أو missing أو overwrite'); process.exit(1); }

let docs = [];
for (const f of files) {
  const j = JSON.parse(gunzipSync(readFileSync(f)).toString('utf8'));
  for (const [col, list] of Object.entries(j.collections || {})) {
    if (only && !only.includes(col)) continue;
    console.log(`  ${col}: ${list.length}`);
    // نفس المشروع اللي نكتب بيه (لو انتقلنا لمشروع ثاني)
    docs.push(...list.map((d) => ({ ...d, name: d.name.replace(/^projects\/[^/]+\/databases\/\(default\)\/documents/, ROOT) })));
  }
}
console.log(`📄 ${docs.length} مستند بالنسخة`);
if (mode === 'dry') { console.log('🧪 تجربة بس — ما انكتب شي. للاسترجاع: --mode=missing (المحذوف بس) أو --mode=overwrite'); process.exit(0); }
const r = await write(docs, { missingOnly: mode === 'missing' });
console.log(`✅ انكتب ${r.done}${mode === 'missing' ? ` — وتخطّينا ${r.skipped} موجود أصلاً` : ''}${r.skipped && mode !== 'missing' ? ` — فشل ${r.skipped}` : ''}`);
