// The live Excel workbook, built here as one .xlsx and uploaded in one call.
//
// Owner 2026-11-03: making the workbook "took way too long" and came out with
// no formatting, unlike the app's own Export data workbook (PDFViewer.jsx
// handleExportSurveyToExcel). Setting a sheet up through Graph took five or six
// calls per category; this file carries everything at once and wears the same
// look as the export:
//   * header row: grey fill, thin borders, centred, wrapped; frozen;
//   * Row ID column hidden, text columns as text ("@"), so 00123 stays 00123;
//   * the export's column widths and centring;
//   * drop-downs on pick-one answers and on Entity;
//   * colours: answers by tone (green / red / grey), each entity in its own
//     colour, a repeated item name in red, and thin borders on every row that
//     has an item, so rows the sync adds later look like the export's.
// Rows are written by the first sync round, as before.
//
// No Excel library here: the edge function writes the parts by hand and zips
// them stored (uncompressed), which Excel, Excel for the web and Graph all open.

import { trackingChoices } from '../layout.js';

export const FORMAT_ROWS = 1000; // matches the export and the Graph drop-downs

const TEXT_KINDS = new Set(['choice', 'text', 'many']);
const isTextColumn = (col) => ['rowId', 'changedBy', 'item', 'entity', 'notes', 'status', 'assignee'].includes(col?.key)
  || (String(col?.key || '').startsWith('answer:') && TEXT_KINDS.has(col.item?.kind || 'choice'));
const isChoiceColumn = (col) => String(col?.key || '').startsWith('answer:') && (!col.item?.kind || col.item.kind === 'choice');
const CENTRED = new Set(['rowId', 'changedBy', 'changedDate', 'item', 'entity', 'status', 'due']);
const isCentred = (col) => CENTRED.has(col?.key) || String(col?.key || '').startsWith('answer:');

// The export's answer colours by tone (src/services/answerSets.js TONE_FILL).
const DEFAULT_ANSWER_FILLS = Object.freeze([
  { value: 'Y', argb: 'FFCEEED0' }, { value: 'N', argb: 'FFF6C9CE' }, { value: 'N/A', argb: 'FFA6A6A6' },
]);

export function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

const esc = (text) => String(text ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An entity colour (#rgb, #rrggbb, rgb(), rgba()) as Excel ARGB, or null. */
export function excelArgb(color) {
  const c = String(color || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return `FF${m[1].toUpperCase()}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return `FF${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) return `FF${[m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return null;
}

/**
 * Excel sheet names: 31 characters, none of []:*?/\, no edge apostrophes, unique.
 * `taken`: names already in the workbook, which new names keep clear of.
 */
export function excelSheetNames(titles, taken = []) {
  const used = new Set((taken || []).map((t) => String(t).toLowerCase()));
  return titles.map((title, i) => {
    let base = String(title || '').replace(/[[\]:*?/\\]/g, '-').replace(/^'+|'+$/g, '').trim() || `Sheet ${i + 1}`;
    base = base.slice(0, 31).trim();
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// The drop-down list for a column, as Excel takes it, or null (same rule as
// msgraph.js dropDownChoices: 255 characters at most, no commas inside).
function dropDown(column, layout) {
  let choices = null;
  if (column.key === 'entity') choices = (layout?.entities || []).map((e) => e?.name).filter(Boolean);
  else if (isChoiceColumn(column)) choices = layout?.answerValues || null;
  else choices = trackingChoices(column, layout);
  if (!choices?.length || choices.some((c) => String(c).includes(','))) return null;
  const source = choices.map(String).join(',');
  return source.length <= 255 ? source : null;
}

const fitWidth = (text) => Math.min(36, Math.max(15, String(text ?? '').length + 2));
function widthOf(column) {
  switch (column.key) {
    case 'rowId': return 16;
    case 'changedBy': case 'changedDate': case 'entity': return 15;
    case 'item': return 24;
    case 'notes': return 50;
    default: return fitWidth(column.header);
  }
}

// ---- styles ---------------------------------------------------------------
// cellXfs: 0 default, 1 header, 2 text, 3 text centred, 4 centred.
// dxfs (conditional formats): 0 thin borders, 1 repeated item, then one per
// answer fill, then one per entity colour.
function stylesXml(fills) {
  const thin = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom>';
  const dxfs = [
    `<dxf><border>${thin}</border></dxf>`,
    '<dxf><font><color rgb="FF9B0007"/></font><fill><patternFill><bgColor rgb="FFFFC7CF"/></patternFill></fill></dxf>',
    ...fills.map((argb) => `<dxf><fill><patternFill><bgColor rgb="${argb}"/></patternFill></fill></dxf>`),
  ];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFBFBFBF"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}<diagonal/></border></borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="5">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="49" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + `<dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs>`
    + '</styleSheet>';
}

const columnStyle = (col) => (isTextColumn(col) ? (isCentred(col) ? 3 : 2) : (isCentred(col) ? 4 : 0));

function sheetXml(scope, layout, { answerDxf, entityDxf }) {
  const columns = scope.columns || [];
  const width = columns.length;
  const last = columnLetter(Math.max(width - 1, 0));
  const rows = FORMAT_ROWS;
  const cols = columns.map((col, i) => {
    const hidden = col.key === 'rowId' ? ' hidden="1"' : '';
    return `<col min="${i + 1}" max="${i + 1}" width="${widthOf(col)}" style="${columnStyle(col)}" customWidth="1"${hidden}/>`;
  }).join('');
  const header = columns.map((col, i) => `<c r="${columnLetter(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(col.header)}</t></is></c>`).join('');

  const cf = [];
  let priority = 1;
  const itemAt = columns.findIndex((c) => c.key === 'item');
  if (itemAt >= 0) {
    const L = columnLetter(itemAt);
    cf.push(`<conditionalFormatting sqref="${L}2:${L}${rows}"><cfRule type="expression" dxfId="1" priority="${priority++}"><formula>AND(${L}2&lt;&gt;"",COUNTIF($${L}$2:$${L}$${rows},${L}2)&gt;1)</formula></cfRule></conditionalFormatting>`);
  }
  columns.forEach((col, i) => {
    const L = columnLetter(i);
    const ref = `${L}2:${L}${rows}`;
    const rules = col.key === 'entity' ? entityDxf : isChoiceColumn(col) ? answerDxf : [];
    if (!rules.length) return;
    cf.push(`<conditionalFormatting sqref="${ref}">${rules.map(({ value, dxfId }) => (
      `<cfRule type="cellIs" dxfId="${dxfId}" priority="${priority++}" operator="equal"><formula>"${esc(String(value).replace(/"/g, '""'))}"</formula></cfRule>`
    )).join('')}</conditionalFormatting>`);
  });

  // Thin borders on every row that has something in it, like the export's
  // rows. Last on purpose: Excel adds every matching rule together, but
  // Google Sheets and LibreOffice use only the first match per cell, and
  // there the answer colours matter more than the lines.
  if (width) {
    cf.push(`<conditionalFormatting sqref="A2:${last}${rows}"><cfRule type="expression" dxfId="0" priority="${priority++}"><formula>COUNTA($A2:$${last}2)&gt;0</formula></cfRule></conditionalFormatting>`);
  }

  const validations = [];
  columns.forEach((col, i) => {
    const source = dropDown(col, layout);
    if (!source) return;
    const L = columnLetter(i);
    // No error box: anything typed still syncs; the merge checks the values.
    validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${L}2:${L}${rows}"><formula1>"${esc(source.replace(/"/g, '""'))}"</formula1></dataValidation>`);
  });

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="A1:${last}1"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${width ? `<row r="1">${header}</row>` : ''}</sheetData>`
    + cf.join('')
    + (validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : '')
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
}

/**
 * The whole live workbook for `layout` (layout.js shape). `answerFills` are the
 * template's answer colours ({ value, argb }, answerSets.js excelAnswerFills);
 * Y / N / N/A by tone when left out.
 * @returns {{ bytes: Uint8Array, sheetNames: string[] }}
 */
export function buildLiveWorkbook(layout, { answerFills } = {}) {
  const scopes = layout?.scopes || [];
  const sheetNames = excelSheetNames(scopes.map((s) => s.title));
  const fills = [];
  const fillIndex = (argb) => {
    const at = fills.indexOf(argb);
    if (at >= 0) return at + 2;
    fills.push(argb);
    return fills.length + 1;
  };
  const answers = (Array.isArray(answerFills) && answerFills.length ? answerFills : DEFAULT_ANSWER_FILLS)
    .filter((a) => a && a.value != null && /^[0-9A-F]{8}$/i.test(String(a.argb || '')))
    .filter((a) => (layout?.answerValues || []).length === 0 || layout.answerValues.map(String).includes(String(a.value)))
    .map((a) => ({ value: String(a.value), dxfId: fillIndex(String(a.argb).toUpperCase()) }));
  const entities = (layout?.entities || [])
    .map((e) => ({ value: e?.name, argb: excelArgb(e?.color) }))
    .filter((e) => e.value && e.argb)
    .map((e) => ({ value: String(e.value), dxfId: fillIndex(e.argb) }));

  const parts = [];
  const n = Math.max(scopes.length, 1);
  const sheetFiles = Array.from({ length: n }, (_, i) => `xl/worksheets/sheet${i + 1}.xml`);
  parts.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheetFiles.map((f) => `<Override PartName="/${f}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>']);
  parts.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
  const names = scopes.length ? sheetNames : ['Sheet1'];
  const printTitles = names.map((name, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(name.replace(/'/g, "''"))}'!$1:$1</definedName>`).join('');
  parts.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + (scopes.length ? `<definedNames>${printTitles}</definedNames>` : '')
    + '</workbook>']);
  parts.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheetFiles.map((f, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${f.replace('xl/', '')}"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>']);
  parts.push(['xl/styles.xml', stylesXml(fills)]);
  if (scopes.length) {
    scopes.forEach((scope, i) => parts.push([sheetFiles[i], sheetXml(scope, layout, { answerDxf: answers, entityDxf: entities })]));
  } else {
    parts.push([sheetFiles[0], '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>']);
  }
  return { bytes: zipStored(parts), sheetNames: names };
}

// ---- zip (stored) --------------------------------------------------------------

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** [name, text] pairs as a zip of stored (uncompressed) entries. */
export function zipStored(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name);
    const data = typeof text === 'string' ? encoder.encode(text) : text;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Reads back a zip made by zipStored: { name: text }. For tests and the e2e fake. */
export function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = {};
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    out[name] = decoder.decode(bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}
