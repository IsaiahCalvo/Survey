# Backlog — audit items not yet filed in Linear

_Created 2026-06-05. **MIGRATED 2026-06-10**: all BL-01…BL-23 items are now in Linear (KAL-280…KAL-297). Linear is now canonical — this file is a historical record only. Obsidian BL files updated with linear_issue fields. Source docs: `.planning/optimization/PERSISTENCE-ARCHITECTURE.md`, `SUPABASE-DATA-AUDIT.md`, `PRE-REBUILD-READINESS.md`._

## BL → Linear mapping (2026-06-10)

| BL | KAL | Status |
|----|-----|--------|
| BL-01 | KAL-280 | Backlog |
| BL-02 | KAL-281 | Backlog |
| BL-03 | KAL-282 | Backlog |
| BL-04 | KAL-283 | Backlog |
| BL-05 | KAL-284 | Backlog |
| BL-06 | KAL-285 | Backlog |
| BL-07 | KAL-286 | Backlog |
| BL-08 | KAL-287 | Backlog |
| BL-09 | KAL-288 | Backlog |
| BL-10 | KAL-289 | Backlog |
| BL-11 | KAL-290 | Backlog |
| BL-12 | KAL-291 | Backlog |
| BL-13 | DONE | fa296bc2 — Excel-sync scenario test suite |
| BL-14 | KAL-292 | Backlog |
| BL-15 | KAL-293 | Backlog |
| BL-16 | KAL-297 | Backlog |
| BL-17 | DONE | b30e3667 — select-mode audit |
| BL-18 | DONE | 6377a33b — DND consolidation audit |
| BL-19 | DONE | e0a50e85 — duplication sweep snapshot |
| BL-20 | KAL-294 | Backlog |
| BL-21 | KAL-295 | Backlog |
| BL-22 | KAL-296 | Backlog |
| BL-23 | DONE | e2020f0e — templates editor refresh fix |

## Already in Linear (for reference): KAL-254 … KAL-279
Epic KAL-254. Milestones A–F + "DB hygiene quick wins" + "Decisions to make" all created. 26 issues filed covering: safety-net tests, security blockers, migration backup/baseline/verification, op-log + access-gate + compaction, data bootstrap + content-hash + dual-write, the full Phase E rebuild (clear-and-refan, Yjs source of truth, embedded-import-exactly-once, large-update drop, offline, concurrency, delete patches), rollout + duplicate-upload UX + realtime cleanup, and the "Failed to fetch" one-line fix (KAL-279).

---

## STILL TO FILE — DB hygiene quick wins (independent, safe to land now)

- [ ] **Deleting a file should remove its marks — cascade-on-archive + cleanup job.** Archiving does NOT cascade and there's no GC job, so 97.9% of all annotation rows (52,108) + 85% of Yjs-state rows belong to archived docs nobody can open; the two heaviest archived copies alone are 46,555 rows. Build a retention/GC job (delete annotations + yjs-state + history for `archived AND updated_at < now()-30d`, ~52k rows reclaimed; test on staging) and decide cascade-on-archive semantics. Land EARLY so the rebuild doesn't migrate garbage. _(audit §2, §5 #3, §7)_

- [ ] **Re-key stored PDF files so they can be cleaned up + hard-delete aged archives.** Files are named by timestamp (`1779028738489.pdf`), unlinkable to a document and un-GC-able (~449 MB, much backing archived-only docs). Re-key the storage scheme (reconcile the two proposals: content-addressed `{user_id}/{sha256}.pdf` from the rebuild — preferred, also gives dedup — vs `{user_id}/{document_id}.pdf` from the audit), backfill the ~97 time-named objects, then add a hard-delete pathway for archived docs aged 90d that removes BOTH rows and the storage object. Re-key BEFORE GC. _(audit §5 #13-14)_

- [ ] **Fix the legacy survey-marker reader's slow pagination (offset → keyset).** Still uses offset pagination → Postgres scans + access-checks every skipped row on deep pages (quadratic). Only ~4 pages today at 3,434 markers but a re-introduced timeout risk as surveys grow. Migrate to the keyset helper. _(audit §4, §5 #6)_

- [ ] **Cut write-ahead-log bloat — switch replica identity from FULL to USING INDEX** on the annotation table's unique index. FULL writes the entire old row to WAL on every update (~800 B → ~50 B), inflating replication lag linearly with annotation count. _(audit §5 #4)_

- [ ] **Schema-constraints bundle:** (a) partial `UNIQUE INDEX documents(user_id, name) WHERE archived=false` as an interim duplicate-stopper until content-hash (KAL-267) lands; (b) `CHECK(file_size>0)` and `CHECK(page_number>0)` — a 10-byte ghost doc already exists; (c) `document_invites.created_by` cascade → `ON DELETE SET NULL` (currently CASCADE hard-deletes accepted-invite audit trail); (d) `UNIQUE(document_id, target_email) WHERE target_email IS NOT NULL` on invites. _(audit §3, §5 #5, #7, #12)_

- [ ] **Query-hygiene bundle:** (a) `.limit(100)` on the unbounded cross-user `getOtherSurveysUsingTemplate` (caller only needs count>0); (b) project columns in list `SELECT *` queries (don't pull the growing preferences JSONB into list views); (c) partial index on annotations `(document_id, page_number) WHERE annotation_type='survey-marker'` (~10x cheaper marker reads); (d) 3–5 concurrency cap on the sequential upsert batch loop for replay/migration paths; (e) replace the 5,000-row client-side JSONB scan (`countSurveyMarkersReferencingChecklistItemFallback`) with a server RPC. _(audit §4, §5 #9-11, #19)_

- [ ] **Clean up bug-residue documents:** 13 active zero-annotation docs (5 `test-rpc-doc`, two `Isaiah Calvo Profile.pdf`, `New document.pdf`, `sync-test.pdf`, etc.) + the 2 *active* duplicate `clickable-link-test.pdf` rows (pick canonical, archive the rest). _(audit §2, §5 #8)_

- [ ] **Disposition the dead tables + investigate the empty op-updates table.** Confirm 0 rows + no app refs, then drop the abandoned Excel tables (`survey_*`, `excel_schema_mapping`) and unused CRDT/activity tables from the realtime publication, then drop. Separately, investigate why `doc_yjs_updates` = 0 — confirm collaborative updates aren't being silently dropped before the rebuild relies on it. _(audit §3, §5 #17-18)_

- [ ] **Storage bucket privacy (security follow-up).** Confirm the documents bucket is public or private; `getPublicUrl` hints it may be public (path-guessable PDF read). If public, switch to short-TTL signed URLs and move bucket policies into SQL migrations. Close before the content-hash storage work ships. _(readiness §5 #4)_

- [ ] **Low-severity security follow-ups.** Dev-server `debugFixturesPlugin` path traversal (2-line resolve+startsWith fix); `oauth:openWindow` redirectUri unvalidated (add a hard-coded origin allowlist; only exploitable post-XSS). _(readiness §5 #6)_

---

## STILL TO FILE — Decisions to make (each gates a phase)

- [x] **Archived-document migration policy** — DECIDED 2026-06-05: **migrate ACTIVE documents only** (user's call, against the recommendation to include all). Archived docs (incl. SE-011-ARCH's 388 marks, Package2-ARCH's 30) are NOT moved in the first pass. SAFEGUARD: the full pre-migration backup (KAL-260) preserves them, so they remain recoverable and can be pulled in later — they are not destroyed, just not carried across initially. _(gates the data bootstrap)_
- [x] **Where the server-side Yjs→flat-table projection runs** — DECIDED 2026-06-05 (Claude's technical call): **a small always-on Node service running Hocuspocus** (`onStoreDocument` persists the Yjs doc + projects to the flat table). Rationale: it's the standard, battle-tested Yjs-on-Postgres server, and a websocket server is the right foundation given mobile/web is on the roadmap (vs an Edge Function trigger, which is harder for live collaboration). _(gates the source-of-truth pivot)_
- [x] **Op-log table** — DECIDED 2026-06-05 (Claude's technical call): **create a fresh `annotation_updates` table** with clear columns + INSERT-only member RLS, and drop the empty deny-all `doc_yjs_updates`. Clean slate avoids the Phase-27 baggage and ambiguity. _(gates the op-log build, KAL-263)_
- [x] **Content-hash dedup scope** — DECIDED 2026-06-05: **per-project** — uniqueness key `(user_id, project_id, content_sha256)`. The same PDF in two projects stays two independent documents with independent marks (projects kept isolated). _(gates content-hash work, KAL-267)_
- [x] **Are the four Package 2 document rows distinct revisions or duplicates to consolidate?** DECIDED 2026-06-05 (Claude's technical call): **no manual consolidation** — they have different byte sizes, so they are genuinely different files and stay independent. Identical-byte copies (if any) merge automatically when content-hashing runs (KAL-267). _(gates data bootstrap)_
- [x] **Same-name/different-content behavior** — DECIDED 2026-06-05: **ask the user every time** (Windows/Mac style) — "keep both" (numbered name) or "replace" (SAFE = archive the old copy, never destroy marks). Build the collision modal + wire into both open paths (KAL-277).
- [ ] **Same-content/different-name aliasing** — (still open, lower priority) when bytes are identical but the name differs: reuse + offer to add the new name as an alias, or treat as new? Default for now: reuse the existing document. _(gates duplicate-upload UX)_
- [x] **Optimistic open vs await-the-doc-create** — DECIDED 2026-06-05 (Claude's technical call): **keep optimistic open** (no extra round-trip / spinner) and rely on the durable import queue (KAL-271) to cover the brief no-document-id window. Best perceived speed, and the durable queue makes it safe. _(gates the open path)_
- [x] **server_ts conflict ordering** — DECIDED 2026-06-05 (Claude's technical call): **yes, use Postgres `NOW()` as the authoritative order** over client clocks. Standard and correct; avoids Electron/mobile clock-skew bugs. _(gates op-log)_
- [x] **Cutover flag obsolete?** DECIDED 2026-06-05 (Claude's technical call): **yes — once Yjs is always authoritative, delete the `cutover_completed_at` flag + its whole branch** during Phase E cleanup. One read path, less complexity. _(gates Phase E cleanup)_
- [x] **Mobile/web log-upload story** — DECIDED 2026-06-05 (user): **phone/web log-upload IS wanted.** So: never bundle the token in any client; build a small server-side relay (a function/endpoint holding the token) that all platforms call. Desktop can use the gh CLI in the interim. This is now a build item, not just a note — fold into the secret-rotation work (KAL-258) so removing the bundled token doesn't drop a capability the user wants. _(gates the secret-rotation work)_

---

## STILL TO FILE — Excel ↔ Survey Marker sync, M365 era (added 2026-06-10; Linear still at its free-tier limit)

_Workstream state: blank-Row-ID matching fix + M365 buildout fully landed on local main (`b6e345d8`…`134cc523`, gates 1320/0/6, unpushed). Authority: `HANDOFF-excel-sync-next.md`, `PLAN.md` Amendment 2026-06-08(b), `.planning/blank-rowid-matching-verdict.md`._

- [ ] **M365 work-account live sync — live verification + writeback gate decision (HIGH, human-gated; the last Excel-sync blocker).** All code built and committed: system-browser sign-in (`2c5b475d`), business-eligibility-gated live sync with plain-English reasons (`0b0bd4b0`), business-Graph Row-ID single-cell writer + drain wired-but-dormant behind `LIVE_WRITEBACK_ENABLED=false` (`ded43508`), local closed-file Row-ID flush live (`08e4ebee`), read-only "verify live sync" probe (`c0101314`), integration suite (`134cc523`). Remaining, in order: (1) USER: Azure portal one-time change on app `0da81a9e-2b05-46ee-b826-5efc5114c765` — Mobile and desktop platform + `http://localhost` redirect + Allow public client flows; (2) USER: work sign-in (passkey/Authenticator — no password needed if org supports); (3) run the in-app verify-live-sync probe; (4) business OneDrive/SharePoint/Teams detection on a real work file; (5) live pull test; (6) Row-ID drain on a SCRATCH workbook; (7) DECISION: flip `LIVE_WRITEBACK_ENABLED` only after 1–6 pass; (8) push the ~165 unpushed commits. Watch items: legacy ETag fallback detector is not drive-scoped (`/me/drive` — SharePoint fallback may 404; sessions path is primary); standing vetoes — personal OneDrive can no longer enable live sync at all, Excel row deletions take effect one save later (delete-grace), positional stamps reset on every export until next import (accepted MVP residual).

- [x] **Excel-sync scenario test suite (item 7, MEDIUM).** _Done 2026-06-10, commit fa296bc2 — gap tests (excelScenarioGaps.test.mjs) + coverage index (docs/excel-sync-scenario-coverage.md); one open paste-above contract-drift sign-off item for Isaiah recorded in the index._ One suite covering: copied row, renamed row, deleted row, row moved across sheets, Excel open vs closed, personal OneDrive vs business OneDrive vs SharePoint/Teams — Graph and fs mocked at the boundary (pattern: `src/services/__tests__/excelM365Integration.test.mjs` from slice 5). Builds on the five locked blank-Row-ID examples already pinned in `excelBlankRowIdScenario.test.mjs`.

- [ ] **"Rows we couldn't place" review surface (item 10, MEDIUM).** Review entries with a null markerId (brand-new unmatched Excel rows with no app marker yet) have no Survey-panel row to attach their red icon to — they currently vanish from view. Needs a small list surface (e.g. at the top of the Survey panel) plus the existing plain-English vocabulary. Wire from `pendingImportReview` entries where `markerId == null`.

- [ ] **Desktop file-watcher EPERM on Desktop/Logs path (item 11, LOW bug).** The local watcher hits a harmless-but-noisy permission error on the Desktop/Logs path; investigate scope (likely macOS folder permissions) and silence or request access properly.

---

## STILL TO FILE — Unification / consolidation sweep (added 2026-06-10, per Isaiah)

_Already in Linear: KAL-81 (unify callouts with the main annotation model — Backlog) and KAL-125 (callout + survey-marker delete bypass the per-user ownership gate — Backlog). Authority: `docs/ANNOTATION-CONTRACT.md` (callout is the documented odd-one-out; unification is a dedicated migration, not piecemeal). The items below extend that same principle app-wide._

- [ ] **Callout unification (execute KAL-81 + KAL-125 together).** Callouts are just text-box annotations; move them onto the standard annotation contract (storage, ownership gate, styling flags, sync, undo/redo, delete authority). Run as ONE dedicated migration with before/after parity tests — the contract doc explicitly warns against piecemeal edits.
- [x] **Select-mode checkbox consistency audit.** _Done 2026-06-10, commit b30e3667 — report at .planning/optimization/SELECT-MODE-AUDIT.md; index-keyed-selection bug risk found; 3 open decisions for Isaiah._ Every list that enters select mode (Survey panel rows, pages panel, history, anywhere else) should use the same checkbox component, keyboard behavior, and select-all semantics. Audit first; unify only where they actually diverge.
- [x] **Drag-and-drop consolidation audit.** _Done 2026-06-10, commit 6377a33b — report at .planning/optimization/DND-CONSOLIDATION-AUDIT.md; slice plan posted to KAL-84; 3 open decisions for Isaiah._ Multiple drag-reorder/drag-drop implementations exist (Survey panel rows, templates editor, page thumbnails, file drop). Inventory them, confirm which share code, and consolidate onto one mechanism where divergence buys nothing. Audit-then-unify, same pattern.
- [ ] **General duplication sweep (standing).** When the loop touches an area, prefer consolidating duplicate spinners/tooltips/modals onto one implementation (KAL-65 tooltips and KAL-73 spinners already exist in Linear Backlog — fold into this principle). _Full-codebase sweep SNAPSHOT done 2026-06-10 (commit e0a50e85): .planning/optimization/DUPLICATION-SWEEP.md — 8 product clone families; 2 tractable slices queued (error-classifier merge; 3-way region-math consolidation); the principle itself stays standing._

---

## STILL TO FILE — UI parity + print/export finalization (added 2026-06-10, per Isaiah)

- [ ] **Match the PDF viewer UI to the homepage hub design language.** The homepage (Documents / Projects / Templates tabs) and the viewer use different palettes, possibly different fonts, and different density — Isaiah PREFERS the homepage's tighter spacing and smaller elements. Direction: bring the viewer toward the homepage look (palette, type, control density), not the other way. Big surface — slice it (toolbar/chrome first, then rails, then panels/modals); screenshot-driven before/after per slice.
- [ ] **Finish the custom print panel + export finalization.** _Step-1 audit done 2026-06-10 (cdad1af4): .planning/optimization/PRINT-EXPORT-STATE.md — panel built but flag-disabled, editable export UI-dark; build half blocked on 4 Isaiah decisions._ Per Isaiah the custom print panel and export surfaces were never finalized. Prior art: KAL-8 (print/export surface audit, Done) and KAL-7 (export scope decision: normal PDF export excludes survey/region/space overlays — GOVERNING). First step is a state-of-the-world audit of what exists vs what KAL-8 recommended, then finish the panel against the KAL-7 rules.

- [ ] **BL-22 — Survey category title can't be renamed/cleared (reverts).** Reported 2026-06-10: in survey mode with the security template, selecting the camera category and trying to delete/rename the title (e.g. "camera" → "C-1") fails — the original word reinstates itself on every delete. Likely applies to all category titles. Find the revert source (controlled input reset / sync overwrite / validation default), fix so a custom title sticks, cover with a test.

- [ ] **BL-23 — Templates editor: background template refresh wipes in-progress category renames.** Found 2026-06-10 during the BL-22 investigation (adversarially verified in code, not yet user-reported). In the home-tab Templates editor: (a) `reloadFromProps` re-runs on ANY identity change of the `templates` prop with no dirty guard (TemplatesEditor.jsx:818-834), discarding unsaved edits — including committed-but-unsaved category renames — whenever the host republishes templates (e.g. a viewer-side save/refetch); (b) clearing a category title and blurring leaves the field visibly empty while the model silently keeps the old name (`renameCategory`'s `if (!v) return`, line 1054), so the old word "reappears" at the next remount; (c) legacy categories without persisted ids get a fresh id every rebuild, guaranteeing input remounts mid-edit. Separate, event-driven data-loss bug — NOT the BL-22 per-keystroke revert (that was the marker name prompt, fixed e5321452). Fix direction: dirty guard on reloadFromProps + explicit empty-name feedback.
