# Loop Baton — Survey queue (scheduled sessions read this FIRST)

**active_since:** none
**session_title:** KAL-92 browser-repro arm (idle-disappearance regression)
**last_session_ended:** 2026-06-10 ~17:00 (KAL-298 + KAL-302 both executed, reviewed, committed; wound down at context budget)
**code-change cap used:** 2 of 6 — KAL-298 (id-keyed bulk selection, 71a82125) and KAL-302 (rename-activation id-keying, 9183e7c9), both this session after the 18:40-stamped cap reset.

## Session title protocol
Keep the session_title field current at ALL times: set it to the task id + short slug the moment you start a task (e.g. "BL-22 title-rename bug"), prefix "continue: " if you are resuming a parked task, and at wind-down set it to the next recommended task (or "pick next from board"). The scheduler names the next session from this field.

## Overlap lock protocol
On session start: if active_since is a timestamp younger than 90 minutes, EXIT immediately (another session is live). Otherwise write the current timestamp into active_since, work, and on wind-down set it back to "none" and update last_session_ended.

## The loop rules (follow exactly)

Work the Survey queue one task at a time in /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2. Queue sources: the Obsidian board "/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/Task Boards/Survey/_Board.md" (including Backlog section) and the Linear project "Survey".

TASK SELECTION (Isaiah away): prefer (1) test suites / regression coverage, (2) audit-only tasks producing a written report + slice plan, (3) small self-contained bug fixes with automated verification. SKIP: viewer-file breakup, collaboration, renderer swap, M365 live verification, production DB/deploys, anything needing a product/UI decision — write the blocker into the Linear ticket + Obsidian file and move on. KAL-258 token rotation stays untouched (standing instruction).

PER TASK: verify it's still real in the app; plan; Codex adversarial plan review until approved; build gated on `npx vite build` + `node scripts/run-node-tests.mjs` (baseline at this wind-down: 1427 tests / 1421 pass / 0 fail / 6 skipped — note this grew from 1390 mid-day because Isaiah's interactive session landed tests; restate what you observe, don't assert this number); Codex result review until converged; commit locally (NEVER push); mark done in BOTH Linear and the Obsidian issue file (check off board, append Status log); message Isaiah a one-line plain-English summary. Respect governing docs (PLAN.md amendments, ANNOTATION-CONTRACT.md, CLAUDE.md high-risk rules, handoffs); never re-open settled decisions. Log session moments per PSMM.

CONTEXT BUDGET (hard rule): check remaining context after every task. At 50% remaining or less: finish/park the current task cleanly, rewrite this baton (state, cap count, in-flight notes, next recommendation), set active_since to none, message Isaiah, and END the session. Do not idle.

IDLE RULE: when no eligible tasks remain, write the wind-down summary into this file, set active_since to none, and END the session — no heartbeating.

CAP: audits/test-only work doesn't count; after 6 completed code-change tasks total (2 now used), do test/audit-only work until Isaiah confirms testing.

## In-flight / next recommendation

Nothing in flight. This session (2026-06-10 16:07–~17:00) completed two cap tasks:

**1. KAL-298 — id-keyed bulk selection (BL-17 S1) — DONE, landed 71a82125.** Executed the round-3-approved PLAN-BL17-S1.md exactly: new leaf helper src/home/selectionById.js (pickByIds/removeByIds/duplicateAfterByIds) + tests/selectionById.test.mjs; ProjectsFolderTree file selection / Move-Copy picks / file context menu keyed by document id with ALL toolbar reads derived from visible matches; TemplatesEditor module selection keyed by module id, zero-match bail before mutateTpl (no spurious dirty — BL-23 contract), renameModule commits by id, selMods cleared on working-copy rebuild. Verified twice: 3-lens adversarial workflow (its two real nits — raw-set spreads at toolbar Duplicate/Delete, twin-order test pin — applied and gates re-run) AND Codex result review (APPROVED, no findings). Full trail in PLAN-BL17-S1-REVIEW-LOG.md result section.

**2. KAL-302 — rename-activation id-keying — DONE, landed 9183e7c9.** Filed from KAL-298's verification (modRename/openMod still index-keyed) then executed same session: modRename now stores a module id (double-click, visibility predicate, addModule via hoisted id), and — Codex round-1 BLOCKING plan finding — rename mode exits on working-copy rebuild beside KAL-298's selMods clear (occurrence-shift hazard). openMod deliberately deferred (bigger surface; noted on the ticket — file separately if it bites). Codex plan APPROVED r2, result APPROVED no findings (PLAN-KAL302-REVIEW-LOG.md).

**Queued for Isaiah's live pass** (source-verified, not machine-proven — no jsdom infra): bulk file/module select survives reorder; rename input stays on the double-clicked module tab under drag-reorder; Add Module still opens rename on the new tab. Both tickets carry the details.

Good next candidates: **KAL-92 browser-repro arm** (idle-disappearance browser regression — agent-cli scripts exist, check repro-sleep-wake.mjs; mostly test work, cap-free), KAL-74/KAL-75 e2e candidates if drivable via agent-cli, or board audit work. Decisions queue for Isaiah unchanged (KAL-299 intent call, KAL-295's 4 print-panel decisions, KAL-290 aliasing). KAL-258 stays untouched. Cap has 4 slots left.
