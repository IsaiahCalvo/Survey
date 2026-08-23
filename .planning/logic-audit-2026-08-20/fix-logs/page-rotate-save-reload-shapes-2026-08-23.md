# Local `?testPdf=` save/reload after page CW — ellipse / cloud-rect / highlighter — 2026-08-23

Named leftover after remaining-type save/reload (`357ce892`). Pen History Restore is already named; highlighter is multiply ink, not a pen replay. Family-level untransformed reload is `e2e-testpdf-local-save-reload`. Named cloud save stays leftover-18 **X-01**. Did **not** stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Remount limit

Same as last pass: remount reloads original fixture bytes. After reload: viewBox **`0 0 612 792`**. `pageTransformations` **null**. Local cache still holds remapped ids + coords.

## Live-proved

Playwright `e2e-page-rotate-save-reload-shapes.spec.mjs` **5 / 5** on Vite `http://127.0.0.1:5189`. `file.id` null.

| Type | Id | Created → CW | Reload persist |
|---|---|---|---|
| Ellipse `fa75978f-…` | **183.60, 245.52 → 546.48, 183.60** | same id + remapped bbox |
| Cloud-rect `5e0441d4-…` | **367.20, 261.36 → 530.64, 367.20** | same id + intensity |
| Highlighter `7459c3fb-…` | **134.64, 396.00 → 396.00, 134.64** | same id; `left` **0** + remapped centerline |

Wipe+reload invents **0**. 390: viewBox + `file.id`. hubPreview Draw **0**.

## Official / focused Node

Focused `pageRotateSaveReloadShapes` + leftover18 (with History + Delete-id) **18 / 18**. Cap **8448** / 75/250 not loosened. No high-risk edit.

## Leftover-18

Still parked. Goal stays OPEN.
