/**
 * tests/phase30/phase30-stuck-queue-banner.spec.mjs
 *
 * RETIRED 2026-08-20 (P2-02 follow-up).
 *
 * This Plan 30-01 scaffold injected `window.__crdtForceLegacyFail` into the
 * deleted `crdtDualWriteQueue` drain path. Live retry is
 * `annotationDocOutbox` (`summarizeOutboxRetry` / `retryActiveOutboxes`).
 *
 * Retargeting this Playwright spec needs a live collab stack, a mounted
 * `useAnnotationDoc` handle, and an outbox-injection seam that does not
 * exist. Do not recreate `crdtDualWriteQueue` to make this green.
 *
 * Coverage instead:
 *   - `tests/annotationOutboxRetryView.test.mjs` (stuck / quarantine view)
 *   - `tests/ydocProviderOverlap.test.mjs` (Retry now → retryActiveOutboxes)
 */

import { test } from '@playwright/test';

test.skip(
  "phase30-stuck-queue-banner: retired — __crdtForceLegacyFail targeted deleted crdtDualWriteQueue",
  () => {
    // Intentionally empty. See file header.
  },
);
