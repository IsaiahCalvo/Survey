/**
 * safeSnapshot.js — guards against cloud-backed state being wiped by an empty incoming snapshot.
 *
 * Exports countSnapshotItems (counts object-map entries, arrays, or 'annotation-pages'
 * objects) and resolveSafeSnapshot, which keeps the current value instead of an empty
 * incoming one when the source is cloudBacked, currently has data, and the emptiness
 * isn't confirmed. Returns {value, preserved, currentCount, incomingCount, context}.
 */
export function countSnapshotItems(value, kind = 'object-map') {
  if (!value) return 0;
  if (kind === 'annotation-pages') {
    return Object.values(value || {}).reduce(
      (sum, page) => sum + (Array.isArray(page?.objects) ? page.objects.length : 0),
      0
    );
  }
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 0;
}

// KAL-275 (2026-08-19) — AUDIT NOTE, read before deleting this function.
//
// The `preserve` branch below is currently UNREACHABLE at both call sites.
// Both live in loadSurveyDataFromSupabase (PDFViewer.jsx): the survey-marker
// restore is gated on `!doc.id`, and the spaces restore on
// `shouldRestoreLegacyAnnotationBlob = !doc.id`. Inside those guards `doc.id`
// is falsy, yet each call passes `cloudBacked: !!doc.id` — always false — and
// `preserve` requires `cloudBacked`. So resolveSafeSnapshot degenerates to a
// pass-through of `incoming`, and the two "[SafeSnapshot] preserved ..."
// warnings can never print. That is intentional in effect (cloud documents
// source this state from the durable Y.Doc, not this legacy Storage sidecar),
// just not expressed directly.
//
// It was left in place rather than deleted because the removal is gated on two
// regression tests that DO NOT EXIST YET: a cloud-roundtrip test and a
// re-upload test (see .planning/optimization/PERSISTENCE-ARCHITECTURE.md).
// Deleting it also means retiring tests/safeSnapshot.test.mjs and the
// source-assertion contract in tests/annotationIdleRecoveryContracts.test.mjs
// that pins this exact call site. Write the two gating tests first, then
// remove the function and those tripwires together.
export function resolveSafeSnapshot({
  current,
  incoming,
  kind = 'object-map',
  cloudBacked = false,
  confirmedEmpty = false,
  context = 'snapshot',
} = {}) {
  const currentCount = countSnapshotItems(current, kind);
  const incomingCount = countSnapshotItems(incoming, kind);
  const incomingEmpty = incomingCount === 0;
  const currentHasData = currentCount > 0;
  const preserve = cloudBacked && currentHasData && incomingEmpty && !confirmedEmpty;

  return {
    value: preserve ? current : (incoming ?? (Array.isArray(current) ? [] : {})),
    preserved: preserve,
    currentCount,
    incomingCount,
    context,
  };
}
