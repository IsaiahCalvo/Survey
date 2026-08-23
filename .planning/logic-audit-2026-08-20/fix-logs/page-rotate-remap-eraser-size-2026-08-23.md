# Remapped Eraser Size after page CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from last-known tip `d3e8adc7`. Unrotated D-04 Size catalog and remapped live-stroke bite exist; applying Size to remapped ink after Pages CW was the leftover named last turn and not taken. Distinct from leftover-18 / X-01 / remapped Counter Size / remapped live-stroke bite / unrotated `e2e-eraser-size-presets` (not replayed). Did **not** write an X-01 parking note. Did **not** write another 103-ID refresh.

## Product

No product edit. High-risk files untouched.

Size 64 is a tool pref (`setEraserSize` clamp 1–100). Cursor diameter = Size × container-aware `offsetWidth / pageWidth` (landscape pageWidth **792**). Remapped ink centerline + `left` **0** hold. Pen `strokeWidth` unchanged. Size is **not** history — undo leaves Size **64**. Letters rejected. Escape skip-commit keeps 64. Empty `0` → **1**. Counter Size **32** does not rewrite Eraser Size. Did **not** bite ink. Did **not** invent a mouse-coord remapper.

## Live-proved

`?testPdf=clickable-link-test.pdf` — `file.id` **null**. viewBox after CW **`0 0 792 612`**.

| Slice | Evidence |
|---|---|
| hubPreview | Size **0** / Draw **0** |
| Empty CW / CCW | invents **0** |
| Ink `a91c7422-…` | **110.16, 142.56 → 649.44, 110.16** `left` **0** |
| Size 64 | cursor **81.77px** = 64 × scale **1.2778** (pageWidth **792**) |
| Undo | Size stays **64** (tool pref, not undoable); remapped ink held |
| Letters / Escape | letters rejected; skip-commit keeps **64** |
| Empty | **0 → 1** then back to 64 |
| Counter Size | **32** does not rewrite Eraser **64** |
| Empty click | invents **0** (stays 1) |
| 390 | viewBox portrait; Pages present; invents **0**; `file.id` null |

Playwright `e2e-page-rotate-remap-eraser-size.spec.mjs` **2 / 2 (13.7s)**.  
Focused Node `pageRotateRemapEraserSize` + leftover18 **14 / 14**.

Cap **8448** / 75/250 **not** loosened. Official `npm test` not re-run (no high-risk edit).

`graphify` CLI **absent**. Lease **absent**. Goal stays **OPEN**.
