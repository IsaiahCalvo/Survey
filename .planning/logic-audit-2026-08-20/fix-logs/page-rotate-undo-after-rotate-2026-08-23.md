# Undo / redo after page-rotate remappers — 2026-08-23

Only undo-after-tool-switch was named as proved. This path is live-object + page CW, then Ctrl+Z / toolbar Undo / Redo. Named cloud Restore stays leftover-18 **X-01**. Distinct from leftover-18 / X-01 / undo-after-tool-switch / remappers / History restore (not replayed). Did **not** invent remapper invert. Did **not** stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Product contract (reachable remainder)

`commitPageStructureState` wipes undo + redo + local annotation lanes so stale pre-rotate addresses cannot zero remapped siblings. Invert of `/Rotate` + remapper is **not** invented.

## Live-proved

Playwright `e2e-page-rotate-undo-after-rotate.spec.mjs` **2 / 2** on Vite `http://127.0.0.1:5188`. `?testPdf=clickable-link-test.pdf`.

| Slice | Evidence |
|---|---|
| Empty stack | Undo + Redo **disabled**; Ctrl+Z invents **0** |
| Create then CW | rect `536791cb-…` **189.72, 285.12 → 506.88, 189.72**; viewBox **`0 0 792 612`** |
| Tool-switch mid-rotate | Opens Rotate menu, switch Select **dismisses** menu; no CW; invents **0** |
| After CW | Undo + Redo **disabled**; Ctrl+Z keeps remapped center + landscape viewBox (does **not** rewind to portrait) |
| Post-wipe create | `50a81210-…` re-arms Undo; Ctrl+Z drops only that create; remapped original held; Redo brings it back |
| 390 | viewBox **`0 0 612 792`**; `file.id` null |
| hubPreview | Draw **0** |

## Official / focused Node

Focused `pageRotateUndoAfterRotate` + leftover18. Cap **8448** / 75/250 not loosened. High-risk files untouched. Official `npm test` not re-run.

## Leftover-18

Still parked. Goal stays OPEN.
