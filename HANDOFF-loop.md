# Loop Baton — Survey queue (scheduled sessions read this FIRST)

**active_since:** none
**last_session_ended:** 2026-06-10 ~06:00 (overnight loop, wound down clean)
**code-change cap used:** 3 of 6 since Isaiah's last testing confirmation (KAL-82 slice 1, BL-19 D1, BL-19 D2)

## Overlap lock protocol
On session start: if active_since is a timestamp younger than 90 minutes, EXIT immediately (another session is live). Otherwise write the current timestamp into active_since, work, and on wind-down set it back to "none" and update last_session_ended.

## The loop rules (follow exactly)

Work the Survey queue one task at a time in /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2. Queue sources: the Obsidian board "/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/Task Boards/Survey/_Board.md" (including Backlog section) and the Linear project "Survey".

TASK SELECTION (Isaiah away): prefer (1) test suites / regression coverage, (2) audit-only tasks producing a written report + slice plan, (3) small self-contained bug fixes with automated verification (BL-22 category-title rename revert is a good candidate). SKIP: viewer-file breakup, collaboration, renderer swap, M365 live verification, production DB/deploys, anything needing a product/UI decision — write the blocker into the Linear ticket + Obsidian file and move on. KAL-258 token rotation stays untouched (standing instruction).

PER TASK: verify it's still real in the app; plan; Codex adversarial plan review until approved; build gated on `npx vite build` + `node scripts/run-node-tests.mjs` (baseline at last wind-down: 1355 pass / 0 fail); Codex result review until converged; commit locally (NEVER push); mark done in BOTH Linear and the Obsidian issue file (check off board, append Status log); message Isaiah a one-line plain-English summary. Respect governing docs (PLAN.md amendments, ANNOTATION-CONTRACT.md, CLAUDE.md high-risk rules, handoffs); never re-open settled decisions. Log session moments per PSMM.

CONTEXT BUDGET (hard rule): check remaining context after every task. At 50% remaining or less: finish/park the current task cleanly, rewrite this baton (state, cap count, in-flight notes, next recommendation), set active_since to none, message Isaiah, and END the session. Do not idle.

IDLE RULE: when no eligible tasks remain, write the wind-down summary into this file, set active_since to none, and END the session — no heartbeating.

CAP: audits/test-only work doesn't count; after 6 completed code-change tasks total (3 already used), do test/audit-only work until Isaiah confirms testing.

## In-flight / next recommendation
Nothing in flight. Good next candidates: BL-22 (title rename bug), KAL-92 browser-repro arm if automatable, remaining small KAL-82 dead-code slices (each is a code-change cap item). 7 decisions are queued for Isaiah across tickets (see board Status logs) — do not attempt those.
