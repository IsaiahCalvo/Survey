# sync-status-history — fix log

Date: 2026-08-20
Allowlist: `src/services/annotationCloudSync.js`, matching tests.
P1-12 and P1-53 were already fixed in wave 1; this file covers P1-55 only.

## P1-55 — Legacy dual-write to `document_annotations` is dead (comments claim live)

- Status: **closed**
- Files changed: `src/services/annotationCloudSync.js` (RETIRED comments; `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`), `src/services/__tests__/annotationCloudSync.dualWrite.test.mjs`
- Intended behavior confirmed: comments no longer claim a live dual-write era. The flag is `false`. A walk of `src/` finds zero production importers of `dualWriteFabricCommit` / `dualWriteFabricDelete` (the functions stay exported so historical scaffolds still resolve).
- Break / adversarial attempts: the old “ALWAYS fires the legacy upsert… dual-write era keeps them whole” sentence is gone; test fails if a new src file starts importing the symbols.
- Edges covered: comment honesty + caller scan. P2-02 (queue never fed) is a separate product decision and was not retired here.
- Test command + result: `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` → pass
- Remaining risk: the unused functions still exist and would write `document_annotations` if something called them. Live persistence remains `annotationDocSync` / the Y.Doc outbox. Whether to delete the helpers is owned by the P2-02 offline-queue decision.
