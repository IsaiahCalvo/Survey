# E2E adversarial wave 4 — new combos

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed)  
**Harness:** `debug/scenarios/e2e-adversarial-wave4.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **15 / 15 passed** (45.4s). `npm test` **exit 0** after the PDFViewer edit. `node --test tests/pdfViewerUndoOneLiners.test.mjs tests/viewerDismissBarrierContracts.test.mjs` **16 / 16**.  
**Not CLEAN** — this slice found two new product bugs (E2E-ADV-04, E2E-ADV-05) and fixed them.  
**This pass does not claim the audit goal complete.** Cloud/native rows stay blocked. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / applied-migration passes. No commit.

## Product fix (min-diff) — E2E-ADV-04

**Draw then undo twice after a second draw inserted a no-op undo step.** Zoom was a red herring (`__pdfHistoryDebug` showed no zoom checkpoint). A normal `path:created` save wrote the same mutation onto **both** the local annotation lane and the legacy fast checkpoint. `shouldUndoLocalBeforeLegacy` prefers the newer order, so the first Undo popped legacy (shape gone) and the next Undo popped the leftover local inverse (IDs unchanged).

**Fix:**

- `src/PDFViewer.jsx` — push `finalLocalHistoryAction` only when legacy will be skipped (`isEraserCommit || yjsDoc || yjsUndoManager`). Precise eraser / CRDT keep the local lane.
- `tests/pdfViewerUndoOneLiners.test.mjs` — source contract that the unconditional dual-write is gone.

No `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name font / CORS change.

**Proof:** live draw → undo/redo probe → zoom → draw → undo twice removes both rects with `extraNoop === 0`; zoom percent stays. Node contract passes.

## Product fix (min-diff) — E2E-ADV-05

**Typing a hex value in Font color, then clicking Font, did not open the font picker.** `CompactColorPicker`’s `DismissBarrier` consumes the first outside pointerdown + trailing click, so the Font trigger never received `onClick`. Hex itself applies live via `normalizeHexColor` (no Enter). The user had to click Font twice.

**Fix:**

- `src/components/CompactColorPicker.jsx` — optional `passthroughSelector` forwarded to `DismissBarrier` (dismiss + keep the sibling click). Hex field `aria-label="Hex color"`; root keeps `data-testid="compact-color-picker"` / `data-font-color-picker` so text-edit click-outside does not treat picker clicks as commit.
- `src/AppShell.jsx` — Font color picker passes `.annotation-dropdown__trigger, [data-font-family-menu], [data-font-size-menu]`.
- `src/components/TextEditOverlay.jsx` — click-outside opt-out includes `[data-testid="compact-color-picker"]`.
- `tests/viewerDismissBarrierContracts.test.mjs` — source contract for passthrough.

**Proof:** live type `f00` in Hex color → one Font click opens the family popover → Georgia commits. Invalid `#f00` / `zz` does not crash.

## ADV-01 / ADV-02 / ADV-03 re-proof

- **ADV-01 held:** Q-drag + type `wave4 callout keep` → Selection keeps `[data-callout-id]`. Undo drops it. Second Q + type + Selection keeps a new id. Pages then Selection does not delete.
- **ADV-02 held:** Pages → Duplicate adds page 2 without ErrorBoundary / “Rendered fewer hooks”. History panel still opens.
- **ADV-03 held:** rotation pill is clickable (`pointerEvents: 'auto'`); type 90° works. Follow-up: type 45° then drag a resize handle changes size and keeps ~45°.

## Coverage (each: 1 intended, 2 breaks, 1 edge)

| Surface | Intended | Break 1 | Break 2 | Edge | Result |
|---|---|---|---|---|---|
| Callout → Selection (ADV-01) → undo → type again | Type then Selection keeps id | Undo removes the committed callout | Type again + Selection keeps a new id | Pages then Selection does not delete | **held** (ADV-01) |
| Duplicate → History (ADV-02) | Duplicate adds page 2, no hooks crash | History still opens | Page 2 present | `file.id` stays null | **held** (ADV-02) |
| Rotation pill clickable (ADV-03) | Type 90° | Pill `pointer-events: auto` | Angle near 90/270 | — | **held** (ADV-03) |
| Type 45° then resize handle | Typed 45° + handle drag changes size | Resize keeps ~45° | Type `999` stays in 0–360 | Undo keeps the rect | **held** |
| Two text boxes, font isolation | Georgia on A only | Courier on B, A stays Georgia | Re-select A still Georgia | Isolated first-box editor | **held** (overlay fallback still in spec) |
| Line + arrow group z-order | Marquee group | Bring to front | Send to back + undo | Empty-page click drops group | **held** |
| Partial erase across highlighter over rect | Carve highlighter `path d` | Rect survives | Undo restores `d` | Miss-erase no-ops | **held** |
| Bookmark folder nest + P1-45 delete | Create group + nested bookmark | Dismiss confirm keeps both | Accept deletes subtree | Undo restores; redo deletes again (`p1-45-undo.md`) | **held** |
| Undo stack: draw, zoom, draw, undo twice | Two undos remove both rects | Zoom is not an undo step | Extra no-op step gone | Undo/redo probe on first draw | **fixed + held** (E2E-ADV-04) |
| Survey stamp + tool switch + undo | Walls stamp | Selection then undo stamp only | Redo restores | Undo again drops stamp | **held** |
| Hex `#f00` then Font without committing hex | Type `f00`, Font opens in one click | Georgia applies after commit | `#f00` / `zz` does not crash | Font stays after outside click | **fixed + held** (E2E-ADV-05) |
| Export after pill 90°, re-import, handle rotate | Export rotated | `?testPdf=_e2e-adv-wave4-rot.pdf` (no `file.id`) | Handle rotate on re-import | Temp fixture unlinked | **held** |
| Mobile 390×844 requestClose then rapid reopen | Backdrop close | Rapid dock reopen | Sheet not left at `translateY(100%)` | Dock is `togglePanel` during 170ms close | **held** |
| Keyboard `?` then B with overlay open | `?` opens shortcuts | B does not crash/unmount it | Escape closes | Overlay stays until Escape | **held** |
| kal441 fill + Fit page | Type + checkbox | Values persist across Fit | `file.id` null | 1-page fixture (no real page 2) | **held** |

## Harness notes (not product bugs)

- Bookmark edit mode uses `<input>` values (`wave4-zone` / `wave4-nested`); `getByText` does not match those fields.
- Font family lives on the overlay until text-edit commit (click-outside); the Font trigger label updates live.
- Two-text still has a createText try/catch if the first-box editor does not mount (wave 3 limitation). This run passed.
- Hex field already prefixes `#`; type `f00`, not `#f00`, or the value becomes `##f00` and does not normalize.
- Zoom does not write a history checkpoint; the extra undo step was dual-lane, not scale.

## Still blocked (unchanged)

- Named cloud revisions / restore (`file.id` + saved document)
- Live Stripe Checkout
- Live MSAL
- Capacitor / native sheets / XCUI pinch
- Captcha-gated password login
- Applied migrations
- Live collab roster / outbox Retry
- U-04 cloud usage count (HubPreview path already closed)
- Native Alt-marquee subtract (Playwright modifier)

Invariants untouched: `zoomGeneration`, SVG `viewBox`, container-aware canvas, single-name fonts, CORS `*`.
