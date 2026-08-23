# Survey unplaced Excel rows — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

## Leftover

Survey **Rows we couldn’t place** (KAL-292). Chrome exists in the rail. DEV `?unplacedRows=mixed|batch` seeds it without a live workbook. Prior hunts counted unplaced **0** because they never passed the query. Parked “leftover-18 unplaced-rows” meant linked-workbook import / X-06 writeback — this slice is the DEV fixture + visual dismiss only.

Not leftover-18. Not remapped-after-CW. Not Excel actions Open linked / Update existing.

## Hunt

Drove `/?hubPreview=1` (Documents / Projects / `unplacedRows=mixed`) and `?testPdf=clickable-link-test.pdf` (default / bogus / mixed / batch / 390). Hub has no Survey rail. Editor choose-template screen stays empty until a template is picked.

## Proof

| Case | Result |
|---|---|
| Intended mixed | 5 named rows + plain-English reasons; no apply-anyway; Dismiss D-114 → 4; Dismiss all → 0 |
| Intended batch | Title **Your Excel changes weren’t applied**; 12 rows; per-row reasons 0; Dismiss all → 0 |
| Break | hub / hub+mixed / default testPdf / bogus / choose-template / empty click invent **0**; no workbook download; no annotations / Survey marks |
| Edge | 390 Open survey dismiss D-114 → 4; `file.id` null |

## Product

No product edit. Dismiss is visual-only (`handleDismissUnplacedRow` / `handleDismissAllUnplacedRows`). X-06 automatic writeback stays `false`.

## Tests

- Playwright `e2e-survey-unplaced-rows.spec.mjs` **2 / 2 (12.6s)** on Vite `http://127.0.0.1:5288`
- Node `surveyUnplacedRows` + leftover18 **15 / 15**
- Cap **8448** / 75/250 not loosened

## Lease

No lease. No `file.id`. No cloud-write. Goal stays open.
