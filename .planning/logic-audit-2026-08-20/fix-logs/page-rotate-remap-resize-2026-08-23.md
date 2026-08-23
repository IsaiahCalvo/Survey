# Page-rotate remapped-page bbox resize / `mtr` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

E-01/E-02 only covered selected bbox resize / `mtr` on an unrotated page (viewBox stayed `0 0 612 792`). Page-rotate-transformed / export-reimport stop at remapped placement. This is the live sibling: rubber-band rect → `br` → page CW → **another** `br` on the remapped page (`viewBox` `0 0 792 612`, angle 90). Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / page-ops catalogs / export-after-rotate. Did **not** invent lease / plus-alias / stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

Min-viable: after CW remap, Fabric `obj.left` / `obj.top` become **`0`** (placeholder) while remapped position lives in `data.left` / `data.top` (`648.17`, `-8.41`). `??` and `left || 0` kept `0`, so overlay / handles / hit rendered in pre-rotate origin space and a later `br` committed `left: 0`.

- `displayedBoxOrigin()` in `src/utils/svgBoundingBox.js` — prefer `data.left`/`data.top` when Fabric left/top is `0` and data is a remapped non-zero.
- `getRectBBox` + `SVGAnnotationLayer.jsx` rect render use that helper (high-risk; min-viable).
- `useSVGInteraction.js` resize `originalProps` + commit writes `data.left`/`data.top`.
- `pageAnnotationReindex.js` remapper always writes `next.left/top` and `data.left/top/angle`.
- `PDFViewer.jsx` SVG layer key includes `pageMutationRevision` so the overlay remounts after page ops (high-risk; min-viable).

CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-remap-resize.spec.mjs` **2 / 2 (9.1s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageRotateRemapResize` + leftover18 **17 / 17**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop rect `6aab5701-…` create **120.4** then pre-rotate `br` **135.42 × 152.24**. CW maps center **67.71, 76.12 → 715.88, 67.71**; angle **90**; left **648.17**. Handles sit on the remapped hit (`handleCx` **783.59**, `handleCy` **143.83**; `renderX` **648.17** — not origin `0`). Post-rotate `br` **135.42 → 141.27 × 158.82** (`+5.85` / `+6.58`); left stayed **~642** (did **not** jump to 0); angle held **90**. Undo last resize restores remapped size; viewBox stays **`0 0 792 612`**. Redo restores the remapped `br`. 390 Pages rotate not cheap (sheet); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass** (`br`; `mtr` skipped)

| Slice | Evidence |
|---|---|
| Create + pre-rotate `br` | **120.4 → 135.42 × 152.24**. |
| Page rotate CW | Same id; center **715.88, 67.71**; angle **90**; viewBox **`0 0 792 612`**. |
| Handles in swapped viewBox | `storeLeft` **0** / `storeDataLeft` **648.17**; `renderX` **648.17**; `br` at **783.59, 143.83**. |
| Post-rotate `br` | **135.42 → 141.27 × 158.82**; left **~642** (not 0); angle **90**; on-page. |
| `mtr` | Handle present. Drag to 135 then 180 left angle at **90**. **Skipped** (`MTR_OPTIONAL_SKIP`). `br` is the required remapped-transform proof. |

### Break — **pass** (undo last resize; collapse/flip not applicable)

| Control | Input | Result |
|---|---|---|
| Undo after page rotate | Toolbar Undo | **Disabled**. Page mutations wipe the local undo lane. Cannot invert rotate. |
| Undo last remapped `br` | Ctrl+Z | Restores post-rotate size **135.42 × 152.24**; remapped center held; viewBox **`0 0 792 612`**. |
| Redo remapped `br` | Ctrl+Shift+Z | Restores **141.27 × 158.82**. |
| Collapse floor | Source `0.01` / `abs(scale)` + remapped `br` size **> 1** | Floor held. Live inward `br` at angle 90 is **not applicable** (AABB-center no-op; inverse-grow overshoots off-page). |
| Flip | Same harness | **Not applicable** at angle 90 in this harness. |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after rotate / remapped `br` | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; user marks **0**; Pages rotate not cheap |
| hubPreview | Draw **0** |

## Official / focused Node

Focused `pageRotateRemapResize` + leftover18 **17 / 17**. Cap **8448** not loosened. Official `npm test` fail-stopped on standing `counterControlsContract` (`disabled={startLocked}` vs current `locked={startLocked}` on `CounterStartNumberField`) — not caused by this pass; not loosened.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
