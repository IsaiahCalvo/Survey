# Loop Baton — Survey queue (scheduled sessions read this FIRST)

**active_since:** none
**session_title:** Tier B item 1 — duplicate-upload handling + storage rekey (see MASTER-PLAN-2026-07-07.md section 3, Tier B #1; decision 6 in DECISION-BATCH-2026-07-07.md is locked, do not re-ask)
**last_session_ended:** 2026-07-08 01:40ish (interactive Isaiah-directed session: merged vibrant-chaplygin into local main, then FULL TIER A landed and PUSHED to production — decisions 1-5, 10, 11-companion, 3 rounds of Codex adversarial review, all findings fixed, verdict APPROVED. Commits 837ffebb..9b6a987f, pushed, Vercel deploy confirmed green by email, no Supabase/GitHub/Brevo alerts. Suite: 1869/1833/0/36. Also fixed pre-existing fabric 7.4.0 upgrade breakage that had been silently dropping custom props on canvas save (drawing tools had also been crashing on activation — fixed). NEXT PER MASTER-PLAN: Tier B item 1 (duplicate uploads + storage rekey), its own dedicated session, two adversarial review passes before done, land local only — do NOT push without Isaiah's ack. 846c052e/3d7ac395 were confirmed already on origin/main from an earlier push — nothing held back on those anymore.)
**KNOWN LIVE CONFLICT:** Isaiah started a separate background task ("Fix remaining fabric 7 upgrade hazards", task_f4f0145c) in another local session on this SAME checkout, still uncommitted as of 2026-07-08 01:40ish, touching FabricDrawingCanvas.jsx, FabricEditCanvas.jsx, FabricEraserCanvas.jsx, PdfjsViewerContainer.jsx, calloutAnnotationBridge.js, calloutEditAdapter.js, svgBoundingBox.js, and related tests, plus some home/ files. Before starting Tier B item 1: run `git status` — if those files are still dirty and not yet committed, wait for that task to finish and commit, or coordinate with Isaiah, rather than editing the same files or discarding that work.
**last_session_ended:** 2026-07-07 ~20:20 (scheduled session; user paused the automatic loop mid-task via crontab, no code changes made, nothing to gate/commit)
**last_session_ended:** 2026-07-07 ~17:20 (scheduled GOAL-queue session; completed GOAL work item 1 end-to-end, commit 08dfc9e1 local-only, DONE-AWAITING-PUSH — see GOAL-autonomous-post-launch.md log for the full record. Suite baseline at wind-down: **1845 tests / 1809 pass / 0 fail / 36 skipped** (HEAD-before was 1820/1784/0/36). Isaiah has been active in the repo (his SpacesPanel WIP landed; head was 333eb777) and something of his may be serving on localhost:5173 — future sessions use another port.)
**code-change cap used:** SUPERSEDED for the GOAL queue — the old 6-slot cap tracked pre-launch commits awaiting Isaiah's testing; that batch shipped to production with his approval 2026-07-02, and GOAL-autonomous-post-launch.md (his newest directive, "work items 1–3 unattended, no check-ins") replaces the cap with the never-push + DONE-AWAITING-PUSH mechanism. Ledger for history: 6 code tasks landed under the old cap era (KAL-298, KAL-302, KAL-75, KAL-304, KAL-303, GOAL-1/08dfc9e1). Tasks OUTSIDE the GOAL queue remain test/audit-only until Isaiah confirms.

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

This session (2026-07-07 16:07–~17:20, scheduled) completed **GOAL work item 1 — invite-email delivery** (commit `08dfc9e1`, local only, DONE-AWAITING-PUSH). Full record: GOAL-autonomous-post-launch.md log + PLAN-GOAL1-invite-email.md + PLAN-GOAL1-REVIEW-LOG.md (Codex plan APPROVED r4, result APPROVED; 2 adversarial subagent reviews NO BLOCKERS, 3 hardenings applied). Key state for the next session:

- **`send-invite-email` edge fn is DEPLOYED to prod** (additive; nothing live calls it until Isaiah pushes 08dfc9e1). Client swap + vercel.json deep-link fix are in the local commit only.
- **Prod deep links are BROKEN live right now** (pre-existing, all /invite/* emailed links blank-page from relative ./assets paths) — fixed in 08dfc9e1's vercel.json, takes effect on Isaiah's push. Don't re-diagnose.
- **Live email topology changed** (Isaiah did owner work): Brevo SMTP auth mailer + branded invite template + fixed site_url/allowlist. See memory reference_email_infrastructure.md. Never touch auth config.
- **Waiting on Isaiah (one-liners, messaged at wind-down):** did the Resend invite to his Gmail land (decides if mail.surveytool.app fallback is needed — owner dashboard step); push 08dfc9e1 when ready; optionally click the +survey-invite-a email to eyewitness the new-user flow after pushing.
- **Test artifacts in prod (intentional, disposable):** auth users isaiahcalvo123+survey-invite-a/-b@gmail.com; -b is a viewer collaborator on "Package 2 - Rev 4 -- IC.pdf"; several test invite rows on that document.
- **Flake watch:** tests/annotationDocSyncDurability.test.mjs "stale snapshot … tab-close flush pending" failed twice under parallel-suite CPU load (passes alone and in both final full runs; exists at HEAD too — NOT from this diff; from the 2026-07-07 morning sync session 846c052e/3d7ac395 area). If it reddens a future gate, rerun solo before blaming the diff.
- **Follow-ups filed, not built (see PLAN-GOAL1-invite-email.md §follow-ups):** send-email fn is an authenticated arbitrary-content relay (pre-existing) + free-tier invite gating is UI-only — good candidate for a future hardening slice; new-user invite emails carry no role/expiry copy (template limitation, cosmetic).
- **NEXT: GOAL work item 2 (design-polish backlog)** — palette unification (KAL-56/64/70/71/73, warm gold wins, pull real home-screen token values), empty-state redesign (KAL-58, design it yourself per the pre-made decision), KAL-59 remainder, KAL-63 copy-tone, KAL-72 confirm-dialogs. Note: Linear is unreachable from scheduled sessions — work from the vault ticket files and note "description may have drifted". UI work can't be Isaiah-eyeballed unattended: gate on build+tests+screenshot evidence (agent-driven browser) and mark DONE-AWAITING-PUSH like everything else.

Previous session (2026-06-11 19:35–~20:25) completed **KAL-288 S2 privacy-regression tripwire** (test-only, cap-free — cap stays 5 of 6; commit `9e7bb047`; Codex plan review APPROVED round 4, log `PLAN-KAL288-S2-REVIEW-LOG.md`; gates green: build clean, unit suite 1615/1600 pass/0 fail/15 skip — tripwire is the 1 added skip; live run vs production GREEN 3/3):

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
