# Local History restore after page CW remaps a live rect — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after survey-marker create after CW. A-07 History click-restore (jump + spotlight, delete-restore on an unrotated page) was proved **before** the remappers — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / create-after-rotate family (not replayed). Did **not** invent cloud versions. Did **not** stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.survey-test-account.json` / `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

Min-viable: after page CW, delete snapshots often store Fabric `left`/`top` **0** while remapped `data.left`/`data.top` hold the displayed origin. `stampDisplayedPlacement` on `fabric:create` restore (and the delete→create invert) lifts that displayed origin so History Restore keeps remapped placement. Already-correct left/top/angle stay untouched. High-risk files untouched. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-history-restore.spec.mjs` **2 / 2 (8.5s)** on Vite `http://127.0.0.1:5245` (`npm run dev:ui`). Focused Node `pageRotateHistoryRestore` + leftover18 **15 / 15**. Also `annotationLocalHistory` + `annotationTrashHistory` **81 / 81** with leftover18.

`?testPdf=clickable-link-test.pdf`. `file.id` null. Cloud History/revision REST **0**.

Desktop rect `ce3d695b-…` before **189.72, 285.12** angle **0** viewBox **`0 0 612 792`**. CW remapped center **506.88, 189.72** angle **90** viewBox **`0 0 792 612`**. Delete + Restore kept the same id + remapped center (not pre-rotate **189.72**). Second Restore invents **0**. Collapse/dismiss without Restore leaves the id gone. Create-event omits Restore.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | create event; viewBox **`0 0 612 792`**; center **189.72, 285.12** |
| After CW remap | same id; center **506.88, 189.72**; angle **90**; viewBox **`0 0 792 612`** |
| After-rotate Restore | same id; center **506.88, 189.72**; viewBox held |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Create-event Restore | activity row | **0** (jump+spotlight, not a snapshot) |
| Second Restore | already-present remapped id | no dup |
| Collapse/dismiss | Restore visible, not clicked | id stays gone |
| `file.id` | `?testPdf=` throughout | **null** |
| Cloud | supabase / document_history / kal48 | **0** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after remap / restore | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| Fabric left 0 snapshot | Restore lifts remapped `data.left` |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate / History restore-after-remap not cheap |
| hubPreview | revisions panel **0** |

## Official / focused Node

Focused `pageRotateHistoryRestore` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
