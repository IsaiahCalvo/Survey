# E2E live-prove — thirteen leftover 00fda232 drops

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Prior receipt:** `fix-logs/diff-00fda232-leftover-drops.md` (Node 55/55, no Vite)  
**Goal:** stays open

Did **not** replay the prior 12 stomps, wave7, or leftover 18.  
No prod SQL. No budget loosen. No secrets. No `.bot-credentials.json` / `.env*`.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-00fda232-thirteen-live.spec.mjs
```

**Live: 5 / 5 passed (17.9s)** after spec tightens (no product change).

Node contracts re-run (same nine files as the leftover-drops receipt): **55 / 55**.

`?testPdf=clickable-link-test.pdf` / `?hubPreview=1`. Each cluster: intended + break + edge.

## Extra product fix

**None.** High-risk files not edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Verdicts

| Cluster | IDs | Verdict | Live proof | Node-only / leftover |
|---|---|---|---|---|
| **1** | **P1-14** `renumberCounters` | **pass** | Duplicate page, drop pins 1–3, delete #1 via context menu. Remaining labels become `[1, 2]` and stay after page 2 → page 1. Vite-import: changed page-2 bucket replaced, page-3 `===`, original objects unmutated; already-correct numbering keeps the bucket; `null` / `{}` fail-closed. | First Delete key miss — overlay needs context-menu Delete (same as wave6). |
| **2** | **P1-01 / 03 / 04** | **pass** | Cloud Rectangle → Export: `/BE << /S /C /I 2 >>`. Plain Square has `be: null`. Resize leaves `scaleX ≈ 1.40`; export `/Rect` uses scaled width. Vite `getLineEndpoints` world `(100,100)` vs buggy `x1+left = 75`. Live line endpoints differ from `x1+left`. Flatten source: offset only `left`/`top`; `width * scaleX` / `height * scaleY`; skip non-finite box. Allowlist `pdfCloudIntensity` / `pdfCloudPathD`. | Print panel stays `PRINT_PANEL_ENABLED = false`. Flatten proved via export + source + live scale, not the disabled print dialog. |
| **3** | **P1-05 / 06 / 08 / 29** | **pass** | Vite-import: group-line 90° → `(100,100)→(60,150)` not `x1+left`; stale id → `-1`; remap `b` index `1→0`; gone id clears; Shift union / Alt subtract. Live: delete first rect, drag the next (id resolve); Undo keeps later rect selectable; two callouts survive Shift+marquee then Alt-subtract. | App-wide Group rotate / Ungroup still hidden (2026-04-21). Group-line transform driven via Vite-imported helper + live line/rect drag. |
| **4** | **P2-13** helpers | **pass** | HubPreview Settings: Microsoft **Connect** visible; click fail-closed (`Preview cannot` / Failed to connect); no `login.microsoftonline.com`. Vite-import: web available + full-page; Capacitor hide + no full-page; Electron available + no full-page. `addInitScript` Capacitor: Microsoft row shows “Not available in the iOS/Android app”, Connect gone (Google Connect stays). | Did not start leftover A-02 live MSAL. |
| **5** | **P2-14 / 24 / 25 / 26** | **Node-only** | Closest UI: same Settings Connect fail-closed; no Reconnect chrome (`needsReconnect: false`). Vite-import `microsoftConnectionMarker`: no invented tokens; merge keeps `web-rt`; wipe only when stored === failed; adopt when rotated; restore `adopt` / `reconnect` / `transient`. Node 55/55 covers `selectPreferredAccount` eviction + `classifySilentTokenError`. | Live MSAL / main-process cache is leftover **A-02** / **UL-21**. No Electron host. |

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-00fda232-thirteen-live.spec.mjs`

## Goal

Stays **open**.
