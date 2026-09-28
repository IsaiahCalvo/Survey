# Annotation Capability Matrix — 2026-09-28 (w52)

Owner ask (2026-09-28): *"Annotations are annotations. There should be one
annotation family, and then things fit underneath with their own formatting …
Same for annotations in surveys, same as ones in regions."*

This is the per-type × per-action audit, filled from code (every cell traced
to source) plus live checks in the app (throwaway doc, own dev server). It
records the state **after** branch `claude/w52-annotation-family`
(commits `b97b20de7` z-order + the Part 2 commit that follows it).

Key: ✓ works · ✗ missing · **D** different by design (reason given) ·
**B** broken (still open, see plan) · ★ fixed on this branch.

Owner rulings this audit respects: Survey-module clean slate (regular markup
hidden while a module is active is the FEATURE); callout knee behaviour is
final; no dashed box around selected callouts; no new chrome.

---

## 1. Select and transform

| Type | Click | Marquee | Lasso | Move | Resize | Rotate | Z-order | Arrow-key nudge | Lock honoured |
|---|---|---|---|---|---|---|---|---|---|
| Pen / highlighter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ★ | ★ | ✓ |
| Rectangle / ellipse / cloud | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ★ | ★ | ✓ |
| Line / arrow | ✓ | ✓ | ✓ | ✓ | D: endpoint handles; box handles after double-click | D: same | ★ | ★ | ✓ |
| Polyline / polygon | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ★ | ★ | ✓ |
| Text box | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ★ | ★ | ✓ |
| Callout | ✓ | ★ (hidden / space-inert callouts no longer picked) | ★ (same) | ✓ | D: text-box corners only (leader geometry is its own handles) | ✗ (plan 4.6) | ★ menu + Cmd+]/[ | ★ | ✓ (callouts have no lock fields yet) |
| Counter | ✓ (Shift+click orbits the nub) | ✓ | ✓ | ✓ | D: bbox edit mode | D: rotates the nub, not the bubble | ★ | ★ | ★ orbit now lock-gated |
| Stamp (imported image) | ✓ | D: locked | D: locked | D: locked (import) | D | D | ★ | D: locked | ✓ |
| Text highlight / strike / underline | ✓ | ✓ | ✓ | D: fixed to its text | D: range handles | D | D: "uniform" highlights paint as one merged layer beneath all marks, so their order is not visible; "layered" ones stack normally | D: locked | ✓ |
| Imported PDF ink / shapes / text | ✓ | ✓ | ✓ | ✓ (movement-locked imports stay put) | ✓ | ✓ | ★ | ★ | ★ group move/rotate/resize now skip movement-locked marks |
| Survey Marker | ✓ (own selection) | ✗ (plan 4.2) | ✗ (plan 4.2) | ✓ | ✓ | ✓ | ✗ always above marks (separate store, plan 4.2) | ★ | n/a |
| Region / space shape | ✓ (region tool) | region tool | region tool | ✓ | ✓ per vertex | ✓ | D: regions are page structure, not marks | ✗ | n/a |

Multi-selection: move ✓; resize/rotate handles hidden on purpose (group
transform frame); z-order ★ moves the whole selection as one block, shapes and
callouts mixed (menu and keyboard, one Undo step).

## 2. Edit actions

| Type | Toolbar restyle | Copy / Cut / Paste | Delete (keyboard + menu, cross-author confirm) | Undo / redo | Right-click menu |
|---|---|---|---|---|---|
| Pen / shapes / lines / text box | ✓ | ✓ menu + Cmd+C/X/V; ★ paste takes the scope of where it lands | ✓ | ✓ one step per action; ★ reorder is now a step | full menu (Cut, Copy, Paste, Delete, 4 z-order) |
| Callout | ✓ (own style patch + font) | ★ Cmd+C / Cmd+X added; paste ★ takes landing scope | ✓ | ✓ | ★ full menu incl. z-order |
| Counter | D: restyle applies to the whole numbered series | ✓ | ✓ (series renumbers) | ✓ | full menu; ★ the dead "Continue pin" item is gone |
| Stamp | none (image) | ★ a pasted stamp no longer vanishes | ✓ | ✓ | full menu |
| Text markup (app) | ✓ own paint transaction | ✓ (exact duplicates refused) | ✓ | ✓ | full menu |
| Imported PDF marks | as base type | ✓ (copy becomes a native mark) | ✓ | ✓ | full menu |
| Survey Marker | ✗ | ✗ | own path; ★ a refused delete no longer leaves an empty Undo step; others' markers blocked instead of confirm (plan 4.2) | own lane | D: no menu this release (suppressed in `contextMenuDiagnostics.js`) |

Permissions: one rule — contributors and owners edit/delete everything,
viewers look only, cross-author delete always confirms. ★ Cmd+X now runs the
same own-mark gate as the menu Cut for shapes AND callouts (it skipped it).
**D:** Cut stays own-marks-only because Cut deletes with no confirmation
(locked 2026-07-17; `tests/phase35/contributorCrossAuthorShapes.test.mjs`);
another user's mark is removed with Copy + Delete, which confirms.

## 3. Erase, visibility and outputs

| Type | Erase whole | Erase partial | Hide/show (scope) | Live to other screens | PDF export | Print | Thumbnail / canvas |
|---|---|---|---|---|---|---|---|
| Pen / highlighter | ✓ | ✓ | ✓ | ✓ while drawing + after | ✓ | ✓ | ✓ |
| Shapes / lines / text box | ✓ | D: whole only | ✓ | after commit | ✓ | ✓ | ✓ |
| Callout | ✓ ★ now obeys the space rule | ✗ | ✓ | after commit | ★ in its stack slot | ★ in its stack slot | ★ in its stack slot |
| Counter | ✓ | D | ✓ | after commit | ✓ | ✓ | ✓ |
| Stamp | ✓ | D | ✓ | after commit | ★ edited stamps exported (were dropped) | ✓ | ★ now drawn |
| Text markup | ✓ | D | ✓ ★ now gets the module/region tag | after commit | ✓ | ✓ | ★ now drawn |
| Imported marks | ✓ | ink ✓ | ✓ | after commit | original kept / edited copy rewritten (D) | app copy replaces original (D) | ✓ |
| Survey Marker | ✓ ★ now obeys the space rule | ✗ | ✓ | **B** never broadcast live (plan 4.3) | active module only (D, owner 2026-09-02) | ✓ | ✗ |

**D — export vs print differ on purpose:** export = regular markup + the open
module's Survey Markers (owner ruling 2026-09-02, `buildPdfExportAnnotationPlan`);
print = an image of the screen (`buildPrintableRegularAnnotationPayload`).
Both are pinned by `tests/pdfSaveExportContract.test.mjs`.

## 4. Scope (normal / Survey module / region)

- **Normal canvas:** as above.
- **Inside a Survey module:** unscoped marks hide (the feature). New marks get
  the module tag through the shared creation helper (`applyScope`).
  ★ Text markup was never tagged (vanished on creation) — fixed.
  ★ Paste kept the source's module (vanished on paste) — the pasted mark now
  takes the module of where it lands; its region changes only where a new
  mark would get one, otherwise it keeps its own (`applyPasteScope`, shapes
  and callouts).
  ★ Marquee/lasso could pick hidden callouts — fixed.
- **Inside a region/space:** only that space's region marks are editable;
  others are visible and read-only. ★ Callouts ignored this for selection and
  the eraser; ★ Survey Markers ignored it for the eraser — both now use the
  same rule (`isInteractiveForActiveSpace`, `isOutsideEraseSpaceScope`).

---

## 5. Why types diverged (root causes)

1. **The store never kept order** (fixed ★): marks read back in map arrival
   order, so every reorder was lost on reload / next remote change; order-only
   edits made no Undo step. Now one persisted stack per page
   (`src/services/annotationStackOrder.js`, `z` beside each mark).
2. **Four selection systems** (shape indexes, callout ids, Survey Marker id,
   region ids). Callout marquee/lasso ran a separate loop that missed the
   visibility filter. Partly unified ★ via `src/utils/annotationFamilyRules.js`
   (one movable rule, one space rule, one reorder helper, one nudge).
3. **Callouts still have their own list** (`callouts[]` derived from the page)
   and a dedicated render loop; every output took callouts as a separate input
   and drew them last. Now every renderer draws them in their stack slot ★.
4. **Survey Markers live in a separate store** (Excel two-way sync needs its
   own columns) — own key handler, delete rule, undo lane, eraser, export and
   no live broadcast.
5. **Menu kind came from the DOM, not the mark type** ("counter" meant
   "Counter tool on"); keyboard and menu were separate code for the same action
   (Cmd+X skipped the gate the menu had) — fixed ★ for the cases above.
6. **Four renderers each with their own type dispatch** (SVG, canvas painter,
   export writers, print). Stamps and text markup were missing from the painter;
   edited stamps missing from export — fixed ★. A shared type registry is the
   plan (4.5).
7. **Scope tags stamped per creation site** — text markup and paste were
   missed; now routed through the shared helpers ★.

---

## 6. Still open — plan

1. **Cut of another user's mark (Cmd+X / menu).** Today refused (by design,
   no-confirm action). Option: route a foreign Cut through the same confirm
   modal as Delete. Needs the owner's nod — it changes a locked ruling and two
   pinned tests. Small.
2. **Survey Markers into the one family** (marquee/lasso/multi-select, z-order
   among marks, right-click menu, cross-author delete confirm instead of a hard
   block). Plan: keep the marker store (Excel sync needs it) but give markers a
   `z` and a slot in the page stack, feed them into the shared selection rules
   and the bulk-delete planner. Large; touches Excel sync — needs two
   adversarial reviews.
3. **Survey Marker and space changes are not live-broadcast** (other screens
   see them only after the saved row lands). Plan: extend the live-edit bus
   (`annotationLiveOverlay.js`) with a marker lane. Medium; sync — two reviews.
4. **Mixed clipboard and Duplicate.** One clipboard for shapes + callouts
   (today: one or the other), keyboard copy of a multi-selection, Cmd+D
   duplicate. Plan: a single clipboard shape `{objects, callouts}` used by
   menu and keys; Duplicate = copy + paste at +offset. Medium.
5. **One type registry for all renderers** (SVG, painter, export, print) so a
   new type can never be missing from one output. Medium–large refactor; do
   after 2.
6. **Callout rotation and user lock** — not built for any type (no Lock item);
   owner decision.
7. **Visibility filter written four times** (shared helper, two inline copies
   in SVGAnnotationLayer, PageAnnotationLayer); copies disagree on marks whose
   region was deleted. Plan: route all through `isAnnotationVisibleInContext`.
   Small–medium.
8. **Dead code:** the `textMarkup` menu kind (pdf.js text-markup selection is a
   stub — real text marks use the normal menu), the unused layer-visibility
   toggle state, `onCopyCallout` props on the unmounted legacy
   PageAnnotationLayer. Remove in a fallow pass.
9. **Counter tool right-click places a pin** (the placement overlay reacts to
   every mouse button). Inside `[COUNTER WIP — DO NOT TOUCH]` code — needs the
   owner's go-ahead; fix = ignore non-primary buttons.
10. **Latent error in Survey item copy between spaces:** `sourceSpaceId` is
    used but never defined in PDFViewer's copy-items flow (ReferenceError).
    Not an annotation path; flagged for its own fix.
