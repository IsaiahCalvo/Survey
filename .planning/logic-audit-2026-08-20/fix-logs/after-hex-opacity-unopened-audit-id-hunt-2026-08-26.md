# Hunt remaining unopened audit IDs after P1-39 — 2026-08-26

## Leftover taken

**None.** Genuine hunt of remaining unopened 2026-08-20 audit IDs after tip `4f904b5f` / product `6c1ab2cd`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay the seven exhausted hunts. Did **not** replay P1-39 hex leftover sibling Opacity persist. Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, Color chrome on 390, eraser-cut Width restroke, imported-outline Width restroke, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

`6c1ab2cd` already took P1-39 hex+Opacity. `ca258573` probed P1-21 / P1-27 / P1-20 / P1-28 / P1-16 / P1-25/26 / P1-32 / KB-1 / KB-2. The P1-39 pass already opened P1-29 / P1-31 / P1-33 / P1-34 / P1-35 / P1-37 / P1-40/41 / P1-42–44 / P1-48 / P1-49 / P1-51 / P2-34. This pass walked the remaining unopened IDs:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **P1-17 / P1-18** page-op merge + clipboard | `mergeLivePagePresentation` / `remapClipboardPage` | **already aligned** |
| **P1-19** page-op version conflict | `DocumentVersionConflictError` | **already aligned** |
| **P1-22** erase approval | page-object + text-markup domains | **already aligned** |
| **P1-23** imported author stamp | `stampImportedAnnotationAuthor` | **already aligned** |
| **P1-24** survey-marker fail-open | `canModifySurveyMarker` no outer skip | **already aligned** |
| **P1-30 / P2-16** Restore toast | `__selectedAnnotationIds` published | **already aligned** |
| **P1-36** own-annotation undo | `isOwnAnnotation` | **already aligned** |
| **P1-38** Match Fill translucent ring | `?testPdf=` Fill 40 + Match Fill | **already aligned** — selected `2px` (not leftover `>= 99`) |
| **P1-45 / P1-47** bookmark delete / reorder | count/confirm + batched persist | **already aligned** |
| **P1-46** sidebar localStorage | guest / no-Y.Doc | **accepted leftover — not taken** |
| **P1-50 / P1-52** spaces LWW / orphans | `spacesById` + `unscopeOrphanedRegionAnnotations` | **already aligned** |
| **P1-53 / P1-54 / P1-55** | pending-before-offline / black-thumb / dual-write false | **already aligned** |
| **P2-11 / P2-15 / P2-17 / P2-31 / P2-32 / P2-35 / P2-36 / P2-38 / P2-39** | quit coordinator / DELETE confirm / 10min presence / profile outcome / unlink / touchcancel / single-instance / billing query / homeDir logs | **already aligned** (Electron / host paths not live-proved here) |
| leftover-18 | — | **not taken** |

Live probe (`/?testPdf=clickable-link-test.pdf` + `?hubPreview=1`): P1-38 Match Fill after Fill **40** shows selected **2px**; empty reload invents 0; hubPreview Color / Hex **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 hex / Match fill chrome **0**.

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** restroke eraser-cut paper-ink or imported outlines without a centerline.

## Files

- `tests/afterHexOpacityUnopenedAuditIdHunt.test.mjs`
- `debug/scenarios/e2e-after-hex-opacity-unopened-audit-id-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-hex-opacity-unopened-audit-id-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-hex-opacity-unopened-audit-id-hunt.spec.mjs` **pending**.

- Intended: P1-38 Fill 40 + Match Fill selected **2px**; viewBox / `file.id`
- Break: empty reload invents 0; hubPreview Color / Hex **0**
- Edge: 390 viewBox / `file.id` / hex chrome **0**

Focused Node `afterHexOpacityUnopenedAuditIdHunt` + leftover18FailClosed **26 / 26**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- P1-46 guest / no-Y.Doc sidebar still localStorage-only — accepted leftover, not taken
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only (restroke would restore erased bits) — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
