/**
 * rowImportMatcher.js — decides, for each Excel row on import, which Survey Marker it is
 * (STAGE1-IDENTITY-PLAN.md). Three-layer priority, all guards fail-safe:
 *
 *   1. Row ID (rowIdToken) is PRIMARY. A valid, in-scope, count-1 token whose marker was
 *      actually exported binds the row to that marker (rename/edits → same marker).
 *   2. Content fingerprints (rowFingerprint) are the SAFETY layer: a blank/lost Row ID is
 *      recovered by exact identity fingerprint (byte-identical twin groups pair in stable
 *      order silently, Amendment #4), then — when the scope's DEVICE-LOCAL positional
 *      stamps are TRUSTED (every leftover stamped from ONE snapshot, matched anchors
 *      order-consistent) — by the row's sheet SLOT relative to flanking anchors (Tier 3),
 *      then by ≥2 shared NON-BLANK identity fields unique in both directions (Tier-4 field
 *      overlap — survives Excel-side edits to a blank-ID row). Strict precedence:
 *      Row-ID tokens > exact unique fingerprint > position; position NEVER overrides an
 *      exact content match (rows that swap content swap pairings, not slots).
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
 * @param {Array<{rowIdCell:*, values:object, sheetRowNumber?:number}>} input.rows  visible row
 *        values + the Row ID cell. sheetRowNumber is the TRUE 1-based sheet row (positional
 *        tier input); absence is always valid and disables only the positional tier.
 * @param {Array<{markerId:string, identityVectorFingerprint:string, fullRowFingerprint?:string,
 *                fieldFingerprints?:object, lastSeenRowNumber?:number, lastIngestSeq?:number
 *               }>} input.stored  markers exported to THIS scope (positions are device-local
 *        hints from the last ingested save — missing/stale stamps degrade to content tiers)
 * @param {string} input.documentId
 * @param {string} input.scopeId  `${moduleId}:${categoryId}`
 * @param {(keyId:string)=>string|null|Promise<string|null>} input.resolveSecret
 * @param {Set<string>|string[]} [input.crossScopeBlankFingerprints]  identity fingerprints of
 *        blank-Row-ID rows seen in OTHER scopes of the same import. A leftover marker whose
 *        baseline fingerprint reappears there was likely cut+pasted to that sheet — it is
 *        shielded from positional/field-overlap pairing here (never eliminated-against
 *        locally); it follows normal delete semantics instead.
 * @returns {Promise<{decisions:Array, candidateDeletes:string[]}>}
 */
export const buildImportPlan = async ({
  rows = [], stored = [], documentId, scopeId, resolveSecret, crossScopeBlankFingerprints = null
}) => {
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

  const reviewMarkerExtraFor = (e, extra = {}) => {
    const match = stored.find((s) =>
      s?.markerId &&
      (s.identityVectorFingerprint === e.fp.identityVectorFingerprint ||
        s.fullRowFingerprint === e.fp.fullRowFingerprint)
    );
    return match ? { ...extra, markerId: match.markerId } : extra;
  };

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

  // --- Positional stamps (slice 3 of the blank-rowid plan) — device-local hints read
  // defensively: anything non-integer / non-positive is "unknown" and (via the trust
  // gate below) disables the positional tier for the scope, never throws.
  const storedPosOf = (s) =>
    (Number.isInteger(s?.lastSeenRowNumber) && s.lastSeenRowNumber > 0 ? s.lastSeenRowNumber : null);
  const storedSeqOf = (s) =>
    (Number.isInteger(s?.lastIngestSeq) && s.lastIngestSeq > 0 ? s.lastIngestSeq : null);
  const rowPosOf = (e) =>
    (Number.isInteger(e?.row?.sheetRowNumber) && e.row.sheetRowNumber > 0 ? e.row.sheetRowNumber : null);
  // Anchors: already-matched pairs carrying BOTH a stored position and a new sheet
  // position. Token-tier matches are collected in Pass 2; 1×1 exact recoveries join in
  // Pass 3a. They gate (order-consistency) and parameterize (flank offsets) every
  // positional inference below.
  const anchorPairs = [];
  // Cross-scope reconciliation (slice 3): markers whose exact baseline fingerprint
  // reappears as a blank row in ANOTHER scope were likely cut+pasted there.
  const crossScopeFps = crossScopeBlankFingerprints instanceof Set
    ? crossScopeBlankFingerprints
    : new Set(crossScopeBlankFingerprints || []);
  const crossShielded = (s) => crossScopeFps.has(s.identityVectorFingerprint);

  // Pass 1 — non-valid rows (blank deferred to Pass 3; the rest are terminal reviews).
  for (const e of enriched) {
    const { rowIndex, cls } = e;
    switch (cls.status) {
      case 'valid': break; // resolved in the group pass below
      case 'blank': blanks.push(e); break;
      case 'foreign': decisions.push(reviewDecision(rowIndex, 'foreign-rowid', reviewMarkerExtraFor(e))); break;
      case 'wrong-scope': decisions.push(reviewDecision(rowIndex, 'wrong-scope-rowid', reviewMarkerExtraFor(e))); break;
      case 'key-unavailable':
        decisions.push(reviewDecision(rowIndex, 'rowid-key-unavailable', reviewMarkerExtraFor(e, { keyId: cls.keyId }))); break;
      case 'malformed':
      default: decisions.push(reviewDecision(rowIndex, 'malformed-rowid', reviewMarkerExtraFor(e))); break;
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
          anchorPairs.push({ storedPos: storedPosOf(s), newPos: rowPosOf(e), seq: storedSeqOf(s) });
        }
      } else {
        const existing = knownCopies.get(ordinal);
        if (existing) {
          // This copy was created on a previous import — apply to its marker, don't twin.
          decisions.push({ rowIndex, decision: 'copy-existing', action: IMPORT_ACTIONS.APPLY, markerId: existing.markerId });
          matchedMarkerIds.add(existing.markerId);
          anchorPairs.push({ storedPos: storedPosOf(existing), newPos: rowPosOf(e), seq: storedSeqOf(existing) });
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
  //       identical twins never go to review). With TRUSTED positional stamps, same-slot
  //       twins pair first and the remainder pairs in relative sheet order (pins follow
  //       slots); without trust the slice-1 order (row order × stored order) is unchanged.
  //   Tier 3. positional slot (trusted stamps only): a CONTENT-CHANGED row pairs with the
  //       leftover whose remembered slot it occupies (flanking-anchor offsets, never
  //       absolute rows), unique in both directions. ≥1 unchanged identity field → apply
  //       (the both-sides conflict guard stays reachable). ZERO unchanged fields (total
  //       rewrite) → Amendment #2: SILENT same-row match, but only while the scope's
  //       layout is otherwise explained (population conserved, content points nowhere
  //       else); anything unexplained falls through to create + normal delete semantics
  //       (Amendment #3 — delete-and-replace never prompts).
  //   3b. field-overlap recovery (Tier 4, zero storage): a row with ZERO exact candidates
  //       pairs with a leftover sharing ≥2 NON-BLANK identity fields, unique in both
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

  // --- Positional trust gate (slice 3). ONE scope-level evaluation; any missing, stale,
  // or inconsistent stamp disables the tier and every path below degrades to the
  // content-only passes (byte-identical to the pre-positional matcher). Gates:
  //   (i)   stamps exist — every leftover marker carries lastSeenRowNumber AND every
  //         still-unmatched blank row carries its TRUE sheetRowNumber;
  //   (ii)  one snapshot — all leftover lastIngestSeq agree and stored positions are
  //         duplicate-free (a position from a different ingest is STALE; two snapshots
  //         never mix). Anchors from another snapshot are dropped, not trusted;
  //   (iii) anchor order-consistency — the already-matched pairs (Row-ID tokens +
  //         1×1 exact) keep their relative order in the new sheet; no positional
  //         inference under sorts/scrambles.
  // Expected slots come from FLANKING-ANCHOR OFFSETS, never absolute row numbers (an
  // insert/delete above shifts absolutes; the offset to the nearest surviving anchor
  // does not). A virtual top-of-sheet anchor (0→0) covers the no-anchor case, where
  // the expected slot degrades to the absolute stored row number.
  const evaluatePositionalTrust = (pendingBlanks, exactAnchors) => {
    const leftovers = leftoverFor();
    if (leftovers.length === 0) return null; // nothing positional to decide
    if (leftovers.some((s) => storedPosOf(s) == null)) return null; // (i)
    if (pendingBlanks.some((e) => rowPosOf(e) == null)) return null; // (i)
    const seqs = new Set(leftovers.map(storedSeqOf));
    if (seqs.size > 1) return null; // (ii) stale mix
    const snapshotSeq = [...seqs][0];
    // (ii) a stamped position WITHOUT an ingest seq is not a snapshot. No current writer
    // produces this shape (buildMarkerIdentityRecord stamps both together), but a null
    // snapshotSeq would otherwise admit null-seq anchors as one coherent layout.
    if (snapshotSeq == null) return null;
    const anchors = [...anchorPairs, ...exactAnchors].filter(
      (a) => a.storedPos != null && a.newPos != null && a.seq === snapshotSeq
    );
    const seen = new Set();
    for (const p of [...leftovers.map(storedPosOf), ...anchors.map((a) => a.storedPos)]) {
      if (seen.has(p)) return null; // (ii) duplicate stored position
      seen.add(p);
    }
    const sorted = anchors.slice().sort((a, b) => a.storedPos - b.storedPos);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].newPos <= sorted[i - 1].newPos) return null; // (iii)
    }
    return { anchors: [{ storedPos: 0, newPos: 0 }, ...sorted] };
  };
  const expectedSlotsFor = (trust, storedPos) => {
    let prev = trust.anchors[0];
    let next = null;
    for (const a of trust.anchors) {
      if (a.storedPos < storedPos) prev = a;
      else if (a.storedPos > storedPos) { next = a; break; }
    }
    // Agreement with EITHER flank survives an insert/delete strictly between the marker
    // and the other flank.
    const slots = [prev.newPos + (storedPos - prev.storedPos)];
    if (next) slots.push(next.newPos - (next.storedPos - storedPos));
    return slots;
  };
  const slotAgrees = (trust, e, s) => {
    const rp = rowPosOf(e);
    const sp = storedPosOf(s);
    if (rp == null || sp == null) return false;
    return expectedSlotsFor(trust, sp).includes(rp);
  };

  // --- Pass 3a: exact-fingerprint groups. Rows and leftovers with the SAME identity
  // fingerprint are byte-identical both sides, so pairing is order-preserving and silent.
  // 1×1 is today's unique recovery (position-free) and joins the anchor set; N×M pairs
  // min(N,M); extra rows fall through to field-overlap recovery; extra markers stay
  // leftover (a deleted twin row → delete candidate, Amendment #3/#7).
  // Group-at-once (not first-row-wins) → the outcome is independent of row order.
  const blanksByFp = new Map(); // identityVectorFingerprint -> [enriched], row order
  for (const e of blanks) {
    const k = e.fp.identityVectorFingerprint;
    if (!blanksByFp.has(k)) blanksByFp.set(k, []);
    blanksByFp.get(k).push(e);
  }

  let overlapPool = []; // blanks with zero exact candidates (or beyond their exact group)
  const nxmGroups = []; // exact groups bigger than 1×1, resolved after the trust gate
  const exactSingletonAnchors = [];
  for (const [fpKey, group] of blanksByFp) {
    const cands = leftoverFor().filter((s) => s.identityVectorFingerprint === fpKey);
    if (cands.length === 0) { overlapPool.push(...group); continue; }
    if (group.length === 1 && cands.length === 1) {
      recoverDecision(group[0].rowIndex, cands[0].markerId);
      exactSingletonAnchors.push({
        storedPos: storedPosOf(cands[0]), newPos: rowPosOf(group[0]), seq: storedSeqOf(cands[0])
      });
    } else {
      nxmGroups.push({ group, cands });
    }
  }

  const trust = evaluatePositionalTrust(
    [...overlapPool, ...nxmGroups.flatMap((g) => g.group)],
    exactSingletonAnchors
  );

  // N×M byte-identical groups (Amendment #4: silent, zero creates while twins remain;
  // the assignment is data-inconsequential so it may follow position — pins follow
  // slots). Untrusted → exactly the slice-1 pairing, immediately. Trusted → same-slot
  // pairs first; the remainder is RESERVED and finalized after the positional tier in
  // relative sheet order, so a content-changed row whose slot points at one specific
  // twin (EX4) can take it without starving any reserved exact row.
  const deferredGroups = []; // { rows:[enriched], cands:[stored] } — exact reservations
  for (const { group, cands } of nxmGroups) {
    if (!trust) {
      const n = Math.min(group.length, cands.length);
      for (let i = 0; i < n; i += 1) recoverDecision(group[i].rowIndex, cands[i].markerId);
      for (let i = n; i < group.length; i += 1) overlapPool.push(group[i]);
      continue;
    }
    const remRows = group.slice().sort((a, b) => rowPosOf(a) - rowPosOf(b));
    const remCands = cands.slice(); // stored order
    const samePaired = new Set();
    for (const e of remRows) {
      const idx = remCands.findIndex((s) => slotAgrees(trust, e, s));
      if (idx !== -1) {
        recoverDecision(e.rowIndex, remCands[idx].markerId);
        remCands.splice(idx, 1);
        samePaired.add(e);
      }
    }
    const rowsLeft = remRows.filter((e) => !samePaired.has(e));
    // Rows beyond the group's exact entitlement can never exact-match → overlap pool.
    while (rowsLeft.length > remCands.length) overlapPool.push(rowsLeft.pop());
    if (rowsLeft.length > 0) deferredGroups.push({ rows: rowsLeft, cands: remCands });
  }
  overlapPool.sort((a, b) => a.rowIndex - b.rowIndex);

  // --- Field-overlap helpers (shared by the positional tier and Pass 3b). Only the
  // IDENTITY fields participate (item / entity / notes / answers) — the audit columns
  // (changedBy / changedDate) move on any edit and never establish identity. A shared
  // field counts ONLY when non-blank on both sides: blank==blank is no signal.
  let nonBlankFieldOverlapCount = () => 0;
  let sharesNonBlankField = () => false;
  let sharesTier4FieldOverlap = () => false;
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
    // Count distinct identity fields whose fingerprints are equal AND not the blank-canonical value.
    // A marker without fieldFingerprints (older record) safely never overlaps.
    nonBlankFieldOverlapCount = (rowFF, markerFF) => {
      if (!rowFF || !markerFF) return 0;
      let shared = 0;
      for (const k of IDENTITY_SCALARS) {
        if (rowFF[k] && rowFF[k] === markerFF[k] && rowFF[k] !== blankFF[k]) {
          shared += 1;
        }
      }
      const rowAnswers = rowFF.answers || {};
      const markerAnswers = markerFF.answers || {};
      for (const id of Object.keys(rowAnswers)) {
        if (rowAnswers[id] && rowAnswers[id] === markerAnswers[id] && rowAnswers[id] !== blankFF.answers[id]) {
          shared += 1;
        }
      }
      return shared;
    };
    sharesNonBlankField = (rowFF, markerFF) => nonBlankFieldOverlapCount(rowFF, markerFF) >= 1;
    sharesTier4FieldOverlap = (rowFF, markerFF) => nonBlankFieldOverlapCount(rowFF, markerFF) >= 2;
  }
  const candidatesFor = (e, fromMarkers) =>
    fromMarkers.filter((s) => sharesTier4FieldOverlap(e.fp.fieldFingerprints, s.fieldFingerprints));
  const weakCandidatesFor = (e, fromMarkers) =>
    fromMarkers.filter((s) => sharesNonBlankField(e.fp.fieldFingerprints, s.fieldFingerprints));

  // --- Tier 3: positional slot for CONTENT-CHANGED rows (trusted stamps only). A pool
  // row pairs with the leftover marker whose remembered slot it occupies, when the slot
  // claim is unique in BOTH directions (gate iv). Two arms:
  //   • ≥1 identity field unchanged → confident same-row edit: pair as 'missing-rowid'/
  //     apply, keeping the downstream both-sides conflict guard reachable.
  //   • ZERO fields unchanged (total rewrite at a stable slot) → Amendment #2: SILENT
  //     same-row match, gated on the layout being otherwise explained — population
  //     conserved (unresolved rows === unresolved markers, i.e. the scope's row-count
  //     delta is fully accounted for by matches already made) AND the content evidence
  //     pointing nowhere else (this row overlaps no OTHER leftover; no other pool row
  //     overlaps this marker). Unexplained layouts fall through: the row creates and
  //     the orphan follows normal delete semantics (Amendment #3 — never a prompt).
  // Cross-scope shield: a leftover whose baseline reappeared verbatim in another scope
  // is never paired positionally here.
  if (trust && overlapPool.length > 0) {
    const claimable = leftoverFor().filter((s) => !crossShielded(s));
    const claimsByRow = new Map(); // enriched row -> [stored]
    const claimsByMarker = new Map(); // stored -> [enriched row]
    for (const e of overlapPool) {
      const list = claimable.filter((s) => slotAgrees(trust, e, s));
      claimsByRow.set(e, list);
      for (const s of list) {
        if (!claimsByMarker.has(s)) claimsByMarker.set(s, []);
        claimsByMarker.get(s).push(e);
      }
    }
    const unresolvedRows = overlapPool.length + deferredGroups.reduce((n, g) => n + g.rows.length, 0);
    // Computed once: every pairing the loop below makes removes exactly ONE pool row and
    // ONE leftover marker, so this equality is loop-invariant — recomputing it inside
    // the loop would yield the same boolean (N conserved rewrites stay conserved at N-1).
    const conserved = unresolvedRows === leftoverFor().length;

    for (const e of [...overlapPool]) {
      const list = claimsByRow.get(e) || [];
      if (list.length !== 1) continue; // (iv) row → marker must be unique
      const s = list[0];
      if ((claimsByMarker.get(s) || []).length !== 1) continue; // (iv) marker → row must be unique
      if (matchedMarkerIds.has(s.markerId)) continue; // safety: claims were a snapshot
      // Never starve a reserved exact group: a reserved twin may be taken only while
      // the group keeps at least one candidate per remaining row.
      const g = deferredGroups.find((dg) => dg.cands.includes(s));
      if (g && g.cands.length - 1 < g.rows.length) continue;
      const corroborated = sharesNonBlankField(e.fp.fieldFingerprints, s.fieldFingerprints);
      if (!corroborated) {
        if (!conserved) continue;
        const allLeftovers = leftoverFor();
        const rowPointsElsewhere = allLeftovers.some(
          (s2) => s2 !== s && sharesNonBlankField(e.fp.fieldFingerprints, s2.fieldFingerprints)
        );
        if (rowPointsElsewhere) continue;
        // Deliberately reads the LIVE pool (unlike the snapshot-based claims maps): a row
        // already paired earlier in this loop is no longer a contender for this marker.
        const markerClaimedElsewhere = overlapPool.some(
          (e2) => e2 !== e && sharesNonBlankField(e2.fp.fieldFingerprints, s.fieldFingerprints)
        );
        if (markerClaimedElsewhere) continue;
      }
      recoverDecision(e.rowIndex, s.markerId, { recoveredBy: 'positional' });
      overlapPool = overlapPool.filter((x) => x !== e);
      if (g) g.cands = g.cands.filter((x) => x !== s);
    }
  }

  // --- Pass 3a (cont.): finalize the reserved exact groups AFTER the positional tier:
  // remaining byte-identical rows × remaining twin markers, order-preserving by sheet
  // position (Amendment #4 — silent, zero creates, zero reviews).
  for (const g of deferredGroups) {
    const rs = g.rows.slice().sort((a, b) => rowPosOf(a) - rowPosOf(b));
    const cs = g.cands.slice().sort((a, b) => storedPosOf(a) - storedPosOf(b));
    const n = Math.min(rs.length, cs.length);
    for (let i = 0; i < n; i += 1) recoverDecision(rs[i].rowIndex, cs[i].markerId);
    for (let i = n; i < rs.length; i += 1) overlapPool.push(rs[i]); // defensive; reservation forbids this
  }
  if (deferredGroups.length > 0) overlapPool.sort((a, b) => a.rowIndex - b.rowIndex);

  // --- Pass 3b: Tier-4 field-overlap recovery (slice-1 semantics, plus the cross-scope
  // shield: a marker whose baseline reappeared verbatim in another scope's blank rows is
  // never eliminated-against locally — it follows normal delete semantics instead).
  if (overlapPool.length > 0) {
    let remaining = leftoverFor().filter((s) => !crossShielded(s)); // stored order
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
        const weakList = weakCandidatesFor(e, remaining);
        if (weakList.length > 0) {
          decisions.push(reviewDecision(e.rowIndex, 'ambiguous-identity', {
            candidateMarkerIds: weakList.map((s) => s.markerId)
          }));
          continue;
        }
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
