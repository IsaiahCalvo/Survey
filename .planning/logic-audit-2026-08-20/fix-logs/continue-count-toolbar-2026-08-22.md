# UL-35 toolbar Continue Count series-row — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Independent catalog vs FEATURE-MATRIX / E2E-STATUS / E2E-UNLISTED + live `?testPdf=clickable-link-test.pdf` and `/?hubPreview=1`. Did **not** copy the last hunt receipt as truth. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / Print panel / stamp / measure / Group / Extract / Note-Link. Did **not** replay overlay Continue pin.

## Why this is a leftover

| Prior claim | What was actually asserted |
|---|---|
| UL-35 cluster | Size every preset + Start lock + series-list Delete. **No** click-to-switch row. |
| UL-31 Continue pin | Overlay context **Continue pin**. New Count used as **setup** only. Receipt said toolbar Continue Count is a different control, then lumped it as already dedicated. |
| New Count | Mints a series. Not a switch. |

Toolbar Continue Count is reachable local chrome (`contextTool === 'counter'` → `data-counter-series-menu` / 390 `.mobile-pdf-properties__menu`). Distinct from overlay Continue pin. Not leftover-18. Not compile-hidden. Not a stub (`handleSwitchCounterSeries` is live).

## Classification

**Reachable local chrome without a dedicated slice (until this pass).**

- Desktop: series row `onSwitchCounterSeries(series.seriesId)` + `setActiveTool('counter')`.
- Mobile: same switch; already on Counter so no `setActiveTool`.
- Handler: missing `seriesId` no-ops; sets fill/number colors for the next pin.
- Empty-armed: Continue Count heading **0** (only + New Count).
- HubPreview: Continue Count **0**.
- Select + selected pin still shows Counter series (`contextTool` stays counter). Empty-page deselect hides it. Pen hides it.

## Live-proved

Playwright `e2e-continue-count-toolbar.spec.mjs` + hunt `e2e-after-continue-pin-independent-hunt.spec.mjs` **2 / 2 (12.8s)** on reused Vite `http://localhost:5173`. Node `continueCountToolbar.test.mjs` **4 / 4**.

IDs: A1 `b32ee2a4-…` series `series-1787407949896`; B1 `2ccb48d1-…` series `series-1787407950732`; A2 `5ae850b5-…` n=2; B2 `e1bfc98a-…` undone. 390 A `7b8bda0f-…` / B `4c276929-…` / A2 `795ef8c2-…`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| New Count then Continue Count → Count 1 | Next pin A2 same series, numbers **1, 2**. Count 1 = 2 pins active / Count 2 = 1 pin. |
| Overlay stays armed | Counter series visible. Continue pin **0** (not the overlay item). |

### Break — **pass**

| Slice | Evidence |
|---|---|
| Empty-armed menu | + New Count **1**. Continue Count **0**. Series rows **0**. |
| Already-active Count 1 | Still 2 series. Overlay armed. |
| Select + empty deselect | Overlay **0**. Counter series **0**. Continue Count **0**. |
| Pen-armed | Overlay **0**. Counter series **0**. Continue Count **0**. |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Continue Count → Count 2 | B2 n=2. Series A stayed 2 pins. |
| Undo | B2 gone; A1+A2 + B1 remain. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| hubPreview | Continue Count **0**. |
| 390 | Same list (series-label trigger). Count 1 after New Count → 1, 2. Continue pin **0**. |

## Product

No min-viable product diff. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric fontFamily untouched. 8448 not loosened.

## Next leftover

Leftover-18 live hosts. First named: **X-01** (needs `.env.local` — still missing; do not invent). Leftover **18** stay parked. Goal stays open.
