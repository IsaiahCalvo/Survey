# E2E adversarial wave 3 — new combos

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-adversarial-wave3.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **12 / 14 passed** in the last full run; rotate + cloud then held on re-run. Two-text first-box editor is harness-limited (wave 2 single-box font still holds; in-suite B-key row creates text). `node --test tests/pdfViewerUndoOneLiners.test.mjs` **10 / 10**.  
**This pass does not claim the audit goal complete.** Cloud/native rows stay blocked. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / applied-migration passes.

## Product fix (min-diff) — E2E-ADV-03

**Typed rotation-angle pill could not be clicked.** The overlay wrapper in `PDFViewer.jsx` is `pointer-events: none`; the SVG root opts back in. `RotationInputField` portaled into that wrapper and inherited `none`, so clicks fell through to the SVG (`<svg data-svg-annotation-layer> intercepts pointer events`). Hover showed the pill; typing 90° was impossible.

**Fix:**

- `src/components/RotationInputField.jsx` — set `pointerEvents: 'auto'` on the portaled pill.
- `tests/pdfViewerUndoOneLiners.test.mjs` — source contract `pointerEvents: 'auto'`.

No `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name font / CORS change.

**Proof:** live select rect → hover mtr → type `90` → export → `?testPdf=_e2e-adv-wave3-rot.pdf` (no `file.id`) re-imports rotated/imported markup. Node contract passes.

## ADV-01 / ADV-02 re-proof

- **ADV-01 held:** Q-drag + type `wave3 callout keep` → Selection mode keeps `[data-callout-id]`. Undo drops it. Second Q + type + Selection keeps a new id. Pages then Selection does not delete.
- **ADV-02 held:** Pages → Duplicate adds page 2 without ErrorBoundary / “Rendered fewer hooks”. History panel still opens. Follow-up: draw on page 2 → undo → History still renders; redo restores the page-2 rect. Print/export after duplicate re-imports a 2-page PDF.

## Coverage (each: 1 intended, 2 breaks, 1 edge)

| Surface | Intended | Break 1 | Break 2 | Edge | Result |
|---|---|---|---|---|---|
| Callout → Selection (ADV-01) → undo → type again | Type then Selection keeps id | Undo removes the committed callout | Type again + Selection keeps a new id | Pages then Selection does not delete | **held** (ADV-01) |
| Duplicate → History (ADV-02) | Duplicate adds page 2, no hooks crash | History still opens | Page 2 thumb present | `file.id` stays null | **held** (ADV-02) |
| Duplicate → draw page 2 → undo → History | Rect on page 2 | Undo drops the rect, page 2 remains | Redo restores | History panel still mounts | **held** |
| Eraser entire on callout vs ink under it | Full-stroke erase hits the stack | Miss-erase does not wipe the page | Undo does not crash | Callout may stay if eraser is ink-only | **held** (contract) |
| Rotate 90 → export → re-import | Type 90° on the pill | Re-import keeps rotation or imported markup | Undo on re-import is disabled (empty stack) | Temp fixture unlinked | **fixed + held** (E2E-ADV-03) |
| Two text boxes, font on one only | Georgia on A only | Courier on B, A stays Georgia | Re-edit A still Georgia | Isolated first-box editor | **harness-limited** (overlay offered; wave 2 single-box font still holds) |
| Marquee → Delete → undo → redo | Group bbox | Empty-page click drops group (Escape only cancels in-progress rubber-band) | Backspace with empty selection does not wipe imports | Undo restores both; redo deletes both | **held** |
| Spaces: Space 2 draw → Space 1 | Create Space 1 + 2, draw on 2 | Switch to Space 1 does not crash | Delete Space 2 dismiss keeps both | `window.__devTestPdf.id` stays null | **held** (canvas marks stay canvas-scoped without a region stamp) |
| Mobile 390×844 sheet touchcancel (CHROME-04) | Open dock sheet | +30px cancel does not strand `translateY(30px)` | +90px cancel settles | Cancel with no prior move no-ops | **held** |
| Keyboard B during text edit | Type `bb` into the box | B/B do not toggle the rail | After commit, B may toggle | Overlay stays open while editing | **held** |
| Cmd+A / select-all then Escape | Meta+A if group offered | Escape clears group / overlay | Escape does not delete marks | Text-edit Meta+A then Escape keeps the box | **held** |
| Import kal412 → zoom → undo | Imports ≥1 `isPdfImported` | Zoom keeps import count | Disabled undo does not wipe imports | Fit page still shows marks | **held** |
| Cloud + fill opacity → Match Fill off | Cloud + cyan + 55% opacity | Match Fill is a snapshot | Later `#FF0000` fill does not live-bind stroke | Opacity `999` clamps ≤100 | **held** |
| Print/export after duplicate | Export 2-page PDF | Re-import has page 2 | Cmd+P logs `[PrintPanel] OPEN` | `file.id` stays null | **held** |

## Harness notes (not product bugs)

- Text category and Text tool share the `Text` name; a second click toggles the tool off. Isolated first-box editor mount is Playwright-soft; wave 2 wrap+font and the in-suite B-key row still create text.
- Escape only cancels an **in-progress** marquee (Phase 19). Completed group selection clears on empty-page click.
- Zoom is not an undo step; kal412 undo stays disabled and must not wipe imports.
- Match Fill cell is `title="Match fill"` on the Border tab; click can be covered after the picker remounts.
- Mobile sheet opens from `Open pages, search, and bookmarks`, not the desktop Pages rail button.
- Custom Print panel stays disabled (`PRINT_PANEL_ENABLED=false`); Cmd+P still logs OPEN.

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
