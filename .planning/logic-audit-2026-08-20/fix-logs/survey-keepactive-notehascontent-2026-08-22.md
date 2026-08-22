# surveyKeepActive stale notes aria-label contract — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Cap **8448** not loosened.

## Verdict

**Stale official contract — not a product regression, not leftover-18.**  
`tests/surveyKeepActive.test.mjs` test 4 still expected rail Add/Edit item notes to key off `surveyMarkers[annotationId]?.note?.text`. Intended product after notes Photo/Video attach uses `noteHasContent(note)` — text **or** photos **or** videos count as saved content. `noteHasContent` was **not** reverted.

| Check | Result |
|---|---|
| Desktop item notes `aria-label` | `noteHasContent(surveyMarkers[annotationId]?.note) ? "Edit item notes" : "Add item notes"` |
| Mobile `hasNoteText` | `const hasNoteText = noteHasContent(...)` then Edit/Add Survey Marker notes |
| `noteHasContent` | `(note.text.trim()) \|\| note.photos.length \|\| note.videos.length` |
| Stale `.note?.text` aria-label | **Absent.** `doesNotMatch` the old ternary. |
| Keep-active after-place / Next / Pen hide | Unchanged. |

## Isolated + focused

```
# tests/surveyKeepActive.test.mjs
# tests 4 / pass 4 / fail 0
```

Focused official subset after the contract fix (keepActive + leftover18FailClosed + continueCountToolbar + hubDismissBarrierContracts + pageOperationsQueueMounted + surveyEmptyCreateTemplate): **28 / 28**.

## Official `npm test` baseline

Suite **proceeds past** `surveyKeepActive` and the rest of the main file list (through `zoomRailControlOrder`). Isolated timing suites: `annotationDocConcurrency` + `partialEraseCurveLocality` ran. **Fail-stop** on isolated `tests/partialEraserComplexity.test.mjs` test 10 (`500 crossing cuts…`):

```
total allocation 12283.13 MiB exceeded 8448.00 MiB — the eraser got allocation-hungrier
```

That is the standing **8448** crossing500 `maxAllocatedBytes` cap (`8_448 * 1024 * 1024`). **Not loosened.** `svgPathTransformFidelity` not reached. Pipeline `EXIT:0` after the fail is a `npm test | tee` pipefail artifact. Node TAP for that isolated file is **9 / 10** (`# fail 1`).

## Product

No product diff. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric fontFamily untouched. High-risk files untouched.

## Next leftover

Independent hunt after this contract fix. Leftover-18 / X-01 stay parked (do not invent `.env.local`). Goal stays open.
