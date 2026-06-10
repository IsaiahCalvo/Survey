# Plan: KAL-82 slice 1 — delete Dashboard dead code (audit-verified)
_2026-06-10 overnight loop. First CODE-CHANGE task of the night (cap 1/6). Evidence base: BL-18 audit (DND-CONSOLIDATION-AUDIT.md) + BL-17 audit (SELECT-MODE-AUDIT.md), both independently Codex-fact-checked, both confirming the same dead blocks in src/Dashboard.jsx._

## Goal
Remove ONLY the provably-dead Dashboard code identified by two audits, leaving the file-drop handlers UNTOUCHED (their delete-or-rewire fate is Isaiah's recorded decision item). No behavior change; hub renders via SurveyHub exactly as before.

## What gets deleted (per the audits; re-verify each before cutting)
1. Orphaned reorder plumbing (BL-18 #16): entity/module/category dnd-kit sensors + handlers (`Dashboard.jsx:198-236, 2346-2360, 2603-2617`), their `templateReorderUtils`/dnd-kit imports IF no other use remains, and the dead entity body-class effects tied to them.
2. Legacy selection mode (BL-17 B4): `isSelectionMode`/`selectedIds` state (`:372-373`), helpers (`isItemSelected`, `toggleSelectItem`, `selectAllCurrent`, `handleEnterSelectionMode`, click-outside logic `:1154-1223`), the unused bulk handlers (`handleBulkDelete/Copy/Share`, `handleMoveToProject`), AND the dead adjacent bits Codex round-1 enumerated: `isMoveModalOpen` state, `handleBulkMove`, `handleContainerClick`, and the selection branch inside `handleSectionNavClick`.
   **CONFIRMED external caller (Codex round-1): `AppShell.jsx:591-592` calls `dashboardRef.current.exitSelectionMode()` — the imperative-handle member STAYS as a documented no-op** (comment: legacy selection mode removed; kept for the AppShell call site until that caller is cleaned separately).
3. Comment hygiene: any LIVE hub comments referencing the deleted handler names get reworded so the zero-reference grep passes cleanly.
4. Scope boundary: `src/Dashboard.jsx` ONLY. Remove Dashboard's `templateReorderUtils`/dnd-kit imports if now unused IN DASHBOARD; the `templateReorderUtils.js` file itself stays (it has other consumers and its own cleanup item in the BL-18 plan).

## What does NOT get deleted
- File-drop handlers (`:846-865`) — Isaiah's pending decision (rewire vs delete).
- Anything with a live reference found during re-verification — if found, document and keep.

## Method
1. Re-verify each block: grep every symbol for references (rendered JSX, props, refs, imperative handles, AppShell/SurveyHub consumers). The audits did this; re-do it fresh at HEAD per fallow rules (never delete on a stale finding).
2. Delete in ONE commit, smallest coherent diff; no refactoring of surviving code.
3. Gates: `npx vite build` + `node scripts/run-node-tests.mjs` (1355/1349/6/0 expected unchanged — Dashboard has no tests pinning the dead code) + a grep proving zero remaining references to deleted symbols.
4. Codex reviews the staged diff; iterate; local commit only.

## Risks
- The imperative handle (`exitSelectionMode`) may be consumed by a parent — handled by evidence-first rule above.
- Dashboard.jsx is NOT on the high-risk list, but it hosts live hub plumbing (`hubDeleteDocuments` etc.) — touch nothing outside the identified blocks.

## Out of scope
File-drop disposition; helper de-duplication (K84-2); any other KAL-82 candidates (rendering dead branch etc. — separate slices); pushes.
