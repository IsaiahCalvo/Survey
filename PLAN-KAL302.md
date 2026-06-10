# PLAN KAL-302 — id-key the module rename-activation pointer (modRename)

_Follow-up to KAL-298 (landed 71a82125). Source: KAL-298 result-verification
findings (PLAN-BL17-S1-REVIEW-LOG.md result section). Small slice; loop session
2026-06-10._

## Problem

KAL-298 made the module rename COMMIT path id-keyed (`renameModule(id, name)`,
both blur call sites pass `mod.id`), but the rename-mode ACTIVATION pointer is
still an array index: `modRename` holds an integer, `SortableModuleTab`'s
double-click calls `onStartRename(index)` (L473), the visibility predicate is
`isRenaming={modRename === mi}` (L572), and `addModule` enters rename mode via
`setModRename(newIndex)` (L1076). After a drag-reorder of module tabs while a
rename is in progress, the rename input visually jumps to whichever module now
occupies the stored index. Display-only — the commit can't hit a wrong target
post-KAL-298 — but it's the same staleness class the slice family exists to
remove.

## Fix shape (src/home/TemplatesEditor.jsx only)

1. `modRename` stores a **module id or null**. Update the L854 comment
   ("module id in rename mode").
2. `SortableModuleTab` double-click: `onStartRename(mod.id)` (mod is in scope).
3. `SortableModuleTabs` render: `isRenaming={modRename === mod.id}`.
4. `addModule`: hoist `const id = newId('m')` ABOVE the `mutateTpl` call, use
   it in the appended module, and `setModRename(id)` in the existing
   setTimeout. Side benefit: the `setRich` updater becomes deterministic
   under StrictMode double-invoke (today each invoke mints a fresh id; the
   hoisted id makes both invocations produce identical output — not claiming
   general idempotence if the updater were applied twice to committed state). `setOpenMod(newIndex)`
   stays index-based — `openMod` id-keying is explicitly OUT of this slice
   (bigger surface: mutateOpenModule, reorderMods bookkeeping, isOn checks,
   deleteModules reset; deferred to a future decision, noted on the ticket).
5. `onCancelRename` (`setModRename(null)`) and `renameModule`'s
   `setModRename(null)` are id-agnostic — unchanged.
6. **Clear rename mode on full working-copy rebuild**: add `setModRename(null)`
   to `reloadFromProps`'s post-rebuild step, directly beside KAL-298's
   `setSelMods(new Set())` and for the same reason — a rebuild can re-mint
   ids for legacy id-less modules (occurrence-shift corner), so a held
   rename-activation id could otherwise reattach to a DIFFERENT same-named
   module after a background republish. (Codex round-1 blocking finding.)
   The append path needs nothing — it never rebuilds existing module ids.

Completeness rule: `rg -n "modRename|onStartRename"` over src/home/ — every
hit must be id-based, null, or a pass-through prop. No integer survivor.

## Acceptance criteria

- **Given** a module tab double-clicked into rename mode, **when** another tab
  is drag-reordered past it, **then** the rename input stays on the
  originally double-clicked module (id match), not the index successor.
- **Given** Add Module, **when** the new tab appears, **then** it opens
  directly in rename mode exactly as today (now keyed by the new module's id).
- **Given** Escape or blur, **when** rename mode exits, **then** behavior is
  unchanged (null reset).
- **Given** a rename in progress, **when** a clean-state templates-prop reload
  rebuilds the working copy (`reloadFromProps`), **then** rename mode exits —
  the input never reattaches to a re-minted id on a different module.
- **Given** the gates, **when** `npx vite build` + `node scripts/run-node-tests.mjs`
  run, **then** build clean and the suite stays at 0 fail (1427/1421/0/6
  observed this session).

## Verification method (per criterion)

The first three criteria are interaction-level with no jsdom infra: verified
by source trace (the id comparison + the rg completeness scan) and queued for
Isaiah's live testing pass per the standing test→report loop — they are NOT
claimed as machine-proven. The reload criterion is verified by source trace of
`reloadFromProps` (clear sits in the same batch as the rebuild). The build +
full-suite gate guards against regressions only.

## DO NOT CHANGE

- `openMod` keying and all its bookkeeping (reorderMods index math,
  deleteModules `setOpenMod(0)`, mutateOpenModule) — out of scope.
- The KAL-298 surface: selMods/selectionById helpers, zero-match bails,
  renameModule signature. `reloadFromProps`: the SINGLE permitted touch is
  adding `setModRename(null)` beside the existing selMods clear — no gate
  logic changes (same carve-out KAL-298 used for the selMods clear).
- BL-23 reload/dirty gating semantics; Dashboard; everything on the standing
  high-risk list.

## Risks / notes

- No new tests: the change is component display state with no pure-logic seam;
  jsdom component-test infra remains a queued Isaiah decision. The existing
  suite + build gate regression; the rename commit invariants are already
  pinned by KAL-298's review trail.
- `modRename` briefly holding a stale id (module deleted while renaming) is
  harmless: no tab matches, no input renders, commit is a no-op by id.
- Gates: build + full suite; Codex result review; local commit only.
