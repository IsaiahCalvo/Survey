# Erase-outbox concurrency — WAL / snapshot accept still wakes effects

- Date: 2026-08-20
- Status: **retargeted** (wake path intact; fixtures were no-ops after KB-1)
- IDs: erase-outbox-concurrency (P2-02 outbox rewire + KB-1 eraser policy)

## Root cause

Not an outbox/sync wake regression. `settleAcceptedRecord` and snapshot accept still call `queueEraseOutboxDrain`. `validateEntry` still requires the exact `eraseOutbox` entry in `acceptedDoc`.

KB-1 made `getEraserOperation(rect, 'partial')` return `'skip'`. The two failing tests (and the sibling 42501 effect test) used a rectangle with the default `mode: 'partial'`. `erasePageAnnotations` therefore produced **no delete targets**, `includeDeleteHistory` added **no** `annotation-delete-history` effect, and `commitEraseIntent` wrote an already-`acknowledged` empty outbox tombstone.

Drain then saw `effects.length === 0` / `status === 'acknowledged'`, so `pending` stayed 0, no retry was scheduled, and the consumer never ran. That looks like "accept did not wake effects" but there was nothing authorized to execute.

This is the live eraser contract, not the retired dual-write queue. The tests were retargeted to `mode: 'entire'` so a rect still whole-deletes and still exercises WAL-accept / snapshot-covered accept → effect wake.

## Files

- `tests/annotationDocConcurrency.test.mjs` — `mode: 'entire'` on the three delete-history effect fixtures; helper comment
- Not edited: `annotationDocOutbox.js`, `annotationDocSync.js`, erase-effect worker (wake + `acceptedDoc` gate unchanged)

## Tests

```
node --test --test-name-pattern "accepted ordinary WAL|snapshot-covered erase|delayed 42501 rolls back erase core" tests/annotationDocConcurrency.test.mjs
```

**3 pass / 0 fail.**

Nearby:

```
node --test tests/annotationDocOutbox.test.mjs tests/annotationDocStore.test.mjs tests/annotationDocSyncDurability.test.mjs tests/annotationDocSyncCatchup.test.mjs tests/annotationDocSyncStackedInkRepair.test.mjs tests/annotationDocSyncChannelReuse.test.mjs
```

**68 pass / 0 fail.**

A full `annotationDocConcurrency.test.mjs` run in the same process also hit a pre-existing flake (`never-settling append and snapshot transports do not hold drain forever`); that test passes in isolation and was not changed.

## Remaining risk

- Other rect + default-partial + `includeDeleteHistory` fixtures will silently no-op the same way. Only these three were retargeted.
- Partial + eligible ink still carves (`replace`), so it still will not emit delete-history unless the stroke is fully removed.
- `retryActiveOutboxes` still only flushes mounted handles (P2-02).
- No commit.
