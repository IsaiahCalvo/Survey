# Board Audit + Linear Reconcile — 2026-06-11

Scheduled loop session (02:07). Audit-only, cap-free. Method: 10 parallel verification
agents over the 30 May-era UI/annotation tickets (the high staleness-risk pool) + 1
status-drift agent over the 6 In-Progress tickets; every OBSOLETE/PARTIAL candidate then
got an independent adversarial refute pass before any action. 36 verdicts total.

## Headline

**Zero tickets obsolete. Nothing canceled.** The board is healthy — every open ticket's
subject still exists in the live app. 24 VALID (untouched, problem fully intact),
12 PARTIAL (real work remains but the ticket's status notes lag reality). One state
drift fixed: KAL-82 was In Progress on the board but Backlog in Linear.

## PARTIAL tickets — what the status notes missed

| Ticket | Still open | Already done (unrecorded or under-credited) |
|---|---|---|
| KAL-59 survey panel polish | items 2 (rename tooltip must read "Rename Survey Marker" — current title is "Click to rename"), 3 (#252525/#2b2b2b colors), 4 (button classes), 8-partial (expand aria-label says "Expand panel" not "Expand Survey panel") | items 5 (Notes width shift), 6 (locate tooltips), 7 (header font-size) fixed; item 1 typo absent from src |
| KAL-70 top toolbar | .btn-active blue→gold swap (styles.css:958) | items 3 (badge overlap) + 4 (legacy BottomToolbar removal) done. Nuance: PDFViewer.jsx:30857 #4A90E2 is the glyph mini-buttons inside the category popup, not the category button itself |
| KAL-84 drag-to-rearrange | BookmarksPanel, PagesPanel, **TabBar.jsx** (third non-migrated surface, previously uncounted) + the "Done when" docs | shared dnd primitives exist; several surfaces migrated |
| KAL-91 imported ink | all 5 bugs B1–B5 + regression fixture + 1 policy decision for Isaiah | investigation complete (31e48dc3, IMPORTED-INK-AUDIT.md) |
| KAL-125 ownership gate | context-menu delete (PageAnnotationLayer.jsx:4344) + bespoke survey-marker authority chain (~23597) still ungated | keyboard-delete path in PDFViewer gated (67b4686d, attributed in comment) |
| KAL-127 PDFViewer breakup | all stateful custom-hook extractions; file still ~34k lines | 30 pure helper lifts into 9 modules done |
| KAL-82 dead code | Dashboard cluster audit (handleDeleteDocument, sort/format helpers, memo chain) + 3 product decisions | slices 1+2 committed (~2,065 lines). **Linear state was Backlog — corrected to In Progress** |
| KAL-279 failed-to-fetch | live confirmation that a large force-flush no longer throws (the ticket's own acceptance gate) | narrow-select fix on all three annotationCloudSync.js upserts IS committed (4c1e420a, 2026-06-05) — the issue file's "uncommitted" note was stale |
| KAL-257 skipped tests | §2.3 spec (blocked on test-env); cosmetic stale header comments in 2 test files | §2.5 delivered — three integration tests use conditional skip, no hard test.skip remains |
| KAL-259 IPC allowlist | live three-scenario test never recorded as passed (sole remaining item) | code fix fully committed incl. restart-gap edge case via dialog-path persistence — issue file's "uncommitted" note was stale |
| KAL-295 print panel | all 5 finalization slices (P1 pick J/K, P2 flag flip + live verify + G6, P3 export menu/IPC, P4 tooltip copy, P5 alert sweep) | step-1 audit committed |
| KAL-61 share modal | **upgraded back to VALID by refute pass**: free-tier red error block, previewSlug placeholder URL shown pre-copy, missing coming-soon disabled treatment — the three original acceptance criteria all still fail | paid-tier Path A sharing is now real (token, send-email edge fn, /invite accept page) |

## Notable VALID confirmations (spot-checks worth recording)

- KAL-57: 55+ native alert() calls survive (PDFViewer, SurveySpacesRail, AppShell); no toast host exists.
- KAL-74: Version History feature complete + unit-tested, but the 22-case e2e suite is entirely unwritten → **good next loop task**.
- KAL-88: prior investigation's debug log still sits verbatim in production code; callout creation path still orphaned from the tool lifecycle.
- KAL-241: upsert batch still has no pre-dedup by annotation_id; full-refetch cascade paths live.
- KAL-239/240: text-select mode unstarted; dependency chain unchanged.

## Actions taken this session

1. Linear: KAL-82 Backlog → In Progress.
2. Linear: dated audit comment posted on each of the 12 tickets above.
3. Vault: Status log line + last_synced bump on the 12 issue files; _Board.md last_synced → 2026-06-11.
4. No cancellations (none warranted), no code changes (cap untouched).

## Recommendation for next loop session

KAL-74 version-history e2e (agent-ready; feature browser-verified previously, so marginal
value is the regression net, not discovery) — or, higher value if Isaiah confirms testing:
finish KAL-59's four small remaining polish items (tiny, well-scoped, all cited above).
