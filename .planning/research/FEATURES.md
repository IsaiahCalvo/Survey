# Feature Research — v2.2 Rotation Handle Polish

**Domain:** Shape-editing UX conventions in SVG/canvas design tools (Figma, tldraw, Excalidraw, Miro, Adobe Illustrator, Sketch, Inkscape, PSPDFKit/Nutrient)
**Scope:** Gap 3 (hover pill after edit-mode return), Gap 4 (mtr handle clip in edit mode), Gap 2 (off-screen handle relocation — **conditional**)
**Researched:** 2026-04-14
**Confidence:** HIGH on Gaps 3 and 4; HIGH (negative) on Gap 2 — survey confirms no mainstream tool does what the backlog proposes.

> **NOTE — scoped research.** This file covers ONLY the three rotation handle
> polish gaps carry-forward from v2.1 Phase 12. It supersedes the prior
> `.planning/research/FEATURES.md` (2026-04-12 Stage 0 Shift-snap scope) for
> v2.2 roadmap purposes. The v2.0 SVG Migration and v2.1 Shift-snap landscapes
> were researched separately and remain valid for their own phases.

---

## TL;DR — Opinionated Recommendations

**Gap 3 (hover pill after edit-return)** — Ship. Table stakes. Standard pattern across every tool surveyed: after any mode exit (edit, drag, keyboard), selection-mode affordances must re-arm automatically. The bug is a React stale-ref defect, not a design question. Implementation is a dependency-array / ref-rebind fix in `SVGAnnotationLayer.jsx`'s hover-intent effect, ~5–20 LOC. **Complexity: LOW.**

**Gap 4 (mtr handle visible in edit mode)** — Ship. Table stakes. Fabric.js has a first-party property for exactly this situation (`controlsAboveOverlay = true`), and the docs explicitly say it exists to prevent clipPath from clipping away controls. The fix is almost certainly a one-line Fabric option plus an `overflow: visible` on a wrapper div. **Complexity: LOW.**

**Gap 2 (off-screen handle relocates to opposite side)** — **Do NOT ship as designed.** Zero tools in the survey do this. The universal pattern is (a) user pans/zooms to bring the handle back into view, (b) edge-scrolling auto-pans during drag (tldraw), or (c) user types an exact angle via numeric input — which v2.1 already shipped. Relocating the handle to a non-standard position creates a worse problem: users learn "rotation handle is above the shape" and a context-dependent flip breaks that model. The backlog's underlying pain (can't re-grab a handle that sits above the page) is already ~95% solved by the typed-degree pill from EDIT-12. **Recommendation:** Close Gap 2 as `wontfix_superseded_by_typed_input` OR downgrade to a far cheaper variant (clamp the pill to the visible page rect while the handle itself scrolls with the viewport). **Complexity of "as designed" version: HIGH for low / arguably negative user value.**

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist the moment they hover, rotate, and enter edit mode. Missing these = interaction model feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Rotation affordance re-arms after exiting edit mode** (Gap 3) | Every tool surveyed (Figma, Excalidraw, Miro, Illustrator, Sketch, tldraw) treats mode-exit as "return to a clean select state." Hover affordances, cursors, tooltips, and marching ants all re-arm with zero user intervention. If hovering the rotation handle after click-off-to-commit does nothing, users conclude the selection is dead and reselect — a workaround is not acceptance. | LOW | Root cause is confirmed in the backlog entry: React reconciles the overlay on edit-commit, the hover-intent effect's `handleEl` ref captures a stale DOM node. Fix: re-run the effect when `annotations` identity changes, or resolve the handle element on each pointerenter instead of at mount. Scope: `SVGAnnotationLayer.jsx` hover-intent effect only. |
| **Rotation handle stays fully visible when shape enters edit mode** (Gap 4) | Users expect the selection chrome they saw in select mode to still be there in edit mode, just possibly dimmed or de-emphasized. Fabric's own `controlsAboveOverlay` property exists specifically because the Fabric authors recognized clipPath cropping controls is a defect, not a feature. A half-clipped handle reads as "the app is broken, not as an intentional boundary." | LOW | Two concrete levers: (1) set `canvas.controlsAboveOverlay = true` on `FabricEditCanvas` canvas init — documented cure for clipPath / overlay control cropping; (2) `overflow: visible` on the FabricEditCanvas wrapper div so controls painted outside the canvas bitmap aren't CSS-clipped by the container. The Gap 4 symptom (clipping only at non-zero rotation) is consistent with both causes: at 0° the mtr handle offset stays inside the tight bounding rect, at non-zero it rotates outside. Scope: `FabricEditCanvas.jsx` canvas init + wrapper CSS. |
| **Rotation handle painted above overlay / z-stack** | Across all tools, transform controls sit at the top of the z-stack above content, above overlays, and above clipping boundaries. This is a strict invariant — no tool buries rotation handles under content. | LOW | Fabric's `controlsAboveOverlay` is the direct implementation. If the project ever adds a visible overlay layer inside FabricEditCanvas, this flag keeps the mtr handle on top. |
| **Free rotation still works at non-zero starting angle** | Already shipped in v2.1. Listed here because Gap 4 could tempt a fix that locks rotation during edit mode. Do not remove rotation-in-edit-mode to make the clip problem go away — that's a regression. | LOW (preserve) | Rotation is allowed during text edit in Figma, Nutrient, Illustrator, tldraw. Rotate-in-edit-mode is table stakes; the right fix is to unclip the handle, not to disable rotation. |
| **Hover-intent gating on rotation pill** | Already shipped in v2.1 (RotationInputField hover-intent visibility state machine). Listed for completeness — Gap 3's fix must preserve this gate so the pill still only appears with intent, not on every mouse flyby. | LOW (preserve) | Don't regress hover-intent while fixing the stale ref. The dependency array change is the surgical fix. |

### Differentiators (Competitive Polish)

Features that would make rotation feel unusually refined but are NOT required to close the milestone.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Pill clamps to visible page rect even when handle is off-page** | Partial Gap 2 answer. The handle itself lives at the geometrically correct orbit (constant-radius from shape center), but the typed-degree pill clamps so it remains reachable. User can ALWAYS type an angle even if the handle is off-screen. The pill already clamps correctly per v2.1 12-02 notes — this is verifying/extending, not building from scratch. | LOW–MEDIUM | Cheap version of Gap 2. Preserves the "handle is always above the shape" learned mental model while giving users a fallback interaction (typed angle) that works regardless of handle visibility. If Gap 2 is ever revisited, do THIS, not handle relocation. |
| **Keyboard rotation nudging** | Already shipped in v2.1 (Arrow nudges ±1° via RotationInputField). Listed here as the existing fallback when the handle is off-screen. | LOW (preserve) | Users who bump into the off-screen handle problem can still nudge via arrows or type a value. This is the "Gap 2 is already 95% solved" argument. |
| **Edge-scrolling during rotate drag (tldraw pattern)** | When user drags the rotation handle toward the viewport edge, the viewport itself pans at a rate proportional to proximity to the edge. tldraw uses an `edgeScrollDistance` (default 8px) proximity zone and scales pan speed 0→1 across the zone. Elegant, discoverable, no new UI. | HIGH | Would require hooking the PDF viewer scroll/pan system to the SVG rotation drag state. The Syncfusion viewer has its own scroll model — hybridizing this is non-trivial. Probably not worth it for v2.2; file for a later polish stage if the off-screen-handle complaint resurfaces. |
| **Numeric rotation always visible during drag** | Excalidraw and Figma both show a live degree readout during rotation drag — next to cursor, in a corner HUD, or in the sidebar. This is a strictly better version of the current "hover to see pill" pattern. | MEDIUM | Out of v2.2 scope (pill visibility gate is shipped and working). Worth remembering for any future Rotation UX v3. |

### Anti-Features (Do NOT Build)

Tempting features that every researched tool rejects, or that would regress the v2.1 interaction model.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Relocate rotation handle to opposite side / nearest visible side when off-screen** (Gap 2 as designed in backlog) | User ran into an off-screen handle in 12-02-UAT Test 14 and couldn't re-grab it without first moving the shape. | **(a)** Zero tools in the survey do this. Figma, Excalidraw, Miro, Illustrator, Sketch, tldraw, Inkscape, Nutrient, PSPDFKit — all keep the rotation handle at a fixed relative position to the bounding box. **(b)** Breaks the universal "rotation handle is above the shape" mental model users bring from every other app. **(c)** Creates a context-dependent handle position that changes as user pans — handle jumps around while user tries to target it. **(d)** "Nearest visible side" is ambiguous when two sides are equidistant — design requires tiebreaker rules that users will find surprising. **(e)** The real pain (can't rotate when handle is off-screen) is already ~95% solved by the typed-degree pill from EDIT-12 + Arrow nudging. | **Preferred:** Close Gap 2 as `wontfix_superseded_by_typed_input`. Document that the typed pill + Arrow keys are the canonical interaction when the handle is inaccessible. **Cheap compromise:** Ensure the typed-degree pill clamps to the visible viewport even if the handle orbits off-page, so the user always has a reachable exact-angle input. **Expensive alternative (not recommended):** Adopt tldraw's edge-scrolling pattern — pan the viewport during drag — rather than relocating the handle. |
| **Hide the rotation handle entirely during edit mode** | Easy "fix" for Gap 4 — if the handle isn't rendered, it can't clip. | **(a)** Removes rotation-in-edit as a feature. Figma, Nutrient, Illustrator, tldraw all allow rotation of a shape while editing its text/content. **(b)** Creates a mode where user can see the shape is rotated but can't adjust the rotation without exiting. **(c)** Asymmetric with the v2.1 typed-degree pill which remains visible in all selection states. **(d)** The root cause is a trivial clipPath/overflow bug — masking it by removing the handle is treating a symptom, not the disease. | Fix the clip with `controlsAboveOverlay = true` + `overflow: visible`. Both are one-liners. |
| **Make the pill / handle rotation-snap to 45° when released off-screen** | User might argue "if I can't see the handle, at least snap so I know where it is." | Breaks the v2.1 invariant that Shift-snap is a drag-only modifier and typed/Arrow commits are exact. Adds a hidden mode switch the user didn't opt into. | Rotation snap remains strictly drag-and-Shift. Off-screen UX is solved by pill clamping, not by silent behavior changes. |
| **Persistent "rotation mode" the user enters with a hotkey** | Some users would love a Figma-R-style modal rotation tool. | Scope creep for a polish milestone. The v2.1 interaction model is modeless-select with hover-intent affordances — switching to a modal tool would be an entire new UI paradigm. | Defer to a future Rotation UX redesign if the modeless pattern ever proves insufficient. |
| **Re-implement hover-intent by polling pointerMove on document** | Tempting "bulletproof" fix for Gap 3 — if the effect listens globally, it can't miss the handle. | Global pointermove listeners during idle selection are wasteful, racy with other overlays, and break the single-responsibility of the hover-intent effect. | Surgical fix: re-run the existing effect when `annotations` identity changes, OR resolve `handleEl` lazily on pointerenter rather than capturing it at effect-mount. |
| **Add an `overflow: visible` to the entire SVG annotation layer** | Might solve Gap 4 "structurally." | Too broad — the SVG layer's overflow rules interact with Syncfusion page div clipping, drag-to-select hit zones, and outside-click dismiss. Gap 4 is specifically the FabricEditCanvas container. | Scope the `overflow: visible` fix narrowly to the FabricEditCanvas wrapper, and verify `controlsAboveOverlay` is the primary fix. |

---

## Evidence by Concern

### Concern 1 — Hover affordances on rotation handles after edit-mode exit

**Question:** When should the rotation pill appear/disappear? What should happen when user click-off-commits an edit and is back in select mode hovering the handle?

**What other tools do (evidence):**

- **Figma** — Rotation affordance is entirely hover-driven: you hover just outside a bounding-box corner and the cursor changes to the curved-double-arrow rotate cursor. This re-arms automatically the moment selection returns to idle after any mode exit. Figma has NO persistent rotation handle element — the corner hit zone IS the affordance. No stale-ref possible because no React ref is captured.
- **tldraw** — The select tool is an explicit state machine with children `idle`, `pointing`, `translating`, `resizing`, `rotating`, etc. When a user exits an edit mode, the state machine returns to `idle` and cursor rendering is recomputed from scratch on the next hover. No DOM ref capture; cursor is a derived value from current state.
- **Excalidraw** — Rotation handle is a circle rendered above the bounding rectangle when the shape is in select state. Every render pass re-emits the handle and attaches hover/pointer handlers based on current selection. No persistence across edit-to-select transitions because the handle is re-created, not re-used.
- **Illustrator** — Cursor change on hovering near a bounding-box corner is computed on every mouse move; there's no captured handle element. (Users have filed bugs when this doesn't work — the expected behavior is re-arm on every selection state.)
- **Miro** — Rotation handle sits at top-center of the selected shape, re-rendered every selection cycle, same hover-to-cursor pattern as Figma.
- **Nutrient/PSPDFKit Web** — Rotation handle appears at the bottom of the annotation when it's selected. Selection state is recomputed on mode changes; no stale ref.

**Pattern:** Every tool surveyed treats the rotation affordance as a **derived render from current selection state**, not a captured DOM reference. When selection mode is re-entered (via click-off from edit, Escape, etc.), the affordance is freshly computed and cannot be stale.

**Survey → bug diagnosis:** The v2.1 implementation captured `handleEl` in a React ref inside the hover-intent effect. When edit-commit triggers a React reconciliation that re-creates the handle DOM element, the captured ref still points at the orphaned pre-reconcile node. This is a React lifecycle bug, not a design question. The fix is well-understood:

1. **Option A (simplest):** Add `annotations` identity to the effect's dependency array so the effect re-subscribes after every commit.
2. **Option B (more robust):** Resolve the handle element lazily on each `pointerenter` instead of caching at mount time. `document.querySelector` inside a shape-scoped parent works and is sub-millisecond.
3. **Option C (most idiomatic React):** Use a callback ref on the handle element so the effect re-runs automatically whenever the DOM node changes.

**Reference tools to visually inspect:** Figma (free tier), Excalidraw (open-source, browsable source).

**Edge cases to cover:**

- Exit edit via Escape key (not just click-off) — must also re-arm the hover affordance.
- Exit edit via commit-then-select-different-shape — the NEW shape's rotation handle must be armed, not the old one's.
- Multi-select → enter edit on one shape → commit → multi-select restored — all selected shapes' affordances must re-arm (probably out of scope for v2.2 since multi-select edit isn't shipped, but worth noting for test coverage).
- Rapid double-click → accidental edit-mode enter → immediate Escape → hover handle — must work on first hover after the aborted edit.

**UX anti-patterns to avoid:**

- Requiring a full deselect + reselect as a "workaround." This is what the v2.1 ship surface does today, and it fails the "tool feels finished" bar.
- Masking the bug by removing the hover gate entirely (always show the pill on selection). This regresses the hover-intent design from 12-02.
- Using a global pointermove listener as a sledgehammer. Wasteful and racy.

---

### Concern 2 — Rotation handle visibility in edit mode on pre-rotated shapes

**Question:** When a shape is already rotated and enters edit mode, is the rotation handle still visible and draggable? If yes, how is it kept inside the clip boundary?

**What other tools do (evidence):**

- **Figma** — Text edit on a rotated text frame keeps the entire bounding box visible, including the corner rotation hit zones. The edit chrome (text cursor, selection range highlights) renders inside the rotated local coordinate frame, but the selection bounding box and rotation affordance are in the parent (canvas) frame and are not clipped. User can rotate while editing text.
- **tldraw** — Shape rendering uses CSS `transform: translate() rotate() scale()` on the shape wrapper, and selection UI is rendered in a separate layer that's not clipped to the shape. Text labels edit in-place but the selection overlay stays live. Release notes explicitly mention "Editing a shape with a label now ensures that the label is on screen" — tldraw actively pans to keep the edit surface visible rather than letting content get clipped.
- **Nutrient/PSPDFKit Web** — Free-rotatable text/image annotations keep their rotation handle available during editing because edit-mode controls are painted at the page-overlay level, not inside a shape-local clip region.
- **Illustrator** — Text-on-path or rotated text object edits happen in-place with the full bounding box and rotation affordance visible.
- **Fabric.js (the library this project uses for edit mode)** — Fabric's own documentation explicitly addresses this: "clipPath will clip away controls, if you do not want this to happen use `controlsAboveOverlay = true`." This is a documented, supported flag on the Canvas class and is the direct fix for Gap 4's symptom.

**Pattern:** Transform controls (rotation, resize) should ALWAYS be painted above any clip region that applies to the shape content. This is a universal invariant across design tools and is directly supported by Fabric via `controlsAboveOverlay`.

**Survey → bug diagnosis:** Gap 4's symptom (mtr handle clipped only at non-zero rotation, not at 0°) is the textbook `clipPath`-vs-`controls` interaction. At 0° the mtr handle offset is small enough that it sits inside whatever tight rect bounds the FabricEditCanvas. At non-zero rotation the mtr's rotated offset protrudes outside that rect and gets clipped.

**Recommended fix order:**

1. **Primary:** Set `canvas.controlsAboveOverlay = true` on `FabricEditCanvas` canvas initialization. One line. Documented cure.
2. **Secondary:** Add `overflow: visible` to the FabricEditCanvas wrapper div. The CSS clip is a second possible culprit — the Fabric canvas element itself is one layer, the React wrapper around it is another.
3. **Tertiary (if the above don't fully solve it):** Increase the FabricEditCanvas canvas element's bitmap size to include the rotation handle's maximum orbit. The mtr handle sits `cornerSize + rotationHandleOffset` pixels outside the shape's local bounding rect. At rotation `r`, its worst-case position relative to the shape's axis-aligned bounding box is `sqrt((w/2 + offset)^2 + (h/2)^2)` etc. Reserve that much padding.

**Reference tools to visually inspect:** Figma (rotate a text frame 30°, then double-click to edit — rotation corner hit zone still works). Fabric.js demos with `controlsAboveOverlay = true` set.

**Edge cases to cover:**

- Shape rotated to exactly 90°, 180°, 270° — the "rotation extends mtr offset in maximum direction" assertion holds at these angles; verify they don't clip.
- Shape rotated to 45° (maximum AABB expansion) — verify.
- Text shape in edit mode with a very long line wrapping the textbox — the wrapping dimension change shouldn't re-introduce clipping.
- Edit mode + live resize (if shipped) — handle visibility should survive resize.
- Edit mode + zoom change — Syncfusion viewer zoom shouldn't re-introduce clipping because Fabric controls are measured in screen space, not PDF space.

**UX anti-patterns to avoid:**

- Hiding the rotation handle during edit. Breaks rotation-while-editing, which is table stakes.
- Forcibly resetting rotation to 0 on edit enter. Data-destructive and breaks user intent.
- Re-projecting the mtr handle into a "safe" position that no longer corresponds to the shape's rotation. Visually confusing — users expect the handle at the top of the rotated shape.
- Using a massive `padding: 500px` on the wrapper. Blunt instrument that hurts hit testing, scroll, and z-stacking on adjacent overlays.

---

### Concern 3 — Off-screen rotation handle behavior

**Question:** If the mtr handle would render off the canvas/page, what to do? Relocate, clamp, mirror, or leave off-screen?

**What other tools do (evidence):**

- **Figma** — Rotation hit zone sits at corners of the bounding box. If the shape extends beyond the viewport, user zooms out or pans to reach the corner. No handle relocation. The rotation affordance simply isn't reachable until the user changes viewport.
- **tldraw** — Rotation handle stays at its geometrically correct position. During an active drag (rotate, resize, translate), tldraw's **edge-scrolling** kicks in: when the pointer enters an 8-pixel proximity zone at any viewport edge, the camera pans at a rate proportional to depth into the zone. Requires active drag + unlocked camera + pointer in zone. This means users drag the handle toward the edge and the world scrolls under them. Outside an active drag, the handle just stays where it geometrically belongs.
- **Excalidraw** — Rotation handle stays above the bounding rect. Users pan/zoom if it's off-screen. No relocation.
- **Miro** — Rotation handle at top-center of the shape. Stays there. Users pan/zoom.
- **Illustrator** — No persistent rotation handle to relocate; rotation affordance is the cursor-near-corner hit zone. Inaccessible hit zones require the user to change the artboard view.
- **Sketch** — Rotation uses ⌘+corner-click (no persistent handle at all). Same story — reach via viewport change.
- **Inkscape** — Rotation handles (double-click to toggle to rotate mode, then corners become rotation handles) stay at corners. Off-screen handles require pan.
- **Nutrient/PSPDFKit Web** — Rotation handle at bottom of annotation. Stays at bottom. If it's off-page, user scrolls the page view.

**Pattern:** **Zero tools in the survey relocate a rotation handle to an alternate side when it's off-screen.** The universal pattern is:

1. Keep the handle at its geometric position (predictable, matches user mental model).
2. User reaches it by panning or zooming the viewport.
3. (tldraw only) During an active drag, edge-scrolling auto-pans the camera as the pointer approaches the viewport edge.
4. Fallback interaction: numeric typed input in a sidebar / property panel.

**Survey → design critique of Gap 2 (as designed):**

The backlog describes Gap 2 as: "When user places a shape near the page edge and rotates it, the mtr rotation handle can go off-screen. Currently the user must move the shape away from the edge to re-grab the handle. Desired flow: place shape near edge → rotate → if handle would be off-screen, it relocates to the opposite side of the shape (or nearest visible side) so the user can re-grab it without moving the shape first. Pill follows the new handle position."

Problems with "as designed":

1. **No tool does this.** The absence across Figma, tldraw, Excalidraw, Miro, Illustrator, Sketch, Inkscape, Nutrient, PSPDFKit is not coincidence — it's a load-bearing invariant for learnability.
2. **Breaks learned mental models.** Users bring "rotation handle is above the shape" from every other tool. A context-dependent flip creates "wait, where did it go?" moments that are worse than "wait, I can't reach it right now."
3. **Tiebreaker ambiguity.** "Nearest visible side" has multiple ambiguous cases (shape partially off-page in two dimensions, shape center off-page, shape larger than visible area). Every rule the team invents will surprise some users.
4. **Moving target during drag.** If the handle can relocate based on viewport, then user-pans or zoom changes during a rotation drag would cause the handle to snap to a new side mid-drag — visually catastrophic.
5. **Already 95% solved by v2.1.** The typed-degree pill + Arrow nudging, both shipped in EDIT-12/12-03, provide a fully-functional rotation path with zero handle-grabbing required. The user can already rotate an off-screen-handle shape by typing or arrowing. Gap 2's underlying pain is thin.
6. **RotationInputField pill already clamps correctly** per v2.1 notes. The user's typed input affordance is already reachable in most off-screen handle cases. The missing piece — if there is one — is "pill is visible even when the handle orbit lies outside the page rect." That's a pill-clamp fix, not a handle-relocation fix.

**Recommended outcomes (pick one):**

- **Option A (strongest recommendation):** Close Gap 2 as `wontfix_superseded_by_typed_input`. Document in the milestone reconciliation that v2.1's typed-degree pill + Arrow nudging is the canonical interaction for unreachable rotation handles, matching what every surveyed tool implicitly relies on (keyboard / numeric fallback when viewport can't show the handle). Ship v2.2 with only Gaps 3 and 4 closed.
- **Option B (cheap compromise, if Gap 2 MUST ship in some form):** Verify and extend the existing pill-clamp logic so the typed-degree pill remains visually reachable even when its natural orbit point is off-screen, without moving the mtr handle itself. The handle lives at its geometric home; the pill clamps to the visible viewport edge (with a leader line back to the handle if desired). Scope: `RotationInputField` placement helpers. Preserves universal handle mental model, gives off-screen user a fallback affordance.
- **Option C (most ambitious, probably not v2.2):** Adopt tldraw's edge-scrolling pattern — during an active rotation drag that approaches the viewport edge, pan the Syncfusion PDF page so the handle stays in view. Requires hooking SVG rotate drag into the Syncfusion viewer scroll API, which has its own coordinate model. HIGH complexity, unclear payoff for the engineering-drawing user base.

**Reference tools to visually inspect:**

- tldraw's edge-scrolling (https://tldraw.dev/sdk-features/edge-scrolling) — only tool in the survey with an active-drag edge behavior.
- Figma, Excalidraw — watch how they handle a shape placed at the top of the canvas with a rotation handle above the viewport. Both tools make you scroll/zoom; neither relocates.

**Edge cases to cover (for Option B pill-clamp only):**

- Pill sits on top of mini-toolbar or other overlays — z-ordering.
- Pill clamped to the same edge as the shape, covering the shape itself — small offset.
- Multiple shapes selected, each with off-screen handles — pill per shape? pill per selection center? (Out of v2.2 scope regardless.)
- Shape rotated such that the pill's normal orbit position is outside BOTH the page rect and the viewport rect — pill is off-viewport entirely. Fallback: anchor pill to the shape's visible bounding rect on the page.

**UX anti-patterns to avoid (critical):**

- **Relocating the mtr handle to a non-standard position based on viewport.** This is the headline anti-feature — breaks the learned mental model and no tool does it.
- **Shrinking the handle into the nearest corner when close to the edge.** Violates "constant-radius from shape center" invariant from v2.1 pill placement.
- **Letting the pill orbit silently off-screen when the handle does.** If we ship Option B, verify the clamp is active and user-visible — failing silently is worse than no clamp at all.
- **Adding a modal "rotate" button in a corner toolbar when the handle is off-screen.** Breaks modelessness. Users would have to learn a second rotation path that only appears in edge cases.

---

## Feature Dependencies

```
Gap 3 (hover pill after edit-return)
    └── requires: stable reference to mtr handle DOM element after React reconciliation
        └── requires: SVGAnnotationLayer hover-intent effect
            └── requires: useSVGInteraction rotation/hover state (shipped v2.1)

Gap 4 (mtr handle not clipped in edit mode)
    └── requires: Fabric canvas.controlsAboveOverlay = true
        └── requires: FabricEditCanvas canvas init (shipped v2.0 Phase 11)
    └── requires: wrapper div overflow: visible
        └── requires: FabricEditCanvas wrapper layout (shipped v2.0 Phase 11)

Gap 2 Option B (pill clamps to visible viewport)
    └── requires: RotationInputField placement helpers (shipped v2.1 EDIT-12)
    └── requires: PDF page rect in screen coordinates (shipped, used by v2.1 pill placement)

Gap 2 Option C (edge-scrolling during rotate drag) [NOT RECOMMENDED]
    └── requires: Syncfusion viewer scroll API hook
    └── requires: SVG rotation drag state machine integration with viewport
    └── conflicts with: existing Syncfusion page scroll model, zoom-aware drag bounds
```

### Dependency Notes

- **Gap 3 depends on React effect dependency / ref-rebind discipline.** The fix touches `SVGAnnotationLayer.jsx` only. No cross-cutting changes. No data model changes.
- **Gap 4 depends on two independent levers.** Both are one-liners. Test them individually to attribute the symptom correctly. `controlsAboveOverlay` is the idiomatic Fabric answer; `overflow: visible` is the React/CSS backstop.
- **Gap 2 Option B depends on the pill placement system from v2.1.** The pill-clamp logic already exists (per v2.1 notes); Option B is verifying and possibly extending it. Low-medium complexity.
- **Gap 2 Option C conflicts with the Syncfusion scroll model.** The PDF viewer owns its own scroll container, and hooking rotation drag into its scroll API would be the first integration of that kind. Strongly recommend against for v2.2.
- **Gap 3 and Gap 4 are independent.** They touch different files (`SVGAnnotationLayer.jsx` vs `FabricEditCanvas.jsx`). They can land in either order. Both should be in v2.2.
- **Gap 2 is independent of Gaps 3 and 4** — the roadmap can include or exclude it without affecting the other two.

---

## MVP Definition — v2.2 Milestone Close

### Ship in v2.2 (strong recommendation)

- [ ] **Gap 3 — hover pill re-arms after edit-mode exit.** Table stakes. LOW complexity. Scope: `SVGAnnotationLayer.jsx` hover-intent effect only. Fix is dependency-array / ref-rebind / lazy-resolve (pick one).
- [ ] **Gap 4 — mtr handle fully visible in edit mode on pre-rotated shapes.** Table stakes. LOW complexity. Scope: `FabricEditCanvas.jsx` canvas init + wrapper CSS. Primary fix: `controlsAboveOverlay = true`. Secondary: `overflow: visible` on wrapper.

### Conditional (only if it slots cleanly)

- [ ] **Gap 2 Option B — pill clamps to visible viewport when handle orbit goes off-screen.** LOW–MEDIUM complexity. Scope: `RotationInputField` placement helpers. Only take this if Gaps 3 and 4 land fast and there's time left in the milestone. Do NOT ship Option A (handle relocation) — it's an anti-feature.

### Defer / Reject

- [x] **Gap 2 Option A (relocate handle to opposite side)** — **REJECT.** See anti-features table above. No tool in the survey does this; it breaks universal mental models; v2.1's typed-degree pill already solves 95% of the underlying pain.
- [ ] **Gap 2 Option C (edge-scrolling during rotate drag)** — Defer to a future polish milestone. Requires Syncfusion scroll integration; HIGH complexity; out of scope for a polish milestone.
- [ ] **Blur-commit / invalid-value revert for RotationInputField** — Already explicitly de-scoped during v2.1 12-02 UAT. Remains de-scoped.
- [ ] **Fabric-path rotation snap** — Already de-scoped in v2.1. Remains de-scoped.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Gap 3 hover pill re-arm | MEDIUM (high frustration to work around) | LOW | **P1** |
| Gap 4 mtr visible in edit mode | MEDIUM (visually broken, undermines "looks finished") | LOW | **P1** |
| Gap 2 Option B pill-clamp | LOW–MEDIUM (partial fallback for edge case) | LOW–MEDIUM | **P2** |
| Gap 2 Option A handle relocate | NEGATIVE (breaks mental model) | MEDIUM–HIGH | **REJECT** |
| Gap 2 Option C edge-scroll drag | MEDIUM (novel but powerful) | HIGH (Syncfusion integration) | **P3 / defer** |

**Priority key:**
- **P1** — Must close v2.2 milestone.
- **P2** — Ship if it slots cleanly; not a gating item.
- **P3** — Defer; file for future polish milestone.
- **REJECT** — Do not build; document rationale in reconciliation.

---

## Competitor Feature Analysis

| Concern | Figma | tldraw | Excalidraw | Illustrator | Nutrient/PSPDFKit | Our v2.2 Approach |
|---------|-------|--------|------------|-------------|-------------------|-------------------|
| Hover affordance for rotation | Cursor-based (corner hit zone), re-armed per render | State-machine derived, re-armed on state return to `idle` | Handle re-rendered per selection, hover handlers fresh | Cursor-based (corner hit zone), re-armed per mouse move | Selection chrome re-rendered on selection cycle | **Fix the React stale-ref bug in hover-intent effect; keep the pill pattern. Matches the "derived from current selection" pattern of every surveyed tool.** |
| Rotation handle visibility in edit mode | Yes, bounding box & corner hit zones remain active during text edit | Yes, selection UI painted above content layer, not clipped | Yes, handles stay above bounding rect | Yes, free transform + rotate work on rotated text | Yes, free-rotatable text/image annotations keep rotation handle | **Fabric `controlsAboveOverlay = true` + wrapper `overflow: visible`. Matches Fabric-documented cure and universal "controls above clip" invariant.** |
| Off-screen rotation handle | Handle stays put; user pans/zooms | Handle stays put; edge-scrolling pans viewport during active drag | Handle stays put; user pans/zooms | No persistent handle; user pans/zooms to reach corner hit zone | Handle stays put; user scrolls page | **Handle stays put (matches every tool). Pill clamps to visible viewport (Option B, if slottable). Explicitly do NOT relocate the handle (no tool does this).** |

---

## Open Questions / Needs Plan-Phase Investigation

1. **Gap 3 fix selection:** Is `annotations` identity the right dep-array trigger, or does the effect need a callback-ref on the handle element? Plan-phase should verify which of the three fix options is cleanest against the current `SVGAnnotationLayer.jsx` structure.
2. **Gap 4 primary cause:** Is the clip caused by Fabric's clipPath (fixed by `controlsAboveOverlay`), by the React wrapper CSS (fixed by `overflow: visible`), or both? Plan-phase should run the one-liner Fabric flag in isolation first, then add the CSS fix only if the symptom persists.
3. **Gap 4 and `cornerSize` / `rotateHandleOffset`:** Does the current FabricEditCanvas set these to values large enough that the handle escapes the default canvas bitmap boundary even with `controlsAboveOverlay`? If so, may need a bitmap-padding adjustment too. Plan-phase should measure.
4. **Gap 2 (if Option B is pursued):** Does the v2.1 pill-clamp already handle the viewport-edge case, or does it only clamp to the PDF page rect? The 12-02 notes say "pill already clamps correctly" but this needs verification against the specific off-screen handle case from Test 14.
5. **Cross-gap interaction:** Does fixing Gap 4 (un-clipping the mtr handle) inadvertently re-introduce hit-testing on a handle that extends outside the FabricEditCanvas visible area? Could create a new "ghost hit zone" bug. Plan-phase should verify hit bounds after fix.

---

## Sources

**Primary (HIGH confidence):**

- [Fabric.js Canvas API — `controlsAboveOverlay` property](https://fabricjs.com/api/classes/canvas/) — First-party Fabric documentation explicitly states `controlsAboveOverlay = true` prevents clipPath from clipping controls. Direct cure for Gap 4 symptom.
- [tldraw Edge Scrolling SDK docs](https://tldraw.dev/sdk-features/edge-scrolling) — Official tldraw documentation on edge-scrolling during active drag states (translating, resizing). Source of Gap 2 Option C pattern.
- [tldraw Tools / Cursors SDK docs](https://tldraw.dev/sdk-features/tools) — State-machine model for select tool (idle/pointing/translating/resizing/rotating). Source of "hover affordance is a derived render from current selection state" pattern for Gap 3.
- [Nutrient/PSPDFKit Web 2023.1 Rich Text + Rotation release](https://www.nutrient.io/blog/pspdfkit-web-2023-1-rich-text-support-annotation-rotation/) — Confirms annotation rotation UX in a PDF-annotation tool competitor. Rotation handle at bottom of annotation, rotation allowed in edit mode.
- [Figma rotation help doc](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions) — Confirms Figma's corner-hover cursor pattern and Shift=15° snap.
- v2.1 Phase 12 close documentation (`FEATURE-BACKLOG.md`, `v2.1-ROADMAP.md`, 12-VERIFICATION.md human_decision) — Source of Gap 2/3/4 symptoms, reproduction steps, and suspected root causes. HIGH confidence because these are internal project records written during UAT.

**Supporting (MEDIUM confidence):**

- [Adobe Illustrator rotation handle community discussions](https://community.adobe.com/t5/illustrator-discussions/rotation-option-not-showing-up-when-you-hover-over-a-corner-point-on-the-bounding-box/td-p/8762118) — Confirms Illustrator uses corner-hover cursor affordance, not a persistent handle.
- [Excalidraw shape transformation deep-wiki](https://deepwiki.com/excalidraw/excalidraw/3.4-element-transformations) — Confirms Excalidraw rotation handle rendered above bounding rect, re-created per render.
- [Miro rotation community thread](https://community.miro.com/developer-platform-and-apis-57/how-to-rotate-24076) — Confirms Miro rotation handle position (top-center of selection) and Shift=45° snap.
- [FigJam resize/rotate help](https://help.figma.com/hc/en-us/articles/1500006206242-Resize-rotate-and-flip-objects-in-FigJam) — Confirms FigJam inherits Figma's rotation UX model.
- [Sketch resize/rotate docs](https://www.sketch.com/docs/designing/layer-basics/resizing-and-rotating-layers/) — Confirms Sketch uses ⌘+corner-click for rotation (no persistent handle to relocate).
- [React stale closure / stale ref discussions](https://dmitripavlutin.com/react-hooks-stale-closures/) — Standard React pattern literature on why a captured ref becomes stale after reconciliation and how to avoid it.

**Not-found (confirms negative claim):**

- **No design tool in the survey implements handle-relocation when off-screen.** Queries for "rotation handle offscreen clamp opposite side relocate" across Figma, Sketch, Illustrator, Inkscape, Excalidraw, Miro, tldraw returned zero positive matches. The closest behavior — tldraw edge-scrolling — pans the viewport, it does NOT relocate the handle. This is a HIGH-confidence negative finding that grounds the Gap 2 Option A rejection.

---

*Feature research for: v2.2 Rotation Handle Polish milestone*
*Researched: 2026-04-14*
*Scope: Gap 3 (hover pill re-arm), Gap 4 (mtr handle clip), Gap 2 (off-screen handle, conditional)*
*Supersedes prior FEATURES.md for v2.2 roadmap purposes only.*
