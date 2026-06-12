# Plan Review Log: KAL-288 S2 privacy-regression tripwire (test-only, cap-free)

Started 2026-06-11 19:40 (autonomous loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL288-S2.md.
Codex session 019eb92a-8d70-79f1-8f35-58abb8212b67.

## Round 1 — Codex

6 findings, VERDICT: REVISE:
1. False green: survey-test in the allowlist lets the probe URL point at survey-test and pass while prod is public — prod host only.
2. False green: gates don't prove the new test actually RAN (file was missing from test:integration at review time) — require an output/name check or dedicated script.
3. False red: running beside phase27 means a paused survey-test project fails the run though prod privacy is fine — dedicated script.
4. Secret gap: host check without protocol check lets `http://` pass — require https + exact origin.
5. Secret gap: default redirect-follow can re-send the custom apikey header cross-origin — `redirect:'manual'` for authenticated requests; follow only the anonymous probe.
6. False red / spec drift: newest-5 orphan burst fails the tripwire though the bucket may be private — search broader before failing.

### Claude's response

ACCEPTED all 6 → plan r1 + implementation updated: (1) allowlist production-only with a
comment explaining why survey-test is excluded. (2) file in `test:integration` AND the live
gate checks the test name appears as `ok` in run output. (3) new `npm run test:privacy`
script runs only the tripwire file. (4) guard enforces `https:` + exact allowlisted
`URL.host` (port-inclusive). (5) service-key requests `redirect:'manual'` (3xx → non-ok →
loud fail); only the anonymous probe follows redirects, any 2xx after the chain = red.
(6) sample widened to newest 15; none-of-15-verifiable still FAILS deliberately (a tripwire
that skips when it cannot certify is a false-green channel; pre-committed in plan r1).

Live evidence at resubmission: `npm run test:privacy` vs production GREEN (3/3 pass, 1.3s —
flag `public:false`, newest object existence-verified 206, anonymous public-route non-2xx);
unit suite 1615 tests / 1600 pass / 0 fail / 15 skipped (tripwire = the 1 added skip).
Honest limit: the red direction (bucket actually public) cannot be exercised against
production — failure direction verified by code review only.

## Round 2 — Codex (plan r1 + implementation + live evidence)

2 findings, VERDICT: REVISE — both doc drift, logic explicitly cleared ("actual test
logic/package scripts look good against accepted findings"):
1. Plan r1 body still carried stale r0 text (survey-test in guard section, limit 5,
   test:integration as the live gate).
2. Test-file header comment still pointed at test:integration as the real-run path.

### Claude's response

ACCEPTED both: plan body de-drifted in all three sections + deliverable 2; test header
comment now names `test:privacy` first. Live re-run after edits GREEN (3/3).

## Round 3 — Codex

1 finding, VERDICT: REVISE: the skip-reason STRING still said integration tests only run
via `npm run test:integration` — stale operator guidance.

### Claude's response

ACCEPTED: skip message now reads "run this tripwire via `npm run test:privacy` (or `npm run
test:integration`)". Verified both directions post-edit: live run GREEN (3/3 pass); without
SUPABASE_INTEGRATION the test SKIPs printing the new message verbatim.

## Round 4 — Codex

No findings. **VERDICT: APPROVED.**

### Claude's response

Converged in 4 rounds. Final gates: `npx vite build` clean; full unit suite 1615 tests /
1600 pass / 0 fail / 15 skipped (tripwire = the 1 added skip; baton baseline was 1589 and
prior session observed 1606 — counts keep growing from parallel sessions, zero failures
throughout); `npm run test:privacy` live vs production GREEN 3/3 in ~1.3s. `git log`
checked after every Codex round — no unauthorized commits. Committing locally only.
