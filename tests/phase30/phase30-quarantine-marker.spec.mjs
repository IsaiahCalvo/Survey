/**
 * tests/phase30/phase30-quarantine-marker.spec.mjs
 *
 * RETIRED 2026-08-20 (P2-02 follow-up).
 *
 * This Plan 30-01 scaffold injected `window.__crdtForceFailAnnoId` and poked
 * `crdtDualWriteQueue` until `attempts === 10`. Live quarantine lives on
 * `annotationDocOutbox` (`listAllQuarantinedForActor` / `summarizeOutboxRetry`).
 *
 * Retargeting this Playwright spec needs a live collab stack plus per-page
 * bbox plumbing for `QuarantineMarkerOverlay` (still stubbed at page 0).
 * Do not recreate `crdtDualWriteQueue` to make this green.
 *
 * Coverage instead:
 *   - `tests/annotationOutboxRetryView.test.mjs` (quarantine vs pending)
 *   - `tests/ydocProviderOverlap.test.mjs` (overlay still mounts from hook)
 */

import { test } from '@playwright/test';

test.skip(
  "phase30-quarantine-marker: retired — __crdtForceFailAnnoId targeted deleted crdtDualWriteQueue",
  () => {
    // Intentionally empty. See file header.
  },
);
