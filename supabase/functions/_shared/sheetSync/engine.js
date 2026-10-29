// The live sheet sync's merge: one round compares a spreadsheet with the
// survey's markers and the values both sides last agreed on (the baseline),
// and says what to write where. It is provider-neutral: Google Sheets and
// Microsoft 365 workbooks feed it the same grid and apply its plan.
//
// Rules (the same as the Excel sync, /mnt/project-files/excel-sync/audit.md):
//   * merge cell by cell: a cell changed on one side only takes that side;
//     different cells changed on both sides both land;
//   * only a cell changed on BOTH sides to DIFFERENT values is a conflict; it
//     holds just that row's disputed cells until someone picks "Keep mine" or
//     "Use the sheet's", and the choice touches only those cells;
//   * a hidden, signed Row ID column ties a row to its marker (Row-ID tokens
//     from _shared/matcher); a row with no valid Row ID is a new item;
//   * a row deleted in the sheet never deletes a marker: it is listed so a
//     person can put it back; a marker deleted in the app removes its row only
//     when nobody changed that row in the sheet.
//
// Pure apart from crypto (fingerprints, Row-ID signing): no network, no
// database, so node tests run it as is.
import { canonicalizeCellValue, computeRowFingerprints } from '../matcher/rowFingerprint.js';
import { detectFieldConflicts } from '../matcher/excelConflictDetect.js';
import { generateRowIdToken, parseRowIdToken, verifyRowIdSignature } from '../matcher/rowIdToken.js';
import { buildMarkerRowValues } from '../markerRowValues.js';
import { checklistItemKind, itemAnswerFor } from '../kitShape.js';
import { noteObjectOf } from '../surveyUndoApply.js';
import { columnIsEditable } from './layout.js';

const SCALAR_KEYS = ['changedBy', 'changedDate', 'item', 'entity', 'notes'];
const NUMBER_KINDS = new Set(['number', 'score', 'count']);
const MAX_TEXT = 5000;

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const isBlankRow = (row) => !Array.isArray(row) || row.every((c) => c == null || String(c).trim() === '');

/** A cell as the text the app saves (10 -> "10", true -> "TRUE"). */
export function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

const sameCell = (a, b) => canonicalizeCellValue(cellText(a)) === canonicalizeCellValue(cellText(b));

const getField = (rec, key) => (key.startsWith('answer:') ? (rec.answers || {})[key.slice(7)] : rec[key]);
const setField = (rec, key, value) => {
  if (key.startsWith('answer:')) rec.answers = { ...(rec.answers || {}), [key.slice(7)]: value };
  else rec[key] = value;
};
const getFp = (fps, key) => (key.startsWith('answer:') ? (fps?.answers || {})[key.slice(7)] : fps?.[key]) ?? null;
const setFp = (fps, key, value) => {
  if (key.startsWith('answer:')) {
    fps.answers = { ...(fps.answers || {}) };
    if (value == null) delete fps.answers[key.slice(7)];
    else fps.answers[key.slice(7)] = value;
  } else if (value == null) delete fps[key];
  else fps[key] = value;
};

const fieldsOf = (fps) => [
  ...SCALAR_KEYS.filter((k) => fps?.[k] != null),
  ...Object.keys(fps?.answers || {}).map((id) => `answer:${id}`),
];

const checklistOfScope = (scope) => scope.columns.filter((c) => c.key.startsWith('answer:')).map((c) => c.item);

/** The row values the app shows for a marker, in rowFingerprint's record shape. */
export function appRecordOf(marker, scope) {
  return buildMarkerRowValues({ marker, checklistItems: checklistOfScope(scope), moduleData: {} });
}

/** The value written into a cell for a field of an app record. */
export function cellValueFor(scope, key, rec) {
  const text = getField(rec, key) ?? '';
  if (key.startsWith('answer:') && text !== '') {
    const col = scope.columns.find((c) => c.key === key);
    if (col && NUMBER_KINDS.has(checklistItemKind(col.item))) {
      const n = Number(text);
      if (Number.isFinite(n)) return n;
    }
  }
  return String(text);
}

// Map a sheet's header row to the layout's columns. Headers are matched by
// text, ignoring case and outer spaces; repeated headers pair up in order.
function mapHeader(scope, headerRow) {
  const norm = (h) => cellText(h).trim().toLowerCase();
  const claimed = new Set();
  const colOfKey = new Map();
  for (const column of scope.columns) {
    const want = norm(column.header);
    for (let i = 0; i < (headerRow || []).length; i += 1) {
      if (!claimed.has(i) && norm(headerRow[i]) === want) {
        claimed.add(i);
        colOfKey.set(column.key, i);
        break;
      }
    }
  }
  return colOfKey;
}

// Turn one sheet cell into the app value for a field, or { error }.
function sheetValueToApp(layout, column, raw) {
  const text = cellText(raw).replace(/\r\n?/g, '\n');
  if (column.key === 'item' || column.key === 'notes') {
    return { value: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text };
  }
  if (column.key === 'entity') {
    const name = text.trim();
    if (!name) return { value: '', entity: null };
    const hit = layout.entities.find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
    return hit ? { value: hit.name, entity: hit } : { error: `"${name}" is not one of this survey's entities` };
  }
  if (column.key.startsWith('answer:')) {
    const kind = checklistItemKind(column.item);
    if (kind === 'choice') {
      const t = text.trim();
      if (!t) return { value: '' };
      const hit = layout.answerValues.find((v) => v.toLowerCase() === t.toLowerCase());
      return hit ? { value: hit } : { error: `"${t}" is not an answer for "${column.header}" (use ${layout.answerValues.join(', ')})` };
    }
    const value = itemAnswerFor(column.item, text);
    return value === null ? { error: `"${text.trim()}" does not fit "${column.header}"` } : { value };
  }
  return { error: 'read-only column' };
}

// Write one app-side field value onto a marker (a copy).
function applyFieldToMarker(marker, key, conv) {
  if (key === 'item') marker.name = conv.value;
  else if (key === 'notes') marker.note = { ...noteObjectOf(marker.note ?? marker.notes), text: conv.value };
  else if (key === 'entity') {
    if (conv.entity) {
      marker.entityId = conv.entity.id;
      marker.entityName = conv.entity.name;
      marker.entityColor = conv.entity.color;
    } else {
      delete marker.entityId;
      delete marker.entityName;
      delete marker.entityColor;
    }
  } else if (key.startsWith('answer:')) {
    const id = key.slice(7);
    const responses = { ...(marker.checklistResponses || {}) };
    const prior = { ...(responses[id] || {}) };
    if (conv.value === '') {
      delete prior.selection;
      if (Object.keys(prior).length) responses[id] = prior; else delete responses[id];
    } else {
      responses[id] = { ...prior, selection: conv.value };
    }
    marker.checklistResponses = responses;
  }
}

const displayOf = (value) => {
  const t = cellText(value);
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
};

/**
 * Plan one sync round.
 *
 * @param {object} args
 * @param {object} args.layout   buildSyncLayout output
 * @param {{sheets: Array<{sheetId:string, title:string, rows:any[][]}>}} args.grid
 *        the spreadsheet as read; rows[0] is the header row
 * @param {Object<string, object>} args.markers   live markers by id
 * @param {Object<string, {scopeId:string, fields:object}>} [args.baseline]
 *        per-marker field fingerprints both sides last agreed on
 * @param {object} [args.state]  link state: sheetIds, conflicts, choices,
 *        removedInSheet, tombstones, columnsSeen, problems
 * @param {{keyId:string, secret:string, signingDocId:string}} args.signing
 * @param {() => string} [args.newMarkerId]
 * @param {Date} [args.now]
 * @returns {Promise<object>} the plan (see bottom of the function)
 */
export async function planSheetRound({
  layout,
  grid,
  markers,
  baseline = {},
  state = {},
  signing,
  newMarkerId = () => `surveyMarker-${crypto.randomUUID()}`,
  now = new Date(),
}) {
  const nextBaseline = { ...baseline };
  const next = {
    sheetIds: { ...(state.sheetIds || {}) },
    conflicts: { ...(state.conflicts || {}) },
    choices: { ...(state.choices || {}) },
    removedInSheet: { ...(state.removedInSheet || {}) },
    tombstones: { ...(state.tombstones || {}) },
    columnsSeen: { ...(state.columnsSeen || {}) },
    problems: [],
    missingTabs: [],
  };
  const plan = {
    cellWrites: [], // { sheetId, title, row, col, value }   row/col are 0-based grid indexes
    verify: [],     // { sheetId, title, row, col, token }   the Row ID that must still be there
    appends: [],    // { sheetId, title, rows: any[][] }
    deletes: [],    // { sheetId, title, row, token }
    headerAdds: [], // { sheetId, title, col, header }
    markerWrites: {},
    summary: { toSheet: 0, toApp: 0, created: 0, appended: 0, deleted: 0, conflicts: 0 },
  };
  const nowIso = now.toISOString();
  const tokenFor = (markerId, scopeId) => generateRowIdToken({
    keyId: signing.keyId, secret: signing.secret, documentId: signing.signingDocId, scopeId, markerId,
  });
  const identify = async (token) => {
    const parsed = parseRowIdToken(token);
    if (!parsed.ok || parsed.documentId !== signing.signingDocId || parsed.keyId !== signing.keyId) return null;
    return (await verifyRowIdSignature(parsed, signing.secret)) ? parsed : null;
  };

  const sheetsById = new Map((grid?.sheets || []).map((s) => [String(s.sheetId), s]));
  const seenMarkers = new Set();
  const markersByScope = new Map();
  for (const [id, m] of Object.entries(markers || {})) {
    if (!m || typeof m !== 'object') continue;
    const scope = layout.scopes.find((s) => sameId(s.moduleId, m.moduleId) && sameId(s.categoryId, m.categoryId));
    if (!scope) continue;
    if (!markersByScope.has(scope.scopeId)) markersByScope.set(scope.scopeId, []);
    markersByScope.get(scope.scopeId).push(id);
  }

  for (const scope of layout.scopes) {
    const sheetId = next.sheetIds[scope.scopeId];
    const sheet = sheetId != null ? sheetsById.get(String(sheetId)) : null;
    if (!sheet) {
      next.missingTabs.push(scope.scopeId);
      continue;
    }
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const header = rows[0] || [];
    const colOfKey = mapHeader(scope, header);
    // New template columns (a checklist line added since the link) go on the
    // end of the header; a column someone deleted in the sheet stays deleted.
    const seen = new Set(next.columnsSeen[scope.scopeId] || []);
    let width = header.length;
    const addedKeys = new Set();
    for (const column of scope.columns) {
      if (!colOfKey.has(column.key) && !seen.has(column.key)) {
        addedKeys.add(column.key);
        plan.headerAdds.push({ sheetId: sheet.sheetId, title: sheet.title, col: width, header: column.header });
        colOfKey.set(column.key, width);
        width += 1;
      }
      seen.add(column.key);
    }
    next.columnsSeen[scope.scopeId] = [...seen];
    const rowIdCol = colOfKey.get('rowId');
    if (rowIdCol == null) {
      next.problems.push({ scopeId: scope.scopeId, message: `The Row ID column is missing from "${sheet.title}", so it was not synced.` });
      continue;
    }

    const sheetRecordOf = (row, base) => {
      const rec = { ...base, answers: { ...(base.answers || {}) } };
      for (const column of scope.columns) {
        if (!columnIsEditable(column) || !colOfKey.has(column.key)) continue;
        const raw = row[colOfKey.get(column.key)];
        setField(rec, column.key, cellText(raw));
      }
      return rec;
    };
    const writeCell = (rowIndex, key, value) => {
      const col = colOfKey.get(key);
      if (col == null) return;
      plan.cellWrites.push({ sheetId: sheet.sheetId, title: sheet.title, row: rowIndex, col, value });
    };
    const rowFor = async (markerId, marker) => {
      const rec = appRecordOf(marker, scope);
      const out = new Array(width).fill('');
      for (const column of scope.columns) {
        const col = colOfKey.get(column.key);
        if (col == null) continue;
        out[col] = column.key === 'rowId' ? await tokenFor(markerId, scope.scopeId) : cellValueFor(scope, column.key, rec);
      }
      return { out, rec };
    };

    const appendRows = [];
    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (isBlankRow(row)) continue;
      const token = cellText(row[rowIdCol]).trim();
      const parsed = token ? await identify(token) : null;
      const markerId = parsed?.markerId ?? null;

      // A row pasted here from another category's tab: left alone.
      if (markerId && parsed.scopeId !== scope.scopeId) continue;

      if (markerId && next.tombstones[markerId]) continue; // deleted in the app, row kept on purpose
      const marker = markerId ? markers[markerId] : null;

      // A valid Row ID with no marker and no baseline: the round that wrote it
      // stopped before the new marker was saved. Make the marker under that id.
      const recreate = markerId && !marker && !nextBaseline[markerId] && !plan.markerWrites[markerId];
      if (markerId && !marker && !recreate) {
        // Deleted in the app. Remove the row only if nobody changed it in the sheet.
        const base = nextBaseline[markerId];
        if (base) {
          const baseRec = {};
          const sheetRec = sheetRecordOf(row, baseRec);
          const sheetFps = (await computeRowFingerprints(sheetRec)).fieldFingerprints;
          const changed = scope.columns.some((c) => columnIsEditable(c) && colOfKey.has(c.key)
            && getFp(base.fields, c.key) != null && getFp(sheetFps, c.key) !== getFp(base.fields, c.key));
          if (changed) {
            next.tombstones[markerId] = nowIso;
          } else {
            plan.deletes.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, token, rowIdCol });
            plan.summary.deleted += 1;
          }
          delete nextBaseline[markerId];
        }
        continue;
      }

      if (marker && !(sameId(marker.moduleId, scope.moduleId) && sameId(marker.categoryId, scope.categoryId))) {
        // Moved to another category in the app: its new tab gets a row (it
        // has none there), and this one goes.
        plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, col: rowIdCol, token });
        plan.deletes.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, token, rowIdCol });
        plan.summary.deleted += 1;
        continue;
      }
      if (marker && !seenMarkers.has(markerId)) {
        seenMarkers.add(markerId);
        delete next.removedInSheet[markerId];
        plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, col: rowIdCol, token });
        await mergeRow({ markerId, marker, row, r });
        continue;
      }

      // No valid Row ID, or a second copy of a row: a new item from the sheet.
      const id = recreate ? markerId : newMarkerId();
      const conv = {};
      const fresh = {
        id,
        name: '',
        moduleId: scope.moduleId,
        categoryId: scope.categoryId,
        checklistResponses: {},
        note: {},
        changedBy: '',
        changedDate: nowIso,
        pageNumber: null,
        bounds: null,
        source: 'sheet',
      };
      for (const column of scope.columns) {
        if (!columnIsEditable(column) || !colOfKey.has(column.key)) continue;
        const c = sheetValueToApp(layout, column, row[colOfKey.get(column.key)]);
        if (c.error) {
          next.problems.push({ markerId: id, scopeId: scope.scopeId, message: c.error });
          continue;
        }
        conv[column.key] = c;
        applyFieldToMarker(fresh, column.key, c);
      }
      if (!fresh.name) fresh.name = 'New item';
      plan.markerWrites[id] = fresh;
      plan.summary.created += 1;
      const rec = appRecordOf(fresh, scope);
      const fps = (await computeRowFingerprints(rec)).fieldFingerprints;
      nextBaseline[id] = { scopeId: scope.scopeId, fields: fps };
      // The row gets its Row ID, and the app's own cells (dates, tidied values).
      plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, col: rowIdCol, token });
      if (!recreate) writeCell(r, 'rowId', await tokenFor(id, scope.scopeId));
      seenMarkers.add(id);
      for (const column of scope.columns) {
        if (column.key === 'rowId' || !colOfKey.has(column.key)) continue;
        if (columnIsEditable(column) && conv[column.key] === undefined) continue; // a bad value stays for the person to fix
        const want = cellValueFor(scope, column.key, rec);
        if (!sameCell(row[colOfKey.get(column.key)], want)) writeCell(r, column.key, want);
      }
    }

    // Markers of this category with no row.
    for (const markerId of markersByScope.get(scope.scopeId) || []) {
      if (seenMarkers.has(markerId)) continue;
      const base = nextBaseline[markerId];
      const putBack = next.choices[markerId] === 'putBack';
      if (base && base.scopeId === scope.scopeId && !putBack) {
        // Deleted in the sheet: never delete the marker; list it.
        if (!next.removedInSheet[markerId]) next.removedInSheet[markerId] = { at: nowIso, name: String(markers[markerId]?.name || '') };
        continue;
      }
      delete next.removedInSheet[markerId];
      delete next.choices[markerId];
      const { out, rec } = await rowFor(markerId, markers[markerId]);
      appendRows.push(out);
      nextBaseline[markerId] = { scopeId: scope.scopeId, fields: (await computeRowFingerprints(rec)).fieldFingerprints };
      seenMarkers.add(markerId);
      plan.summary.appended += 1;
    }
    if (appendRows.length) plan.appends.push({ sheetId: sheet.sheetId, title: sheet.title, rows: appendRows, width });

    // ---- one matched row -------------------------------------------------
    async function mergeRow({ markerId, marker, row, r }) {
      const base = nextBaseline[markerId]?.fields || null;
      const appRec = appRecordOf(marker, scope);
      const appFps = (await computeRowFingerprints(appRec)).fieldFingerprints;
      const sheetRec = sheetRecordOf(row, appRec);
      const sheetFps = (await computeRowFingerprints(sheetRec)).fieldFingerprints;
      const keys = scope.columns.filter((c) => c.key !== 'rowId').map((c) => c.key);
      // Fields the sheet does not show (column deleted or read-only) count as
      // unchanged there, so only the app's change to them is kept.
      const sheetSide = JSON.parse(JSON.stringify(sheetFps));
      for (const key of keys) {
        const column = scope.columns.find((c) => c.key === key);
        // A column added this round is blank in the sheet: nothing changed there yet.
        if (!columnIsEditable(column) || !colOfKey.has(key) || addedKeys.has(key)) {
          setFp(sheetSide, key, base ? getFp(base, key) : getFp(appFps, key));
        }
      }
      const { conflictFields, excelChangedFields } = detectFieldConflicts({
        baseline: base || {},
        appNow: appFps,
        excelIn: sheetSide,
      });
      const choice = next.choices[markerId];
      const conflicts = new Set(conflictFields.filter((k) => keys.includes(k)));
      const fromSheet = new Set(excelChangedFields.filter((k) => keys.includes(k) && !conflicts.has(k)));
      if (choice === 'sheet') conflicts.forEach((k) => fromSheet.add(k));
      if (choice === 'app' || choice === 'sheet') conflicts.clear();
      if (choice === 'app' || choice === 'sheet') delete next.choices[markerId];

      const updated = JSON.parse(JSON.stringify(marker));
      const bad = new Set();
      let appChanged = false;
      for (const key of fromSheet) {
        const column = scope.columns.find((c) => c.key === key);
        const conv = sheetValueToApp(layout, column, row[colOfKey.get(key)]);
        if (conv.error) {
          bad.add(key);
          next.problems.push({ markerId, scopeId: scope.scopeId, message: conv.error });
          continue;
        }
        if (canonicalizeCellValue(getField(appRec, key) ?? '') === canonicalizeCellValue(conv.value)) continue;
        applyFieldToMarker(updated, key, conv);
        appChanged = true;
        plan.summary.toApp += 1;
      }
      if (appChanged) {
        updated.changedDate = nowIso;
        plan.markerWrites[markerId] = updated;
      }

      const finalRec = appChanged ? appRecordOf(updated, scope) : appRec;
      const finalFps = appChanged ? (await computeRowFingerprints(finalRec)).fieldFingerprints : appFps;
      const nextFields = base ? JSON.parse(JSON.stringify(base)) : {};
      for (const key of keys) {
        if (conflicts.has(key) || bad.has(key)) continue;
        setFp(nextFields, key, getFp(finalFps, key));
        const col = colOfKey.get(key);
        if (col == null) continue;
        const want = cellValueFor(scope, key, finalRec);
        if (!sameCell(row[col], want)) {
          writeCell(r, key, want);
          if (!fromSheet.has(key)) plan.summary.toSheet += 1;
        }
      }
      // Keep answers the layout no longer has out of the baseline.
      for (const key of fieldsOf(nextFields)) if (!keys.includes(key)) setFp(nextFields, key, null);
      nextBaseline[markerId] = { scopeId: scope.scopeId, fields: nextFields };

      if (conflicts.size) {
        const fields = [...conflicts].sort();
        next.conflicts[markerId] = {
          scopeId: scope.scopeId,
          name: String(marker.name || ''),
          fields: fields.map((key) => ({
            key,
            header: scope.columns.find((c) => c.key === key)?.header || key,
            app: displayOf(getField(appRec, key)),
            sheet: displayOf(row[colOfKey.get(key)]),
          })),
          at: next.conflicts[markerId]?.at || nowIso,
        };
        plan.summary.conflicts += 1;
      } else {
        delete next.conflicts[markerId];
      }
    }
  }

  // Conflicts and lists of markers that no longer exist go away.
  for (const id of Object.keys(next.conflicts)) if (!markers[id]) delete next.conflicts[id];
  for (const id of Object.keys(next.removedInSheet)) if (!markers[id]) delete next.removedInSheet[id];
  for (const id of Object.keys(next.choices)) if (!markers[id]) delete next.choices[id];
  for (const id of Object.keys(nextBaseline)) {
    if (!markers[id] && !plan.markerWrites[id] && !next.tombstones[id]) delete nextBaseline[id];
  }

  return { ...plan, baseline: nextBaseline, state: next };
}
