# P2-02 follow-up — YDocProvider overlap + Phase 30 Playwright leftovers

- Date: 2026-08-20
- Status: **repaired** (YDocProvider) + **retired** (Phase 30 Playwright leftovers)
- IDs: P2-02 follow-up (overlap + leftover specs). Collab-ux IDs P1-30 / P2-12 / P2-16 restored into the same provider file.

## 1. YDocProvider — repaired, not intact

The current file was the **pre-audit baseline**, not a last-write of one landing over the other. Both landings were missing from this tree (P2-02 outbox Retry + collab-ux access-removed / live Restore? seams). Fix logs `collab-ux.md` and `p2-02.md` were also absent.

Restored a minimum viable merge so **both** behaviors are present:

| Behavior | Source | Now in `YDocProvider.jsx` |
|---|---|---|
| Access-removed banner outranks sign-in expiry | collab-ux P2-12 | `storageStateAfterSignedOut` / `storageStateAfterResignIn` / `storageStateWhenAccessRevoked` + `accessRevokedRef` |
| Restore? from live selection seams | collab-ux P1-30 / P2-16 | `isLocallyInteractingWith` (Phase-29 window + `__selectedAnnotationIds` + selected SVG `cursor:move`) |
| Stuck banner / quarantine overlay still mount | P2-02 | `useDualWriteQueue` + `QuarantineMarkerOverlay` unchanged at the call site |
| Retry now → live outbox | P2-02 | `retryActiveOutboxes({ documentId, actorUserId })` |
| Deleted-queue drain | P2-02 | `drainQueue` / `__crdtForceLegacyFail` / `__crdtForceFailAnnoId` **removed** |

Helpers restored because the merge imports them (they had not persisted):

- `src/components/collab/collabBannerState.js`
- `src/components/collab/remoteDeleteInteraction.js`
- `src/services/annotationDocSync.js` — re-exported `retryActiveOutboxes` (P2-02's export was missing; Retry now cannot compile without it)

`crdtDualWriteQueue` was **not** recreated.

## 2. Phase 30 Playwright leftovers — retired

Could not retarget without a live collab stack (mounted `useAnnotationDoc` handle + outbox-injection seam + real bbox feed). Retired with comments pointing at the live outbox.

| Spec | Action |
|---|---|
| `tests/phase30/phase30-stuck-queue-banner.spec.mjs` | `test.skip` — was `__crdtForceLegacyFail` → deleted drain path |
| `tests/phase30/phase30-quarantine-marker.spec.mjs` | `test.skip` — was `__crdtForceFailAnnoId` → deleted queue quarantine |
| `tests/phase30/phase30-unit-suite.test.mjs` | dropped `crdtDualWriteQueue.test.mjs` import |
| `tests/phase30/phase30-backfill-roundtrip.spec.mjs` | untouched (backfill seams, not the deleted queue) |
| `tests/phase30/phase30-edit-during-backfill.spec.mjs` | untouched (same) |

## Tests

```
node --test tests/ydocProviderOverlap.test.mjs tests/collabBannerState.test.mjs tests/remoteDeleteInteraction.test.mjs tests/phase30/phase30-unit-suite.test.mjs
```

**32 pass / 0 fail / 9 skipped** (pre-existing yjs-missing backfill scaffolds).

Covered: both wirings present in `YDocProvider.jsx`; revoke-then-expiry keeps `permission_revoked`; re-sign-in does not clear a still-revoked lockout; Restore? matches Phase-29 / SVG-mirror / `cursor:move` and stays silent with no binding; `retryActiveOutboxes` no-ops when no handle is mounted.

## Remaining risk

- `useDualWriteQueue` / `useTabPendingDualWrite` still poll `crdtDualWriteQueue` (P2-02 hook retarget did not persist). Banner/tab dots will stay dark until those hooks read `summarizeOutboxRetry` / `annotationDocOutbox`.
- `src/services/annotationOutboxRetryView.js` is still missing in this tree.
- `crdtDualWriteQueue.js` still exists on disk; YDocProvider no longer imports it. Do not recreate producers.
- `retryActiveOutboxes` only flushes handles already opened by `useAnnotationDoc`.
- Quarantine overlay still uses stub bboxes (page 0) — pre-existing.
- Retired Playwright specs are not a live-collab substitute.
