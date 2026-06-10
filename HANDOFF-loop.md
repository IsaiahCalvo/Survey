# Loop Baton — Survey queue (scheduled sessions read this FIRST)

**active_since:** none
**session_title:** BL-23 templates-editor rename wipe
**last_session_ended:** 2026-06-10 ~09:01 (BL-22 fixed and committed, wound down clean at context budget)
**code-change cap used:** 0 of 6 — RESET 2026-06-10 ~18:40: Isaiah completed a passing testing pass (marker naming popup ✓ with one cosmetic follow-up [placeholder → "Enter Name", being fixed], templates editor refresh survival ✓, region/shape drawing ✓). Fleet code work is un-paused. (Previous count had reached 6/6: KAL-82 slice 1, BL-19 D1, BL-19 D2, BL-22, BL-23, KAL-82 slice 2.)

## Session title protocol
Keep the session_title field current at ALL times: set it to the task id + short slug the moment you start a task (e.g. "BL-22 title-rename bug"), prefix "continue: " if you are resuming a parked task, and at wind-down set it to the next recommended task (or "pick next from board"). The scheduler names the next session from this field.

## Overlap lock protocol
On session start: if active_since is a timestamp younger than 90 minutes, EXIT immediately (another session is live). Otherwise write the current timestamp into active_since, work, and on wind-down set it back to "none" and update last_session_ended.

## The loop rules (follow exactly)

Work the Survey queue one task at a time in /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2. Queue sources: the Obsidian board "/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/Task Boards/Survey/_Board.md" (including Backlog section) and the Linear project "Survey".

TASK SELECTION (Isaiah away): prefer (1) test suites / regression coverage, (2) audit-only tasks producing a written report + slice plan, (3) small self-contained bug fixes with automated verification. SKIP: viewer-file breakup, collaboration, renderer swap, M365 live verification, production DB/deploys, anything needing a product/UI decision — write the blocker into the Linear ticket + Obsidian file and move on. KAL-258 token rotation stays untouched (standing instruction).

PER TASK: verify it's still real in the app; plan; Codex adversarial plan review until approved; build gated on `npx vite build` + `node scripts/run-node-tests.mjs` (baseline at this wind-down: 1368 tests / 1362 pass / 0 fail / 6 skipped); Codex result review until converged; commit locally (NEVER push); mark done in BOTH Linear and the Obsidian issue file (check off board, append Status log); message Isaiah a one-line plain-English summary. Respect governing docs (PLAN.md amendments, ANNOTATION-CONTRACT.md, CLAUDE.md high-risk rules, handoffs); never re-open settled decisions. Log session moments per PSMM.

CONTEXT BUDGET (hard rule): check remaining context after every task. At 50% remaining or less: finish/park the current task cleanly, rewrite this baton (state, cap count, in-flight notes, next recommendation), set active_since to none, message Isaiah, and END the session. Do not idle.

IDLE RULE: when no eligible tasks remain, write the wind-down summary into this file, set active_since to none, and END the session — no heartbeating.

CAP: audits/test-only work doesn't count; after 6 completed code-change tasks total (4 now used), do test/audit-only work until Isaiah confirms testing.

## In-flight / next recommendation

Nothing in flight. This session (2026-06-10 08:26–09:01) closed **BL-22**: the "category title rename reverts" report was actually the marker Name Prompt Modal's controlled input with a falsy default fallback (PDFViewer.jsx ~32240) — fixed with a null-sentinel + extracted commit resolver (src/utils/surveyMarkerNamePrompt.js), select-on-open, deletion-path stale-input clear; 13 new tests in tests/surveyMarkerNamePromptContract.test.mjs; Codex plan review 4 rounds APPROVED + result review APPROVED; commit e5321452 (plus 86e1c176 docs). PLAN-BL22.md / PLAN-BL22-REVIEW-LOG.md in repo are the argument record. NOTE: PLAN.md (root) is the governing Excel-sync contract — never overwrite it for plan-review loops; use task-scoped PLAN-<id>.md files.

Good next candidates: **BL-23** (new, found during BL-22: TemplatesEditor reloadFromProps wipes unsaved category renames on templates-prop churn — small self-contained fix, code-change cap item, full detail in BACKLOG-not-yet-in-linear.md), KAL-92 browser-repro arm if automatable, remaining KAL-82 dead-code slices (Dashboard.jsx orphaned template-modal editing paths at lines ~141/1968-2906 were confirmed unrendered during the BL-22 investigation — a ready KAL-82 slice). 7+ decisions queued for Isaiah across tickets (see board Status logs, BL-22 follow-ups: name-prompt cancel semantics, IME Enter guard) — do not attempt those.
