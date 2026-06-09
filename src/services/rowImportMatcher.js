/**
 * rowImportMatcher.js — decides, for each Excel row on import, which Survey Marker it is
 * (STAGE1-IDENTITY-PLAN.md). Three-layer priority, all guards fail-safe:
 *
 *   1. Row ID (rowIdToken) is PRIMARY. A valid, in-scope, count-1 token whose marker was
 *      actually exported binds the row to that marker (rename/edits → same marker).
 *   2. Content fingerprints (rowFingerprint) are the SAFETY layer: a blank/lost Row ID is
 *      recovered by exact identity fingerprint (byte-identical twin groups pair in stable
 *      order silently, Amendment #4), then by ≥1 shared NON-BLANK identity field unique in
 *      both directions (Tier-4 field overlap — survives Excel-side edits to a blank-ID row).
 *   3. Duplicate / unknown / foreign / wrong-scope / malformed Row IDs, and blank recovery
 *      with multiple NON-identical candidates either direction, NEVER guess — they surface
 *      for review ("Needs your choice").
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

  // Pass 3 — blank Row ID recovery. Recoverable only against LEFTOVER markers (not already
  // bound by a token, not tangled in a duplicate). Per the locked blank-rowid amendments
  // (2026-06-09, .planning/blank-rowid-matching-verdict.md):
  //   3a. exact identity-vector fingerprint, GROUP-AWARE: byte-identical rows and markers
  //       pair in stable order silently (Amendment #4 — assignment is data-inconsequential,
  //       identical twins never go to review).
  //   3b. field-overlap recovery (Tier 4, zero storage): a row with ZERO exact candidates
  //       pairs with a leftover sharing ≥1 NON-BLANK identity field, unique in both
  //       directions (byte-identical sides pair as a group), iterated to fixpoint.
  //   3c. fall-through: zero overlap with every leftover → genuinely new (create);
  //       multiple NON-identical candidates either direction → 'ambiguous-identity'
  //       review (genuinely consequential ambiguity only — never guess, never create).
  const leftoverFor = () => stored.filter((s) => !matchedMarkerIds.has(s.markerId));

  const recoverDecision = (rowIndex, markerId, extra = {}) => {
    decisions.push({
      rowIndex,
      decision: 'missing-rowid',
      action: IMPORT_ACTIONS.APPLY, // confident recovery: re-attach + apply (owner rule 5).
      // Emitting action 'apply' keeps the downstream both-sides conflict guard reachable
      // (buildScopeImportPlans Amendment #6) — a both-sides edit becomes a 'conflict' review.
      markerId,
      recovered: true,
      ...extra
    });
    matchedMarkerIds.add(markerId);
  };

  // --- Pass 3a: exact-fingerprint groups. Rows and leftovers with the SAME identity
  // fingerprint are byte-identical both sides, so pairing is order-preserving and silent
  // (rows in row order × leftovers in stored order). 1×1 is today's unique recovery;
  // N×M pairs min(N,M); extra rows fall through to field-overlap recovery; extra
  // markers stay leftover (a deleted twin row → delete candidate, Amendment #3/#7).
  // Group-at-once (not first-row-wins) → the outcome is independent of row order.
  const blanksByFp = new Map(); // identityVectorFingerprint -> [enriched], row order
  for (const e of blanks) {
    const k = e.fp.identityVectorFingerprint;
    if (!blanksByFp.has(k)) blanksByFp.set(k, []);
    blanksByFp.get(k).push(e);
  }

  let overlapPool = []; // blanks with zero exact candidates (or beyond their exact group)
  for (const [fpKey, group] of blanksByFp) {
    const cands = leftoverFor().filter((s) => s.identityVectorFingerprint === fpKey);
    const n = Math.min(group.length, cands.length);
    for (let i = 0; i < n; i += 1) recoverDecision(group[i].rowIndex, cands[i].markerId);
    for (let i = n; i < group.length; i += 1) overlapPool.push(group[i]);
  }
  overlapPool.sort((a, b) => a.rowIndex - b.rowIndex);

  // --- Pass 3b: Tier-4 field-overlap recovery. Only the IDENTITY fields participate
  // (item / entity / notes / answers) — the audit columns (changedBy / changedDate) move
  // on any edit and never establish identity. A shared field counts ONLY when non-blank
  // on both sides: blank==blank is no signal.
  if (overlapPool.length > 0) {
    // Precompute the canonical-blank fingerprint per identity field (one hashing pass
    // covering every answer id present on either side) so "non-blank" is an exact
    // fingerprint comparison, not a value heuristic.
    const answerIds = new Set();
    for (const e of overlapPool) Object.keys(e.fp.fieldFingerprints?.answers || {}).forEach((id) => answerIds.add(id));
    for (const s of stored) Object.keys(s.fieldFingerprints?.answers || {}).forEach((id) => answerIds.add(id));
    const blankFF = (await computeRowFingerprints({
      answers: Object.fromEntries([...answerIds].map((id) => [id, null]))
    })).fieldFingerprints;

    const IDENTITY_SCALARS = ['item', 'entity', 'notes'];
    // ≥1 identity field whose fingerprints are equal AND not the blank-canonical value.
    // A marker without fieldFingerprints (older record) safely never overlaps.
    const sharesNonBlankField = (rowFF, markerFF) => {
      if (!rowFF || !markerFF) return false;
      for (const k of IDENTITY_SCALARS) {
        if (rowFF[k] && rowFF[k] === markerFF[k] && rowFF[k] !== blankFF[k]) return true;
      }
      const rowAnswers = rowFF.answers || {};
      const markerAnswers = markerFF.answers || {};
      for (const id of Object.keys(rowAnswers)) {
        if (rowAnswers[id] && rowAnswers[id] === markerAnswers[id] && rowAnswers[id] !== blankFF.answers[id]) return true;
      }
      return false;
    };
    const candidatesFor = (e, remaining) =>
      remaining.filter((s) => sharesNonBlankField(e.fp.fieldFingerprints, s.fieldFingerprints));

    let remaining = leftoverFor(); // stored order
    // Fixpoint: each round pairs every row-fingerprint group whose candidate set is
    // unambiguous — either a unique mutual pairing, or all candidates byte-identical and
    // uncontended by any non-identical row (Amendment #4 group pairing) — then re-derives
    // candidates so earlier matches can disambiguate later ones. Pairs are decided
    // set-wise per round, so the result is independent of row order.
    for (;;) {
      const candsByRow = new Map(); // enriched row -> [stored]
      const rowsByMarker = new Map(); // stored -> [enriched row]
      for (const e of overlapPool) {
        const list = candidatesFor(e, remaining);
        candsByRow.set(e, list);
        for (const s of list) {
          if (!rowsByMarker.has(s)) rowsByMarker.set(s, []);
          rowsByMarker.get(s).push(e);
        }
      }

      // Rows with identical identity fingerprints have identical identity-field
      // fingerprints, hence identical candidate sets — group them.
      const rowGroups = new Map(); // identityVectorFingerprint -> [enriched], row order
      for (const e of overlapPool) {
        const k = e.fp.identityVectorFingerprint;
        if (!rowGroups.has(k)) rowGroups.set(k, []);
        rowGroups.get(k).push(e);
      }

      const paired = []; // [enriched row, stored marker]
      for (const group of rowGroups.values()) {
        const cands = candsByRow.get(group[0]) || [];
        if (cands.length === 0) continue; // resolved in Pass 3c (new-row)
        // All candidates must be byte-identical to EACH OTHER (a single candidate is
        // trivially so — the plain unique pairing), else this is consequential ambiguity.
        const headFp = cands[0].identityVectorFingerprint;
        if (!cands.every((s) => s.identityVectorFingerprint === headFp)) continue;
        // No candidate may be wanted by a row OUTSIDE this byte-identical group —
        // that contention is ambiguity in the marker direction, never guessed away.
        const groupSet = new Set(group);
        const contended = cands.some((s) => (rowsByMarker.get(s) || []).some((r) => !groupSet.has(r)));
        if (contended) continue;
        const n = Math.min(group.length, cands.length);
        for (let i = 0; i < n; i += 1) paired.push([group[i], cands[i]]);
      }

      if (paired.length === 0) break;
      const usedRows = new Set();
      const usedMarkers = new Set();
      for (const [e, s] of paired) {
        // recoveredBy is purely diagnostic (logs / future observability) — no executor
        // consumes it. Exact-fingerprint recoveries (3a) deliberately omit it so their
        // decision shape stays byte-identical to the pre-Tier-4 matcher.
        recoverDecision(e.rowIndex, s.markerId, { recoveredBy: 'field-overlap' });
        usedRows.add(e);
        usedMarkers.add(s);
      }
      overlapPool = overlapPool.filter((e) => !usedRows.has(e));
      remaining = remaining.filter((s) => !usedMarkers.has(s));
    }

    // --- Pass 3c: fall-through for still-unmatched blanks. Zero overlap with every
    // leftover → genuinely new row (Amendment #2). Any surviving candidates here are
    // non-identical or contended → review; listing them shields them from
    // candidateDeletes below (a row possibly theirs exists, merely unresolved).
    for (const e of overlapPool) {
      const list = candidatesFor(e, remaining);
      if (list.length === 0) {
        decisions.push({ rowIndex: e.rowIndex, decision: 'new-row', action: IMPORT_ACTIONS.CREATE });
      } else {
        decisions.push(reviewDecision(e.rowIndex, 'ambiguous-identity', {
          candidateMarkerIds: list.map((s) => s.markerId)
        }));
      }
    }
  }

  // Pass 4 — stored markers that no row matched → delete candidates. A stored marker
  // referenced by ANY review decision (an ambiguous blank-recovery candidate, or an
  // unknown/duplicate token that names it) still has a possibly-corresponding row that is
  // merely unresolved, NOT genuinely gone — so it is excluded here. This makes a delete
  // candidate mean strictly "no Excel row references this marker at all", which is the only
  // safe signal for Excel-driven deletion (the caller may auto-remove received ones through
  // History, so this exclusion prevents deleting a marker whose row is just under review).
  const reviewReferenced = new Set();
  for (const d of decisions) {
    if (d.action !== IMPORT_ACTIONS.REVIEW) continue;
    if (d.markerId) reviewReferenced.add(d.markerId);
    if (Array.isArray(d.candidateMarkerIds)) d.candidateMarkerIds.forEach((id) => reviewReferenced.add(id));
  }
  const candidateDeletes = stored
    .filter((s) => !matchedMarkerIds.has(s.markerId) && !reviewReferenced.has(s.markerId))
    .map((s) => s.markerId);

  // Keep decisions in row order for a stable, readable plan.
  decisions.sort((a, b) => a.rowIndex - b.rowIndex);
  return { decisions, candidateDeletes };
};
