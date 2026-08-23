# Page-rotate remapped-page `mt` after CW rotate — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped `br` or the 90→180 `mtr` happy path as the leftover.

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

After CW remap the grown rect sits on the new right/top edge (`left` **648.17**, `top` **−8.41**, angle **90**, viewBox `0 0 792 612`). Overlay `rotate(90)` maps local-top to world-right, so `mt` / `tl` / `tr` / `ml` / `bl` sat past the viewBox. Same `overflow: hidden` clip as `mtr`. `br` / `mb` / `mr` were already on-page.

Min-viable:

- `clampHandleToPage()` in `src/utils/svgBoundingBox.js` — pull an overlay knob toward the bbox center along the same world ray (shared by `placeRotationHandle`).
- `SVGSelectionOverlay` clamps the 8 resize handles (inset **8**) and parks `mtr` with `separateRotationHandle` so the hit circle no longer covers `mt`.
- Stem attaches on the `mtr` side of the pill after both knobs clamp inward.

Typical mid-page line `p1` / `p2` stay on-page after remap (offsets not rewritten). Callout 0–1 fractions are not remapped — not this leftover. Shift+45 after object-180 still not cheap (`mtr` screen box **x −516**). CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-remap-resize.spec.mjs` **3 / 3 (13.5s)** on Vite `http://127.0.0.1:5297`. Focused Node `pageRotateRemapResize` + leftover18 **22 / 22**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop rect `e2b4c085-…` create **120.4** then pre-rotate `br` **135.42 × 152.24**. CW maps center **67.71, 76.12 → 715.88, 67.71**; angle **90**; left **648.17**. All 8 resize handles on-page (`offPage` **[]**). `mt` `dxRight` **10.22**; `elementFromPoint` **`rect` / `mt`**. Inward `mt` **152.24 → 140.33** height; width held; angle **90**. Toolbar Undo restores **152.24**; viewBox stays **`0 0 792 612`**. 390 Pages rotate not cheap; edge viewBox + `file.id` + 0 marks.

### Intended — **pass** (`mt` collapse)

| Slice | Evidence |
|---|---|
| Knob on remapped page | `REMAP_HANDLE_CLIP` all 8 `onPage`; `mt` `dxRight` **10.22**. |
| Hit | `MT_HIT` `rect` / `mt` (not `mtr`). |
| Inward drag | **vh 152.24 → 140.33**; vw held **135.42**; angle **90**; on-page. |
| viewBox | **`0 0 792 612`** |

### Break — **pass** (undo last `mt`)

| Control | Input | Result |
|---|---|---|
| Undo last remapped `mt` | Toolbar Undo | Size **140.33 → 152.24**; viewBox **`0 0 792 612`**. |
| Radial grow `mt` | World +x leaves the page | **Not applicable**; inward collapse is the hittable sibling. |
| Shift+45 after 180 | Stem screen box **x −516** | **Not applicable** (same skip as remapped `mtr`). |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after rotate / remapped `mt` | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; user marks **0** |
| Line / callout | Typical mid-page line `p1`/`p2` on-page; callout fractions not remapped — not this leftover |

## Official / focused Node

Focused `pageRotateRemapResize` + leftover18 **22 / 22**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit; overlay + bbox helpers covered by focused tests).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
