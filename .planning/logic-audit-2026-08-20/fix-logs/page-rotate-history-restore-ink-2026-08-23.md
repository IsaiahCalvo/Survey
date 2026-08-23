# Local History restore after page CW remaps live ink — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after rect History restore after CW (`d3fa11a1`). A-07 click-restore was proved **before** the remappers — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapped rect History Restore / remapped ink / callout / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / create-after-rotate family (not replayed). Did **not** invent cloud versions. Did **not** stamp `file.id`. Did **not** extend `stampDisplayedPlacement`.

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

No product change. Live pen stores `path` + `paperCenterline` in page space (`left: 0` is normal; no `data.left`). After CW, `rotatePageSpaceInk` remaps those points and keeps `left` 0. History Restore of the remapped delete snapshot is `fabric:create` with the remapped path/centerline. `stampDisplayedPlacement` is a no-op (no `data.left` to lift). Fabric save after Restore may localize `left`/`pathOffset`/`originX=center` while the remapped path + centerline stay put — not a park.

Sibling Node probe (not receipted): clean remapped callout fractions and counter origin restore through the same invert. Callout/counter `fabric:modify` / page-rotate checkpoints do not offer Restore (delete-only). Counter Fabric-0 without `data.left` would restore at 0 — live remapped pins already carry remapped `left`/`top`, not hunted this pass.

High-risk files untouched. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-history-restore-ink.spec.mjs` **2 / 2 (9.6s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `pageRotateHistoryRestoreInk` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `file.id` null. Cloud History/revision REST **0**.

Desktop pen `6fe039b5-…` before **134.64, 237.60** left **0** viewBox **`0 0 612 792`**. CW remapped centerline **554.40, 134.64** left **0** angle **0** path `M 553.26, 133.66` viewBox **`0 0 792 612`**. Restore kept same id + remapped centerline + remapped path (not pre-rotate **134.64**). Fabric localized left **49.02** / `pathOffset` **506.88, 189.72** / `originX=center` — centerline held. Second Restore invents **0**. Collapse/dismiss does not apply. Create-event omits Restore.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | create event; viewBox **`0 0 612 792`**; centerline **134.64, 237.60**; left **0** |
| After CW remap | same id; centerline **554.40, 134.64**; left **0**; angle **0**; viewBox **`0 0 792 612`** |
| After-rotate Restore | same id; remapped centerline + path; viewBox held |

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
| left 0 is normal | remapped ink has no `data.left`; stamp is a no-op |
| Fabric localize after Restore | left **49.02** + pathOffset; centerline held |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate / History restore-after-remap not cheap |
| hubPreview | revisions panel **0** |

## Official / focused Node

Focused `pageRotateHistoryRestoreInk` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped if missing.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
