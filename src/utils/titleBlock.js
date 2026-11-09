// Sheet number and revision from a drawing's title block (Nightly flag
// 'sheet-revisions', Drawboard Projects trial audit 2026-11-09). Drawboard
// reads the title block of each uploaded sheet and files a sheet whose number
// it already has as a new revision. This file is the pure part: it takes the
// page's text pieces (already in display space, y down) and the file name.
//
// A text piece: { str, x, y, w, h } with x/y the top-left corner and h the
// font height, in PDF points on the page as shown (rotation applied).

// One or two discipline letters, an optional separator, then the number:
// A-101, A101, A 101, M-2.01, FP-101, S-201A.
const SHEET_RE = /^([A-Z]{1,2})[-. ]?(\d{1,3}(?:\.\d{1,3})?)([A-Z])?$/;
// Short words a drawing also prints before a number, never a sheet prefix.
const NOT_A_PREFIX = new Set(['NO', 'OF', 'ID', 'PG', 'PO', 'RM', 'EL', 'CT', 'DT', 'TO', 'AT', 'BY', 'OR', 'IN', 'FT', 'SF', 'LF', 'EA', 'GA', 'HR', 'MM', 'CM', 'KW', 'KV', 'HP', 'PH']);
const SHEET_LABEL_RE = /^(sheet|drawing|dwg)\.?\s*(no\.?|number|num\.?|#)?\s*:?$/i;
const SHEET_INLINE_RE = /^(?:sheet|drawing|dwg)\.?\s*(?:no\.?|number|num\.?|#)\s*:?\s*(.+)$/i;
const REV_LABEL_RE = /^rev(?:ision)?\.?\s*(?:no\.?|#)?\s*:?$/i;
const REV_INLINE_RE = /^rev(?:ision)?\.?\s*(?:no\.?|#)?\s*:?\s*([A-Z0-9]{1,3})$/i;
const REV_VALUE_RE = /^[A-Z0-9]{1,3}$/;
// Next to a "Sheet number" label a sheet can be named any way: SEC-A01, E001.
const LOOSE_SHEET_RE = /^[A-Z0-9][A-Z0-9.\-_/ ]{0,15}$/i;

/** "A-101", "a101", "A.101" and "A 101" all read as "A101"; null if not a sheet number. */
export function normalizeSheetNumber(value) {
  const m = SHEET_RE.exec(String(value ?? '').trim().toUpperCase());
  if (!m || NOT_A_PREFIX.has(m[1])) return null;
  return `${m[1]}${m[2]}${m[3] || ''}`;
}

// A labelled value: the strict form when it fits, else any short code with a
// digit in it (not a date, not "1 of 5").
function normalizeLabelledSheet(value) {
  const raw = String(value ?? '').trim();
  const strict = normalizeSheetNumber(raw);
  if (strict) return strict;
  if (!LOOSE_SHEET_RE.test(raw) || !/\d/.test(raw) || !/[A-Z]/i.test(raw)) return null;
  if (/\bof\b/i.test(raw) || /\d{1,4}[/-]\d{1,2}[/-]\d{2,4}/.test(raw)) return null;
  return raw.toUpperCase().replace(/[\s_-]+/g, '');
}

/** The sheet number the way it is usually printed: "A-101". */
export function displaySheetNumber(normalized) {
  const m = /^([A-Z]{1,2})(\d.*)$/.exec(String(normalized || ''));
  return m ? `${m[1]}-${m[2]}` : String(normalized || '');
}

function stem(fileName) {
  return String(fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** Sheet number and revision written in a file name, e.g. "A-101 Floor Plan rev B.pdf". */
export function readSheetFromFileName(fileName) {
  const name = stem(fileName);
  let sheetNumber = null;
  const sheetRe = /(?:^|[\s_()[\],-])([A-Za-z]{1,2})([-. ]?)(\d{1,3}(?:\.\d{1,3})?)([A-Za-z])?(?=$|[\s_()[\],-])/g;
  for (let m = sheetRe.exec(name); m; m = sheetRe.exec(name)) {
    const letters = m[1].toUpperCase();
    // "v2", "r3": a version or revision tag, not a sheet.
    if (!m[2] && (letters === 'V' || letters === 'R')) continue;
    if (m[3].replace('.', '').length < 2) continue;
    const n = normalizeSheetNumber(`${letters}${m[3]}${m[4] || ''}`);
    if (n) { sheetNumber = n; break; }
  }
  const rev = /(?:^|[\s_.()-])(?:rev(?:ision)?|r)[\s._-]?([A-Za-z0-9]{1,3})(?=$|[\s_.()-])/i.exec(name);
  return { sheetNumber, revision: rev ? rev[1].toUpperCase() : null };
}

function median(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  return sorted[Math.floor(sorted.length / 2)];
}

// The title block sits along the right edge or the bottom of a drawing.
function inTitleArea(p, page) {
  return p.x >= page.width * 0.6 || p.y >= page.height * 0.72;
}

function inCorner(p, page) {
  return p.x >= page.width * 0.6 && p.y >= page.height * 0.55;
}

function sameLine(a, b) {
  return Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) <= Math.max(a.h, b.h) * 0.6;
}

// A value printed next to its label: after it along the line or under it,
// in either reading direction (title blocks often run sideways).
function nearLabel(label, p) {
  const unit = Math.max(label.h, 4);
  const gapX = Math.max(0, p.x - (label.x + label.w), label.x - (p.x + p.w));
  const gapY = Math.max(0, p.y - (label.y + label.h), label.y - (p.y + p.h));
  if (gapX > unit * 6 || gapY > unit * 6) return false;
  return p.x >= label.x - unit && p.y >= label.y - unit;
}

// pdf.js can split "A-101" into "A-" and "101": also try each piece joined
// with the next one on the same line.
function candidatePieces(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    const str = String(a.str || '').trim();
    if (str) out.push({ ...a, str });
    const b = items[i + 1];
    if (!b || !str) continue;
    const bStr = String(b.str || '').trim();
    if (!bStr || !sameLine(a, b)) continue;
    const gap = b.x - (a.x + a.w);
    if (gap < -a.h || gap > a.h * 0.6) continue;
    out.push({ str: `${str}${gap > a.h * 0.15 ? ' ' : ''}${bStr}`, x: a.x, y: Math.min(a.y, b.y), w: b.x + b.w - a.x, h: Math.max(a.h, b.h) });
  }
  return out;
}

function revRank(value) {
  if (/^\d+$/.test(value)) return Number(value);
  // Letters sort after numbers only within their own kind; A < B < ... < Z < AA.
  return value.split('').reduce((n, ch) => n * 27 + (ch.charCodeAt(0) - 64), 0);
}

function readRevision(pieces, page) {
  const area = pieces.filter((p) => inTitleArea(p, page));
  let best = null;
  const offer = (value) => {
    const v = String(value).toUpperCase();
    if (!best || revRank(v) > revRank(best)) best = v;
  };
  // "Revision 2" written out, maybe several times in a revision table: the
  // latest is the highest.
  for (const p of area) {
    const m = REV_INLINE_RE.exec(p.str);
    if (m && !REV_LABEL_RE.test(p.str)) offer(m[1]);
  }
  if (best) return best;
  const labels = area.filter((p) => REV_LABEL_RE.test(p.str));
  for (const label of labels) {
    const unit = Math.max(label.h, 4);
    const values = area.filter((p) => p !== label && REV_VALUE_RE.test(p.str) && !REV_LABEL_RE.test(p.str) && (
      (sameLine(label, p) && p.x > label.x && p.x - (label.x + label.w) <= unit * 6)
      // A revision table: the REV column holds one row per issue; the
      // latest is the highest.
      || (p.y > label.y && p.y - label.y <= unit * 12 && Math.abs((p.x + p.w / 2) - (label.x + label.w / 2)) <= unit * 2)
    ));
    for (const v of values) offer(v.str);
  }
  return best;
}

/**
 * Read the sheet number and revision from a page's text pieces. Returns
 * { sheetNumber, revision } (normalized sheet number, or nulls).
 */
export function readTitleBlock(items, page) {
  const list = Array.isArray(items) ? items.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  if (!list.length || !page?.width || !page?.height) return { sheetNumber: null, sheetLabel: null, revision: null };
  const pieces = candidatePieces(list);
  const typical = median(list.map((p) => p.h));
  const labels = pieces.filter((p) => SHEET_LABEL_RE.test(p.str));

  // A labelled value wins; the nearest one to its label first.
  let labelled = null;
  for (const p of pieces) {
    const inline = SHEET_INLINE_RE.exec(p.str);
    if (inline) {
      const sheetNumber = normalizeLabelledSheet(inline[1]);
      if (sheetNumber) { labelled = { sheetNumber, label: inline[1].trim(), dist: 0 }; break; }
      continue;
    }
    if (SHEET_LABEL_RE.test(p.str) || REV_LABEL_RE.test(p.str)) continue;
    for (const l of labels) {
      if (l === p || !nearLabel(l, p)) continue;
      const sheetNumber = normalizeLabelledSheet(p.str);
      if (!sheetNumber) continue;
      const dist = Math.hypot(p.x - l.x, p.y - l.y);
      if (!labelled || dist < labelled.dist) labelled = { sheetNumber, label: p.str, dist };
    }
  }
  if (labelled) return { sheetNumber: labelled.sheetNumber, sheetLabel: labelled.label, revision: readRevision(pieces, page) };

  // No label: only a big, lone sheet number in the corner counts. A corner
  // full of small codes is a drawing (tags, panels), not a title block.
  const loose = pieces
    .map((p) => ({ p, sheetNumber: normalizeSheetNumber(p.str) }))
    .filter((c) => c.sheetNumber && inTitleArea(c.p, page));
  let best = null;
  if (loose.length <= 3) {
    for (const { p, sheetNumber } of loose) {
      if (!inCorner(p, page) || p.h < typical * 1.4) continue;
      if (!best || p.h > best.h) best = { sheetNumber, sheetLabel: p.str, h: p.h };
    }
  }
  return { sheetNumber: best?.sheetNumber ?? null, sheetLabel: best?.sheetLabel ?? null, revision: readRevision(pieces, page) };
}

/**
 * The newest open document that is the same sheet as the incoming file, or
 * null. A document's sheet comes from its saved title-block reading, else
 * from its file name. Same bytes never count (that is the duplicate path).
 */
export function pickSameSheetDocument(incoming, docs) {
  const sheet = incoming?.sheetNumber;
  if (!sheet) return null;
  const matches = (docs || []).filter((doc) => {
    if (!doc || doc.archived || doc.superseded_by) return false;
    if (incoming.sha && doc.content_sha256 && doc.content_sha256 === incoming.sha) return false;
    if (incoming.name && doc.name === incoming.name) return false;
    const own = normalizeSheetNumber(doc.sheet_number) || readSheetFromFileName(doc.name).sheetNumber;
    return own === sheet;
  });
  matches.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const doc = matches[0];
  if (!doc) return null;
  return { doc, revision: doc.sheet_revision || readSheetFromFileName(doc.name).revision || null };
}
