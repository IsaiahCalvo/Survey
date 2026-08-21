# P2-02 complete — live outbox retry view + hook rewire

- Date: 2026-08-20
- Status: fixed
- Decision: **B** (already chosen). This pass finishes the landing that did not persist after the YDocProvider merge.
- IDs: P2-02

## What was still broken

`YDocProvider` Retry already called `retryActiveOutboxes` (left alone). Banner/tab-dot hooks still imported `crdtDualWriteQueue`, and `annotationOutboxRetryView.js` / `summarizeOutboxRetry` were missing.

## Files added

- `src/services/annotationOutboxRetryView.js` — `summarizeOutboxRetry`, `STUCK_THRESHOLD_MS`, `EMPTY_OUTBOX_RETRY`
- `tests/annotationOutboxRetryView.test.mjs`

## Files updated

- `src/services/annotationDocOutbox.js` — `queuedAt`, `listAllPendingForActor`, `listAllQuarantinedForActor`, `getSharedAnnotationOutbox`
- `src/services/annotationDocSync.js` — stamp `queuedAt` on enqueue
- `src/hooks/useDualWriteQueue.js` — polls live outbox via `summarizeOutboxRetry`
- `src/hooks/useTabPendingDualWrite.js` — same for tab dots
- `src/services/annotationCloudSync.js` — removed `enqueueDualWrite` import/calls (dead dual-write helpers stay for P1-55)
- `tests/annotationDocOutbox.test.mjs` — `queuedAt` + actor list

Not edited: `YDocProvider.jsx` Retry / collab-ux merge, `PDFViewer.jsx`. Did not recreate `crdtDualWriteQueue`.

## `crdtDualWriteQueue` imports

**Zero production imports remain.** Grep of `src/hooks`, `src/services`, `YDocProvider.jsx` found only a comment in `annotationOutboxRetryView.js`. The leftover module may still sit on disk; nothing live imports it.

## Tests

```
node --test tests/annotationOutboxRetryView.test.mjs tests/annotationDocOutbox.test.mjs src/hooks/__tests__/useDualWriteQueue.test.mjs src/hooks/__tests__/useTabPendingDualWrite.test.mjs tests/ydocProviderOverlap.test.mjs
```

**24 pass / 0 fail.** Includes `useTabPendingDualWrite` #1–#3 (the previously failing empty-queue source contract).

Covered: empty / fresh pending / stuck >30s / missing `queuedAt` / quarantine vs pending / online-replay drain / per-actor list / no hook imports of the retired queue / Retry still `retryActiveOutboxes` / access-removed + Restore? seams still present.

## Remaining risk

- Orphan `src/lib/collab/crdtDualWriteQueue.js` may still exist; do not re-import it.
- `retryActiveOutboxes` only flushes handles already opened by `useAnnotationDoc`.
- Quarantine overlay still uses stub bboxes (page 0).
- Retired Phase 30 Playwright specs are not a live-collab substitute.
