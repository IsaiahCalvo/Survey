# E2E leftovers — unblocked leftover edges (pass 2)

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200). Did **not** kill 5174.  
**Harness:** `debug/scenarios/e2e-unblocked-followup-2.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **5 / 5 passed**.  
**CLEAN** — this slice found zero new product bugs. No product file edited.  
**This pass does not claim the audit goal complete.** Did not apply migrations. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / second-account / wipe passes. No commit.

## Newly live-pass (each: intended + break + edge)

| ID | Intended | Break | Edge | Result |
|---|---|---|---|---|
| T-04 clamp | Mobile 390×844 `textbox "Font size"` commits 48 | Desktop has no numeric field (dropdown only; typing `13` adds no option) | `1` / `0` → 6; `999` → 200 (`TextEditOverlay.setFontSize` + `clampFontSize`) | **held** |
| E-02 Shift+45° | Handle Shift-drag near 44° snaps to 45° | ArrowUp without Shift is +1° | Far Shift-drag stays 23° (soft 3° threshold); Shift+ArrowUp from 1° → 46° | **held** |
| D-02 print | Cmd+Shift+P flatten includes freehand highlighter (`fabric: 1`) | Cmd+P is base PDF (`withMarkup=false`); Text highlight menu hidden (KAL-240) | Survey-marker highlight excluded (`surveyMarkers: 1`); 8 unedited imported natives preserved | **held** |
| C-05 counter colors | Fill tab `#FF0000` vs Number tab `#0000FF` on a live pin | Number change does not overwrite fill | Armed Number → `#FFFFFF` still leaves fill `#FF0000` | **held** |
| S-04 selected patch | Deselect → reselect → V-shape / Open circle / None writes `data.arrowheadStyle` | Click-away drops the picker | Re-select keeps stored `none` | **held** |

## Real control paths (not invented)

- **Font size clamp 6–200:** desktop offers only `FONT_SIZE_PRESETS` (8…72). The custom numeric field is mobile `MobilePdfViewerChrome` `aria-label="Font size"` (narrow shell ≤720px). Overlay `setFontSize` clamps 6–200; mobile `onChange` allows 1–200 then the overlay lifts 1→6.
- **Shift+45°:** `RotationInputField` Shift+Arrow ±45°; `useSVGInteraction` Shift-rotate calls `snapAngleToNearest45(angle, 3)`.
- **Highlighter print:** Cmd+P = original PDF. Cmd+Shift+P = `buildPrintableRegularAnnotationPayload` (regular canvas marks only). Freehand highlighter is a regular path (included). Survey markers / text-markup highlight are excluded. Text-highlight split menu stays hidden.
- **Counter number color:** Color picker second tab is **Number** (not Border) when `contextTool === 'counter'`. Fill → `fill`; Number → `data.numberColor`.
- **Selected arrowhead:** `handleArrowheadStyleChange` patches `data.arrowheadStyle` only when the selected object is an arrow.

## Still blocked (unchanged hosts)

| Leftover | Why |
|---|---|
| Five in-tree SQL migrations | Production-linked Survey (`cvamwtpsuvxvjdnotbeg`) + no local Docker. Not applied. |
| X-01 identity-churn | Needs a signed-in cloud user whose session identity changes. |
| A-06 / UL-45 two-client roster | Needs a second signed-in collab account. |
| A-01 / UL-15 captcha completion | Turnstile token + real password form. |
| UL-16 wipe | Destructive account delete. |
| A-05 / UL-20 Stripe | Start trial / Checkout not clicked. |
| A-02 / UL-21 live MSAL | Auto-login already **Connected as**. Did not Disconnect / start OAuth. |
| UL-22 Google OAuth | Live host OAuth. |
| A-03 / UL-24 email delivery | Invalid Send already fail-closed. Did not send to a real inbox. |
| P-01 / UL-46 native Capacitor | No device / XCUI. |
| U-04 cloud usage count | Needs Dashboard + Supabase. HubPreview path already closed. |
| X-06 Excel host writeback | Live sheet host. |
| X-05 form cloud persist | Needs a saved `file.id` write. |
| UL-13 profile persist | Would mutate the production profile. |

## Still unproven but not host-blocked

None from the prior leftover list. This pass closed T-04 clamp, E-02 Shift+45°, D-02 print-exclusion, C-05 counter number color, and selected-arrow `arrowheadStyle` patch.

## Invariants

`zoomGeneration`, SVG `viewBox`, container-aware canvas, single-name `fontFamily`, CORS `*` untouched. No high-risk product file edited.

## Files

- `debug/scenarios/e2e-unblocked-followup-2.spec.mjs`
- `E2E-STATUS.md` / `E2E-NEW-ISSUES.md` / `E2E-UNLISTED.md` / `COMPLETION-AUDIT.md` — leftover status only

No commit.
