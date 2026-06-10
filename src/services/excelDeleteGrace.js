// src/services/excelDeleteGrace.js
//
// One-import delete-grace window for Excel-driven deletion (blank-Row-ID plan,
// slice 4 — .planning/blank-rowid-matching-verdict.md, Amendment #5). Accepted
// product behavior: deletes take effect one save later.
//
// Problem: a previously-received marker (exportedAt present) whose row was missing
// from an imported save used to be auto-trashed in that SAME import. A row cut in
// one save and pasted back in the next — or an AutoSave burst landing mid-edit —
// therefore trashed the original and recreated it as a new marker, severing its
// pin, history, and identity.
//
// Behavior now: the FIRST import that misses the row does NOT trash; it stamps a
// pending-delete mark (pendingDeleteSince + pendingDeleteSeq) onto the marker's
// excelSync record. A LATER import then either:
//   • rebinds the row by any matcher tier (Row-ID token / exact fingerprint /
//     positional / field-overlap) → the apply path restamps excelSync wholesale
//     with a fresh identity record, so the mark vanishes; a both-sides 'conflict'
//     review clears it explicitly in the executor — no trash, no prompt, no
//     duplicate; or
//   • still finds the marker unmatched → the shipped trash path (History event +
//     30-day tombstone, one-click restore) runs exactly as before.
//
// The mark rides excelSync, which is sync bookkeeping: DEVICE-LOCAL (not in the
// Supabase mapper), excluded from the Excel-sync dirty fingerprint (stamping never
// makes a synced survey read unsynced), and replaced wholesale by every export and
// import-apply restamp — so matched markers and legacy records (which simply lack
// the two fields) can never carry a stale mark. Pure module: nothing is mutated;
// callers receive new records. The only clock is an overridable `now` default.

const validSeq = (seq) => (Number.isInteger(seq) && seq > 0 ? seq : null);

/** True when the record carries a pending-delete mark (either field counts). */
export const hasPendingDeleteMark = (excelSync) =>
  Boolean(excelSync && (excelSync.pendingDeleteSince != null || excelSync.pendingDeleteSeq != null));

/**
 * Decide ONE candidate-delete marker that already passed the existing executor
 * gates (received by Excel + trusted recency). Never widens deletion: 'trash' is
 * only ever returned where the pre-grace code would have trashed anyway.
 *
 * @param {object|null} excelSync  the marker's identity record (legacy records and
 *        null are valid and simply have no mark → 'defer')
 * @param {{ingestSeq?:number|null}} [opts]  THIS import's ingest sequence — a mark
 *        stamped by the same ingest never counts as a prior miss (defensive; the
 *        executors check before stamping, so this only matters if both ever run
 *        against one ingest).
 * @returns {'trash'|'defer'}  'trash' = a mark from an EARLIER import exists →
 *          proceed with the shipped trash path unchanged; 'defer' = first miss →
 *          stamp/keep the mark instead of trashing.
 */
export const triageCandidateDelete = (excelSync, { ingestSeq = null } = {}) => {
  if (!hasPendingDeleteMark(excelSync)) return 'defer';
  const markSeq = validSeq(excelSync.pendingDeleteSeq);
  const nowSeq = validSeq(ingestSeq);
  if (markSeq != null && nowSeq != null && markSeq === nowSeq) return 'defer';
  return 'trash';
};

/**
 * Return a NEW excelSync record carrying the pending-delete mark. An existing mark
 * is preserved unchanged (the first-miss stamp keeps its meaning); all other
 * fields pass through untouched. Accepts null/undefined (degenerate records) —
 * the result still carries the mark so the next import can act on it.
 *
 * @param {object|null} excelSync
 * @param {{ingestSeq?:number|null, now?:number}} [opts]
 * @returns {object} a new record (or the same reference when already marked)
 */
export const markPendingDelete = (excelSync, { ingestSeq = null, now = Date.now() } = {}) => {
  const base = excelSync && typeof excelSync === 'object' ? excelSync : {};
  if (hasPendingDeleteMark(base)) return base;
  const seq = validSeq(ingestSeq);
  return { ...base, pendingDeleteSince: now, ...(seq != null ? { pendingDeleteSeq: seq } : {}) };
};

/**
 * Return the record without its pending-delete mark. Returns the SAME reference
 * when there is nothing to clear, so callers can cheaply detect "no change"
 * (legacy records and unmarked records pass through untouched).
 *
 * @param {object|null} excelSync
 * @returns {object|null}
 */
export const clearPendingDeleteMark = (excelSync) => {
  if (!hasPendingDeleteMark(excelSync)) return excelSync;
  const { pendingDeleteSince, pendingDeleteSeq, ...rest } = excelSync;
  return rest;
};
