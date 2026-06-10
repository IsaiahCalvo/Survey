# PLAN BL-17 S1 — id-keyed bulk selection (fix audit finding B1)

_Status: PLAN ONLY — written 2026-06-10 while the code-change cap is full (6/6).
Execute in a later session once Isaiah confirms testing. Source: select-mode audit
`.planning/optimization/SELECT-MODE-AUDIT.md` finding B1 + slice S1 (commit
b30e3667). Plan-review log: `PLAN-BL17-S1-REVIEW-LOG.md`._

## Problem

Two live multi-select surfaces key their selection by **array position** instead of
stable id. If the list reorders or rebuilds between selecting and acting — live
drag-reorder (projects-tree files), a working-copy rebuild from a host republish
(templates modules), a refetch resort, or any insertion — the bulk action targets
the **wrong items**. Both are data-affecting: files have bulk delete / duplicate /
move-copy; modules have bulk delete / duplicate.

Verified present in today's code (2026-06-10, post-BL-23, post-KAL-82-slice-2):

1. **Projects-tree file select** — `src/home/ProjectsFolderTree.jsx`
   - `selFiles` is a `Set` of indices into `openFiles` (L183; checked at L786
     `selFiles.has(i)`; select-all at L731 `new Set(openFiles.map((_, i) => i))`).
   - `openFiles` is a memo over `localDocs` filtered by project (L260) — it
     re-sorts under drag-reorder (`SortableRearrangeList` at L783 + `reorderFiles`
     at L460) and re-derives on any `localDocs` change.
   - Actions resolve index→doc **at click time**: `duplicateFiles` (L434),
     `deleteFiles` (L443 → `onDeleteDocuments` → hub delete pipeline),
     `moveCopyFiles` (L482).
   - Same-class adjacent hazards, in scope because they're the identical pattern:
     - `moveIndices` (L190-192) holds indices **across an open Move/Copy modal**
       (`setMoveIndices([...selFiles])` at L747, consumed on confirm at L994) —
       the widest staleness window in the file.
     - `fileMenu` stores `{ idx, rect }` (L197) and resolves `openFiles[fileMenu.idx]`
       at render time (L942) with `deleteFiles([fileMenu.idx])` (L954) — an open
       context menu survives a list resort.

2. **Templates-editor module select** — `src/home/TemplatesEditor.jsx`
   - `selMods` is a `Set` of indices (L854; checked at L2227 `selMods.has(mi)`;
     select-all at L2257 `new Set(mods.map((_, i) => i))`).
   - `deleteModules` / `duplicateModules` (L1091 / L1098) act by index via
     `mutateTpl` against `t.modules`. (Bulk surface is delete/duplicate only —
     there is no module bulk move/copy action.)
   - Staleness vector (corrected in review round 1): the modal rows carry a bare
     `draggable` attribute with **no drag handlers** — modal-internal drag-reorder
     is NOT live. The real vector is the working copy being **rebuilt or mutated
     under an open modal**: a clean-state `reloadFromProps` rebuild from a host
     templates republish, or module insertion/removal through another surface.
     Indices held in `selMods` then point at different modules.
   - `renameModule(mi, name)` (L1069, used at L2242 `onBlur`) commits **by index
     at blur time** — the same staleness class, included as a same-pattern fix.
   - Module ids are present after BL-23's `buildRich` (L296), but with a known
     **occurrence-shift corner**: identically-named legacy id-less siblings get
     occurrence-keyed minted ids, so a rebuild after a sibling deletion can hand
     a *surviving* module the id a *different* same-named sibling had before.
     id-keying alone therefore does NOT fully close the rebuild window — the fix
     must also **clear module selection whenever the working copy is rebuilt**
     (see Part B).

`orderedMods` aliases `tpl.modules` directly (L952), so there is no *static*
index mismatch today — the bug class is purely *staleness over time*. Document
ids are always present (`SortableRearrangeList ids={openFiles.map(f => f.id)}`
would already be broken otherwise; local clones get `nextLocalId()`).

Scope note on the file actions: `duplicateFiles` and `moveCopyFiles` mutate
**local state only** (`setLocalDocs`) — no host persistence callback is wired
for them (only `deleteFiles` reaches the hub pipeline via `onDeleteDocuments`).
This slice fixes the selection key; the local-only persistence gap for
duplicate/move-copy is a separate finding recorded for the board, NOT addressed
here.

## Fix shape

Key both selections by **stable id**; resolve ids→items only at action time;
treat unresolvable ids as silent no-ops (a stale id must never hit a wrong target).

### Part A — ProjectsFolderTree.jsx

- `selFiles`: `Set` of document ids. `toggleFileSel(id)` (L225), checkbox render
  `selFiles.has(f.id)` (L786), select-all `new Set(openFiles.map((f) => f.id))`
  (L731). Exit-clears (L452, L457, L500, L770) unchanged.
- **Effective selection is derived, never trusted raw** (same rule as Part B):
  render computes `selectedFiles = openFiles.filter((f) => selFiles.has(f.id))`
  and ALL toolbar reads come from it — the count `c`, `allSel`, button
  enabled/disabled, and the Move/Copy modal's `count`. Raw `selFiles.size` is
  never displayed.
- `duplicateFiles(ids)` / `deleteFiles(ids)`: replace `indices.map((i) => openFiles[i])`
  with an order-preserving `openFiles.filter((f) => idSet.has(f.id))` (via the
  shared helper below), bailing on zero matches. Existing `.filter(Boolean)`
  semantics are preserved by construction — missing ids simply don't match.
- `moveCopyFiles(ids, destId, mode)`: delete the internal index→id conversion at
  L482 (it already works on ids after that line); take ids directly.
- `moveIndices` → `moveIds` (rename state + the two uses at L993-994; the modal
  count displays `pickByIds(openFiles, moveIds).length`, not raw `moveIds.length`,
  so a file disappearing while the modal is open can't overcount).
- `fileMenu`: store `{ id, rect }`; resolve `openFiles.find((f) => f.id === fileMenu.id)`
  at L942; menu Delete passes `[fileMenu.id]`. If the doc no longer exists the
  existing `f` null-guard path renders nothing, same as today.

### Part B — TemplatesEditor.jsx

- `selMods`: `Set` of module ids. `toggleModSel(mod.id)`, `isSel = selMods.has(mod.id)`
  (L2227).
- **Effective selection is derived, never trusted raw**: render computes
  `selectedMods = mods.filter((m) => selMods.has(m.id))` and ALL UI reads come
  from it — the count chip, button enabled/disabled state, and the All/None
  comparison (`selectedMods.length === mods.length`). Stale ids can therefore
  never inflate counts or flip All/None wrongly.
- `deleteModules(idSet)` / `duplicateModules(idSet)`: resolve the matched set
  against `t.modules` FIRST and **bail before `mutateTpl` when zero match** —
  a no-match action must not mark the editor dirty (post-BL-23, a spurious
  dirty would block reloads). Then: delete = `removeByIds`, duplicate = the
  existing push-after loop keyed on `idSet.has(m.id)` (deep re-mint of copy ids
  via `newId('m'/'c'/'i')` untouched). `setOpenMod(0)` / `setOpenCat(-1)`
  resets stay as-is.
- **Clear `selMods` whenever the working copy is rebuilt** (the occurrence-shift
  corner above): add the clear to the existing reload effect's post-rebuild
  step. This adds a side effect at that site but does NOT alter the reload/dirty
  gating semantics (snapshot guard, edit-revision, request-sequence) — those are
  contract, see DO NOT CHANGE.
- `renameModule(id, name)`: look up the module by id inside the `mutateTpl`
  callback instead of `modules[mi]`; the L2242 `onBlur` passes `mod.id`. Same
  no-op-when-missing semantics as today's `if (modules[mi] && ...)` guard.
  **Indirect caller**: `SortableModuleTab` (L452 area) calls `onRename(index, …)`
  — it must pass `mod.id` instead (it already receives the module object).
- The module **Move/Copy button** (L2259 area) exists but is non-functional
  (its modal confirm is a no-op) — out of scope for behavior, but its
  enabled/count reads switch to `selectedMods.length` like every other toolbar
  read, so it can't show a stale state either.
- **Call-site completeness rule (applies to Parts A and B)**: before declaring
  done, `rg -n "selFiles|selMods|fileMenu|toggleFileSel|toggleModSel|moveIndices|renameModule|onRename\("`
  over `src/home/` and every hit must be id-based or a deliberate, commented
  exception. No index-typed survivor.

### Part C — pure helpers + node tests (no jsdom needed)

Precedent: BL-23's leaf util `src/home/templatesEditorReload.js`. New leaf util
`src/home/selectionById.js`:

- `pickByIds(list, ids)` → order-preserving items whose `id` is in `ids`
  (skips non-matching ids silently).
- `removeByIds(list, ids)` → list minus matching ids.
- `duplicateAfterByIds(list, ids, clone)` → push `clone(item)` immediately after
  each matching item.

Helper contract: ids are expected unique per list (true for doc ids and module
ids by construction). Defined behavior if duplicates ever appear anyway: **every**
matching item is affected (filter semantics, no first-wins ambiguity) — pinned
by a test, not left implicit.

Both components consume these; the invariants get pinned in
`tests/selectionById.test.mjs` (node test runner, matches
`scripts/run-node-tests.mjs` globs):

1. **Reorder survival**: select ids of items A and C, reorder the array, apply
   remove/pick/duplicate → exactly A and C are affected.
2. **Stale-id no-op**: an id no longer present affects nothing — and never a
   different item (the core regression this slice exists to prevent).
3. **Duplicate placement + identity**: copies land directly after their source
   and `clone` is called once per matching item, in list order.
4. **Empty/edge**: empty id set → identity (no-op); all-ids → full effect.

## Acceptance criteria

- **Given** two files checked in the projects tree, **when** the file list is
  drag-reordered (or re-derived by a `localDocs` change) and Delete/Duplicate/
  Move-Copy is invoked, **then** exactly the originally-checked files are
  affected (Duplicate and Move-Copy assessed at their current local-state
  semantics — the missing host persistence for those two actions is out of
  scope, recorded separately).
- **Given** modules checked in the Edit-modules modal, **when** `t.modules` is
  reordered or rebuilt between selecting and Delete/Duplicate (e.g. a module
  added/removed through another surface), **then** exactly the
  originally-checked modules are affected — and **when** the working copy is
  rebuilt by `reloadFromProps`, **then** the module selection is cleared
  (occurrence-shift safety).
- **Given** a checked item that was removed by another path before acting,
  **when** the bulk action runs, **then** that id is silently skipped — never a
  wrong target, never a crash, and (Templates) **never a dirty mark when nothing
  matched**; displayed counts/All-None always reflect the *visible* matched
  selection, not the raw id set.
- **Given** the full suite, **when** `npx vite build` and
  `node scripts/run-node-tests.mjs` run, **then** build is clean and the baseline
  (1390 tests / 1384 pass / 0 fail / 6 skipped at plan time) plus the new
  `selectionById` tests all pass.

## DO NOT CHANGE

- `src/PDFViewer.jsx`, `src/components/SVGAnnotationLayer.jsx`,
  `src/PageAnnotationLayer.jsx`, Fabric canvases — out of scope entirely.
- `src/SurveySpacesRail.jsx` survey-panel select modes — that's S4/S5 (and the
  dead copy-mode branch B3 is an Isaiah decision).
- `src/home/Dashboard.jsx` — the BL-23-hardened persistence chain
  (`persistTemplates`/`hubSaveTemplates`) and the templates `useMemo` must
  survive untouched; this slice needs nothing from Dashboard.
- TemplatesEditor's reload/dirty lifecycle **gating semantics** (`reloadFromProps`
  snapshot guard, edit-revision and request-sequence gates,
  `src/home/templatesEditorReload.js`) — BL-23 contract. The single permitted
  touch at that site is adding the `selMods` clear to the post-rebuild step;
  no gate logic changes.
- Checkbox visuals/ARIA (S4) and select-all/exit/confirm semantics (S5 — blocked
  on Isaiah's UX decisions). This slice changes the selection KEY only.

## Risks / notes

- MED risk per the audit (data-affecting selection semantics), but the change is
  mechanical and the helpers make the invariant directly testable without
  component-test infra (jsdom infra remains a queued Isaiah decision).
- TemplatesEditor was reworked by BL-23 days ago; this slice deliberately
  touches only the module-select state + two handlers, not the lifecycle.
- Selection-set pruning on list change is deliberately NOT added: the raw sets
  may briefly hold stale ids, but every visible/effective read (counts, All/None,
  enabled state, action targets) is derived from current rows at use time, so a
  stale id can affect nothing. Pruning effects would only add lifecycle
  complexity to a file that just had its effect lifecycle carefully reworked.
- Separate finding for the board (NOT this slice): projects-tree file Duplicate
  and Move/Copy are local-only (`setLocalDocs`) with no host persistence callback
  — duplicated/moved files likely don't survive a reload. Needs its own ticket +
  product confirmation.
- Gates: `npx vite build` + `node scripts/run-node-tests.mjs`; Codex result
  review after implementation; local commit only, never push.
