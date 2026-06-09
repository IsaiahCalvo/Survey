/**
 * rowImportMatcher.js — decides, for each Excel row on import, which Survey Marker it is
 * (STAGE1-IDENTITY-PLAN.md). Three-layer priority, all guards fail-safe:
 *
 *   1. Row ID (rowIdToken) is PRIMARY. A valid, in-scope, count-1 token whose marker was
 *      actually exported binds the row to that marker (rename/edits → same marker).
 *   2. Full-row fingerprint (rowFingerprint) is the SAFETY layer: it recovers a blank/lost
 *      Row ID by content and reports which fields changed (for conflict detection).
 *   3. Duplicate / unknown / foreign / wrong-scope / malformed Row IDs, and ambiguous blank
 *      recovery, NEVER guess — they surface for review ("Needs your choice").
 *
 * This module is PURE and async (it awaits the token classifier + fingerprint hashing). It
 * produces decisions only; it does not mutate markers or the workbook. Excel-driven deletion
 * of a placed marker stays OFF — a stored marker with no row is at most a review candidate.
 */
import { classifyRowIdToken } from './rowIdToken.js';
import { computeRowFingerprints, diffRowFields } from './rowFingerprint.js';

// action = what the caller may do with this decision.
//   apply  → write the row's attributes onto markerId
//   create → make a new unplaced Survey Marker from this row
//   review → surface for the user ("Needs your choice" / cannot-sync); never write
export const IMPORT_ACTIONS = { APPLY: 'apply', CREATE: 'create', REVIEW: 'review' };

const reviewDecision = (rowIndex, decision, extra = {}) =>
  ({ rowIndex, decision, action: IMPORT_ACTIONS.REVIEW, ...extra });

/**
 * @param {object} input
 * @param {Array<{rowIdCell:*, values:object}>} input.rows  visible row values + the Row ID cell
 * @param {Array<{markerId:string, identityVectorFingerprint:string, fullRowFingerprint?:string,
 *                fieldFingerprints?:object}>} input.stored  markers exported to THIS scope
 * @param {string} input.documentId
 * @param {string} input.scopeId  `${moduleId}:${categoryId}`
 * @param {(keyId:string)=>string|null|Promise<string|null>} input.resolveSecret
 * @returns {Promise<{decisions:Array, candidateDeletes:string[]}>}
 */
export const buildImportPlan = async ({ rows = [], stored = [], documentId, scopeId, resolveSecret }) => {
  const storedById = new Map(stored.map((s) => [s.markerId, s]));
  const exportedIds = new Set(storedById.keys());

  // Pass 0 — classify every row's Row ID token + compute its fingerprints once.
  const enriched = await Promise.all(rows.map(async (row, rowIndex) => {
    const cls = await classifyRowIdToken(row.rowIdCell, { documentId, scopeId, resolveSecret });
    const fp = await computeRowFingerprints(row.values || {});
    return { rowIndex, row, cls, fp };
  }));

  const decisions = [];
  const matchedMarkerIds = new Set();
  const blanks = [];

  // Group valid-token rows by their marker id, preserving row order. A row COPIED in
  // Excel carries the original's token, so a token appearing on >1 row is the
  // copy/paste case — the group is resolved by position below, not sent to review.
  const validGroups = new Map(); // originMarkerId -> [enriched rows]
  for (const e of enriched) {
    if (e.cls.status === 'valid') {
      if (!validGroups.has(e.cls.markerId)) validGroups.set(e.cls.markerId, []);
      validGroups.get(e.cls.markerId).push(e);
    }
  }

  // Copies created on a PRIOR import remember their lineage on their own identity
  // record: copyOfMarkerId (the original) + copyOrdinal (their position in the group).
  // copiesByOrigin: originMarkerId -> Map(ordinal -> storedEntry).
  const copiesByOrigin = new Map();
  for (const s of stored) {
    if (s.copyOfMarkerId != null && Number.isInteger(s.copyOrdinal)) {
      if (!copiesByOrigin.has(s.copyOfMarkerId)) copiesByOrigin.set(s.copyOfMarkerId, new Map());
      copiesByOrigin.get(s.copyOfMarkerId).set(s.copyOrdinal, s);
    }
  }

  // Pass 1 — non-valid rows (blank deferred to Pass 3; the rest are terminal reviews).
  for (const e of enriched) {
    const { rowIndex, cls } = e;
    switch (cls.status) {
      case 'valid': break; // resolved in the group pass below
      case 'blank': blanks.push(e); break;
      case 'foreign': decisions.push(reviewDecision(rowIndex, 'foreign-rowid')); break;
      case 'wrong-scope': decisions.push(reviewDecision(rowIndex, 'wrong-scope-rowid')); break;
      case 'key-unavailable':
        decisions.push(reviewDecision(rowIndex, 'rowid-key-unavailable', { keyId: cls.keyId })); break;
      case 'malformed':
      default: decisions.push(reviewDecision(rowIndex, 'malformed-rowid')); break;
    }
  }

  // Pass 2 — valid-token groups. The FIRST row (lowest index) is the original and binds
  // to the token's marker; each LATER row is a copy and maps to its OWN marker by
  // (origin, ordinal) — so a copy becomes a new item automatically and re-saving the
  // same copies never multiplies them. (Position-based: pasting a copy ABOVE the
  // original flips which row owns the identity — no data is lost since both become
  // items; the user can reorder. Codex flagged this as the accepted tradeoff for a
  // zero-friction copy/paste.)
  for (const [originMarkerId, group] of validGroups) {
    const sortedRows = group.slice().sort((a, b) => a.rowIndex - b.rowIndex);
    const knownCopies = copiesByOrigin.get(originMarkerId) || new Map();
    sortedRows.forEach((e, ordinal) => {
      const { rowIndex, fp } = e;
      if (ordinal === 0) {
        if (!exportedIds.has(originMarkerId)) {
          // Valid signature for this doc+scope, but never exported here (typed/pasted
          // token for a marker not in this workbook). Never mutate.
          decisions.push(reviewDecision(rowIndex, 'unknown-rowid', { markerId: originMarkerId }));
        } else {
          const s = storedById.get(originMarkerId);
          decisions.push({
            rowIndex,
            decision: 'match',
            action: IMPORT_ACTIONS.APPLY,
            markerId: originMarkerId,
            changed: fp.fullRowFingerprint !== s.fullRowFingerprint,
            changedFields: s.fieldFingerprints ? diffRowFields(s.fieldFingerprints, fp.fieldFingerprints) : undefined
          });
          matchedMarkerIds.add(originMarkerId);
        }
      } else {
        const existing = knownCopies.get(ordinal);
        if (existing) {
          // This copy was created on a previous import — apply to its marker, don't twin.
          decisions.push({ rowIndex, decision: 'copy-existing', action: IMPORT_ACTIONS.APPLY, markerId: existing.markerId });
          matchedMarkerIds.add(existing.markerId);
        } else {
          // A brand-new copy → create a new item, remembered by (origin, ordinal).
          decisions.push({
            rowIndex,
            decision: 'copy-new',
            action: IMPORT_ACTIONS.CREATE,
            copyOfMarkerId: originMarkerId,
            copyOrdinal: ordinal
          });
        }
      }
    });
  }

  // Pass 3 — blank Row ID recovery by fingerprint. Recoverable only against LEFTOVER markers
  // (not already bound by a token, not tangled in a duplicate). A unique identity-vector hit
  // re-attaches the marker; multiple hits → "Needs your choice"; no hit → genuinely new.
  const leftoverFor = () => stored.filter((s) => !matchedMarkerIds.has(s.markerId));

  for (const e of blanks) {
    const { rowIndex, fp } = e;
    const candidates = leftoverFor().filter((s) => s.identityVectorFingerprint === fp.identityVectorFingerprint);
    if (candidates.length === 1) {
      decisions.push({
        rowIndex,
        decision: 'missing-rowid',
        action: IMPORT_ACTIONS.APPLY, // confident unique recovery: re-attach + apply (owner rule 5)
        markerId: candidates[0].markerId,
        recovered: true
      });
      matchedMarkerIds.add(candidates[0].markerId);
    } else if (candidates.length > 1) {
      decisions.push(reviewDecision(rowIndex, 'ambiguous-identity', {
        candidateMarkerIds: candidates.map((c) => c.markerId)
      }));
    } else {
      decisions.push({ rowIndex, decision: 'new-row', action: IMPORT_ACTIONS.CREATE });
    }
  }

  // Pass 4 — stored markers that no row matched → review-only delete candidates (guard ON).
  const candidateDeletes = stored
    .filter((s) => !matchedMarkerIds.has(s.markerId))
    .map((s) => s.markerId);

  // Keep decisions in row order for a stable, readable plan.
  decisions.sort((a, b) => a.rowIndex - b.rowIndex);
  return { decisions, candidateDeletes };
};
