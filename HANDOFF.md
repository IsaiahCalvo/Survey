# Handoff: blank-pages + load-then-vanish annotation bugs (fixed, needs live verify) + duplicate-name UX (half-built)

**Generated**: 2026-06-05 (late session)
**Branch**: `main` (local-only, NOT pushed — direct-to-main workflow; push only when the user asks)
**Status**: In Progress — core fixes landed + tested; 3 open threads + live verification pending

## Goal
Drive down the optimization backlog (started with a security batch + safe perf batch), then chased a real user-facing chain: a PDF opened blank → marks loaded then vanished → why the file kept landing on empty duplicate cloud documents. Also: make the fragile files safe for an agent to change on its own (self-verification harness).

## Completed this session (7 commits, local main, unpushed — newest first)
- [x] `6d0ca379` **fix(sync): load-then-vanish.** Cloud hydrate wholesale-replaced page state, so an empty/partial cloud snapshot wiped embedded PDF marks the cloud lacked. Added `mergePreservingImportedMarks` (preserves `isPdfImported` marks the cloud lacks, deduped by id) and wired it into all 5 initial-hydrate `setAnnotationsByPage` sites in `useAnnotationCloudSync.js`. **Needs live verify.**
- [x] `a9fc855d` **fix(documents): reopen-don't-duplicate.** Both file-open paths created a NEW empty cloud doc every time (no dedup) → blank duplicates piled up. Added `classifyIncomingFile` (recognizes a file by name + exact byte size) and wired both Dashboard open paths to reopen the existing live copy instead of uploading a blank duplicate.
- [x] `247fcffe` **fix(import): self-heal blank pages.** When a cloud doc hydrates with count===0 but the PDF has embedded marks, re-import them (guarded once-per-doc, re-checks live count is still 0 before committing). This is what made the marks come back. **Known wart: it commits via `handleSaveAnnotations`, which pushes the imported marks to the cloud — that push fails ("Failed to fetch") and is noisy / risks re-bloat. See Not Yet Done.**
- [x] `0e24b31c` docs: `.planning/optimization/SELF-VERIFY-CAPABILITIES.md` — full map of how an agent can drive + verify the app (agent-cli, `?testPdf=` route, Playwright/kapture MCPs, behavior-coverage checklist).
- [x] `968baf2c` perf(viewer): wheel handler no longer runs `document.querySelector` + getBoundingClientRect on every wheel tick (only when target is outside the PDF container). User felt it "maybe minuscule."
- [x] `1f809a2d` perf(main): async `fs.promises` for file read/write IPC, Uint8Array IPC for openFile, statSync-throttle on the continuous-log hot path, fileWatcher isDestroyed guard + auto-close.
- [x] `cd45e6bb` fix(security): shell:openPath spawn-not-exec, setWindowOpenHandler exact-host allowlist, oauth:openWindow https-validate + sandbox, continuous-log token redaction. **Cmd+Shift+L log-save kept intact, just scrubs tokens.**

Baseline: `npm test` was **888/0/6** at session start, now **899/0/6** (added incomingFileResolver +6, mergePreservingImportedMarks +5). `npx vite build` clean.

## Not Yet Done (next session, priority order)
- [ ] **VERIFY the vanish fix live** — reopen the test file, confirm marks stay on pages 6–11 (not just 6–7). Cloud-hydrate state is NOT reproducible headlessly.
- [ ] **Quiet the self-heal push** — self-heal (`247fcffe`) commits embedded marks via `handleSaveAnnotations`, which triggers the legacy bulk push (`upsertAnnotationsByPage`, 3056 rows → "Failed to fetch"). Imported marks are file-derived and should NOT be cloud-pushed. Change the self-heal apply to render-only (`setAnnotationsByPage` merge) and confirm the bulk push no longer fires for imported marks. Watch for the CRDT delta path already skipping `isImported` (useAnnotationCloudSync ~L2308) vs the legacy bulk push NOT excluding them.
- [ ] **Stage 2: same-name-different-content prompt** (design agreed with user, not built). `classifyIncomingFile` already returns `{kind:'name-collision', collisions}`; `nextAvailableName` helper already exists. Build: a modal (pattern: `src/components/ExcelSyncConfirmModal.jsx`) that ALWAYS asks (user: "ask every time" like Windows/Mac) → "Keep both" (numbered name via `nextAvailableName`) or "Replace" (SAFE = archive the old copy, create new with original name; never destroy marks). Wire into both Dashboard open paths where the `name-collision` branch currently falls through to create-new.
- [ ] **Duplicate cleanup + restore** — user's original `Package 2 - Rev 4 -- IC.pdf` (`5fa31b86`, 22,103 marks) is soft-deleted (archived). Ask user whether to restore it (un-archive) or leave it (embedded 3056 marks re-import via self-heal; the 22k were mostly duplicate re-imports). Two empty archived dupes (`398beaa9`, `0c9626ea`) can be hard-deleted.
- [ ] **Remaining 46-finding backlog** in `.planning/optimization/FINDINGS.md` — surfaced, not applied. Notably security #4 (fs path allowlist — risks breaking Excel/OneDrive reads, needs live test) and #5 (VITE_GITHUB_LOG_TOKEN baked into bundle — needs a secrets-in-packaged-build decision + mobile proxy). Plus IPC/collab/interaction/rendering/db-sync/react-perf items.

## Failed Approaches (don't repeat)
- **`debug/scenarios/annotation-draw-render.spec.mjs` fails headless.** The pen arms (Draw button → `lastDrawTool='pen'`, 36 canvas-containers mount) but a `page.mouse` stroke does NOT commit under `npx playwright test` — `__renderedAnnotationRegistry['1']` and the Fabric canvas `getObjects()` both stay 0, even with `expect.poll` (10s) and reading the canvas directly. The SAME stroke DOES commit when driven live via the Playwright MCP (regPage1 went 0→1). Cause is a readiness/timing gap (drawing canvas not interactive yet at draw time). Next: gate the stroke on the upper-canvas being interactive, or use a different draw trigger. Spec is committed but currently red — treat as WIP.
- **`?testPdf=` route does NOT persist drawn marks across reload.** It's a transient local preview; the `annotationsByPage_<id>` localStorage key is a read-only legacy migration cache (PDFViewer deliberately does not load it). Real persistence is the Supabase cloud path (already covered by agent-cli: `survey-roundtrip.mjs`, `proof-snapshot-invariant.mjs`). So a draw→reload-survival browser test is NOT viable on testPdf — assert draw→render→survive-zoom instead.

## Key Decisions
| Decision | Rationale |
|----------|-----------|
| Recognize files by **name + exact byte size**, not a content hash | No DB migration needed; uniquely identifies the same file in practice (different content → different size). A true hash column is a possible future hardening. |
| Preserve `isPdfImported` marks across cloud hydrate (merge) instead of refactoring the ~15 sync apply sites | Minimal, principled: cloud owns user-drawn marks; file-derived marks are re-derived and must never be cloud-deleted. |
| Two-layer + non-destructive defense | dedup-at-create (prevent blank dupes) + self-heal-at-open (recover) + preserve-on-hydrate (don't wipe). |
| Soft-delete is intentional, and the dupes were a **user bulk-delete** (source `survey-hub-bulk`), not an auto-bug | Logs confirm 3 bulk deletes today; re-adding a deleted file makes a fresh empty doc by design — combined with no-dedup = blank pages. |

## Files to Know
| File | Why It Matters |
|------|----------------|
| `src/utils/incomingFileResolver.js` | `classifyIncomingFile(file, existingDocs)` → `{kind:'new'|'reuse'|'name-collision'}` + `nextAvailableName(name, existingNames)`. Pure, unit-tested. |
| `src/utils/safeSnapshot.js` | `mergePreservingImportedMarks(prev, incoming)` (new) + existing `resolveSafeSnapshot` (empty-only guard). |
| `src/Dashboard.jsx` | Two file-open paths (Electron dialog ~L525, browser input ~L665) — reuse branch added; `name-collision` branch is the Stage-2 TODO. |
| `src/PDFViewer.jsx` | Self-heal effect just above the `__fix19ImportPdfAnnotations` harness; `embeddedImportFallbackDoneRef`. Import skip at "shouldSkipEmbeddedPdfAnnotationImport = !!pdfFile?.id". |
| `src/hooks/useAnnotationCloudSync.js` | HIGHEST-RISK. 5 initial-hydrate apply sites now use `mergePreservingImportedMarks`. `markInitialHydration({ready,count})` is the signal the self-heal keys on. The failing bulk push is `upsertAnnotationsByPage`. |
| `.planning/optimization/FINDINGS.md` | 46 surfaced findings, not applied. |
| `.planning/optimization/SELF-VERIFY-CAPABILITIES.md` | How to drive/verify the app. |

## Code Context
```js
// src/utils/incomingFileResolver.js
classifyIncomingFile(file, existingDocs) // matches by name + Number(file_size||size); reuse picks OLDEST match
  -> { kind:'new' } | { kind:'reuse', doc } | { kind:'name-collision', collisions }
nextAvailableName('Report.pdf', ['Report.pdf']) // -> 'Report (1).pdf'

// src/utils/safeSnapshot.js
mergePreservingImportedMarks(prev, incoming) // returns `incoming` identity-unchanged when nothing to preserve
// else: incoming + any prev objects with isPdfImported not already in incoming (deduped by id ?? data.id ?? pdfAnnotationId)

// useAnnotationCloudSync: hydration signal the self-heal watches (PDFViewer destructures as normalAnnotationHydration)
initialHydration = { ready: boolean, count: number|null, documentId, pdfId, ... } // count===0 + ready===true => empty cloud doc
```
**Reuse branch (both Dashboard paths):** attaches `file.id = existing.id` (+ project_id, file_path, user_id) to the local File and calls `onDocumentSelect(file)` — skips upload+create entirely.

**Self-heal trigger (PDFViewer):** `normalAnnotationHydration.ready===true && count===0 && documentId===pdfFile.id && !done-for-this-doc && pdfDoc present` → `importAnnotationsFromPdf(pdfDoc, {rawPdfBytes})` → commit per page via `handleSaveAnnotations(pageNumber, {...current, objects:[...current, ...stamped]}, {source:'embedded-import-empty-cloud-fallback', checkpointPolicy:'skip'})`.

## Resume Instructions
1. Read this + today's session-moments (`.claude/projects/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2/memory/session-moments/2026-06-05.md`) — the full root-cause chain is logged there.
2. **Live-verify the vanish fix**: user reopens the test file (`/Users/isaiahcalvo/Documents/Records/Documents To Review/PDFs from Desktop/Package 2 - Rev 4 -- IC.pdf`). Expected: marks render AND stay on pages 6–11. If they still vanish: check `renderer-console.continuous.log` for which hydrate `source` fired (one of snapshot-prefetch / supabase-durable-snapshot / ydoc-snapshot / *-fallback) and whether `[CloudSync][push] upsertAnnotationsByPage failed` is still corrupting the cloud to a partial set.
3. **Then quiet the self-heal push** (see Not Yet Done) so nothing fights — verify no `upsertAnnotationsByPage` fires for the 3056 imported marks after open.
4. **Then Stage 2 prompt** (modal + numbering + safe replace).
5. Confirm `npm test` 899/0/6 and `npx vite build` clean after any change. Commit with explicit `git add <paths>` ONLY (never `-A`) to keep the pdf.js-cutover WIP + debug scaffolding out. Push only on the user's say-so.

## Headless verification tools (no GUI needed)
- `node agent-cli/index.mjs docs` — list visible (non-archived) docs as the dev user.
- `node agent-cli/index.mjs open <documentId>` — real backend hydrate row count + timing. (Heavy original: `5fa31b86-...` = 22,103 marks; empty dupes = 0.)
- Count embedded PDF marks in a file: load `pdfjs-dist/legacy/build/pdf.js`, `getDocument({data})`, loop `page.getAnnotations()`. The test file has **3056** embedded (pages 6–11: Ink + 1 Square/page + 1 FreeText).
- Drive the live app: Playwright MCP → `http://localhost:5173/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`; arm pen by clicking the toolbar **Draw** button; read `window.__debugBridge.snapshot()` and `window.__renderedAnnotationRegistry`.

## Warnings
- **DO NOT `git add -A`.** Pre-existing uncommitted pdf.js-cutover WIP + debug scaffolding must stay out of commits. Stage exact paths.
- `useAnnotationCloudSync.js` and `PDFViewer.jsx` are the highest-risk files. Min-diff. The waiver in `memory/feedback_protected_files_waiver.md` allows edits without per-edit approval but the enforced invariants still bind (SVG viewBox owns zoom, never remove `zoomGeneration`, container-aware canvas sizing, single-name fontFamily).
- The live engine is the **owned pdf.js renderer** (not Syncfusion); `[InteractionDiag]` lines saying "syncfusion-page" are stale labels — ignore.
- `archived: true` on a document means **soft-deleted** (the documents fetch filters `archived=false`).
