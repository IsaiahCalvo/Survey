# surveyEmptyCreateTemplate stale Walls contract — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Cap **8448** not loosened.

## Verdict

**Stale official contract — not a product regression, not leftover-18.**  
`tests/surveyEmptyCreateTemplate.test.mjs` sliced Empty Module Template from `id: 'kal436-empty-module-template'` to `SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY`. The later Two Category Template (Walls + Windows) was added for category reorder and sat inside that slice, so `doesNotMatch /name: 'Walls'/` failed.

| Check | Result |
|---|---|
| Empty Module Template | Still `categories: []`. No Walls / Doors / entities. |
| Two Category Template | Intended sibling seed. `kal436-two-cat-walls` / `kal436-two-cat-windows`. |
| Create template product | Not reverted. Empty-state still opens CreateCategoryModal. |
| Test | Not skipped. Slice now stops at `kal436-two-category-template`. Two-category slice asserts Walls + Windows. |

## Isolated + focused

```
# tests/surveyEmptyCreateTemplate.test.mjs
# tests 3 / pass 3 / fail 0
```

Focused official subset after the contract fix (empty-create + leftover18FailClosed + continueCountToolbar + hubDismissBarrierContracts + pageOperationsQueueMounted): **24 / 24**.

## Official `npm test` baseline

Suite **proceeds past** `surveyEmptyCreateTemplate`. **Fail-stop** on the next standing file `surveyKeepActive` test 4 (`PDFViewer + rail + 390 chrome wire the Keep-active rules; notes chrome exists`).

Stale rail assertion:

```
/aria-label=\{surveyMarkers\[annotationId\]\?\.note\?\.text \? "Edit item notes" : "Add item notes"\}/
```

Intended product after notes Photo/Video attach uses `noteHasContent(surveyMarkers[annotationId]?.note)` (photos/videos count as content, not just `.text`). Did **not** skip or rewrite that file this pass. Isolated 8448 still not reached. Cap **8448** not loosened.

Pipeline `EXIT:0` after the fail is a `npm test | tee` pipefail artifact. Node TAP for that file is **3 / 4** (`# fail 1`).

## Product

No product diff. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric fontFamily untouched. High-risk files untouched.

## Next leftover

Independent hunt after this contract fix. Leftover-18 / X-01 stay parked (do not invent `.env.local`). Goal stays open.
