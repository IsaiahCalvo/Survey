# Live E-02 leftover: RotationInputField Arrow ±1 / Shift+Arrow ±45 intended+break+edge — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after E-02 Shift+45° `mtr` snap (`5961fd24` / `e2e-rotation-shift-snap.spec.mjs`). Prior E-02 dedicated type/blur/wrap/Escape and canvas `mtr` Shift+45 soft snap. Followup-2 only sampled ArrowUp 0→1 / Shift+ArrowUp 1→46. Distinct from leftover-18, free-drag 90/180, typed pill, canvas snap, counter nubbin, survey-marker `mtr`. Group-rotate 15° is not live (group `moveOnly` hides `mtr`). P1-32 hold-arrow coalescing **not** replayed. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Tab reorder / document title rename | No real two-PDF-tab path. `?testPdf=` opens one File. HubPreview `handleOpenDocument` does `location.assign`. Dashboard Upload stamps `file.id`. |
| Text-markup highlight after Select text | Compile-hidden. `showTextMarkupHighlightMenu = false`. |
| Theme / appearance | Absent. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Callout selected bbox / `mtr` | Not live. |
| Counter bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |
| Group-rotate 15° Shift snap | Group `moveOnly` hides `mtr`. |
| Create-poly / Extract / measure / Group / Note-Link / Forms / Print panel | Not live / compile-hidden. |

Product path is distinct: focused pill `ArrowUp`/`ArrowDown` commits `normalizeTypedDegrees(base ± 1)`; `Shift+Arrow` commits `± 45`. Immediate commit, no canvas soft-3° snap. Unfocused Arrow is page-nav. Wrap `% 360`.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-rotation-input-arrow.spec.mjs` **2 / 2 (10.0s)** on Vite `http://127.0.0.1:5173`. Focused Node `rotationInputArrow` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop 1400×900: A `adbb0c95-…` / B `b75974bb-…`. ArrowUp 0→**1**→**2**; ArrowDown →**1**. Shift+ArrowUp 1→**46**; Shift+ArrowDown →**1**. Reset 0 then Shift+ArrowUp →**45**→**90**. B isolated. Ctrl+Z after blur drops B 1; Ctrl+Shift+Z redo; second undo.

390: ArrowUp 0→**1**; Shift+ArrowUp →**46**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| ArrowLeft / ArrowRight | focused pill | angle stays **90** |
| ArrowUp from 359 | wrap | **0** |
| ArrowDown from 0 | wrap | **359** |
| Shift+ArrowUp from 350 | wrap | **35** |
| Shift+ArrowDown from 10 | wrap | **325** |
| Unfocused ArrowUp | page-nav / stay | A stays **45** |
| Line single-click | endpoints | `mtr` **0**; pill **0** |
| Empty page | Select drag | invents 0; pill **0** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | B ArrowUp 1 holds A at 45 |
| Undo / redo | blur then stack restores 0 / 1 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; pill **0**; `mtr` **0** |
| 390 | wrap 359→0; unfocused Arrow no-op |
| Pen hide | deselect + Pen; A held 45 |

## Official / focused Node

Focused `rotationInputArrow` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
