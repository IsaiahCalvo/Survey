# Fallow Codebase Audit — 2026-06-04

Tool: fallow 2.88.3 (free static layer). Config added at `.fallowrc.jsonc`.
Repeatable commands: `npm run audit:code | audit:dead | audit:dupes | audit:health`.

## Headline

- Maintainability **80.0 (moderate) → 90.3 (good)**.
- Raw findings were ~80% false positives until the repo's real entry points were
  declared. After config: dead-code noise dropped from 674 to a small, real set.

## What changed (committed to local main)

1. **`.fallowrc.jsonc`** — declares entry points (web app, electron main/preload,
   workers, edge functions, test suites, standalone CLIs/scripts) and excludes
   vendored/build/scratch dirs. This is the single biggest signal-quality win and
   makes every future run trustworthy.
2. **Removed 27 dead orphan files** — zero resolved importers, validated by a
   path-resolving import analysis (`validate-strict.mjs`), a full `vite build`,
   and 888 passing tests. Most were leftovers from the 2026-05-29 chrome-lift
   refactor (CLAUDE.md notes that refactor "left dead orphans").
3. **Declared `@dnd-kit/utilities`** — imported by 4 live screens (TabBar,
   BookmarksPanel, TemplatesEditor, SortableRearrangeList) but undeclared; was
   relying on transitive resolution. Latent break, now fixed.
4. **Broke 2 import cycles** in the collab module by extracting `YDocContext`
   into its own leaf module (fallow's own recommendation). 2 → 0 cycles.

## False positives fallow got wrong (reasoning caught these — did NOT act)

- **Syncfusion shim files** (`src/shims/ej2-*.js`) — flagged dead, but wired via
  `vite.config.js` alias, not imports. Kept; marked as entry in config. Blind
  deletion would have broken the build.
- **The "top dead code" finding** (7 `pdfNativeExport` adapters, "100% dead") —
  actually covered by `tests/pdfNativeExport/adapters/`. Cleared by config.
- **Test files / standalone CLIs / audit scripts** — flagged "unused" only
  because nothing imports them by design. Declared as entry points.

## Deferred — needs your decision (NOT auto-deleted)

These are flagged unused with zero importers, but each is a judgment call:

- `src/authConfig.js` — auth config; sensitive, may be staged/intentional.
- `src/components/OneDriveConnectButton.jsx` + `src/utils/oneDriveUtils.js` —
  a OneDrive feature not currently wired into the UI. Staged feature or dead?
- `src/components/Callout/CalloutCanvas|CalloutComponent|CalloutContextMenu|CalloutEditModal.jsx`
  — the old Callout fork. CLAUDE.md memory: Callout unification is a "dedicated
  migration, not piecemeal." Leave for that migration.
- `src/App.css`, `src/index.css` — global stylesheets; not JS-imported (main.jsx
  uses `styles.css`) but referenced in comments as the CSS-variable source. CSS
  deletion has no test coverage; near-zero benefit. Verify visually before any cut.
- `src/types/database.ts` — generated Supabase types; harmless to keep.
- `src/lib/collab/HocuspocusYjsProvider.js` — dead collab provider (also the last
  remaining undeclared-dependency source). Likely safe but lives in collab.

## Deferred — belongs to the Syncfusion-removal migration

- **~25 unused dependencies**, mostly `@syncfusion/ej2-*` sub-packages
  (-25.0 maintainability, the single biggest remaining deduction). Removing them
  piecemeal while Syncfusion is still the active renderer is risky and low-reward.
  Fold this into the planned Syncfusion → owned-pdf.js cutover (north star).

## Deferred — risk for cosmetic gain (recommend leaving)

- **~215 unused exports.** Heaviest in `src/utils/geometryHitTest.js` (26 per-shape
  hit-test primitives). Unexporting gives a tidier surface with no runtime benefit
  (build already tree-shakes truly-dead code) and a real chance of a subtle
  selection/eraser bug in correctness-critical geometry that no test guards.
- **Duplication 11.1%** — top clone groups are in debug `.spec.mjs` test
  scenarios, not production. Low value to dedupe test boilerplate.
- **Complexity hotspots** — concentrated in the load-bearing monoliths
  (`PDFViewer.jsx` etc.) where CLAUDE.md mandates minimum-viable-diff. Not safe
  to auto-refactor.

## Recommendation

The safe, high-confidence wins are done and verified. The rest is either a
product decision (the deferred files above) or work that should ride along with
the Syncfusion-removal migration rather than a standalone cleanup. Keep
`.fallowrc.jsonc` so future `npm run audit:*` runs stay honest.
