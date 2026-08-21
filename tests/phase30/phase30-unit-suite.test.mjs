// tests/phase30/phase30-unit-suite.test.mjs
// Phase 30 Wave 0 — npm test glob bridge.
//
// The Phase 30 unit test scaffolds live co-located under src/<area>/__tests__/
// per Plan 30-01's `<files>` block. The project's `npm test` script globs only
// `tests/**/*.test.mjs` (locked, no plan waiver to widen it), so this thin
// bridge file re-imports each scaffold so node:test discovers their `test()`
// registrations during the npm-test run.
//
// This file contains zero of its own assertions — it's purely a discovery
// bridge so the Plan 30-01 acceptance criterion `npm test 2>&1 | grep ...`
// matches the colocated scaffolds.

import '../../src/lib/collab/__tests__/crdtBackfill.test.mjs';
import '../../src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs';
import '../../src/services/__tests__/annotationCloudSync.dualWrite.test.mjs';
import '../../src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs';
import '../../src/hooks/__tests__/useDualWriteQueue.test.mjs';
// useAnnotationCloudSync.dualWrite.test.mjs was deleted 2026-07-17 with the
// retired (unmounted) useAnnotationCloudSync hook module.
import '../../src/hooks/__tests__/useTabPendingDualWrite.test.mjs';
