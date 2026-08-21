# E2E leftovers — Capacitor UL-46 + Pages handle-swipe

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No commit. Did not print secrets. Did not retry lease, Docker, prod SQL, Stripe, MSAL, captcha, personal-account writes, or Electron file dialog. Reused iPhone 17 Simulator `26ED4ECA-254E-4D88-861D-8E3FB593AF08` + Vite `127.0.0.1:5180` `?testPdf=clickable-link-test.pdf`.

## Blocker (both leftovers)

The prior Capacitor boot URL included `nativePinchE2E=1`. That flag portals an invisible `button[aria-label="PDF gesture surface"]` at `15vw / 15vh / 70vw × 60vh` with `z-index: 2147483646` (`PdfjsViewerContainer.jsx`). It exists only so XCUI pinch can find a named surface.

On iPhone 17 (402×874): overlay covers **x 60–341, y 131–655**.

| Hit | Inside overlay? | Prior result |
|---|---|---|
| Solid / size / menu options (~y 114–250, x ~250) | menu yes; trigger no | trigger opened; pick looked like outside dismiss |
| Pages handle (~201, 540) | yes | swipe never reached `onTouch*` |
| Close X (~372, 505) | x=372 is right of 341 | X dismiss worked |
| Pages tab (~201, 848) | y=848 below 655 | sheet open worked |

Logged proof: `pointerdown@250,200 tgt=BUTTON.[PDF gesture surface]`. Not a product sheet/select bug. **Test miss** from the pinch harness overlay. Pinch leftovers stay proven (`AppNativePinch`).

`capacitor.config.json` server URL no longer carries `nativePinchE2E=1`. Do not re-add it for chrome / sheet / select proofs.

## UL-46 — styled select (proven)

**Actual control:** `MobileStyledSelect` in the mobile properties strip (not the More rail). With Text armed: red swatch, **Width** `AnnotationSizeControl` (native-looking “3 ▾”), **Border style** `MobileStyledSelect` (“Solid ▾”), **Aa**. Font uses the same `MobileStyledSelect` in the text-formatting strip / edit sheet; Aa this pass focused a PDF form field (keyboard) so Font was not re-walked. Same component + dismiss contract as Border style.

Trigger `getBoundingClientRect` (CSS px = Simulator points): `{x:218,y:102,w:82,h:24}`.

| Case | Result | Proof |
|---|---|---|
| Intended — open Border style, pick Dashed | **pass** | menu Solid / Dashed / Dotted; tap (250, 203); trigger reads **Dashed**. `e2e-capacitor-ul46-artifacts/06-border-menu-open.png`, `07-dashed-committed.png`. |
| Break — dismiss without change | **pass** | reopen; tap (80, 400); menu closed; trigger still **Dashed**. `08-dismiss-no-change.png`. |
| Edge — every short option | **pass** | Dotted then Solid. `09-dotted-committed.png`, `10-solid-restored.png`. |
| Intended — Width presets (long list) | **pass** | chevron (200, 114) opens WIDTH 1…16+; pick **8**. `11-size-menu-open.png`, `12-size-8-committed.png`. |
| Break — size dismiss | **pass** | reopen; outside tap; stays **8**. `13-size-dismiss-no-change.png`. |

No `src/` product edit. Overlay pointer-events were disabled only for the live prove, then reverted.

## Handle-swipe dismiss — test miss, then proven

`SHEET_DISMISS_DY` is 82 (`src/mobile/useMobileSheetMotion.js`). Handle is `.mobile-pdf-sheet__handle` (18px). Live handle bar: **x 184–218, y 538–541**, center **(201, 540)**. Prior swipes from y=430 / 500 started on the page / overlay, not the handle.

| Case | Result | Proof |
|---|---|---|
| Intended — ≥82px from handle | **pass** | swipe (201, 540) → (201, 640), 0.45s (dy=100). Handle gone (white page). `16-handle-swipe-100.png`. |
| Break — ~60px stays open | **pass** | swipe (201, 540) → (201, 600). Handle still `#68707a` at y=540. `17-handle-swipe-60-stays.png`. |
| Edge — already proven | **pass** | X dismiss + safe-area (`e2e-local-hosts.md`). |

No motion-code fix. High-risk files untouched. Invariants untouched (`zoomGeneration`, SVG viewBox, container-aware canvas, single-name fonts, CORS `*`).

## What moved

| ID | Before | After |
|---|---|---|
| UL-46 native styled select | host-blocked | **proven** on Simulator (Border style + Width) |
| P-01 handle-swipe dismiss | leftover / suspected WK hit miss | **proven** (test miss: overlay + off-handle start) |

E2E catalog host-blocked paths: **19 → 18**.

## Still blocked (18)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06` roster, `UL-03` native pick/cancel, `UL-13` profile persist, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24` inbox send, `UL-45`.

SQL apply leftovers unchanged.

**Goal stays open.**
