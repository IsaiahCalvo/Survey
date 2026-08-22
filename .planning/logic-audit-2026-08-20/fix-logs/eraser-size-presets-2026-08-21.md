# Eraser Size every preset — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay Counter Size 5/8/12/16/24/32/48/64 + Start number, F3/Ctrl+G, counter-series Delete, Cloud bump 1–20, Search Previous / result-row, keyboard matrix, every-swatch (Fill/Border/Pen/Font), callout paste, thin leftovers, PDF links, History, pages menu, flatten, mobile chrome, leftover-18 fail-closed, hub extras.  
D-05 mixed Width + 1–100 is **not** a substitute for this pass.  
No secrets. Did not invent `.env.local`. Did not stamp `file.id`. Cap **8448** / **75/250** not loosened.  
Did **not** invent compile-hidden Print panel / stamp renderer / measurement / Group-Ungroup / Extract Pages / Note-Link create.

## Independent catalog (this pass)

Source: `AnnotationSizeControl` + AppShell eraser arm + live Size popover on `?testPdf=clickable-link-test.pdf`.

| Candidate | Verdict |
|---|---|
| **Eraser Size catalog** | **This pass.** `ANNOTATION_SIZE_PRESETS.eraser = [1,4,8,12,16,24,32,48,64,80,100]`. Clamp **1–100**. Custom field exists (default **20** is not a preset). Desktop chrome is a Size **field + popover**, no slider. Not D-05 Width (`[1,2,3,4,6,8,10,12,16,20,32,50]`, 1–50) and not Counter Size (`[5,8,12,16,24,32,48,64]`, 4–76). |
| leftover-18 (18 hosts) | Parked. `.env.local` / `.bot-credentials.json` / Docker still missing. |
| Custom Print / stamp / measure / Group / Extract / Note-Link create | Compile-hidden or absent. **Not invented.** |

## Live chrome (inspected first)

Eraser armed → toolbar label **Size** (Width hidden). Preset trigger `Size presets` opens `[data-annotation-size-popover]`. Live options:

**1 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 80 / 100**

No range slider. Custom whole-number field (maxLength 3). Default stored diameter **20**.

## 1. Every preset — **pass**

Playwright `e2e-eraser-size-presets.spec.mjs` **1 / 1 (19.9s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `eraserSizePresets.test.mjs` **2 / 2**.

For each preset: arm Partial erase → pick Size → measure `[data-eraser-cursor]` diameter against `offsetWidth / viewBox.width` → erase along the live pen path → remaining ink changes → Undo restores.

| Check | Result |
|---|---|
| Intended arm | Eraser reveals **Size**, not Width. Default field `20`. |
| Intended presets | Every **1 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 80 / 100** applied. |
| Cursor | Size 1 ring **2.00px**; Size 100 ring **99.83px**. Each matched `diameter × offsetWidth/pageWidth` (≤8%). |
| Cut geometry | Remaining path ink after a same-span bite fell monotonically: 1→**851.57**, 4→848.95, 8→844.33, 12→840.02, 16→835.94, 24→827.90, 32→819.92, 48→803.54, 64→787.61, 80→771.54, 100→**751.44**. |
| Custom field | Typed **40** (not a preset). Cursor 39.92 ≈ 39.93 expected. Bite cut. |

No product bug.

## 2. Break / edge — **pass**

| Check | Result |
|---|---|
| Break letters | `abc` rejected; Size stays 16; cursor still 16×scale. |
| Break 0 | Clamps to **1**. |
| Break 999 | Clamps to **100**. |
| Edge empty | Commits **1**. |
| Break Eraser not armed | Pen shows **Width** only; no Size field / Size presets. |
| Break other tool | Pen Width **10** does not become Eraser Size (stayed **1**). Eraser Size **24** does not change Pen Width (**10**). Separate stores — product rule. |
| Edge undo min | Size **1** bite then Undo restores the stroke. |
| Edge undo max | Size **100** bite then Undo restores the stroke. |
| Edge zoom then erase | Zoom in ×2. `effectiveScale = offsetWidth/pageWidth` **1.562**. Size 32 cursor **49.98** ≈ 32×1.562. Bite cut. `reportedScale` on the page div was **0** — did **not** use `pageSize * scale`. |

`file.id` stayed null. Not leftover-18 persist.

## Live-proved

Playwright **1 / 1 (19.9s)** on reused Vite `http://localhost:5173`. Node contracts **2 / 2**.

- `debug/scenarios/e2e-eraser-size-presets.spec.mjs`
- `tests/eraserSizePresets.test.mjs`

## Product

No min-viable product diff. No high-risk files edited. `FabricEraserCanvas` untouched; `zoomGeneration` still present.

Invariants unchanged: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

Official `npm test` 8448 leftover not loosened (no high-risk edit).

## Still parked / leftover-18

None of these moved. Legal slices already in `leftover18-unblock-2026-08-21.md`.

| ID | Still-parked host |
|---|---|
| X-01 | identity-churn (`.env.local` missing) |
| X-05 persist | saved `file.id` cloud persist |
| X-06 writeback | live sheet host |
| U-04 cloud | Dashboard + Supabase meter |
| A-01 Turnstile | live captcha completion |
| A-02 MSAL | live MSAL / Graph |
| A-03 / UL-24 inbox | live email delivery |
| A-05 / UL-20 Stripe | live Checkout |
| A-06 / UL-45 roster | second-account lease tuple |
| UL-03 | native Electron pick/cancel |
| UL-13 / UL-15 / UL-16 | persist / captcha / wipe |
| UL-21 / UL-22 | live MSAL / Google OAuth |

Thinner leftovers still open after this pass: custom Print panel (flag off), stamp/image edit, measurement, tablet chrome, Group/Ungroup as user tools.

## Files

- `debug/scenarios/e2e-eraser-size-presets.spec.mjs`
- `tests/eraserSizePresets.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- this receipt

Goal stays open.
