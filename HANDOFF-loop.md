# Loop Baton — Survey queue (scheduled sessions read this FIRST)

**active_since:** none
**session_title:** pick next from board (cap RESET — code work allowed again)
**last_session_ended:** 2026-06-10 ~15:15 (BL→Linear migration finished + BL-17 S1 plan approved; wound down at context budget)
**code-change cap used:** 0 of 6 — RESET 2026-06-10 ~18:40 by the interactive session: Isaiah completed a passing testing pass (marker naming popup ✓ with cosmetic follow-up [placeholder → "Enter Name", landed 9bcde724], templates editor refresh survival ✓, region/shape drawing ✓). Fleet code work is un-paused. (Previous count had reached 6/6: KAL-82 slice 1, BL-19 D1, BL-19 D2, BL-22, BL-23, KAL-82 slice 2.)

## Session title protocol
Keep the session_title field current at ALL times: set it to the task id + short slug the moment you start a task (e.g. "BL-22 title-rename bug"), prefix "continue: " if you are resuming a parked task, and at wind-down set it to the next recommended task (or "pick next from board"). The scheduler names the next session from this field.

## Overlap lock protocol
On session start: if active_since is a timestamp younger than 90 minutes, EXIT immediately (another session is live). Otherwise write the current timestamp into active_since, work, and on wind-down set it back to "none" and update last_session_ended.

## The loop rules (follow exactly)

Work the Survey queue one task at a time in /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2. Queue sources: the Obsidian board "/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/Task Boards/Survey/_Board.md" (including Backlog section) and the Linear project "Survey".

TASK SELECTION (Isaiah away): prefer (1) test suites / regression coverage, (2) audit-only tasks producing a written report + slice plan, (3) small self-contained bug fixes with automated verification. SKIP: viewer-file breakup, collaboration, renderer swap, M365 live verification, production DB/deploys, anything needing a product/UI decision — write the blocker into the Linear ticket + Obsidian file and move on. KAL-258 token rotation stays untouched (standing instruction).

PER TASK: verify it's still real in the app; plan; Codex adversarial plan review until approved; build gated on `npx vite build` + `node scripts/run-node-tests.mjs` (baseline at this wind-down: 1390 tests / 1384 pass / 0 fail / 6 skipped); Codex result review until converged; commit locally (NEVER push); mark done in BOTH Linear and the Obsidian issue file (check off board, append Status log); message Isaiah a one-line plain-English summary. Respect governing docs (PLAN.md amendments, ANNOTATION-CONTRACT.md, CLAUDE.md high-risk rules, handoffs); never re-open settled decisions. Log session moments per PSMM.

CONTEXT BUDGET (hard rule): check remaining context after every task. At 50% remaining or less: finish/park the current task cleanly, rewrite this baton (state, cap count, in-flight notes, next recommendation), set active_since to none, message Isaiah, and END the session. Do not idle.

IDLE RULE: when no eligible tasks remain, write the wind-down summary into this file, set active_since to none, and END the session — no heartbeating.

CAP: audits/test-only work doesn't count; after 6 completed code-change tasks total (5 now used), do test/audit-only work until Isaiah confirms testing.

## In-flight / next recommendation

Nothing in flight. This session (2026-06-10 14:07–15:15) did two things:

**1. Finished the BL→Linear migration (the queued first admin task).** A prior 12:11 session created Linear issues KAL-280…KAL-297 then DIED mid-migration. This session verified all 18 existed (created none — no duplicates), attached all to the Survey project (they had none, so the loop's queue source couldn't see them), closed KAL-296 (was BL-22, already fixed) with comment, set KAL-295 In Progress (was BL-21), renamed the 17 open board files BL-NN→KAL-NNN with proper frontmatter (was_backlog preserves lineage), restructured _Board.md (overflow graduated into Open lists; done BLs under Recently closed; BL-19 under Standing practices), stamped the repo backlog file MIGRATED/historical (94c02b73). Cross-check clean: 74 open Linear Survey issues == 74 board lines == files. **Linear is canonical again — work from Linear + the board, NOT BACKLOG-not-yet-in-linear.md.**

**2. BL-17 S1 planned to execution-readiness (plan-only, cap-free).** PLAN-BL17-S1.md: re-key bulk selection by stable ids in ProjectsFolderTree (files) + TemplatesEditor (modules); derived visible reads; zero-match bail before mutateTpl (never dirty on no-op); module-selection clear on working-copy rebuild (BL-23 occurrence-shift corner makes id-keying alone insufficient). Codex-approved round 3/5 (PLAN-BL17-S1-REVIEW-LOG.md), committed f0b17cb9, filed as **KAL-298** — execute when a cap slot frees. Review fact-check surfaced a NEW bug, filed **KAL-299**: projects-tree file Duplicate/Move-Copy are local-only (no host persistence; Delete does persist) — needs Isaiah's intent call before fixing.

Good next candidates (cap-free only until Isaiah confirms testing): **KAL-92 browser-repro arm** (idle-disappearance browser regression — agent-cli scripts exist, check repro-sleep-wake.mjs), more scenario/regression tests from the Linear board (KAL-74/KAL-75 e2e candidates if drivable via agent-cli), or audit work. KAL-298 is the FIRST cap task once testing is confirmed. Baseline 1390 tests / 1384 pass / 0 fail / 6 skipped. Decisions queue for Isaiah keeps growing (now + KAL-299 intent, see board Status logs) — do not attempt those. KAL-258 stays untouched.
