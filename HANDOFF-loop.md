# Loop Baton — Survey queue (scheduled sessions read this FIRST)

**active_since:** none
**session_title:** pick next from HANDOFF-post-launch-push.md — invite-email routing investigation is scoped and ready to build (see that doc's "Do this first" section); design-polish backlog after that
**last_session_ended:** 2026-07-02 ~12:30 (MVP-wrapup interactive session wound down cleanly. Full product is LIVE on main/production, commit ea3d61b8, verified by fetching the real served bundle. Isaiah explicitly approved the production push. Wrote HANDOFF-post-launch-push.md as the entry point for whatever picks this up next — read it before touching anything. Owner-gated items (Stripe live, Microsoft/Excel) are explicitly parked, do not re-surface. Baseline: 1810 tests / 1726 pass / 0 fail / 84 skipped.)
**code-change cap used:** 5 of 6 — KAL-298 (71a82125), KAL-302 (9183e7c9), KAL-75 src guards+fixes (1838f3cf), KAL-304 (666f1c5f), KAL-303 (30c9bf53). KAL-287 + KAL-288 were cap-free audit work.

## Session title protocol
Keep the session_title field current at ALL times: set it to the task id + short slug the moment you start a task (e.g. "BL-22 title-rename bug"), prefix "continue: " if you are resuming a parked task, and at wind-down set it to the next recommended task (or "pick next from board"). The scheduler names the next session from this field.

## Overlap lock protocol
On session start: if active_since is a timestamp younger than 90 minutes, EXIT immediately (another session is live). Otherwise write the current timestamp into active_since, work, and on wind-down set it back to "none" and update last_session_ended.

## The loop rules (follow exactly)

Work the Survey queue one task at a time in /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2. Queue sources: the Obsidian board "/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/Task Boards/Survey/_Board.md" (including Backlog section) and the Linear project "Survey".

TASK SELECTION (Isaiah away): prefer (1) test suites / regression coverage, (2) audit-only tasks producing a written report + slice plan, (3) small self-contained bug fixes with automated verification. SKIP: viewer-file breakup, collaboration, renderer swap, M365 live verification, production DB/deploys, anything needing a product/UI decision — write the blocker into the Linear ticket + Obsidian file and move on. KAL-258 token rotation stays untouched (standing instruction).

PER TASK: verify it's still real in the app; plan; Codex adversarial plan review until approved; build gated on `npx vite build` + `node scripts/run-node-tests.mjs` (baseline at this wind-down: 1589 tests / 1575 pass / 0 fail / 14 skipped — restate what you observe, don't assert this number); Codex result review until converged; commit locally (NEVER push); mark done in BOTH Linear and the Obsidian issue file (check off board, append Status log); message Isaiah a one-line plain-English summary. Respect governing docs (PLAN.md amendments, ANNOTATION-CONTRACT.md, CLAUDE.md high-risk rules, handoffs); never re-open settled decisions. Log session moments per PSMM.

LINEAR ACCESS (discovered 2026-06-11 14:15): scheduled sessions currently CANNOT reach Linear — no MCP/CLI/API key on this machine, kapture fails with a cross-extension error, the Playwright profile is logged out (Google OAuth wall). Do NOT burn time retrying browser paths. Note "Linear flip pending" in the ticket file's Status log and move on; the vault board + issue files are the durable mirror. PENDING LINEAR FLIPS for Isaiah (or a future session with access): KAL-262 → Done, KAL-260 → Done, KAL-75 → Done (board label reconciled this session), KAL-287 → comment "investigation done, drops await owner", CREATE BL-24 in Linear (op-log silent append drop, High), KAL-288 → In Progress + comment "bucket confirmed private; S2 tripwire landed (9e7bb047); remaining = S1 (ack) + S3 (Isaiah)".

CONTEXT BUDGET (hard rule): check remaining context after every task. At 50% remaining or less: finish/park the current task cleanly, rewrite this baton (state, cap count, in-flight notes, next recommendation), set active_since to none, message Isaiah, and END the session. Do not idle.

IDLE RULE: when no eligible tasks remain, write the wind-down summary into this file, set active_since to none, and END the session — no heartbeating.

CAP: audits/test-only work doesn't count; after 6 completed code-change tasks total (5 now used), do test/audit-only work until Isaiah confirms testing.

## MVP-wrapup takeover progress (2026-07-01, branch claude/quirky-taussig-7fda28)

Long-running interactive launch push. LANDED + browser-verified this session
(all gated on clean build + node tests, ending baseline 1808/1724/0/84):
- **Browser export** of the annotated PDF (was desktop-only). Verified live:
  real download, 17 annotations baked into page 1. (fe85c5fb)
- **Project + template sharing** backend live on prod (project_invites,
  template_invites, template_collaborators, accept/resend/revoke RPCs,
  user_can_access_template) + closed live RLS gaps (projects SELECT via
  collaborators; documents/projects co-owner rename/delete; project→document
  flow-through). 17-step RLS smoke green on survey-test. (92b2d86b, migration
  20260701120000). Sharing UI made real end-to-end incl. the old decoy Manage
  Team modal. (77a7a9c3) Verified live: 2nd real account accepted a UI-minted
  project invite, 0→1 projects.
- **Viewer-role read-only gating**: get_my_document_role RPC (20260701130000) +
  ReadOnlyGate viewer trigger. Verified live: 2nd user (viewer) sees dimmed
  toolbar + "View-only access" banner; server-side viewer INSERT = 403.
  (fa66acd6, a483db27)
- **Account flows**: /reset-password page, resend-confirmation panel, verify
  current password. Verified live (reset invalid-state + signup check-email +
  resend cooldown). (4e2ffd4a)
- **Security**: bucket confirmed private; removed dead public-URL thumbnail
  fallback. (9b29417a)
- **Save-restore epic (KAL-254)**: reconciled A–F — forward reliability is
  done-by-rebuild + proven (yjs-roundtrip live). Built **BL-24** durable
  op-append fix (eager checkpoint on failed op + pagehide/visibility flush +
  sync-health signal, +3 tests) — under adversarial review, NOT yet committed.
  Landed KAL-274 lock-gate on annotation_updates (prod). (8d342346)
- **Linear**: KAL-254 confirmed Pre-MVP; KAL-61/288 → In Progress w/ comments;
  KAL-259/287/295 comments; BL-24 filed as KAL-316.
- **Owner blockers** written to OWNER-ACTIONS-BEFORE-LAUNCH.md (839b964b):
  Microsoft Azure app-reg + work sign-in (M365 live sync — the one true blocker
  on the core selling point), Stripe live-key flip, Supabase auth prod config
  (site_url still localhost:3000, no SMTP, empty redirect allowlist),
  2 secret rotations.

STILL OPEN (buildable, deferrable, or disposable): KAL-266 backfill of ~489
live + 418 archived pre-rebuild user-drawn marks (Isaiah's OWN test data —
app unpublished, disposable, NOT a real-user data-loss risk); KAL-267 atomic
upsert race; KAL-275 dead-code deletion (partly blocked by source-assertion
tests); KAL-277 same-name-upload UX modal.

## In-flight / next recommendation

This session (2026-06-11 19:35–~20:25) completed **KAL-288 S2 privacy-regression tripwire** (test-only, cap-free — cap stays 5 of 6; commit `9e7bb047`; Codex plan review APPROVED round 4, log `PLAN-KAL288-S2-REVIEW-LOG.md`; gates green: build clean, unit suite 1615/1600 pass/0 fail/15 skip — tripwire is the 1 added skip; live run vs production GREEN 3/3):

- **New test `tests/storagePrivacyTripwire.test.mjs`**: asserts the production `documents` bucket reports `public:false` AND an anonymous GET on the SDK-built public route is denied for an existence-verified object. A dashboard toggle to public is now a red test, not a silent exposure. Run via **`npm run test:privacy`** (needs `SUPABASE_PRIVACY_PROBE_URL` + `SUPABASE_PRIVACY_PROBE_SERVICE_KEY` in `.env.test` — populated locally this session, documented in `.env.test.example`); also wired into `test:integration`; plain `npm test` records it as a skip (KAL-257 §2.5 pattern).
- **Safety posture**: read-only by construction (GET + `Range: bytes=0-0` only, no supabase-js client), production-only https host allowlist (Codex r1 killed a real false-green — survey-test was originally allowlisted), service-key requests never follow redirects, masked paths in all output. Honest limit: the red direction (bucket actually public) is verified by code review only — can't flip prod to prove it.
- **Board/ticket updated**; KAL-288 remaining = S1 (dead thumbnail fallback removal — code change, cap/ack gated) + S3 (storage policies into SQL migrations — Isaiah-run).

**Next-pick assessment (board re-swept this session):** queue is THIN — no away-mode-eligible task remains. KAL-91's remaining regression fixture/test is blocked by Isaiah's edited-imported-marks policy decision (the export-resurrection test can't be written green before the fix direction is chosen). Everything else: awaiting Isaiah (KAL-279 live confirm, KAL-287 drops, KAL-291/295/299/290/266/BL-24 decisions/acks), burns the held last cap slot (KAL-285/282/84/82, BL-24), or is a skipped category (UI/product, viewer breakup, collab, renderer). Wind down immediately unless Isaiah has acted.

Previous session (18:08–~18:50) completed **KAL-288 storage-bucket-privacy confirmation** (cap-free read-only audit; Codex plan+report APPROVED round 2, log PLAN-KAL288-REVIEW-LOG.md; gates green: build clean, tests 1606/1592 pass/0 fail/14 skip — count grew from 1589, zero failures):

- **Bucket is PRIVATE — ticket fear unfounded.** `public:false` live; on existence-verified objects (service-key Range GET 206) all three anonymous routes 400 (public URL, SDK download route, authenticated route — routes byte-verified against storage-js source). Only ONE bucket exists in the project. `getPublicUrl()` is client-side string concat — it never proved anything about the flag.
- **Re-scoped remainder (3 human-gated slices in `.planning/optimization/KAL-288-BUCKET-PRIVACY-REPORT.md`):** S1 delete/sign the dead PdfPageThumb public-URL fallback (code change — cap/ack gated); **S2 privacy-regression tripwire integration test (cap-free — NEXT RECOMMENDED PICK, KAL-257 §2.5 conditional-skip pattern, survey-test or prod GET-only)**; S3 storage policies into SQL migrations (Isaiah-run).
- **Side-find:** ≥1 `documents` row references a storage object that does not exist (oldest sampled path; orphaned row). Folded toward KAL-286/KAL-267 hygiene scope — no new ticket filed.
- **Pending Linear flips add:** KAL-288 → In Progress + comment "bucket confirmed private; remaining = S1/S2/S3".

Previous session (16:07–~17:10) completed **KAL-287 dead-table disposition + doc_yjs_updates investigation** (cap-free audit, commit `a269cb11`, Codex plan+report APPROVED r4, log PLAN-KAL287-REVIEW-LOG.md, gates green 1589/1575/0/14):

- **doc_yjs_updates = 0 answered: SUPERSEDED, not data loss.** No writer was ever shipped (Phase 27 schema-only → Phase 28 RLS-but-no-writer → 2026-06-06 rebuild created `annotation_updates` as the real op log). The rebuild WAL is LIVE: 339 rows / 4 docs; latest write 15:54Z, minutes before the audit — **someone (probably Isaiah) appeared to be actively using the app during this session.**
- **Disposition matrix + human-gated slice plan**: `.planning/optimization/KAL-287-DEAD-TABLES-REPORT.md`. Droppable: survey_presence, survey_sync_log, excel_schema_mapping (4 stale rows — off-repo export REQUIRED first), legacy `annotations` (schema capture REQUIRED — no CREATE TABLE in history), doc_yjs_updates (+trigger fn +policies). activity_log = Isaiah decision. NOT droppable: survey_sessions/survey_items (live kal48 version-history RPCs DML them unconditionally — defer to a kal48-rewrite slice). All drops are Isaiah-run SQL with a pg_depend pre-check (expected-vs-unexpected dependent rules in §7).
- **Side-finds**: (1) **BL-24 filed (High, not in Linear)** — op-log append failures are silently dropped (console-only; snapshot is only a partial backstop); fix slice is written on the ticket but needs Isaiah's ack + the adversarial-verify-realtime protocol — deliberately NOT fixed (last cap slot held + app in live use). (2) kal307 + kal313 migrations committed but NOT deployed to production (`supabase db push` pending — Isaiah). (3) Old audit's claim "survey_sessions in realtime publication" is wrong — only survey_items + survey_presence are.

**Eligibility notes for the next away-mode session:** KAL-288 S2 is DONE. The queue remains THIN — see the next-pick assessment above: nothing is away-mode eligible until Isaiah acts (confirms testing to reset the cap, makes the queued decisions, or green-lights BL-24/KAL-288-S1 with an ack). If nothing has changed: wind down immediately per the idle rule.

**22:10 re-sweep (idle exit, no work done):** board folder unchanged since the 20:20 wind-down write; git log unchanged (head 2b997257); no Isaiah acks/decisions found. NEW HAZARD for future sessions: Isaiah has a large live uncommitted rework in progress (src/sidebar/SpacesPanel.jsx ~900 lines churned, styles.css +240, BookmarksPanel/SearchTextPanel touched; mtimes 22:02, renderer console log active). Any future session that commits MUST stage explicitly (never `git add -A` / `git commit -a`) and must not edit those four files until his WIP lands.
