# History Restore after page CW — ellipse / cloud-rect / highlighter — 2026-08-23

Named leftover after remaining History Restore + Counter `data.id` fix (`fc305b06` / `357ce892`). Rect + pen ink restore already named. Highlighter is multiply, not a pen replay. Named cloud Restore stays leftover-18 **X-01**. Did **not** stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## `data.id` Delete extras

**None.** Keyboard + context-menu `candidateIds` already use `data.id || id`. Ellipse / cloud-rect / highlighter / pen stamp **both** top-level `id` and `data.id`. Counter remains the only reachable create that stamps `data.id` only. Live Delete after CW journaled a Restore row for all three types.

## Live-proved

Playwright `e2e-page-rotate-history-restore-shapes.spec.mjs` **5 / 5** on Vite `http://127.0.0.1:5190`. `file.id` null. Cloud History **0**.

| Type | Id | Created → CW / Restore |
|---|---|---|
| Ellipse `926c366e-…` | **183.60, 245.52 → 546.48, 183.60** |
| Cloud-rect `b9e85fcc-…` | **367.20, 261.36 → 530.64, 367.20** |
| Highlighter `cdf8cd23-…` | **134.64, 396.00 → 396.00, 134.64** |

Create-event omits Restore; second Restore invents **0**; collapse/dismiss does not apply. 390: viewBox + `file.id`. hubPreview Draw **0**.

## Official / focused Node

Focused `pageRotateHistoryRestoreShapes` + `deleteCandidateIdsDataId` + leftover18 **18 / 18**. Cap **8448** / 75/250 not loosened. No high-risk edit.

## Leftover-18

Still parked. Goal stays OPEN.
