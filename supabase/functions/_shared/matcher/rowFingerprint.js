/**
 * rowFingerprint.js — the full-row value-check layer for Excel ↔ Survey Marker sync
 * (STAGE1-IDENTITY-PLAN.md, the layer-2 "safety / what-changed / conflict" check).
 *
 * The visible Row ID column (rowIdToken.js) is the PRIMARY identity match. This module
 * is the SAFETY layer: it fingerprints the exact VISIBLE cell values of a row so the
 * app can (a) detect what changed since the last export, (b) detect a both-sides-changed
 * conflict, and (c) recover a lost/blank Row ID by content. It is NOT row-position truth.
 *
 * It operates on the visible values themselves (the strings actually shown in the cells —
 * e.g. the formatted date string, the 'Y'/'N'/'N/A' selection), so the fingerprint
 * computed at export equals the one recomputed at import. The canonical serializer
 * accepts both plain strings (export side) and raw ExcelJS cell objects (import side:
 * rich text, formula, date, number, blank).
 *
 * Two fingerprints per row:
 *  - fullRowFingerprint: ALL visible fields incl. the Changed By / Changed Date audit
 *    columns — the change-detection key.
 *  - identityVectorFingerprint: Item + Entity + Notes + answers (by checklist-item id),
 *    EXCLUDING the audit columns (which move on any edit) — the content key used by the
 *    Row-ID fallback matcher and blank-row recovery.
 * Plus per-field fingerprints, so "which field changed" / conflict detection is exact.
 *
 * Hashing uses Web Crypto SubtleCrypto (globalThis.crypto.subtle), the same cross-env
 * convention as contentHash.js / rowIdToken.js. Therefore the compute functions are async.
 */

export const ROW_FINGERPRINT_VERSION = 'v1';

const SENTINEL_EMPTY = '∅'; // ∅ — a single sentinel for blank/empty, distinct from "".
const textEncoder = new TextEncoder();

const canonString = (s) =>
  String(s)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n') // normalize line endings
    .replace(/\s+$/, ''); // trim trailing whitespace (incl. trailing newlines)

const canonNumber = (n) => (Object.is(n, -0) ? '0' : String(n));

/**
 * Canonicalize a single cell/field value to a stable string. Handles plain JS values
 * (export side) and ExcelJS cell shapes (import side): rich text, formula result,
 * hyperlink, Date, number, boolean, blank.
 */
export const canonicalizeCellValue = (value) => {
  if (value == null) return SENTINEL_EMPTY;

  const t = typeof value;
  if (t === 'string') {
    const s = canonString(value);
    return s === '' ? SENTINEL_EMPTY : s;
  }
  if (t === 'number') return Number.isFinite(value) ? canonNumber(value) : SENTINEL_EMPTY;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'bigint') return value.toString();

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? SENTINEL_EMPTY : value.toISOString();

  if (t === 'object') {
    // ExcelJS rich text: { richText: [{ text }, ...] }
    if (Array.isArray(value.richText)) {
      return canonicalizeCellValue(value.richText.map((run) => (run && run.text != null ? run.text : '')).join(''));
    }
    // ExcelJS formula: { formula, result } — use the cached result, never the formula.
    if ('result' in value) {
      return value.result == null ? SENTINEL_EMPTY : canonicalizeCellValue(value.result);
    }
    // ExcelJS hyperlink / text wrapper: { text, hyperlink }
    if ('text' in value) return canonicalizeCellValue(value.text);
    // ExcelJS error cell: { error: '#REF!' }
    if ('error' in value) return SENTINEL_EMPTY;
    // Last resort: a stable JSON projection.
    try {
      return canonString(JSON.stringify(value));
    } catch {
      return SENTINEL_EMPTY;
    }
  }

  return canonString(String(value));
};

const getSubtle = () => {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('SubtleCrypto unavailable for row fingerprinting');
  return subtle;
};

const sha256Hex = async (str) => {
  const digest = await getSubtle().digest('SHA-256', textEncoder.encode(str));
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i += 1) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
};

const fingerprint = async (str) => `${ROW_FINGERPRINT_VERSION}:${await sha256Hex(str)}`;

/**
 * Build the canonical serialization of a row's visible fields. The answer set is
 * sorted by checklist-item id so column reorder is not a content change.
 *
 * @param {{changedBy, changedDate, item, entity, notes, answers}} input
 *   answers: { [checklistItemId]: visibleValue }
 */
export const buildRowRecord = ({ changedBy, changedDate, item, entity, notes, answers } = {}) => {
  const fields = {
    changedBy: canonicalizeCellValue(changedBy),
    changedDate: canonicalizeCellValue(changedDate),
    item: canonicalizeCellValue(item),
    entity: canonicalizeCellValue(entity),
    notes: canonicalizeCellValue(notes)
  };

  const answerEntries = Object.entries(answers || {})
    .map(([id, value]) => [String(id), canonicalizeCellValue(value)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Explicit arrays → deterministic, unambiguous serialization (no field can bleed into
  // another; "a","bc" never serializes the same as "ab","c").
  const identityParts = [
    ['item', fields.item],
    ['entity', fields.entity],
    ['notes', fields.notes],
    ['answers', answerEntries]
  ];
  const fullParts = [['changedBy', fields.changedBy], ['changedDate', fields.changedDate], ...identityParts];

  return {
    fields,
    answerEntries,
    identitySerialized: JSON.stringify(identityParts),
    fullSerialized: JSON.stringify(fullParts)
  };
};

/**
 * Compute the row's fingerprints from its visible field values.
 * @returns {Promise<{fullRowFingerprint, identityVectorFingerprint, fieldFingerprints, canonical}>}
 *   fieldFingerprints: { changedBy, changedDate, item, entity, notes, answers: { [id]: fp } }
 */
export const computeRowFingerprints = async (input) => {
  const record = buildRowRecord(input);

  const [fullRowFingerprint, identityVectorFingerprint] = await Promise.all([
    fingerprint(record.fullSerialized),
    fingerprint(record.identitySerialized)
  ]);

  const fieldKeys = ['changedBy', 'changedDate', 'item', 'entity', 'notes'];
  const fieldFps = await Promise.all(fieldKeys.map((k) => fingerprint(`${k}${record.fields[k]}`)));
  const answerFps = await Promise.all(
    record.answerEntries.map(([id, v]) => fingerprint(`answer${id}${v}`).then((fp) => [id, fp]))
  );

  const fieldFingerprints = {};
  fieldKeys.forEach((k, i) => { fieldFingerprints[k] = fieldFps[i]; });
  fieldFingerprints.answers = Object.fromEntries(answerFps);

  return {
    fullRowFingerprint,
    identityVectorFingerprint,
    fieldFingerprints,
    canonical: { full: record.fullSerialized, identity: record.identitySerialized }
  };
};

/**
 * Diff two per-field fingerprint sets → the field keys that changed. Used for
 * change-detection and the both-sides-changed conflict check (Amendment #6).
 * Answer fields are reported as `answer:<checklistItemId>`. A field present on one
 * side only counts as changed.
 * @returns {string[]} sorted list of changed field keys
 */
export const diffRowFields = (prev = {}, next = {}) => {
  const changed = new Set();
  const scalarKeys = ['changedBy', 'changedDate', 'item', 'entity', 'notes'];
  for (const k of scalarKeys) {
    if (prev[k] !== next[k]) changed.add(k);
  }
  const prevAnswers = prev.answers || {};
  const nextAnswers = next.answers || {};
  for (const id of new Set([...Object.keys(prevAnswers), ...Object.keys(nextAnswers)])) {
    if (prevAnswers[id] !== nextAnswers[id]) changed.add(`answer:${id}`);
  }
  return [...changed].sort();
};

// Exposed for tests; not part of the public API.
export const __testing = { canonString, canonNumber, SENTINEL_EMPTY };
