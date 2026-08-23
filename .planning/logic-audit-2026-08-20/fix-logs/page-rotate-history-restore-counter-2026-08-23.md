# Counter History Restore after page CW — 2026-08-23

Named leftover after remaining-type History Restore (`eb72f23c`) documented Counter as unreachable. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapped rect+ink / callout/line/textbox/survey-marker History Restore / remapped-page export / undo-after-rotate (not replayed). Did **not** invent a History engine or named cloud Restore.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Product — bug-fixed (not intentional omit)

`deleteSelected` keyed `candidateIds` on top-level `id` only. Counters stamp `data.id` (`crypto.randomUUID()`), so Delete fell through to `runDelete()` and skipped `emitBulkTrashRows`. History showed "made an edit" with no Restore.

Min-viable:
- `useSVGInteraction.js` / context menu: `data.id || id` (same fallback `buildBulkDeletePlan` already documents)
- `annotationTrashHistory.js`: label `data.type === 'counter'` as "counter", not "circle"
- `rotatePageSpaceCounter`: always stamp `data.left` / `data.top` so SVG-localized Fabric `left` 0 still restores remapped origin

High-risk files untouched. No new remapper.

## Live-proved

Playwright `e2e-page-rotate-history-restore-remaining.spec.mjs` `--grep "counter intended|390 History restore remaining"` on Vite `http://127.0.0.1:5188`. `?testPdf=clickable-link-test.pdf`. **2 / 2 (9.6s)**.

| Check | Result |
|---|---|
| Counter `3d08ac92-…` | **171.36, 411.84 → 380.16, 171.36**; Restore kept remapped center + `data.left` **366.16** |
| viewBox after CW | **`0 0 792 612`** |
| create-event Restore | **0** |
| second Restore | invents **0** |
| collapse/dismiss | does not apply Restore |
| `file.id` | **null** |
| cloud History | **0** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate / History restore-after-remap not cheap |

## Official / focused Node

Focused `pageRotateHistoryRestoreRemaining` + `pageRotateCounterRemap` + leftover18 **25 / 25**. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk edit). `graphify` CLI absent.

## Leftover-18

Still parked. Goal stays OPEN.
