# PLAN — KAL-82 slice 2: delete the orphaned template-modal machinery in Dashboard.jsx

**Task:** KAL-82 (dead-code removal), slice 2. Uses the LAST code-change cap slot (6/6).
**File touched:** `src/Dashboard.jsx` ONLY (3,419 lines today). No other source file changes.
**Invariant:** zero observable behavior change. Broken-stays-broken: buttons that no-op today keep no-opping; the one real side effect the dead path still has (entities seeding, see below) is preserved byte-identically.

## Evidence base (all independently verified this session)

1. **The modal UI is gone.** Dashboard.jsx's JSX return (3332–3416) renders only two hidden file inputs, `<SurveyHub/>`, and the dashboardError toast. `isTemplateModalOpen` has zero JSX reads — only a dead snapshot effect (2783–2791) and a dead memo (2793–2799) read it. Git history: commit `409b0325` (2026-05-15, home-redesign) stopped rendering the legacy home containing the modal JSX; `3cb37412` (2026-05-29) physically deleted that JSX block ("never rendered... No behavior change"). Dashboard.jsx was extracted afterward, carrying the orphaned state machine along.
2. **An 88-symbol dead closure** was computed by a 2-agent map + 3-lens adversarial verification workflow (run `wf_e813041b-6bb`, full output preserved in the workflow transcript dir). Every dead symbol's complete reference list was walked; three adversarial agents (reachability / external+tests / behavior-preservation) re-derived the closure from the raw files.
3. **Strongest deadness proof:** the four delete handlers (`deleteModule`/`deleteModules`/`deleteCategory`/`deleteCategories`) call `setSelectedTemplate`, which is **never declared anywhere in the file** — they would throw ReferenceError if ever invoked. They have provably never run since some pre-extraction refactor.
4. **Two REAL entanglements found (verification blockers, resolved in this plan):** `openTemplateModal` (2828–2834) and `openEditTemplateModal` (2896–2929) call the **live** `setEntities` prop (AppShell-owned state, AppShell.jsx:454; serialized into the persisted document-data JSON by PDFViewer.jsx:18089 and restored at 18197). Both calls are reachable today from live buttons: TemplatesEditor.jsx:1442 → SurveyHub.jsx:135 → Dashboard.jsx:3359, and PDFViewer.jsx:31540/31604 + SurveySpacesRail.jsx:884/2575 → AppShell.jsx:797–805 → ref. A pure no-op stub would change persisted bytes. **Resolution: the stubs keep the setEntities behavior exactly** (option (a) from the verifier). Dropping the vestigial reset is queued as an Isaiah decision, not taken here.

## Change spec

### A. Replace the two modal openers with behavior-preserving stubs

- `openTemplateModal` → keeps ONLY the `setEntities([...5 default entities...])` block (current lines 2827–2834, verbatim including the `Date.now()` ids and `hexToRgba(...,0.2)` colors). All 26 dead-state setter calls and `setIsTemplateModalOpen(true)` go.
- `openEditTemplateModal(templateId)` → keeps ONLY: the `templates.find` lookup, the `alert('Template not found.')` early return (2846–2850), and the entities load/normalize/set block verbatim (2896–2929: `defaultEntities`, `template.entities || defaultEntities`, hex→rgba conversion, rgba opacity clamp, `setEntities(normalizedEntities)`). The `options` parameter and its `focusModuleId`/`startAddingCategory` handling go (callers may still pass an options object; it is ignored — JS semantics, no signature break).
- Both stubs get one shared comment block stating: the legacy modal UI was removed (`409b0325`/`3cb37412`), these entry points are still called by live buttons, they intentionally preserve the entities side effect because PDFViewer persists it into document data, and the rewire-or-remove decision is queued on KAL-82.
- The duplicated 5-entity default literal stays duplicated (exact copies of today's code — minimum-diff rule; no new helper).

### B. Ref handle (2837–2842) — keys kept, one body change

`openTemplateModal`, `openEditTemplateModal` now reference the stubs (no edit at the handle itself); `closeTemplateModal: () => setIsTemplateModalOpen(false)` becomes `closeTemplateModal: () => {}` (state is deleted; AppShell currently has NO caller of closeTemplateModal — verified, only :592/:799/:804 exist). `exitSelectionMode` untouched (slice-1 no-op).

### C. Delete the dead closure (~1,250 lines)

By region (line numbers are pre-edit):
- **State/refs:** 126–148 (modal + move/copy + dropdown state, `moveCopyDropdownRef`, `initialTemplateStateRef`), 190–194 (color-picker state), 310–311 (`selectedTemplateId` zero-ref, `editingTemplateId`), 2237–2242 (move/copy destinations).
- **Effects:** 422–437 (move/copy dropdown outside-click — its only state/ref die with it), 441–444 (reset `selectedTemplateCategoryId` on `selectedModuleId` change — both symbols dead; the line-443 setter site is NOT a live entanglement), 2273–2277 (clear rename input), 2783–2791 (snapshot init/reset).
- **Handler block:** every handler/memo in 1599–3130 EXCEPT the two stubs and the ref handle: all module/category/checklist/entity add-rename-delete-select handlers, the move/copy machinery incl. `executeMoveCopy` and its memos, `getTemplateSnapshot`, `hasUnsavedTemplateChanges`, `cancelTemplateModal`, `handleTemplateOverlayClick`, `saveTemplate` (incl. its guest localStorage branch 3107–3114 — the ONLY live guest write is hubSaveTemplates:3162, which stays).
- **Local helpers:** `generateUniqueId`, `createCopyName` (verify zero refs post-delete). **`hexToRgba` STAYS** (used by both stubs).
- **Imports: none change** (verified — no import becomes unused).

### D. Comment updates (no code effect)

- Header comment (line ~4): ref methods are no-op/entities-only stubs since this slice.
- Helpers comment (~25–26): drop deleted helper mentions, keep `hexToRgba`.
- `hubSaveTemplates` comment (~3153): remove the "Mirrors ... saveTemplate" dangling reference.

### E. Explicitly NOT in this slice

- LIVE code untouched: `templates` useMemo, `resolveSupabaseTemplateId`, `sanitizeTemplateConfig`, `templatesRef`/`supabaseRowsRef`/`prevSupabaseTemplatesRef`, `updateTemplates`, `persistTemplates` (loses its one dead caller `saveTemplate`; hubSaveTemplates remains), `hubSaveTemplates`, the supabase sync effect (357–368), `hasNameConflict`/`normalizeName` (live at 865/1025), `serializeError`, `FONT_FAMILY`, `hubGetChecklistItemUsageCount`, all SurveyHub props at 3349–3369, `exitSelectionMode`, `entities`/`setEntities` props (now used by the stubs).
- Out-of-scope dead-looking cluster flagged for a FUTURE slice with its own audit (do not touch now): project-create modal cluster, `handleDeleteDocument`, `handleSort`, `formatFileSize`/`formatDate`, `persistProjects`, the `sorted*`/`filteredDocuments`/`hasItems` memo chain, nav style consts.
- No caller-side edits (AppShell/SurveyHub/TemplatesEditor/PDFViewer/SurveySpacesRail untouched).

### F. Trap list for the implementer

- Same-named independent symbols exist elsewhere — delete ONLY Dashboard's locals: `deleteModules`/`addCategory`/`renameCategory`/`deleteCategories`/`addEntity`/`toggleCategorySelection` in TemplatesEditor.jsx, `selectedModuleId` prop in SurveySpacesRail.jsx, `hexToRgba` copies in PDFViewer.jsx:4009 / viewerShared.js:326 / Callout/types.js:197 / pdfAnnotationImporter.js:328. No global find/replace.
- `tests/templatesEditorReloadGuard.test.mjs:255-256` asserts EXACTLY 4 occurrences of the string `rowFailures += 1;` in Dashboard.jsx source — all 4 sit inside persistTemplates (kept). New stub comments must not contain that string.
- `closeTemplateModal` body swap must land atomically with the state deletion (compile dependency).

## Verification gates (all must pass before commit)

1. `npx vite build` clean.
2. `node scripts/run-node-tests.mjs` — baseline 1390 tests / 1384 pass / 0 fail / 6 skipped; required: same or better, 0 fail.
3. Zero-reference grep over every deleted symbol name scoped to `src/Dashboard.jsx` (and repo-wide for Dashboard-unique names) returns empty.
4. `git diff --stat` touches exactly one file.
5. Codex result review until converged.

## Follow-ups queued for Isaiah (recorded on KAL-82 / board, NOT attempted)

1. Five dead-end buttons today produce nothing visible: TemplatesEditor "New Template", PDFViewer survey-panel "Create Template" ×2, SurveySpacesRail create-category ×2. Rewire to the hub TemplatesEditor flow or remove them.
2. The preserved entities side effect itself (silently reseeding/reloading app-wide entity definitions on those clicks, which changes the next document save's persisted JSON) is arguably a latent bug — keep, fix, or drop is a product call.
