# Print fail-closed blob/OS path — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Host probe (`host-probe-2026-08-22.md`): leftover-18 / X-01 auto-login hosts **absent**. Did not invent `.env.local`. Then classified compile-hidden Print.

## Classification

| Surface | Class | Why |
|---|---|---|
| Custom Print panel UI (`setPrintPanelOpen`, paper / copies / Save as PDF) | **Compile-hidden** | `PRINT_PANEL_ENABLED = false`. UL-40–43 proven once with a DEV flip; flag restored. Repeat live needs another flip. **Not invented.** |
| Cmd/Ctrl+P / Cmd/Ctrl+Shift+P blob / flatten iframe | **Reachable fail-closed chrome** | `if (!PRINT_PANEL_ENABLED)` still intercepts shortcuts and prints a blob URL. leftover18-save-export only polled `[PrintPanel] OPEN`. No dedicated intended+break+edge until this pass. |

This leftover is **not** leftover-18, **not** a stub, and **not** a Print backend.

## Slice

`PRINT_PANEL_ENABLED = false` fail-closed path on `?testPdf=clickable-link-test.pdf`.

Do **not** flip the flag. Do **not** invent a printer / Save-as-PDF dest / custom panel.

## Product

No min-viable product diff. Flag stays `false`. CORS `*` unchanged. No high-risk file edit. 8448 not loosened.

## Live

Playwright `debug/scenarios/e2e-print-panel-failclosed.spec.mjs` **1 / 1 (4.8s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| Intended | Ctrl+P → `OPEN` `panel enabled=false` `withMarkup=false`; `disabled — base PDF blob print`; `iframe.print()` log; custom dialog / Print options / More copies / Save as PDF **0**; Draw stays. |
| Break | Second Ctrl+P prints again (no-markup path does **not** set `printInFlight`); still no custom panel. Fresh hubPreview Ctrl+P → PrintPanel logs **0**. |
| Edge | Ctrl+Shift+P → `withMarkup=true` flatten; second press `ignoring — a print job is still composing` (OPEN is logged before the gate, so shift OPEN **2**). Fresh 390 same blob path. Export visible, **not** clicked. |

Harness: stub iframe `print()` so headless Chromium does not crash on later navigations; later hotkeys dispatch the viewer capture `keydown`. Flag not flipped. Native OS dialog leftover.

Node `tests/printPanelFailClosed.test.mjs` **4 / 4**. leftover18FailClosed **12 / 12** still holds.

## Next leftover

Leftover-18 live hosts. First named: **X-01** identity-churn / signed-in cloud save (needs `.env.local` auto-login — still missing; do not invent).

Goal stays open.
