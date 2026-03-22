# Deferred Items - Phase 04

## Pre-existing Test Failures

The following 7 test failures exist in the full E2E suite and are NOT caused by Phase 4 changes. They all share the same root cause: `debugBridge.waitFor('ready')` times out because `annotationsMounted` is false (page 10 has no annotations mounted).

### Affected Tests

1. `bridge-snapshot.spec.mjs` - 5 tests (INST-01, INST-02, INST-05, INST-06, pageStatus)
2. `readiness-signals.spec.mjs` - 1 test (waitFor ready resolves)
3. `zoom-flicker.spec.mjs` - 1 test (zoom-flicker scenario)

### Root Cause

`debugBridge.waitFor('ready')` requires `annotationsMounted` to be true, which requires ALL visible pages to have annotations. Page 10 does not have annotations mounted (`perPageAnnotationStatus: {"6":true,"7":true,"8":true,"9":true,"10":false}`). This is a debugBridge configuration issue, not a zoom/PAL issue.

### Verification

Confirmed pre-existing by stashing Phase 4 changes and running `bridge-snapshot` tests on clean code -- same failure.
