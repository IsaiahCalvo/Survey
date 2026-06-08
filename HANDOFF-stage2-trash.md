# Handoff — Stage 2: Recoverable trash + tombstones (the recovery net)

**Created:** 2026-06-08. **Branch:** `main` (local, unpushed — direct-to-main; user tests on dev server; push only on their say-so). **Decision is LOCKED (by Isaiah):** build recoverable trash/tombstones **before** ever allowing Excel to delete a placed PDF Survey Marker. The red per-row warning icon waits until the delete/trash logic is safe. The sync-history Supabase table is **not** required for this — recovery lives in the durable store, no backend table, no Codex deliberation needed.

Read this, then `PLAN.md` (the "Product Decision Amendments — 2026-06-08" section governs) and `HANDOFF-excel-sync.md` (Stage 0 state).

---

## Why this is next (the safety ordering)

Stage 0 shipped the safety floor: automatic whole-file Excel writeback is off, imports are attribute-only and can't place/move/erase markers, a marker is only deletable by Excel once it was actually received (has `exportedAt`), and the synced/not-synced state is honest + durable. The remaining destructive path is **deletion itself**: today `handleSurveyMarkerDeleted` hard-deletes a marker (gone from the durable store with no recovery). Amendment #1 says *all* deletes — app-origin today, Excel-origin later — must be **recoverable**. So the recovery net must exist before any delete (especially a future Excel-driven one) is allowed to touch a placed marker.

**Therefore: land recoverable trash first. Only after it's solid do we (a) route app deletes through it, then (b, later) allow received-marker Excel deletes through the same tombstone path.**

---

## The model (decided)

A deleted Survey Marker is **not destroyed** — it becomes a **tombstone**: the marker payload plus `_deletedAt` (ISO) + `_deletedBy` (user id/name) + optional `reason`, held in a durable per-document trash store. Trash is recoverable for **30 days**; restore reinstates the marker (geometry intact); a marker past 30 days is eligible for purge.

**Storage decision:** start with a durable **per-device localStorage store keyed by document** (mirrors the Stage 0 baseline store — simple, no backend, fully unit-testable). This is the deleting user's recovery net immediately. Cross-device/shared trash (promote the tombstone map into the Y.Doc or a Supabase table) is a **follow-up upgrade**, noted but not blocking. Keep the store behind a tiny swappable interface so the upgrade is a drop-in.

This keeps active views unchanged: the delete path still removes the marker from the live `surveyMarkers` React state (so the panel/canvas need no filtering rework), but **writes a tombstone first**. Restore re-adds the marker to `surveyMarkers` and drops the tombstone.

---

## Build order (each slice: pure logic + test, then wire, `node scripts/run-node-tests.mjs` + `npx vite build` green, commit)

1. ✅ **DONE** (`db6be9cd`). Pure service `src/services/surveyMarkerTrash.js` (`TRASH_RETENTION_DAYS=30`, `makeTombstone`, `isTombstoneExpired`, `selectExpiredKeys`, `addTombstone`/`removeTombstone`/`purgeExpired`/`listActiveTrash`) + `tests/surveyMarkerTrash.test.mjs` (8/8).
2. ✅ **DONE** (`db6be9cd`). Durable store `src/services/surveyMarkerTrashStore.js` (localStorage per `pdfId`, swappable storage, graceful) + tests.
3. ✅ **DONE** (`db6be9cd`). Wired `handleSurveyMarkerDeleted`: tombstones each permitted marker (origin `app`) before removal. Best-effort; delete still proceeds if store unavailable.
4. ✅ **DONE** (`db6be9cd` + `2e14802d`). `restoreSurveyMarkerFromTrash(key)` callback exists (re-adds to `surveyMarkers`, drops tombstone); startup purge sweep drops >30-day tombstones; import-driven deletions (`executeExcelImport`/`executeAutoExcelImport`) also tombstone (origin `excel-import`).
5. **NEXT — Minimal Trash UI.** A simple list (deleted item name, when, by whom, Restore button) calling `restoreSurveyMarkerFromTrash`. `restoreSurveyMarkerFromTrash` is currently defined but unused — the UI wires it. Source the list from `loadTrash(pdfId)` → `listActiveTrash(trash, { now })`. Keep it basic; the red per-row warning icon stays deferred until after this.
6. **Only after 5 is solid:** allow Excel-origin deletes of *received* markers to go through the tombstone path (relax the received-only guard so a previously-exported marker absent from Excel becomes a *recoverable* tombstone instead of being protected). This is the actual "Excel can delete what it received" enablement, now safe because it's recoverable. Keep placed-marker protection until verified end-to-end.

**Note on storage:** trash is currently per-device (localStorage). Promote the tombstone map into the Y.Doc (or Supabase) for shared cross-device trash as a follow-up — the store interface (`loadTrash`/`saveTrash`/`clearTrash`) is the only thing that changes.

---

## Hard rules (unchanged, do not violate)

- Manual export stays available; automatic whole-file writeback stays OFF (Stage 0 switch) until Stage 3's patch-writer.
- Never lose unsynced PDF/app work; a marker Excel never received (no `exportedAt`) is never erased by a missing row.
- Contract invariants untouched: container-aware canvas sizing, single-name fontFamily, the `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer.jsx`.
- High-risk files (`PDFViewer.jsx` etc.): minimum-viable-diff, run `node scripts/run-node-tests.mjs` after, report baseline.

## Self-verify (no user needed)

- `node scripts/run-node-tests.mjs` (standing gate; baseline **969 pass / 0 fail / 6 skipped** as of Stage 0 close — keep it green and growing).
- `npx vite build` clean.
- New unit tests per slice (trash logic, store, delete→tombstone, restore round-trip, 30-day purge).

## State at handoff

Stage 0 committed on local `main` (latest first): `2bf3d6fd` handoff update, `59e19b5a` durable baseline, `372a31b5` received-only delete narrowing, `9e62fb52` export-ack stamping, `0eff390e` attribute-only import boundary, `85e9056d` writeback switch, plus the earlier origin guard / placed-marker guard / silent-import gate / plan amendments. Nothing pushed.
