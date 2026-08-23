# Page-2-only rotate — page 1 objects hold — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** invent pages.

Multi-page fixture already exists: `debug/fixtures/spike-120-pages.pdf` (bookmark-jump). Bookmark-jump proved sibling rotate stays on page 1 **without** annotations. This leftover is **objects on both pages**.

Distinct from leftover-18 / X-01 / CW/CCW/180 remapper persist / handle catalogs (not replayed).

## Live proof

`?testPdf=spike-120-pages.pdf` · Playwright `e2e-page-rotate-page2.spec.mjs` **2 / 2**.

| Object | Before | After page-2 CW |
|---|---|---|
| Page 1 `36a5d2dd-…` | **183.60, 277.20** angle **0** | **held** same id / center / angle / `left`/`top` |
| Page 2 `e749e2ca-…` | **183.60, 277.20** angle **0** | **514.80, 183.60** angle **90** |
| Page 1 viewBox | `0 0 612 792` | **held** leftover portrait |
| Page 2 viewBox | `0 0 612 792` | **`0 0 792 612`** landscape host |

Break: empty page-2 CW invents **0** on page 2; page 1 cache holds the original rect (sibling rotate can unmount page 1’s SVG layer — hold is cache + remount, not a drop). Edge: 390 viewBox + `file.id` null; hubPreview Draw **0**.

Observed `Maximum update depth exceeded` in `PDFViewer` during page-2 rotate on the 120-page fixture. Tests still passed. Known chrome-publish identity-churn class (CLAUDE.md). Did **not** invent a high-risk `PDFViewer` fix this turn.

## Node

`tests/pageRotatePage2.test.mjs` — `transformPageState` rotate page **2** remaps page 2 only; page 1 identity; spec uses `spike-120-pages`. **2 / 2**.

## Product

No product edit. High-risk files untouched. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk change). `graphify` CLI **absent**.

## Next leftover

Leftover-18 live hosts (first **X-01**). Goal stays **OPEN**.
