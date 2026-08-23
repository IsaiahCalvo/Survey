# Remapped move + Cut/Copy/Paste after page CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from last-known tip `977823b4`. Distinct from leftover-18 / X-01 / remapped format / handle-drag / persist/History/export/save / `mtr` / max-update-depth / unrotated E-03 + Cut/Copy/Paste (not replayed). Did **not** write an X-01 parking note.

## Product

No product edit. High-risk files untouched.

Remapper already writes displayed `left`/`top` + `data.left`/`data.top` on the swapped page, so body-drag and cursor-centered paste stay in landscape space (`0 0 792 612`). Did **not** invent a mouse-coord remapper. PointerEvent select/drag is harness-only (Playwright mouse miss after Pages rotate).

## Live-proved

`?testPdf=clickable-link-test.pdf` — `file.id` **null**. viewBox after CW **`0 0 792 612`**.

| Slice | Evidence |
|---|---|
| Empty CW / CCW | invents **0** |
| Rect `e86c3dd8-…` | **183.60, 277.20 → 514.80, 183.60** (left **454.60**) |
| Body-drag | **577.40, 221.16** — landscape, not leftover portrait / not origin; size held |
| Undo | restores remapped-unmoved **514.80, 183.60** |
| Escape | cancel does **not** move |
| Copy + Paste | original remapped coords hold; clone `767a3cd1-…` **617.54, 440.27** |
| Cut + Paste | original gone; clone `f45a65e5-…` **173.80, 477.05** on landscape |
| Empty clipboard | second Paste gray; invents **0** |
| 390 | viewBox portrait; Pages present; invents **0**; `file.id` null |
| hubPreview | Draw **0** |

Playwright `e2e-page-rotate-remap-move-clipboard.spec.mjs` **2 / 2 (11.8s)**.  
Focused Node `pageRotateRemapMoveClipboard` + leftover18 **14 / 14**.

Cap **8448** / 75/250 **not** loosened. Official `npm test` not re-run (no high-risk edit).

`graphify` CLI **absent**. Lease **absent**. Goal stays **OPEN**.
