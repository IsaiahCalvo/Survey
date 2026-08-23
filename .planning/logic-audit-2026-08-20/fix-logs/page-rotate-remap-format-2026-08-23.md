# Remapped fill / font / callout style after page CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from last-known tip `34f18066`. Distinct from leftover-18 / X-01 / remapped handle-drag / remapper placement / persist/History/export/save / `mtr` / max-update-depth / contract aligns / unrotated `e2e-pickers-every-swatch` (not replayed). Did **not** write an X-01 parking note.

## Product

No product edit. High-risk files untouched.

Harness-only: Playwright mouse after Pages rotate misses the landscape host — PointerEvent select until kind-specific chrome mounts (Color vs Font / Arrowhead). `geom()` first missed callout `legacyCallout.style`, so Arrowhead `vShape` looked empty; product already wrote `c.style`. Did **not** invent a mouse-coord remapper.

## Live-proved

`?testPdf=clickable-link-test.pdf` — `file.id` **null**. viewBox after CW **`0 0 792 612`**.

| Class | Evidence |
|---|---|
| Empty CW / CCW | invents **0** |
| Rect `18a66bd0-…` | **183.60, 277.20 → 514.80, 183.60**; Fill chip `#FF0000` + hex `#00AAFF` + Border `#0000FF`; placement held; undo restores remapped + prior color |
| Textbox `8a7b10bf-…` | **318.50, 190.74 Helvetica → 601.26, 318.50**; Font **Times New Roman** + size **24**; `fontFamily` single-name; undo restores remapped + prior family/size |
| Callout `callout-b000225c-…` | box **0.440 / 0.700 → 0.204 / 0.512**; Arrowhead **`vShape`**; remapped box held; undo restores remapped |
| Escape skip-commit | Color picker dismiss does **not** apply |
| Empty remapped-page click | invents **0** (stays 3) |
| 390 | viewBox portrait; Pages present; invents **0**; `file.id` null |
| hubPreview | Draw **0** |

Playwright `e2e-page-rotate-remap-format.spec.mjs` **2 / 2 (14.6s)**.  
Focused Node `pageRotateRemapFormat` + leftover18 **14 / 14**.

Cap **8448** / 75/250 **not** loosened. Official `npm test` not re-run (no high-risk edit).

`graphify` CLI **absent**. Lease **absent**. Goal stays **OPEN**.
