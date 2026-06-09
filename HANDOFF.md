# Handoff — START HERE (pointer)

**Updated:** 2026-06-09. This root file is a POINTER, not the handoff itself. Two
sessions in a row started from a stale version of this file and tried to re-ask
already-settled decisions — so the real content now lives in the dated workstream
handoffs and this file only routes you.

## Current entry point

**`HANDOFF-testing-issue.md`** — READ FIRST (2026-06-09 night): Isaiah found an
issue while live-testing and has a proposed solution to discuss; that file says
exactly how to pick the conversation up. Then:

**`HANDOFF-excel-sync-next.md`** — the live workstream state (Excel ↔ Survey
Marker sync workstream). Read it first, together with the two GOVERNING sections
of `PLAN.md`: "Product Decision Amendments — 2026-06-08" and "Amendment
2026-06-08(b)". Those decisions are MADE — never re-ask "answers-only vs
add/remove markers." Short version: Excel may update attributes, add clean rows
as unplaced Survey Markers, and delete only previously-RECEIVED markers
(restorable via History); app-made markers Excel never received are never
deleted.

## Parallel tracks (still valid, separate workstreams)

- `HANDOFF-remove-legacy-engine.md` — persistence unification: undo/redo onto the
  new engine, retire the old CRDT layer, delete the inert legacy cluster, drop
  dead tables. (Survey markers / spaces / callouts already migrated.)
- `.planning/phases/37-pdfjs-cutover/DEMO-PARITY-BLUEPRINT.md` — renderer
  demo-parity + Syncfusion removal.
- `HANDOFF-optimization.md` — security findings batch (verify before assuming fixed).

## Stale traps — do NOT orient from these

- Any older copy of this file (the 2026-06-07 body said "DECISION NEEDED" on
  Excel sync — answered since by the PLAN amendments).
- `.planning/optimization/MASTER-OPEN-ITEMS.md` (2026-06-07) — predates the
  Excel-sync decisions and everything that landed after.
- `HANDOFF-excel-sync.md`, `HANDOFF-stage1-identity.md`, `HANDOFF-stage1-rowid.md`,
  `HANDOFF-stage2-trash.md` — superseded historical records of landed stages.
- The original 5-round Excel-redesign review log was preserved as
  `PLAN-REVIEW-LOG-excel-redesign-2026-06-07.md`; `PLAN-REVIEW-LOG.md` now holds
  the Amendment (b) review.

## Standing workflow rules

Direct-to-main (commit locally, push only on the user's say-so; they test on
their dev server first). Gate every change on `npx vite build` +
`node scripts/run-node-tests.mjs`. Plain-English replies only — no file paths,
code names, or line numbers; always write "Survey Marker" in full.
