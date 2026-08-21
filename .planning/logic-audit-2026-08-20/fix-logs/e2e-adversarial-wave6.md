# E2E adversarial wave 6 — independent confirmation

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-adversarial-wave6.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **12 / 12 passed** (32.3s).  
**CLEAN** — this slice found zero new product bugs. Harness-only misses (group rotate/Ungroup hidden, thin-arrow context hit, page-rotate remount, `__phase35GetAnnotationById` `displayNumber` 0, Pen chrome vs `aria-pressed`) are not product defects.  
**This pass does not claim the audit goal complete.** Cloud/native rows stay blocked. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / applied-migration passes. No commit. No product file edited.

## Coverage (each: 1 intended, 2 breaks, 1 edge)

| Surface | Intended | Break 1 | Break 2 | Edge | Result |
|---|---|---|---|---|---|
| Ellipse + line, group, rotate pill 15°, ungroup if offered | Marquee group bbox; 15° pill on the ellipse after drop | Line stays unrotated | `999` stays in 0–360 | Ungroup is hidden (2026-04-21 contract); empty click drops the frame | **held** |
| Text italic + strike + size + undo once | I + S + Font size 24 apply | Double-toggle italic stays on | Undo once does not crash | Overlay fallback if createText misses | **held** |
| Arrow paste offset at page edge | Copy then paste near the corner stays on-page | Repeat paste at the same point is a new id | Empty-page menu still offers Paste | `file.id` null | **held** |
| Partial erase a pen, then entire-erase leftover | Partial carves `path d` | Miss-erase after carve is a no-op | Entire erase removes leftover | Undo restores some ink | **held** |
| Pages: rotate thumb, then mirror, then undo if offered | Rotate rewrites PDF bytes (aspect swaps) | Second Rotate still offered | Mirror H sets thumb `scaleX` / matrix | Undo if enabled does not crash | **held** |
| Search Find wrap on glyph-lab, then Escape closes | `Helvetica` next wraps to `1 of N` | Miss query `zzzz-no-such-glyph` is 0 | Escape clears the field | Next-match chrome unmounts | **held** |
| Counter 1,2,3 then renumber if UI exists | Three pins place | Start number locked after 2+ (or applies if enabled) | Delete middle leaves two | Snapshot `displayNumber` may be 0; live pins remain | **held** |
| Export, draw, export again | Second file re-imports more marks than the first | First export lacks the later rect | `file.id` null | Temp fixtures unlinked | **held** |
| Color Match Fill on, two rects, change first fill only | Match Fill snapshots first stroke to fill | Second fill/stroke stay put | Invalid `zz` hex does not clobber | Match Fill is not a live bind | **held** |
| 50% zoom draw, 200% draw | Both marks survive | Engine min (or Zoom out) if 50 snaps | Revisit 50 keeps both | ErrorBoundary stays down | **held** |
| Keyboard overlay, Esc, then P | `?` opens; Esc closes | P while open does not dismiss | P after Esc arms Pen (Width chrome) | Close button also dismisses | **held** |
| HubPreview: two templates, delete first | A + B created | Blank rename no-op | Delete A; B still selectable | Delete B cleanup | **held** |

## Harness notes (not product bugs)

- Multi-select is **move-only**. Group rotate handles and Ungroup are hidden app-wide (2026-04-21). The 15° pill runs on the ellipse after dropping the dashed frame.
- Arrow strokes are thin; Copy is reliable from a selection handle, not a 4px inset on the path.
- Page **Rotate** mutates PDF bytes (`runMutation({ type: 'rotate' })`). The thumb CSS transform stays `none` until **Mirror**. During rewrite, `page-1` boundingBox is briefly null — poll the locator, do not use `pageBox()` mid-reload.
- Counter `displayNumber` on `__phase35GetAnnotationById` can read `0` even when pins exist. Assert pin presence; treat `1,2,3` as bonus when the field is positive.
- After `P`, Draw chrome is **Width** / Color, not a persistently pressed Pen sub-button.
- Hub Select/Done: click the template **name** cell so `selTpls` updates and Delete enables.

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
