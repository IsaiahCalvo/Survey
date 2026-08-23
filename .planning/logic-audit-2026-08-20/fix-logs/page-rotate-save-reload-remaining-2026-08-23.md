# Local `?testPdf=` save/reload after page CW — leftover types — 2026-08-23

Named leftover after Counter History Restore (`fc305b06`). Family-level untransformed reload is `e2e-testpdf-local-save-reload` — that is not this path. Named cloud save stays leftover-18 **X-01**. Distinct from leftover-18 / X-01 / History Restore / remapped-page export (not replayed). Did **not** stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Remount limit

`?testPdf=` remount reloads original fixture bytes. Page rotate rewrites an in-memory File (`usePageOperations` / `mutatePdfPages`); that blob is lost. pdf.js `rotation = 0` — baked `/Rotate` is not restored. After reload: viewBox **`0 0 612 792`**. `pdfSidebar_*` `pageTransformations` **null**. Local cache still holds remapped ids + coords.

## Live-proved

Playwright `e2e-page-rotate-save-reload-remaining.spec.mjs` **7 / 7** on Vite `http://127.0.0.1:5188`. `file.id` null.

| Type | Id | Created → CW | Reload persist |
|---|---|---|---|
| Callout `callout-798aaa7c-…` | **329.28, 348.64 → 443.36, 329.28** | same id + remapped `callouts_*` fractions |
| Counter `34bef0f5-…` | **171.36, 411.84 → 380.16, 171.36** | same id + remapped left/top + nub |
| Line `ab39f4e2-…` | **110.16, 174.24 → 617.76, 110.16** | same id + remapped start |
| Arrow `7c73e797-…` | **122.40, 380.16 → 411.84, 122.40** | same id + remapped start |
| Textbox `aa7fb3e1-…` | **306.26, 174.90 → 617.10, 306.26** | same id; `Helvetica` |
| Survey-marker `surveyMarker-003632e3-…` | **373.32, 427.68 → 364.32, 373.32** | same id + remapped `surveyMarkers_*` |

Wipe+reload invents **0**; viewBox leftover portrait. 390: viewBox + `file.id` + 0 marks. hubPreview Draw **0**.

## Official / focused Node

Focused `pageRotateSaveReloadRemaining` + leftover18 (with shape-export suite) **16 / 16**. Cap **8448** / 75/250 not loosened. No high-risk edit. `graphify` CLI absent.

## Leftover-18

Still parked. Goal stays OPEN.
