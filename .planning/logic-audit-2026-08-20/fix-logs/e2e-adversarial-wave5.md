# E2E adversarial wave 5 — new combos

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-adversarial-wave5.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **15 / 15 passed** (39.2s).  
**CLEAN** — this slice found zero new product bugs. Harness-only misses (imported `\d+R` link IDs, 48px chrome host vs `--app-sidebar-width`, callout knee handles vs mtr pill, hub Select/Done toggle) are not product defects.  
**This pass does not claim the audit goal complete.** Cloud/native rows stay blocked. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / applied-migration passes. No commit. No product file edited.

## ADV-01 … ADV-05 re-proof

- **ADV-01 held:** Q-drag + type `wave5 callout keep` → Selection keeps `[data-callout-id]`. Undo drops it. Second Q + type + Selection keeps a new id. Pages then Selection does not delete.
- **ADV-02 held:** Pages → Duplicate adds page 2 without ErrorBoundary / “Rendered fewer hooks”. History panel still opens.
- **ADV-03 held:** rotation pill is clickable (`pointerEvents: 'auto'`); type 90° works.
- **ADV-04 held:** draw rect → undo → redo restores the **same id**; second undo returns the empty user-id set. Zoom then second draw → undo twice removes both with `extraNoop === 0`. User-id counts ignore late-hydrating PDF link objects (`39R` / `43R` / …).
- **ADV-05 held:** type `f00` in Hex color → one Font click opens the family popover → Georgia commits. Invalid `zz` does not crash.

## Coverage (each: 1 intended, 2 breaks, 1 edge)

| Surface | Intended | Break 1 | Break 2 | Edge | Result |
|---|---|---|---|---|---|
| Draw rect, undo, redo, undo (ADV-04 family) | Same id + count after redo | Undo returns empty user-id set | Extra no-op after zoom+second draw is 0 | Zoom is not an undo step | **held** (ADV-04) |
| Hex then Font once (ADV-05) | One Font click opens menu | Georgia commits | `zz` does not crash | Font stays after outside click | **held** (ADV-05) |
| Triple-undo after pen, rect, text | Three undos remove all three | Fourth undo does not restore a no-op | Redo ×3 restores all three ids | ErrorBoundary stays down | **held** |
| Redo after switching pages | Duplicate → draw p1 → undo → p2 → redo restores p1 id | Redo does not leak onto page 2 | Undo from page 2 drops p1 only | `file.id` null | **held** |
| Callout + rotate pill 30° + export | Callout stays; companion rect types 30° | `999` stays in 0–360 | Export re-imports a mark | Callouts use knee/arrow handles, not mtr (contract) | **held** |
| Entire erase → undo → partial on restored ink | Entire erase removes the path | Miss-erase after gone is a no-op | Undo restores original `d` | Partial carve then undo restores `d` | **held** |
| Sidebar B, Draw, B | Pages open → B collapses (`--app-sidebar-width` < 80) | Draw while collapsed still commits | B expands again; ink stays | BBB does not crash | **held** |
| 3 bookmarks, reorder, undo if offered | a/b/c created | Empty name does not add a fourth | Drag handle reorder keeps all three | Undo if enabled does not wipe the set | **held** |
| Spaces: stamp in each, switch | Space 1 + 2; Walls stamp in each | Switch does not crash | Isolation is space-count or canvas-scoped | `file.id` null | **held** |
| 4000% zoom, type text, Fit page | Text commits at 4000% | Fit page ≠ 4000 and text remains | Re-zoom to 4000 keeps the id | ErrorBoundary stays down | **held** |
| Highlighter + callout, Shift-click, Cut, Paste | Cut removes at least one | Paste adds a clone | Undo after paste does not crash | Empty-page right-click dismisses | **held** |
| HubPreview template same name | Create + rename + Save | Blank rename no-op | Delete then recreate same name + delete again | Select/Done must stay in template aside | **held** |

## Harness notes (not product bugs)

- `clickable-link-test.pdf` hydrates imported link objects as `39R` / `43R` / … after first paint. `userAnnotationSnapshot` must drop `isPdfImported` **and** `/^\d+R$/` or undo counts race.
- `#chrome-left-host` is a fixed 48px flex basis; the rail width lives on `--app-sidebar-width` (48 ↔ 272). The sidebar starts collapsed; open Pages before asserting B-collapse.
- Callouts expose knee / arrow / text-box handles, not `[data-rotation-handle="mtr"]`. The 30° pill path runs on a companion rect; export still includes the callout.
- Bookmark row `textContent` includes the ☰ handle; match names with `includes('wave5-bm-')`, not `startsWith`.
- Hub template `Click to rename` matches category titles too. Use `input.inline-edit.cat-title`. After the first Select+Delete, the aside button reads **Done**; a second `Select` click would toggle **off** and leave Delete disabled. `selectAndDeleteHubTemplate` stays on Done.

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
