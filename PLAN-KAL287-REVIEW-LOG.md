# Plan Review Log: KAL-287 dead-table disposition + doc_yjs_updates investigation (audit-only)
Started 2026-06-11 16:10 (autonomous loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL287.md.

## Round 1 — Codex
10 findings, VERDICT: REVISE:
1. survey_items/survey_sessions live via kal48 RPCs (documentRevisionService → RevisionsPanel) — zero rows/src-refs ≠ safe to drop.
2. Publication claim stale: 20241230000001 adds only survey_items + survey_presence, not survey_sessions.
3. doc_yjs_updates investigation missed Phase 28 (20260504000000): real RLS + validate_origin trigger — deny-all stubs do NOT explain zero rows.
4. crdtUndoManager doc_yjs_updates refs are comment-only — don't classify as live usage.
5. Read-only counts can't prove safe-to-drop — require human SQL dependency check (functions/views/policies/triggers/FKs/publications/grants).
6. Drop slices must explicitly forbid CASCADE (could silently remove live kal48 functions).
7. Alias grep set underspecified — add highlight_id/annotation_id, ball_in_court_*/entity_*, camelCase, JSON keys, mocks/fixtures, SQL function bodies.
8. Zero-row annotation_updates/annotation_snapshots ambiguity — don't infer from aggregate counts alone.
9. Workbook table name wrong: actual is excel_workbook_registrations (kal307).
10. activity_log needs server-side-writer sweep (edge functions) + Phase-33 dependency check.

### Claude's response
ACCEPTED all 10. Notes: findings 1, 3, 4 had already been independently confirmed in this session's groundwork before the review returned (RevisionsPanel mount chain; Phase-28 RLS/trigger read; comment-only lines 29/323). Finding 8 resolved with live evidence rather than plan wording alone: annotation_updates is NOT zero — 339 rows, first 2026-06-07, latest 2026-06-11 15:54 UTC, max seq 451 (compaction-consistent gaps); per-document recency breakdown promised in the report. Finding 9 verified: correct name excel_workbook_registrations, REST probe under the correct name confirms absent in prod (committed-not-deployed); kal313 creates no table (alters document_history_events). Plan rewritten (r1): couplings section, widened alias sweep incl. SQL function bodies + rename-era tokens, mandatory pg_depend pre-drop SQL for Isaiah, CASCADE forbidden with stop-on-dependency-error rule, publication ledger with adds+drops and live-verification SQL, Phase-28 timeline in the yjs investigation, activity_log edge-function + Phase-33 gates.

## Round 2 — Codex
3 findings, VERDICT: REVISE:
1. annotation_updates seq-gap "snapshot-compaction pruning" inference is wrong — code only upserts snapshots, nothing prunes the WAL; gaps fit identity burns / deleted-doc cascades.
2. Legacy `annotations` drop under-specified — RLS migrations exist but NO CREATE TABLE in history; live schema capture required before any drop.
3. Don't commit production row contents verbatim in the report — keep rollback data off-repo.

### Claude's response
ACCEPTED all 3. (1) Report §2 rewritten: gaps attributed to deleted-doc cascades + GENERATED ALWAYS AS IDENTITY burning seqs on failed/conflicted inserts — explicitly flagged as a rough ceiling on §5.1 append-failure frequency, removing the compaction claim. (2) Q0 now REQUIRED before Slice A and includes information_schema.columns + pg_indexes + pg_constraint capture for public.annotations; Slice A rollback note states the Q0 capture is the only source of that schema. (3) Report §6 stripped of row contents (counts/dates/ownership only); exports directed to ~/SurveyBackups/kal287/ per the KAL-260 pattern. Plan updated to r2 (same corrections mirrored).

## Round 3 — Codex (plan + report combined)
2 findings, VERDICT: REVISE:
1. PLAN-KAL287.md live-evidence table still carried the stale r1 "snapshot-compaction pruning" wording for the annotation_updates seq gaps.
2. Report Q2 stop rule too blunt — "non-empty result = STOP" would stop every drop, since each candidate has expected table-owned policies/triggers/indexes/FKs.

### Claude's response
ACCEPTED both. (1) Plan table row corrected to the r2 explanation (deleted-doc cascades + burned identity values; nothing prunes the WAL). (2) Report §7 rules rewritten: expected-own-objects (the §4 "DB-side dependents" column, incl. FKs from same-slice tables) are explicitly NOT stop signals; STOP only on UNEXPECTED dependents (unlisted functions, any view, FK from a non-slice table, unaccounted publication membership). Gates run meanwhile: vite build clean, node tests 1589/1575 pass/0 fail/14 skipped (= baseline). Resubmitting r3.

## Round 4 — Codex
VERDICT: APPROVED. One non-blocking note: KAL-307 "5 days old/live" label stale vs the same report's correct not-deployed statement.

### Claude's response
Label fixed in both files (migration dated 2026-06-11, deploy pending). PLAN + REPORT FINAL (approved r4). The report is the deliverable — no code changes were made, so no separate result review applies beyond this combined plan+report convergence.
