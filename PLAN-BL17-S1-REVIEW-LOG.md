# Plan Review Log: BL-17 S1 — id-keyed bulk selection
Started 2026-06-10 ~14:50 (loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-BL17-S1.md.
Plan-only session (code-change cap full); execution happens in a later session.

## Round 1 — Codex
```
Read-only; no files changed.

Material flaws:

- `TemplatesEditor` id stability claim false. BL-23 explicitly accepts same-label legacy id-less rows shifting/reusing minted ids. Fix: clear `selMods` on clean prop reload/template rebuild, or persist real module ids before selection.
- Stale ids are not harmless if toolbar uses raw `Set.size`: `allSel`, button enabled state, and counts can be wrong; Templates no-match delete/duplicate still marks dirty via `mutateTpl`. Fix: derive current matched ids from visible list; bail before mutate if zero matches.
- Missed index call sites: file row/checkbox still call `toggleFileSel(i)`; file menu toggle still compares/stores `idx`; module checkbox still calls `toggleModSel(mi)`. Fix: replace every `selFiles`/`selMods`/`fileMenu.idx` rg hit.
- Plan says edit-modules modal drag reorder is live. It is not; rows only have `draggable`, no handlers. Fix: change acceptance to reload/reorder-from-props, or implement modal DnD.
- Templates module Move/Copy is not data-affecting; modal buttons only close. Fix: exclude it from claims, or implement using selected module ids.
- If reload/reorder while edit-modules modal open is in scope, `renameModule(mi)` remains index-stale. Fix: rename by module id or declare out of scope.
- Projects duplicate/move-copy are local-only; `ProjectsFolderTree` does not receive Dashboard’s `onDuplicateDocuments`/`onMoveCopyDocuments`. Fix: wire callbacks or narrow acceptance to local UI behavior.
- Helper contract missing duplicate-id behavior. Fix: assert unique ids in tests/guards, or define “all matching duplicate ids are affected.”

VERDICT: REVISE```

### Claude's response (all 8 accepted, 2 verified in source first)
1. ACCEPTED — module-id occurrence-shift corner (BL-23 minted ids can transfer to a same-named sibling on rebuild): added "clear selMods on working-copy rebuild" to Part B + acceptance criteria.
2. ACCEPTED — counts/All-None now derive from the VISIBLE matched selection; handlers bail before mutateTpl on zero matches so a stale no-op can never dirty the editor.
3. ACCEPTED — added an rg-based call-site completeness rule (every selFiles/selMods/fileMenu/toggle*/moveIndices/renameModule hit must be id-based or a commented exception).
4. ACCEPTED after verification — confirmed the modal rows have a bare `draggable` with no handlers; corrected the staleness vector to working-copy rebuild/mutation and reworded the acceptance criterion.
5. ACCEPTED — removed "move" from module-surface claims (bulk surface is delete/duplicate only).
6. ACCEPTED — renameModule(mi)→renameModule(id) folded in as a same-pattern fix (verified index-at-blur in source).
7. ACCEPTED — narrowed file Duplicate/Move-Copy acceptance to local-state semantics; the local-only persistence gap recorded as a separate board finding, not this slice.
8. ACCEPTED — helper contract now defines duplicate-id behavior (all matching affected) with a pinning test.

## Round 2 — Codex
```
Material issues remain:

- Missed indirect rename caller: [TemplatesEditor.jsx](/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/src/home/TemplatesEditor.jsx:452) still calls `onRename(index, ...)`; the plan’s `rg renameModule` rule misses this. Fix: update `SortableModuleTab` to call `onRename(mod.id, ...)` and add `onRename\(` to the completion grep.

- Module Move/Copy claim still false: [TemplatesEditor.jsx](/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/src/home/TemplatesEditor.jsx:2259) has a module Move/Copy button, even if modal confirm is no-op. Fix: say “present but non-functional/out of scope” and derive its enabled/count from `selectedMods.length`.

- Projects stale-count behavior conflicts with acceptance: Part A still leaves `selFiles.size` as toolbar truth, while acceptance says displayed counts/All-None reflect visible matches. Fix: derive `selectedFiles = openFiles.filter(f => selFiles.has(f.id))` for `c`, `allSel`, buttons, modal count.

- Risks note contradicts revised fix: it still says visible count can overcount after external removal. Fix: replace with “raw sets may contain stale ids, but visible/effective selection is derived from current rows.”

VERDICT: REVISE```

### Claude's response (all 4 accepted)
1. ACCEPTED — SortableModuleTab's onRename(index,…) caller added to Part B; completeness grep extended with onRename\(.
2. ACCEPTED — module Move/Copy button documented as present-but-non-functional, out of scope for behavior; its enabled/count reads switch to the derived selection.
3. ACCEPTED — Part A now derives selectedFiles for ALL toolbar truth (count, allSel, buttons, modal count); raw selFiles.size never displayed.
4. ACCEPTED — risks note rewritten: raw sets may hold stale ids, every effective read derives from current rows at use time.

## Round 3 — Codex
```
No material blockers found. Prior issues are addressed.

Minor wording still sloppy: top Problem still says both surfaces have live drag handles / bulk move, while later text correctly scopes module Move/Copy as non-functional. Fix before implementation notes if you care, but it won’t misdirect the actual work.

One implementation nit: `moveIds.length` can overcount if a file disappears while the Move/Copy modal is open. Better count `pickByIds(openFiles, moveIds).length`, but target resolution is already safe.

VERDICT: APPROVED```

### Claude's response
Both non-blocking nits applied anyway: Problem intro now scopes drag/move claims per surface; Move/Copy modal count specified as pickByIds(openFiles, moveIds).length.

## Outcome
CONVERGED — VERDICT: APPROVED at round 3 of 5. Plan is execution-ready for a future session (code-change cap was full at plan time). Status update: the plan-approved slice awaits a free cap slot + Isaiah's testing confirmation.

---

# Result Review Log: KAL-298 execution (2026-06-10 ~16:10–16:40 loop session)

Implementation executed per the approved plan (round-3 APPROVED above). Gates:
`npx vite build` clean; `node scripts/run-node-tests.mjs` 1427 tests / 1421
pass / 0 fail / 6 skipped (pre-task baseline that day: 1390/1384/0/6 — delta is
the new selectionById tests plus tests landed by the interactive session).

## Verification — two independent passes

**1. Multi-lens workflow (3 Sonnet agents: plan-conformance, regression-hunt,
contract-boundary).** Actionable findings, all resolved:
- Toolbar Duplicate/Delete passed the raw `[...selFiles]` id set instead of the
  derived `selectedFiles.map(f => f.id)` — functionally safe (ids resolve via
  pickByIds at action time) but against the plan's derive-everything letter.
  FIXED both call sites.
- Twin-corner test didn't pin WHICH twin each copy followed. FIXED — added a
  tag-order assertion.
- `modRename` (rename-mode activation) is still index-keyed while the rename
  COMMIT path is now id-keyed. DELIBERATELY NOT FIXED — scope discipline: the
  plan scoped the commit path only; the activation highlight (and the whole
  `openMod` open-tab pointer) is a pre-existing index-keyed display surface
  with no wrong-target data risk (onBlur commits the id of the module whose
  tab the input visibly sits on). Filed as a follow-up finding (see board /
  Linear). Worst case is a rename input visually jumping tabs if the user
  drag-reorders mid-rename.
- Dismissed: TOCTOU between the render-time zero-match bail and the
  `mutateTpl` updater (theoretical — two user actions can't share a batch;
  any concurrent mutateTpl already marked dirty itself; bail-before-mutate is
  exactly what the approved plan specifies), modal-count O(n) per render
  (plan-mandated expression, suggested by Codex itself in round 3),
  `!ids.size` guard vs array-tolerant helpers (all internal callers pass Sets).

**2. Codex adversarial result review** (read-only, full diff + new files +
plan): "No findings." — VERDICT: APPROVED (round 1). Confirmed Part A/B/C
complete, no index-keyed survivor, zero-match bail before the dirty path,
reload gating untouched beyond the permitted selMods clear, DO NOT CHANGE
honored, tests pin all invariant groups + duplicate-id corner.

Post-approval deltas (the two FIXED items above) are strictly more conformant
to the already-approved plan text; gates re-run green after them.

## Outcome
CONVERGED — implementation committed locally. Follow-up filed: id-key the
module rename-activation/open-tab pointers (`modRename`, `openMod`) as a
small UX-hardening slice.
