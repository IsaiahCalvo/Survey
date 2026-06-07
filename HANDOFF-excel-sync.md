# Handoff — Excel ↔ Survey Marker sync rebuild (Stage 0 underway)

**Updated:** 2026-06-07. **Branch:** `main` (local, unpushed — direct-to-main; the user tests on their dev server; push only on their say-so). **Nothing is committed yet** — the working tree holds the Stage 0 first slice; land it on local `main` only when the user OKs (they had not yet said "commit" at handoff time).

This is the entry point for the next session. Read this, then `PLAN.md`.

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

## What landed this session (uncommitted, verified)

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

**Finish Stage 0: wire the live import path to use the guard, then close the rest of the safety contract.** In `src/PDFViewer.jsx` (high-risk, ~34k lines — minimum-viable-diff, `npm test` after, report baseline):

1. Route `executeExcelImport` / `executeAutoExcelImport` so the durable write uses `origin: 'excel-import'` (additive) and never sets React survey-marker state in a way that drops an un-exported placed marker. Disable the silent hard-delete of a placed marker (today ~`13247–13382` / ~`13685–13757`) → quarantine instead.
2. Gate the silent startup import (`loadLatestSurveyData` ~`12677–12727`) on `!hasPendingExcelSyncChanges`; replace the `selectedTemplate.updatedAt` watermark with a workbook eTag + content hash.
3. Persist the last-synced baseline durably (today it's an in-memory ref lost on reload) so `hasPendingExcelSyncChanges` isn't falsely true after every reopen; fail closed to "review required" when no baseline exists.
4. Stand up the sync journal (a new service + a Supabase audit table).
5. **Writeback kill-switch (do this early in Stage 0):** disable automatic full-file re-upload + live-sync writeback (the old whole-workbook rebuild) until Stage 3's safe patch-writer + queue land; leave only manual export-to-a-clean-copy. And in the import transaction, **whitelist writable fields** (answers/name/note/entity) so an import can never set geometry or introduce a placed marker; treat `protectedIds` as write-protected for imports.

**Pre-Stage-0 test gates still to add** (per PLAN.md): a never-delete-a-placed-marker test at the viewer level, a durable-baseline test (fresh handle with no in-memory baseline reads as dirty), and an auto-save-never-pushes-Excel test. (The origin-guard test is done.)
**Pre-Stage-1 gate:** a builder-output snapshot test that freezes today's sheet names / header + column order / hidden metadata cells / column widths / colors — it must exist before any Stage 1 builder/parser change (it also guards the Stage 3 cutover). Stage 1's hidden ID columns are snapshot-approved additive drift; the *visible* contract must not change.

After Stage 0: Stage 1 (stable hidden IDs + the shared `SYSTEM_COLUMNS` skip-list + import inbox + ID-stamping migration), Stage 2 (tombstones + 30-day trash + history), Stage 3 (patch-only writes + durable outbound queue + Graph concurrency — has a spike gate), Stage 4 (per-field LWW), Stage 5 (quiet collab UX), Stage 6 (live cadence). See PLAN.md.

---

## Hard guarantees made to the user (do not violate)

- **The Excel sheet builder + all formatting are preserved.** First-time creation always uses the existing builder; in Stage 3 it is *extracted* (cut-and-lift, no logic change), never rewritten. Patch writes run only against a workbook the builder already created and must NOT re-apply conditional formatting / dropdowns. Full Preserve/Do-Not-Break list in `EXCEL-SYNC-IMPACT.md` §4 and `PLAN.md`.
- **The new-checklist-item modal (`NewColumnsModal`) is KEPT exactly**, including the "Modify disabled when the template is shared" protection. The only required change: add the Stage-1 reserved hidden columns to a shared `SYSTEM_COLUMNS` constant in `src/viewerShared.js`, replacing the four inline skip-list literals (`PDFViewer.jsx:13070, 13487, 14244, 14412`), so hidden columns never trigger it.
- **Excel is attribute-only.** It may edit answers/name/note/entity and may *propose* a new row (appears unplaced with the orange locate button), but it can never place or destroy a placed marker or touch geometry.
- **Conflicts:** per-field last-writer-wins, old value kept in history, no prompt — but never clobber a field the user is actively typing in.
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
