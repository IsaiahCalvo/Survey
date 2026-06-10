# Select-Mode Checkbox Consistency Audit (BL-17)

_2026-06-10, overnight loop. Audit-only: no code changed. Claims verified in source
this session; Codex adversarial fact-check applied. Sibling audit:
DND-CONSOLIDATION-AUDIT.md (BL-18). Related ticket: KAL-66 (accessibility pass)._

## Executive summary

**Eleven live multi-select surfaces** exist (Survey panel ×2, Documents ledger,
Projects tree ×2, Templates editor ×4, team-management modal, plus the Phase-35
annotation bulk-delete which is NOT a checkbox mode), built on **three unrelated
checkbox implementations with no shared component**: a custom
button-with-checkmark in the Survey panel, bare inline-styled spans (no ARIA, not
keyboard-reachable) in the ledger/tree/templates/team surfaces, and one native
checkbox that lives only inside dead code. Two whole select-mode systems are
**dead code** (the Survey panel's "copy mode" branch was never wired to a trigger;
the old Dashboard selection mode survived the hub redesign as ~130 orphaned
lines). The one **bug-risk** finding: TWO surfaces key selection off array
indices instead of stable ids (Projects-tree files AND Templates-editor modules) —
a reorder between selecting and acting targets the wrong items. (An earlier draft
claimed file bulk delete never reached the server — FALSE, withdrawn after
fact-check: it routes through the hub's confirm + full delete pipeline.) No
select-mode surface has tests.

## Inventory (11 live surfaces + 2 dead)

| Surface | Checkbox | Entry/Exit | Select-all | Keyboard | Bulk actions + confirm |
|---|---|---|---|---|---|
| Survey panel: category select (`SurveySpacesRail.jsx:1431-1438`, state `PDFViewer.jsx:7151-7152`) | custom `SurveyMarkerLeadingSelect` button (`:67-89`, `aria-pressed`, ✓ span) | "Select" `:998-1007`; EXIT via the panel's X `:756-787` (doubles as cancel — no Done button); module-tab switch also exits `:810-814` | none | button-native Enter/Space only; no Esc/shift/arrows | Move/Copy = **stub `alert()`** `:970-985`; Delete = `window.confirm` (`:892`) |
| Survey panel: item select per category (`:1769-1775`, state `PDFViewer.jsx:7156-7157`) | same button component | "Select" per category `:1543-1558`; "Done" `:1561-1578`; multiple categories can be in select mode at once (unique) | "All" per category `:1579-1594` (no "None"; no tri-state) | same | Copy → space picker `:1596-1618`; Delete = `window.confirm` `:1620-1654` |
| Documents ledger (`src/home/DocumentsLedger.jsx:144-145`, render `:309-312`) | bare inline-styled `<span>` — **no role/aria-checked/tabIndex** | "Select"/"Done" toggle `:233` | "All/None" `:244` over the filtered+sorted list | none (row onClick only) | Duplicate / Move-Copy modal / Share / Delete via `ConfirmModal` (`BulkModals.jsx`) — the ONLY proper modal confirm |
| Projects tree: project select (`src/home/ProjectsFolderTree.jsx:181-182`, render `:647-652`) | same bare-span pattern, no ARIA | "Select"/"Done" `:542-546` | "All/None" `:550-556` over the filtered list | none | Duplicate (local), Share (first item only — not bulk), Delete → `hubDeleteProjects` `Dashboard.jsx:3748-3770` (`window.confirm`) |
| Projects tree: file select (`:182-183`, render `:830-835`) | same bare-span, no ARIA | "Select"/"Done" `:770-773` | "All/None" `:730-733` — **INDEX-based** over `openFiles` | none | Duplicate (local); Move/Copy modal; Share shares the PROJECT not the files; Delete IS fully wired: `deleteFiles` (`:443`) → `onDeleteDocuments` → `SurveyHub.jsx:114` → `hubDeleteDocuments` (`Dashboard.jsx:3726`, confirms + `deleteDocumentEverywhere`) |
| Templates editor: template/category/entity bulk select (`src/home/TemplatesEditor.jsx:780-802`) | bare-span pattern, no ARIA | per-section Select/Done toggles | All/None per section | none | bulk delete/duplicate per section; confirm patterns mixed |
| Templates editor: MODULE bulk select (`TemplatesEditor.jsx:800,2128,2149`) | bare-span, no ARIA | Select/Done | `new Set(mods.map((_, i) => i))` — **INDEX-based** | none | delete/duplicate by index |
| Team modal: member bulk select (`src/home/ManageTeamModal.jsx:156,240,317`) | bare-span, no ARIA | edit-mode toggle | All/None | none | bulk role change / email / **remove with NO confirm** |
| Annotation bulk-delete (Phase 35) | n/a (marquee/eraser scopes, not checkbox lists) | — | — | — | fully implemented with modal + undo toast; tested in `tests/phase35/` — listed to bound the audit: it is NOT a checkbox select-mode |
| **DEAD: Survey panel "copy mode"** (`SurveySpacesRail.jsx:1021-1330`, state `PDFViewer.jsx:7146,7148`) | MIXED: native `<input type="checkbox">` select-all `:1050-1065` + the custom buttons | `setCopyModeActive(true)` is **never called anywhere** — branch is unreachable | module-scope select-all (dead) | — | Copy-to-Spaces, Delete (dead) |
| **DEAD: Dashboard legacy selection** (`Dashboard.jsx:372-373,1154-1190`) | none rendered | helpers never invoked from rendered JSX (legacy home UI removed; `:3677` comment) | dead | dead | ~130 orphaned lines incl. bulk handlers |

## Divergences

### Bug-risk (fix regardless of unification)
- **B1 — index-keyed selection in TWO surfaces**: Projects-tree files (`ProjectsFolderTree.jsx:182-183,730-733`, `selFiles` = Set of indices) AND Templates-editor modules (`TemplatesEditor.jsx:800,2128,2149`, `selMods` = `Set(mods.map((_, i) => i))`, delete/duplicate by index). A reorder/refresh between selecting and acting targets the wrong items. Fix: key both by stable id.
- ~~B2~~ **WITHDRAWN** — an earlier draft claimed file bulk delete was local-only with no confirm/server call. Fact-check disproved it: `deleteFiles()` (`ProjectsFolderTree.jsx:443`) calls `onDeleteDocuments(targets)`, wired through `SurveyHub.jsx:114` to `hubDeleteDocuments()` (`Dashboard.jsx:3726`), which confirms and calls `deleteDocumentEverywhere`. (Minor note: the host callback is not awaited — cosmetic at most.)

### Dead code (delete or wire deliberately)
- **B3 — copy-mode branch** (`SurveySpacesRail.jsx:1021-1330`): unreachable since birth; contains the codebase's only native-checkbox select-all; sits inside a 3.2k-line live file — a maintenance hazard. Decision: delete, or wire a real entry point if module-scope copy is still wanted (product call).
- **B4 — Dashboard legacy selection mode** (`Dashboard.jsx:372-373,1154-1190` + bulk handlers): orphaned by the SurveyHub redesign. Pairs with the BL-18 finding of dead reorder sensors in the same file — one Dashboard-cleanup slice can take both.

### Consistency (the unification backlog)
- **C1 — three checkbox implementations, no shared component.** Recommendation: one `SelectCheckbox` (probably promoted from the Survey panel's button variant, which already has `aria-pressed` and focusability) used by all list select modes — now including the four Templates-editor sections and the team modal.
- **C2 — accessibility**: the ledger/tree/templates/team spans have no role, no `aria-checked`, no `tabIndex`, no keyboard toggle (overlaps KAL-66's audit scope — cross-filed). Team-modal bulk REMOVE additionally has no confirm at all (overlaps C5).
- **C3 — select-all semantics**: per-category "All" (no None) vs "All/None" toggles vs none at all (Survey category mode); no tri-state anywhere; scopes differ (filtered list vs category vs module).
- **C4 — exit semantics**: Done button vs panel-X-doubles-as-cancel vs tab-switch side-exit; no Escape-to-exit on any live surface.
- **C5 — confirm patterns**: `ConfirmModal` (ledger) vs `window.confirm` (survey, projects, files via the hub pipeline) vs nothing (team-modal bulk remove; Templates bulk deletes if counted in scope). Overlaps KAL-57 (replace native alerts) and KAL-72 (confirm-dialog unification).
- **C6 — the Survey category Move/Copy button is a stub `alert()`** — overlaps KAL-57's alert inventory.
- **C7 — zero tests** for any select-mode behavior.

## Slice plan (gated on `npx vite build` + `npm test`)

1. **S1 — bug fix (B1)**: id-keyed selection for Projects-tree files AND Templates-editor modules. Risk MED (data-affecting selection semantics; self-contained, automatable).
2. **S2 — Dashboard cleanup (B4, pairs with BL-18's K84-1)**: delete the legacy selection mode + dead reorder sensors + dead drop-zone handlers in one slice. Risk LOW.
3. **S3 — copy-mode disposition (B3)**: product call first (delete vs wire); then a small slice either way. Risk LOW-MED (high-traffic file).
4. **S4 — shared `SelectCheckbox` + ARIA/keyboard (C1+C2)**: introduce the component, migrate the ledger + tree spans first (lowest risk), Survey panel last. Risk MED.
5. **S5 — semantics polish (C3+C4+C5)**: needs Isaiah's UX decisions (tri-state? Escape? one confirm pattern) — blocked on product choices; overlaps KAL-57/KAL-66/KAL-72, so consider folding into those tickets instead of a new one.

## Open decisions for Isaiah
- ~~Checkbox style standard~~ **DECIDED 2026-06-10 (Isaiah): GOLD checked-fill is the app-wide standard** (the homepage/Documents-ledger look — everything moves toward the homepage design language). Behavior comes from the Survey-panel button variant (focusable, `aria-pressed`, keyboard-togglable); visual comes from the ledger (14px square, 2px radius, gold fill + dark ✓ when checked). The shared `SelectCheckbox` (S4/C1) combines both.
- B3: was module-scope "copy mode" abandoned (delete) or still wanted (wire a trigger)?
- Team modal: should bulk member REMOVE get a confirm? (recommend yes — `ConfirmModal`.)
- S5 UX choices: tri-state select-all? Escape-to-exit everywhere? single confirm pattern (recommend `ConfirmModal`)?
