# E2E leftovers — unblocked catalog + edge follow-up

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200). Did **not** kill 5174.  
**Harness:** `debug/scenarios/e2e-unblocked-followup.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **6 / 6 passed** (27.1s).  
**CLEAN** — this slice found zero new product bugs. No product file edited.  
**This pass does not claim the audit goal complete.** Did not apply migrations. Did not stamp `file.id`. Did not invent captcha / Stripe / MSAL / Capacitor / second-account / wipe passes. No commit.

## Newly live-pass (each: intended + break + edge)

| ID | Intended | Break | Edge | Result |
|---|---|---|---|---|
| T-06 + T-05 | All 9 alignment cells | Justify not offered | Underline `aria-pressed=true` while editing | **held** |
| T-04 | All 18 `FONT_SIZE_PRESETS` 8…72 | Last commit stored 72 | Desktop has no custom size field (clamp 6–200 stays helper) | **held** |
| C-04 + C-03 | SV leave mid-drag (`Saturation 0%`) then re-enter (`85% / 80%`) | Transparent disables the opacity slider | `#FF0000` re-enables slider; range → 40 | **held** |
| S-04 | All 6 Arrowhead labels | None is offered | Picker stays on the last label | **held** |
| P-04 C | `c` arms `[data-counter-overlay]` | `c` in Zoom % input is ignored | Re-arm after Escape + page click | **held** |
| V-01 narrow | 700×820 More → Zoom in overflowed; named Pan moved scroll `284/403` → `565/633` | Overflow required (`scrollWidth - clientWidth > 8`) | Mobile Draw→Pen ink at overflow is a harness miss (`inkId` null); desktop pen-at-100% already stands | **held** |

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

These are leftover break/edges, not the blocked hosts above. Not invented as substitutes.

- T-04 custom size clamp 6–200 (no desktop numeric size field)
- E-02 Shift+45° snap
- D-02 highlighter print-exclusion
- C-05 counter number color vs fill
- S-04 patch of a **selected** arrow’s `data.arrowheadStyle` (this pass drove the armed-tool picker)

## Invariants

`zoomGeneration`, SVG `viewBox`, container-aware canvas, single-name `fontFamily`, CORS `*` untouched. No high-risk product file edited.

## Files

- `debug/scenarios/e2e-unblocked-followup.spec.mjs`
- `E2E-STATUS.md` / `E2E-NEW-ISSUES.md` / `E2E-UNLISTED.md` / `COMPLETION-AUDIT.md` — leftover status only

No commit.
