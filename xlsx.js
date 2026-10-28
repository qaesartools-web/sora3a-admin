// مولّد إكسل (.xlsx) حقيقي بدون أي مكتبة — يفتح بإكسل/كوكل شيت بدون تحذير، بهوية «سرعة».
// الاستعمال: xlsxBase64({ title, subtitle, meta:[..], sheetName, columns:[{h,w,t}], rows:[[..]], totals:[..] }) → base64
//   أو عدة أوراق: xlsxBase64({ title, subtitle, meta, sheets: [{ name, subtitle?, meta?, columns, rows, totals? }] })
// t للعمود: 'text' | 'num' | 'money' (افتراضي text) — والخلية تگدر تكون { v, t } لنوع خاص بيها
// totals: سطر «المجموع» عريض بآخر الجدول (null = خلية فارغة)

const te = new TextEncoder();
// (رموز التحكم ممنوعة بـ XML — إذا بقت بنص صنف أو ملاحظة، إكسل يرفض الملف كله)
const xe = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// ── CRC32 ──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP (store، بدون ضغط) ──
function zip(files) {
  const enc = files.map((f) => ({ name: te.encode(f.name), data: typeof f.data === 'string' ? te.encode(f.data) : f.data }));
  const out = []; const push = (a) => { for (let i = 0; i < a.length; i++) out.push(a[i] & 0xFF); };
  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF]; const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  const TM = 0, DT = 0x5021;   // وقت 00:00، تاريخ 2020-01-01 (تاريخ DOS صالح — بعض القرّاء يرفضون 0)
  const central = []; let offset = 0;
  for (const f of enc) {
    const crc = crc32(f.data), n = f.data.length;
    push(u32(0x04034b50)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(TM)); push(u16(DT));
    push(u32(crc)); push(u32(n)); push(u32(n)); push(u16(f.name.length)); push(u16(0));
    push(f.name); push(f.data);
    central.push({ crc, n, name: f.name, offset });
    offset = out.length;
  }
  const cdStart = out.length;
  for (const c of central) {
    push(u32(0x02014b50)); push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(TM)); push(u16(DT));
    push(u32(c.crc)); push(u32(c.n)); push(u32(c.n)); push(u16(c.name.length)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0)); push(u32(0)); push(u32(c.offset));
    push(c.name);
  }
  const cdSize = out.length - cdStart;
  push(u32(0x06054b50)); push(u16(0)); push(u16(0)); push(u16(central.length)); push(u16(central.length)); push(u32(cdSize)); push(u32(cdStart)); push(u16(0));
  return Uint8Array.from(out);
}

const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26; } return s; };

// خلية: الأنماط 4/7 مبلغ/رقم، 5 نص — والعريضة (سطر المجموع) 10/9/8
function cell(ref, v, ty, bold) {
  if (v && typeof v === 'object' && 'v' in v) { ty = v.t || ty; v = v.v; }
  if (ty === 'num' || ty === 'money') return `<c r="${ref}" s="${bold ? (ty === 'money' ? 10 : 9) : (ty === 'money' ? 4 : 7)}"><v>${Number(v) || 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${bold ? 8 : 5}"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
}

function sheetXml(r) {
  const cols = r.columns || [];
  const ncol = Math.max(1, cols.length);
  const last = colLetter(ncol - 1);
  const colsXml = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>`;
  const rows = []; let rn = 0; const merges = [];
  // دمج خلية وحدة (A1:A1) إكسل يعتبره تلف
  const band = (text, style, h) => { rn++; if (ncol > 1) merges.push(`A${rn}:${last}${rn}`); rows.push(`<row r="${rn}"${h ? ` ht="${h}" customHeight="1"` : ''}><c r="A${rn}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xe(text)}</t></is></c></row>`); };
  band(r.title || 'سرعة', 1, 30);
  if (r.subtitle) band(r.subtitle, 2, 22);
  (r.meta || []).forEach((m) => band(m, 6, 18));
  rn++; rows.push(`<row r="${rn}"></row>`);   // سطر فاصل
  // رأس الأعمدة
  rn++; const head = rn;
  rows.push(`<row r="${rn}">${cols.map((c, i) => `<c r="${colLetter(i)}${rn}" t="inlineStr" s="3"><is><t xml:space="preserve">${xe(c.h)}</t></is></c>`).join('')}</row>`);
  // البيانات
  for (const row of (r.rows || [])) { rn++; rows.push(`<row r="${rn}">${cols.map((c, i) => cell(colLetter(i) + rn, row[i], c.t)).join('')}</row>`); }
  if (r.totals) { rn++; rows.push(`<row r="${rn}">${cols.map((c, i) => cell(colLetter(i) + rn, r.totals[i] == null ? '' : r.totals[i], r.totals[i] == null ? 'text' : c.t, true)).join('')}</row>`); }
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  // رأس الأعمدة يبقى ثابت وانت تنزل بالجدول
  const view = `<sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="${head}" topLeftCell="A${head + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${head + 1}" sqref="A${head + 1}"/></sheetView>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="16"/>${colsXml}<sheetData>${rows.join('')}</sheetData>${mergeXml}</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0&quot; د.ع&quot;"/></numFmts><fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FFDDE3FF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F6BED"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E6F0"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF4F6BED"/></top><bottom style="thin"><color rgb="FF4F6BED"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="5" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="3" fontId="5" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="5" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function toB64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

// اسم الورقة: إكسل يمنع [ ] : * ? / \ وما يقبل أكثر من 31 حرف ولا اسمين متشابهين
const BAD_SHEET = /[[\]:*?/\\]/g;
export function xlsxBytes(report) {
  const list = report.sheets && report.sheets.length ? report.sheets : [{ name: report.sheetName, columns: report.columns, rows: report.rows, totals: report.totals }];
  const used = new Set();
  const sheets = list.map((s, i) => {
    const n = String(s.name || '').replace(BAD_SHEET, '-').trim().slice(0, 28) || 'Sheet' + (i + 1);
    let u = n; for (let k = 2; used.has(u.toLowerCase()); k++) u = n.slice(0, 26) + ' ' + k;
    used.add(u.toLowerCase());
    return { title: s.title || report.title, subtitle: s.subtitle != null ? s.subtitle : report.subtitle, meta: s.meta || report.meta, columns: s.columns, rows: s.rows, totals: s.totals, name: u };
  });
  const N = sheets.length;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${N + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files);
}

export const xlsxBase64 = (report) => toB64(xlsxBytes(report));
