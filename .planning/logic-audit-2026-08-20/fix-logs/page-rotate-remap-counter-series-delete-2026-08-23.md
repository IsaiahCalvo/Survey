# Remapped Counter series Delete after page CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from last-known tip `2d492f3d`. Unrotated UL-35 series-list Delete + 390 Delete exist; wiping a remapped 2-pin series after Pages CW was not named. Distinct from leftover-18 / X-01 / remapped Start/Size / remapped style chips / unrotated `e2e-counter-series-delete` / 390 Delete (not replayed). Did **not** write an X-01 parking note. Did **not** write another 103-ID refresh.

## Product

No product edit. High-risk files untouched.

First Playwright fail: empty click after wipe invented 1 because Counter stayed armed. Spec-only fix: Select before that click. Not a product bug.

Series Delete + confirm wipes both remapped pins. Cancel / no-selection Delete invent **0**. Undo restores remapped ids + centers. viewBox stays **`0 0 792 612`**.

## Live-proved

`?testPdf=clickable-link-test.pdf` — `file.id` **null**. viewBox after CW **`0 0 792 612`**.

| Slice | Evidence |
|---|---|
| hubPreview | series Delete **0** / Draw **0** |
| Empty CW / CCW | invents **0** |
| Pin `db7cd27a-…` | **232.56, 221.76 → 570.24, 232.56** |
| Pin `750e351c-…` | **379.44, 332.64 → 459.36, 379.44** |
| Series | `series-1787488891207` |
| No-selection Delete | invents **0**; remapped holds |
| Cancel | invents **0**; remapped holds |
| Delete count | both gone; viewBox holds |
| Undo | remapped ids + centers |
| Empty click | invents **0** |
| 390 | viewBox portrait; Pages present; invents **0**; `file.id` null |

Playwright `e2e-page-rotate-remap-counter-series-delete.spec.mjs` **2 / 2 (12.2s)**.  
Focused Node `pageRotateRemapCounterSeriesDelete` + leftover18 **14 / 14**.

Cap **8448** / 75/250 **not** loosened. Official `npm test` not re-run (no high-risk edit).

`graphify` CLI **absent**. Lease **absent**. Goal stays **OPEN**.
