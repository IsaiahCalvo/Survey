# pages-panel — fix log

Date: 2026-08-20
Allowlist: `src/sidebar/PagesPanel.jsx`, `src/sidebar/pagesPanelUtils.js`, matching tests.
Did not edit PDFViewer.jsx.

## P1-42 — Sidebar thumbnails never use the existing IndexedDB cache

- Status: **closed**
- Files changed: `src/sidebar/pagesPanelUtils.js` (`getPdfDocumentCacheStamp`, `buildPagesPanelThumbKey`), `src/sidebar/PagesPanel.jsx` (`processQueue` reads/writes `thumbnailStore`)
- Intended behavior confirmed: before a pdf.js raster, PagesPanel looks up `pages-panel::<fingerprint>::<page>::<quality>::r<rev>` in the existing Home-screen IndexedDB store. Hits skip the render; successful rasters are written. Fast hits still enqueue a crisp upgrade.
- Break / adversarial attempts: missing stamp / page 0 → no key (skip cache rather than collide). Quality and revision change the key. Black frames are not written (see P1-54).
- Edges covered: fingerprint array vs legacy `fingerprint`; revision invalidation hook (`thumbnailCacheRevision`, default 0).
- Test command + result: `node --test tests/pagesPanelUtils.test.mjs` → pass
- Remaining risk: parents do not yet pass `thumbnailCacheRevision`. Cache relies on pdf.js fingerprints; if a page-op mutates bytes without changing the fingerprint, a stale thumb can persist until revision is wired. CSS rotate/mirror still apply on top of the cached raster.

## P1-43 — Drag-reorder in a filtered Space also moves hidden pages

- Status: **closed**
- Files changed: `src/sidebar/pagesPanelUtils.js` (`canReorderVisiblePages`), `src/sidebar/PagesPanel.jsx` (internal mime / drop / drop-highlight gated)
- Intended behavior confirmed: internal reorder only runs when the visible list is the complete `1..numPages` sequence. A Space subset (e.g. `[2,5,8]`) sets dropEffect `none` and never calls `onReorderPages`. Drag-to-tab (external mime) is unchanged.
- Break / adversarial attempts: full 1..n allowed; subset; permutation of 1..n (not sequential) treated as filtered; empty / numPages 0.
- Edges covered: `activeSpacePages` and `shouldShowPage` both feed `allowedPages`.
- Test command + result: `tests/pagesPanelUtils.test.mjs` → pass
- Remaining risk: no “move among visible pages only” translation — reorder is disabled in Space mode, not remapped. That needs a parent API if product wants filtered-relative moves.

## P1-54 — Black-thumbnail-detection guard is dead code

- Status: **closed**
- Files changed: `src/sidebar/pagesPanelUtils.js` (`isLikelyBlackThumbnailPixels`), `src/sidebar/PagesPanel.jsx` (`applyThumbnailResult` now runs the existing Image probe before commit; one retry on black)
- Intended behavior confirmed: solid-black rasters are not committed and not cached. One re-queue retry, then give up (avoids a loop on a genuinely black page).
- Break / adversarial attempts: 8×8 opaque black → reject; white → accept; one bright pixel in a black field → accept (contrast); empty / zero size → false (fail open).
- Edges covered: probe still uses the existing canvas path; pixel math is shared with Node tests.
- Test command + result: `tests/pagesPanelUtils.test.mjs` → pass
- Remaining risk: Image/canvas probe is browser-only; Node tests cover the pixel predicate, not the Image onload path. A page that is *supposed* to be near-black (e.g. a night render) could be rejected once and retried.
