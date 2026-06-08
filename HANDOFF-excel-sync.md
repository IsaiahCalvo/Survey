# Handoff — Excel ↔ Survey Marker sync rebuild (Stage 0 underway)

**Updated:** 2026-06-08. **Branch:** `main` (local, unpushed — direct-to-main; the user tests on their dev server; push only on their say-so).

> ⚠️ **READ FIRST — the plan was amended 2026-06-08.** Nine owner product decisions now GOVERN where they differ from the original plan body — see the "Product Decision Amendments — 2026-06-08 (GOVERNING)" section at the top of `PLAN.md`. Headline changes: Excel **may** delete, but only items it previously received/acknowledged (not "never delete a placed marker"); clean new rows go **straight to the Survey panel** as unplaced items (no import inbox); duplicate **names** are fine — only broken tracking identity asks "Needs your choice"; **every row gets a full visible-value fingerprint**; **no hidden ID columns/rows on visible sheets** (identity lives in `_SurveyMetadata` + the app record); conflict = same field changed on both sides before sync; per-row red exclamation icon for sync problems (asset at `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`); prove each Excel setup before promising live sync. The Stage 0 safety slices already shipped are **temporary protection** that stays until the smarter logic replaces it.

This is the entry point for the next session. Read this, then `PLAN.md` (amendments section first).

---

## Where we are

The plan is **locked and approved**. It was grilled with the user (Act 1 of grill-me-codex) then survived **5 adversarial Codex rounds** (Act 2) — full argument in `PLAN-REVIEW-LOG.md`. The first slice of Stage 0 is **built and proven end-to-end against the real backend**; the rest of Stage 0 (the live wiring in the big viewer) is the next job.

**The goal (driving north star, set this session):** three tracks, in order — (1) never lose the user's data, (2) make zoom/pan feel like the demo, (3) collapse to one of everything. We are on track 1. Excel-sync data integrity is the first piece of track 1.

---

## Read these (the build contract + evidence)

- `PLAN.md` — the staged build contract (Stages 0–6 + migration preflight, core safety invariants, Preserve/Do-Not-Break, acceptance criteria). **The source of truth for what to build.**
- `PLAN-REVIEW-LOG.md` — the full 5-round Claude↔Codex argument and every decision/rejection.
- `.planning/optimization/EXCEL-SYNC-MAP.md` — how the sync works today, file:line, the bug.
- `.planning/optimization/EXCEL-SYNC-UX-PLAYBOOK.md` — the collaboration UX (proven by Figma/Google/Linear/Notion/Bluebeam/MS 365).
- `.planning/optimization/EXCEL-SYNC-IMPACT.md` — exact stage→files map, the Preserve/Do-Not-Break list, the new-checklist-item-modal answer, and the verification recipe.

---

## What landed (committed on local `main`, 2026-06-08)

Three Stage 0 safety slices are now committed (direct-to-main; not pushed):
1. `984e4121` — **origin-aware reconcile foundation** (engine level; behavior-neutral on the live app).
2. `490ddb4c` — **never destroy a placed Survey Marker on import** (live fix at both `executeExcelImport`/`executeAutoExcelImport` delete sites; pure tested predicate `isPlacedSurveyMarker` + `computeImportDeletionCandidates` in `surveyMarkerSyncDiff.js`; `tests/importNeverDeletesPlacedMarker.test.mjs`, 7/7). **Temporary guard** — Amendment #1 will later allow deleting items Excel previously received.
3. `1d3a58ad` — **gate the silent open-time import** (`loadLatestSurveyData`) on a fresh-computed pending-changes check; fails closed (no baseline → no auto-import); `tests/excelSyncDirtyBaseline.test.mjs` (gate #3). Manual sync untouched.

Full suite **946 pass / 0 fail / 6 skipped**, `npx vite build` clean.

---

## Engine foundation detail (slice 1)

The corruption fix's **foundation**: the durable survey-marker reconcile is now origin-aware.
- `src/services/annotationDocStore.js` — `syncSurveyMarkersToDoc` now: when `origin === 'excel-import'` it is **additive/patch-only** (never deletes a key the imported dict omits), and it honors a `protectedIds` set (never delete those, even on a local reconcile). Default (`origin: 'local'`, no `protectedIds`) behavior is unchanged.
- `src/services/annotationDocSync.js` — `applySurveyMarkers(markers, opts)` now forwards `{ origin, protectedIds }` (default origin `'local'`, so live behavior is unchanged until the import path opts in).
- `tests/excelImportOriginGuard.test.mjs` — NEW unit test (4 cases, green).
- `agent-cli/excel-corruption-e2e.mjs` — NEW end-to-end harness against the real backend.

**Proof (all green):** `node --test tests/excelImportOriginGuard.test.mjs` (4/4); `node scripts/run-node-tests.mjs` (935 pass / 0 fail / 6 skipped); `node agent-cli/excel-corruption-e2e.mjs` (CONTROL reproduces the data loss; FIX/GUARD/PATCH confirm it's stopped); `npx vite build` clean.

**Reviewed:** the `openai/codex-plugin-cc` plugin is installed (user scope; its `/codex:*` slash commands appear after a Claude Code restart). Its Codex engine gave the harness + plan a round-6 hardening pass → now **APPROVED**: it caught that the harness over-claimed an app-level fix (now scoped to engine-layer), that Stage 0 needed the writeback kill-switch + import field whitelist, and that the builder snapshot gate belongs before Stage 1. All folded into `PLAN.md` and `PLAN-REVIEW-LOG.md`.

> Important: the store guard exists but the **live app does not benefit yet** — the viewer's import path still calls the reconcile with the default `'local'` origin. So the live bug is still present until the next step lands. The e2e harness proves the engine-level fix; the wiring makes it real.

---

## NEXT STEP (recommended — start here)

**Done so far (Stage 0):** placed-marker import guard (slice 2) and the silent open-time import gate (slice 3). **Still to close in Stage 0**, in `src/PDFViewer.jsx` (high-risk, ~34k lines — minimum-viable-diff, `npm test` after, report baseline):

1. **Writeback kill-switch (highest value next):** disable automatic full-file re-upload + live-sync writeback (the old whole-workbook rebuild) until Stage 3's safe patch-writer + queue land; leave only manual export-to-a-clean-copy. In the import transaction, **whitelist writable fields** (answers/name/note/entity) so an import can never set geometry or introduce a placed marker; treat `protectedIds` as write-protected for imports.
2. Thread a real `origin: 'excel-import'` through the capture effect (`useAnnotationDoc` → `applySurveyMarkers`) during import so the durable Y.Doc gets the additive guard too (defense-in-depth; today the import path still flows through the default `'local'` origin even though the engine supports `'excel-import'`).
3. Persist the last-synced baseline durably (today it's an in-memory ref lost on reload) so the dirty check isn't falsely true after every reopen; replace the `selectedTemplate.updatedAt` watermark with a workbook **eTag + content hash**; keep failing closed to "review required" when no baseline exists.
4. Add per-marker export-acknowledgment metadata (`exportedAt` / `exportAckEtag` / `createdByApp`) — the prerequisite for **Amendment #1** (Excel may delete only items it previously received). The current "never delete a placed marker" guard stays until this exists, then is replaced by the received-only rule.
5. Stand up the sync journal (a new service + a Supabase audit table).

**Pre-Stage-0 test gates:** never-delete-placed-marker ✅ done; durable-baseline (fail-closed) ✅ done; still to add — an **auto-save-never-pushes-Excel** test (silent save never reaches `pushToExcelWithRetry`), which pairs with the writeback kill-switch.
**Pre-Stage-1 gate:** a builder-output snapshot test that freezes today's sheet names / header + column order / `_SurveyMetadata` cells / column widths / colors — it must exist before any Stage 1 builder/parser change (it also guards the Stage 3 cutover). **Per Amendment #5 the snapshot now also forbids any new hidden column/row on a visible sheet** — identity metadata goes only in `_SurveyMetadata` + the app record.

After Stage 0: **Stage 1** (full-row fingerprints for every row + identity in `_SurveyMetadata`/app-record — *no hidden visible-sheet columns*; the shared `SYSTEM_COLUMNS` skip-list de-dup; **clean new rows straight to the Survey panel as unplaced items**; duplicate names allowed, only broken identity asks "Needs your choice"; one-time unambiguous-only identity backfill), **Stage 2** (tombstones + 30-day trash + history), **Stage 3** (patch-only writes + durable outbound queue + Graph concurrency — spike gate + the 3-setup capability proofs from Amendment #8), **Stage 4** (conflict = same field both sides + per-field LWW), **Stage 5** (quiet collab UX + the per-row red exclamation icon), **Stage 6** (live cadence). See `PLAN.md` (amendments govern).

---

## Hard guarantees made to the user (do not violate)

- **The Excel sheet builder + all formatting are preserved.** First-time creation always uses the existing builder; in Stage 3 it is *extracted* (cut-and-lift, no logic change), never rewritten. Patch writes run only against a workbook the builder already created and must NOT re-apply conditional formatting / dropdowns. Full Preserve/Do-Not-Break list in `EXCEL-SYNC-IMPACT.md` §4 and `PLAN.md`.
- **The new-checklist-item modal (`NewColumnsModal`) is KEPT exactly**, including the "Modify disabled when the template is shared" protection. The only change: de-dup the existing system skip-list into a shared `SYSTEM_COLUMNS` constant in `src/viewerShared.js`, replacing the four inline literals (`PDFViewer.jsx:13070, 13487, 14244, 14412`). **No new hidden columns are added to visible sheets** (Amendment #5) — identity lives in `_SurveyMetadata` + the app record.
- **Excel can place nothing, but may delete what it received** (Amendment #1). It may edit answers/name/note/entity and a clean new row appears **directly in the Survey panel** as an unplaced item with the orange locate button (Amendment #2). It can never place or touch geometry. It may delete a marker **only if that marker was previously synced/acknowledged to Excel** — never app-created work Excel never received — and always recoverably.
- **Conflicts** = the same field changed on both sides before a sync (Amendment #6); placing a marker while Excel edits that row's attributes is NOT a conflict (keep placement, apply attributes). Per-field last-writer-wins, old value in history, no prompt — but never clobber a field the user is actively typing in.
- **Identity = full visible-value row fingerprint** (Changed By, Changed Date, Item, every checklist answer, Entity, full Notes) for every row, plus `_SurveyMetadata`/app-record IDs — never Item name alone (Amendments #4, #9).
- **Per-row sync problems** show a red circled exclamation icon on the Survey-panel row (asset `/Users/isaiahcalvo/Downloads/exclamation-circle-svgrepo-com.svg`) with a hover explanation — never a global warning (Amendment #7).
- **Anyone can edit/remove**; deletes are recoverable (30-day trash); no broadcast popups.
- **Contract invariants untouched:** container-aware canvas sizing, single-name fontFamily, the `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer.jsx`.

---

## How to self-verify (no user needed)

- Unit: `node --test tests/excelImportOriginGuard.test.mjs`
- Full suite (standing gate): `node scripts/run-node-tests.mjs`  → expect 935+ pass / 0 fail
- End-to-end vs real backend: `node agent-cli/excel-corruption-e2e.mjs`  (needs `.env`/`.env.local`, already on this machine; `--keep` to leave the throwaway docs)
- Build: `npx vite build`
- Existing durable-path harness (keep green): `node agent-cli/yjs-roundtrip.mjs`

---

## Setup
Real-backend harnesses need `.env`/`.env.local` (present on this machine). Dev server for live checks: `npm run dev:ui` (port 5174), drive via Playwright MCP.
