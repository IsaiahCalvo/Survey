# Pickers every swatch / font / format — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Base:** `main`  
**Vite:** Playwright webServer `http://127.0.0.1:5173` (`npm run dev:ui`).  
**Goal:** stays open. Did **not** mark `/goal` complete.

Did **not** replay waves 5–13, flatten, survey-marker, pages insert/rotate/move, History restore, PDF-link ftp, thin leftovers, callout last-writer, hub docs extras.

Did **not** invent captcha / Stripe / MSAL / Capacitor / plus-aliases / prod SQL / `file.id` on `?testPdf=` / Extract Pages / Note or Link create.

Leftover **18** stay parked. Cap **8448 MiB** / **75/250** not loosened.

## Why this pass

Catalog-reconcile claimed **0** unique unblocked GAPs at **cluster** level (`C-01`, `T-03`…`T-07`). Cluster-proven ≠ every discrete swatch / font / format. This pass inventories every live picker on `?testPdf=` editor chrome and live-proves each discrete value (stored or computed style after apply).

## Live inventory (desktop `?testPdf=`, leftover-18 off)

| # | Picker site | Discrete values | firstPreset / notes |
|---|---|---|---|
| 1 | Shape **Fill** tab (rect / ellipse / text / callout selected or armed) | 16: transparent + 15 solids | `firstPreset='transparent'` |
| 2 | Shape **Border** tab (rect / ellipse) | 15 solids + **Match Fill** | `firstPreset={kind:'match'}`, `minOpacity=1`, no Transparent |
| 3 | Stroke-only **Color** (Pen / Highlighter / Line / Arrow) | 16: transparent + 15 solids | no Fill tab |
| 4 | Counter **Fill** tab | 16: transparent + 15 solids | `aria-label="Counter colors"` |
| 5 | Counter **Number** tab | 15 solids + transparent | not Match Fill (`shapeOneVisibleRule` is rect/ellipse only) |
| 6 | Rich-text **Font color** | 15 solids | `firstPreset='none'`, `showOpacity={false}` |
| 7 | **Font** family dropdown | 6 single names | Arial, Helvetica, Times New Roman, Courier New, Georgia, Verdana |
| 8 | **Font size** dropdown | 18 presets | 8…72; desktop has no numeric field |
| 9 | **B / I / U / S** | 4 toggles | Bold / Italic / Underline / Strikethrough |
| 10 | **Text alignment** 3×3 | 9 cells | no Justify offered |
| 11 | **Style** | Solid / Dashed / Dotted (+ Cloud on rect) | dash `6,4` / `2,4` |
| 12 | **Arrowhead** | 6 | already S-04 — not replayed |
| 13 | **Width** presets | 12 | already D-05 — not replayed |

**Same catalogs, not a second invent:** mobile sheets reuse `CompactColorPicker` + `FONT_FAMILIES` (`MobilePdfViewerChrome.jsx`). Node contract: `tests/annotationStyleUiContract.test.mjs`. P-02 catalog live once.

**No picker (skip):** context menu (Cut/Copy/Paste/z-order only).  

**Compile-hidden (skip, not invented):** text-highlight split color menu (`showTextMarkupHighlightMenu = false`); Underline / Squiggly / Strike tools; Note create; Link create; Forms designer colors.

**Leftover-18 (skip):** cloud save / identity-churn (`X-01`). `file.id` stayed null.

## Verdict

Playwright `debug/scenarios/e2e-pickers-every-swatch.spec.mjs` **5 / 5 (32.6s)**.

- **Picker sites inventoried:** 13 desktop (11 live-proven this pass; Arrowhead + Width cited, not replayed).
- **Unique unblocked per-value GAP remaining:** **0**.
- **Product bugs fixed:** **0**. All six `FONT_FAMILIES` are single names (no CSS stack). No high-risk files touched.
- **Leftover-18:** still parked.

## Classification

- **swatch-proven** — this spec asserted stored/computed style after that exact value (or a cited live spec that already did).
- **cited** — existing spec already hard-asserted every value; not replayed.
- **compile-hidden / leftover-18** — skipped.

### Color swatches (every hex)

| Value | Fill | Border | Pen stroke | Counter fill | Counter number | Font color |
|---|---|---|---|---|---|---|
| transparent | **swatch-proven** | n/a (Match Fill) | **swatch-proven** | **swatch-proven** | n/a as first cell; solids all proven | n/a (`firstPreset='none'`) |
| Match Fill | n/a | **swatch-proven** → stroke `#00FF00` | n/a | n/a | n/a | n/a |
| `#FF0000` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#FF0080` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#FF00FF` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#8000FF` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#0000FF` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#0080FF` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#00FFFF` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#00FF80` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#00FF00` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#80FF00` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#FFFF00` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#FF8000` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#FFFFFF` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#808080` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |
| `#000000` | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** | **swatch-proven** |

Prior cluster C-01 (`e2e-adversarial-repass.spec.mjs`) clicked all 15 solids but asserted only the **last** fill (`#000000`). That is why this table exists.

### Fonts / sizes / format / align / style

| Value | Class | Evidence |
|---|---|---|
| Arial, Helvetica, Times New Roman, Courier New, Georgia, Verdana | **swatch-proven** (offered + single-name) | This spec: Font menu lists all 6; option `fontFamily` has no comma. T-03 (`e2e-adversarial-repass.spec.mjs`) already applied each to overlay computed style — not replayed as a second apply loop. Georgia committed after undo in this spec. |
| Sizes 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72 | **swatch-proven** | Trigger label + `fontSize` / overlay px after **each** pick (T-04 previously asserted only last `72`) |
| Bold / Italic / Underline / Strike | **swatch-proven** | `aria-pressed=true` + overlay weight/style/decoration after each |
| top/middle/bottom × left/center/right | **swatch-proven** | stored `textAlign` / `verticalAlign` after each of 9 |
| Solid / Dashed / Dotted / Cloud | **swatch-proven** | Style dropdown on a selected rect |
| Arrowhead × 6 | **cited** | S-04 `e2e-unblocked-followup.spec.mjs` — not replayed |
| Width 1,2,3,4,6,8,10,12,16,20,32,50 | **cited** | D-05 — not replayed |

## Intended / break / edge (this spec)

| Control | Intended | Break | Edge | Result |
|---|---|---|---|---|
| Fill 16 | each swatch stored on selected rect | invalid hex `ZZZZZZ` / `not-a-color` keeps prior; no-selection Color does not clobber `#0000FF`; Pen-armed picker has **no Fill tab** and does not clobber rect fill | Undo after Match Fill; resize + rotate keep `#0000FF` | **pass** |
| Border 15 + Match Fill | each solid on stroke; Match Fill snapshots `#00FF00` | no Transparent cell on rect Border | Undo drops Match Fill snapshot | **pass** |
| Pen 16 | each solid then transparent on selected ink | no Fill tab | — | **pass** |
| Counter fill 16 + number 15 | each stored; number does not clobber fill `#FF0000` | — | — | **pass** |
| Font color 15 | each overlay/fill; custom `#ABCDEF` | invalid `nope` keeps `#ABCDEF`; no Transparent / no opacity field | Undo after size 72 | **pass** |
| Font / size / B/I/U/S / 3×3 | every value applied | Font options are single names (stack = bug; none found) | Georgia commit after re-enter edit | **pass** |
| Style 4 | Solid / Dashed / Dotted / Cloud | — | — | **pass** |

`file.id` null throughout.

## Resize / rotation handles (missing per-type assert)

E-01 / E-02 already hard-assert **rect** live drag + Shift-45°. This pass did **not** replay those drags. Missing assert was handle **presence** on other creatable types:

| Type | Resize ids | Rotate `mtr` |
|---|---|---|
| rect | tl tr bl br mt mb ml mr | yes |
| ellipse | tl tr bl br mt mb ml mr | yes |
| line | tl tr bl br mt mb ml mr | yes |
| arrow | tl tr bl br mt mb ml mr | yes |
| text | tl tr bl br mt mb ml mr | yes |
| callout | tl tr bl br mt mb ml mr | yes |

Fill-picker edge already resized + rotated a colored rect and asserted fill `#0000FF` survived.

## Local persist on `?testPdf=` (no cloud)

After style/handles, `localStorage` keys present:

- `annotationsByPage_clickable-link-test.pdf-23183`
- `callouts_clickable-link-test.pdf-23183`

That is the local cache write path (not leftover-18 cloud save). Reload-restore was **not** executed this pass (would still be fixture-local; `file.id` stayed null). Cloud save remains leftover-18.

## FontFamily invariant

`FONT_FAMILIES` are six single names. Font menu option computed `fontFamily` contains no comma / no `-apple-system` stack. Chrome UI stacks (AppShell tab labels) are not annotation `fontFamily`.

## Files

- `debug/scenarios/e2e-pickers-every-swatch.spec.mjs` — live proof **5 / 5 (32.6s)**
- `E2E-STATUS.md` — this-pass blurb
- this receipt

No product diff. No high-risk files touched.
