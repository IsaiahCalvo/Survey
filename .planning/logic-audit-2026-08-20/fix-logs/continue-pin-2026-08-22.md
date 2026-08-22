# UL-31 Continue pin dedicated slice — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Independent catalog vs FEATURE-MATRIX / E2E-STATUS / E2E-UNLISTED + live `?testPdf=clickable-link-test.pdf` and `/?hubPreview=1`. Did **not** copy the last hunt receipt as truth. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / Print panel / stamp / measure / Group / Extract / Note-Link.

## Why this is a leftover

| Prior claim | What was actually asserted |
|---|---|
| E-06 / UL-27–31 cluster | `e2e-context-menu-spaces.spec.mjs` right-click → Continue pin → overlay stays armed. **No** New Count switch. **No** next-pin same-series. **No** Select/Pen/empty breaks. **No** 390. |
| S-05 Counter | Place + Size + Start + series Delete + bbox + nubbin. Status said **“UL-31 Continue pin not replayed.”** |
| UL-35 series menu | Size / Start / series-list Delete. Toolbar **Continue Count** row is a different control. |

UL-31 is reachable local chrome (`ctx.kind === 'counter'` while `[data-counter-overlay]` is mounted). Cluster-only / thinner than intended+break+edge. Not leftover-18. Not compile-hidden. Not a stub (E2E-UL-04 already wired `handleContinuePin`).

## Hunt (cluster-only / thinner / partial rows checked)

Live-opened every hubPreview tab + `?testPdf=` editor. Clicked Continue pin. Inventoried the rest.

| Row / marker | Class | Why not this leftover |
|---|---|---|
| leftover-18 18 **partial** hosts (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud, `A-01` Turnstile, `A-02` MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **leftover-18** | Hosts still missing. Dedicated fail-closed already. Not invented. |
| UL-31 Continue pin | **This leftover** | Cluster-only re-arm. Proved this pass. |
| UL-35 toolbar Continue Count / New Count | **Already dedicated family** | New Count used as **setup** only. Size / Start / Delete already sliced. Not this GAP. |
| Space CSV / PDF Pages | **leftover-18 parked** | Save/export inventory. Not invented. |
| Templates Move/Copy | **Stub** | `closeMoveModal` only. |
| 390 checklist Y/N/N-A | **Parked** | No compiled-in items. |
| Stamp / measure / Group / Extract / Note-Link / Forms / Print panel | **Compile-hidden** | 2026-08-22 hunt. Do not invent. |
| skip-already-proven | **None found** | Completion audit 0 weak. No skip-without-receipt row this hunt. |
| Hub Try again / Documents Select / Share Access / Settings General / Usage / Upload / Connect / Start trial / wipe | **Already dedicated** | Not replayed. |
| Preview Team / ⌘K / hubLoading | **Display-only** | No control. |

## Classification — UL-31

**Reachable local chrome without a dedicated slice (until this pass).**

- Overlay-gated: `activeTool === 'counter'` mounts `[data-counter-overlay]` with `pointerEvents: 'auto'`. Hit-test `isCounter` → `kind: 'counter'`.
- Menu: Continue pin only (no Cut/Delete).
- Action: resolve `seriesId` from index / id / first page counter → `handleSwitchCounterSeries` + `setActiveTool('counter')`.
- HubPreview: Continue pin **0** (no editor).
- Select-armed / Pen-armed: overlay gone; shape menu (Cut/Delete), not Continue pin.

## Product bug (fixed, min-viable)

Counter overlay `onPointerDown` treated button 2 as a place. Empty-overlay right-click dropped a pin **and** opened Continue pin. Guard: `if (e.button != null && e.button !== 0) return;` in `src/PDFViewer.jsx` (only that overlay handler). Canvas sizing / `zoomGeneration` / SVG viewBox / CORS / Fabric fontFamily untouched.

## Live-proved

Playwright `e2e-continue-pin.spec.mjs` **1 / 1 (8.8s)** on reused Vite `http://localhost:5173`. Node `continuePin.test.mjs` **4 / 4**.

IDs: A1 `641afc67-…` series `series-1787407375838`; B1 `cd9b9f45-…` series `series-1787407376256`; A2 `c0649dd8-…` n=2. 390 A `98bce90c-…` / A2 `82a83044-…`. `viewBox="0 0 612 792"`. `file.id` null. Stub logs **[]**.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| New Count then Continue pin on A | Next pin A2 same series, numbers **1, 2**. Count 1 = 2 pins / Count 2 = 1 pin. |
| Re-arm | Overlay stays. No `[AnnotCtxMenu] continuePin` stub. |

### Break — **pass**

| Slice | Evidence |
|---|---|
| Counter-armed empty overlay | Continue pin. **Not** Paste. No extra pin after the button-2 guard. |
| Already-on-series Continue pin | Still 2 series. Overlay armed. |
| Select-armed pin | Cut/Copy/Paste/Delete + z-order. Continue pin **0**. |
| Select-armed empty page | Paste only. Continue pin **0**. |
| Pen-armed pin | Overlay **0**. Shape menu. Continue pin **0**. |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Series B isolation | B1 stayed series B n=1. |
| Undo | A2 gone; A1 + B1 remain. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| hubPreview | Continue pin **0**. |
| 390 | Same overlay item (title Counter + Continue pin). Place after click → 1, 2. No long-press. |

No `file.id`. No error boundary. Cap **8448** not loosened.

Official `npm test` after the PDFViewer overlay guard: `tests/continuePin.test.mjs` **4 / 4**. Suite exit 1 on unrelated `hubDismissBarrierContracts.test.mjs` (`document, project, and template More menus use the same barrier` — DocumentsLedger / ProjectsFolderTree / TemplatesEditor source-assert; not this overlay). Geometry/timing 75/250 not loosened.

## What is claimed

UL-31 now has a dedicated intended+break+edge slice. Goal stays open. Leftover **18** stay parked. Next leftover-18 live host: **X-01**. Do **not** re-claim unblocked GAP = 0.
