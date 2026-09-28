# Annotation Capability Matrix — 2026-09-28 (w52, updated w53)

Owner ask (2026-09-28): *"Annotations are annotations. There should be one
annotation family, and then things fit underneath with their own formatting …
Same for annotations in surveys, same as ones in regions."*

This is the per-type × per-action audit, filled from code (every cell traced
to source) plus live checks in the app (throwaway doc, own dev server). It
records the state **after** branch `claude/w52-annotation-family`
(commits `b97b20de7` z-order + the Part 2 commit that follows it).

Updated for `claude/w53-family-wave2` (cells marked ☆).

Key: ✓ works · ✗ missing · **D** different by design (reason given) ·
**B** broken (still open, see plan) · ★ fixed in w52 · ☆ fixed in w53.

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
| Survey Marker | ✓ ☆ Shift-click adds / Alt-click removes, with marks and callouts | ☆ | ☆ | ✓ ☆ moves with the whole selection (drag any member) | ✓ alone; D in a group (the group frame is move-only for every type) | ✓ alone; D in a group | ☆ one stack with marks (menu + Cmd+]/[) | ★ ☆ with the selection | n/a |
| Region / space shape | ✓ (region tool) | region tool | region tool | ✓ | ✓ per vertex | ✓ | D: regions are page structure, not marks | ✗ | n/a |

Multi-selection: move ✓; resize/rotate handles hidden on purpose (group
transform frame); z-order ★ moves the whole selection as one block, shapes and
callouts mixed (menu and keyboard, one Undo step). ☆ Survey Markers are
members too: marquee / lasso / Shift-click pick them with marks, a drag or an
arrow-key nudge moves marks and markers together, and a move, restack or
Delete of the whole selection is ONE Undo step.

## 2. Edit actions

| Type | Toolbar restyle | Copy / Cut / Paste | Delete (keyboard + menu, cross-author confirm) | Undo / redo | Right-click menu |
|---|---|---|---|---|---|
| Pen / shapes / lines / text box | ✓ | ✓ menu + Cmd+C/X/V; ★ paste takes the scope of where it lands | ✓ | ✓ one step per action; ★ reorder is now a step | full menu (Cut, Copy, Paste, Delete, 4 z-order) |
| Callout | ✓ (own style patch + font) | ★ Cmd+C / Cmd+X added; paste ★ takes landing scope | ✓ | ✓ | ★ full menu incl. z-order |
| Counter | D: restyle applies to the whole numbered series | ✓ | ✓ (series renumbers) | ✓ | full menu; ★ the dead "Continue pin" item is gone |
| Stamp | none (image) | ★ a pasted stamp no longer vanishes | ✓ | ✓ | full menu |
| Text markup (app) | ✓ own paint transaction | ✓ (exact duplicates refused) | ✓ | ✓ | full menu |
| Imported PDF marks | as base type | ✓ (copy becomes a native mark) | ✓ | ✓ | full menu |
| Survey Marker | ✗ | see Copy / Paste row below (w53 part 4) | own path; ★ a refused delete no longer leaves an empty Undo step; ☆ several at once (or with marks) = one step, nothing deleted if the marks' cross-author confirm is cancelled; others' markers still blocked instead of confirmed (plan 6.2a) | ☆ family actions ride the shared step | ☆ the normal menu (Paste, Delete, Bring / Send); inside a selection, the group menu |

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
   region ids). ☆ w53: the Survey Marker id became a set that joins the
   shared selection (marquee, lasso, Shift / Alt click, group move, nudge). Callout marquee/lasso ran a separate loop that missed the
   visibility filter. Partly unified ★ via `src/utils/annotationFamilyRules.js`
   (one movable rule, one space rule, one reorder helper, one nudge).
3. **Callouts still have their own list** (`callouts[]` derived from the page)
   and a dedicated render loop; every output took callouts as a separate input
   and drew them last. Now every renderer draws them in their stack slot ★.
4. **Survey Markers live in a separate store** (Excel two-way sync needs its
   own columns) — own key handler, delete rule, undo lane, eraser, export and
   no live broadcast. ☆ w53 keeps the store and adapts at the interaction
   layer (`src/utils/surveyMarkerFamily.js`): a marker's place in its page's
   stack is a canvas-only `stack` field naming the marks it sits between
   (never an Excel column; stripped from the Excel "not synced"
   fingerprint); family actions write geometry / `stack` field-by-field onto
   each marker as it is now, never a whole stale copy; a family Delete runs
   the established marker delete (trash, History row, Excel row removal);
   the Undo half (`survey-marker:batch`) rides the marks' step in the local
   history lane.
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
2. ☆ **Survey Markers into the one family** — done in w53 (selection, move,
   nudge, stack, right-click menu, Delete, one Undo step). Still open:
   (a) another user's Survey Marker is blocked from delete instead of
   confirmed like marks (a marker permission rule — owner's nod);
   (b) group resize / rotate stay hidden for every type;
   (c) a selection of markers + callouts only (no marks) moves as two Undo
   steps (callouts keep their own commit);
   (d) moving a Survey Marker makes a linked Excel read "not synced" (bounds
   are hashed — pre-w53 behaviour, geometry is not an Excel column);
   (e) the canvas painter / thumbnails still draw no Survey Markers.
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
