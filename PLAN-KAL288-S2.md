# PLAN — KAL-288 S2: storage privacy regression tripwire (test-only, cap-free) — r1

**r1 changes (Codex round-1 findings, all 6 accepted):** (1) allowlist is PRODUCTION-ONLY —
survey-test removed; a green run against survey-test guards nothing and reads as false
assurance. (2)+(3) dedicated `npm run test:privacy` script added (tripwire file only) so a
paused survey-test project cannot turn the privacy gate red; file stays in `test:integration`
too; the live gate verifies the test NAME appears as `ok`/pass in the run output, not just
exit 0. (4) guard requires `https:` and exact allowlisted host (URL.host includes the port,
so nonstandard ports are rejected). (5) service-key requests use `redirect:'manual'` — a
cross-origin redirect would re-send the custom apikey header; only the anonymous probe
follows redirects (a redirect chain ending 2xx = exposed = red). (6) sample is newest 15
rows, not 5 — an orphan burst among recent uploads must not fail the tripwire while a
verifiable object exists; NONE-of-15-verifiable still FAILS (a tripwire that skips when it
cannot certify is itself a false-green channel).

**Date:** 2026-06-11 · **Session:** autonomous loop · **Scope:** test-only (cap-free per
baton rules). Parent: `.planning/optimization/KAL-288-BUCKET-PRIVACY-REPORT.md` §Slice plan
S2. Goal: a dashboard toggle of the `documents` bucket `public` flag becomes a RED test
instead of a silent exposure.

## Deliverables

1. `tests/storagePrivacyTripwire.test.mjs` — new integration test, self-contained guard,
   conditional-skip pattern per KAL-257 §2.5 (missing env SKIPS, never fails).
2. `package.json` — append the new file to the `test:integration` file list AND add the
   dedicated `test:privacy` script (infra file; two minimal script-block lines, documented
   here as the why).
3. `.env.test.example` — document the two new env vars.
4. Local `.env.test` (gitignored) gets the production values so the tripwire is actually
   exercised this session; values sourced from the existing local `.env` /`.env.local`
   (`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — never committed, never in argv.

## Why production is allowed here (and why that is safe)

The privacy risk lives on the PRODUCTION bucket — a tripwire pointed only at survey-test
guards nothing. Unlike the phase27 tests (which INSERT rows and structurally exclude prod),
this test is **read-only by construction**: every request is an HTTP GET issued via Node
`fetch` (keys in headers, never argv/spawn), all object probes carry `Range: bytes=0-0`
(≤1 byte of PDF content moves). No supabase-js client is created; there is no code path that
could write. This matches the no-prod-writes memory and the KAL-288 audit method exactly.

## Guard (own logic, NOT tests/phase27/integrationEnv.mjs — that one excludes prod by design)

Skip (with reason) unless ALL hold:
- `SUPABASE_INTEGRATION === '1'` (so plain `npm test` always records a skip — baseline-safe);
- `SUPABASE_PRIVACY_PROBE_URL` is `https:` and its exact `URL.host` (port-inclusive) is in
  a hardcoded allowlist containing ONLY `cvamwtpsuvxvjdnotbeg.supabase.co` (production —
  GET-only test, see above). Survey-test is deliberately NOT allowlisted (r1 finding 1: a
  green run there is false assurance). The allowlist prevents the service key from being
  sent to a typo'd/arbitrary host;
- `SUPABASE_PRIVACY_PROBE_SERVICE_KEY` present.

Distinct var names (not `SUPABASE_TEST_URL`) so the phase27 survey-test guard and this prod
probe can coexist in one `.env.test` without cross-contamination.

## Assertions (conclusions pre-committed)

**A — flag tripwire:** `GET /storage/v1/bucket/documents` (service key headers) must return
200 AND `public === false`. A 404 (bucket renamed/deleted) FAILS — the tripwire must not
silently pass when it can no longer see the thing it guards. `public: true` FAILS (the
regression this test exists for).

**B — behavior tripwire (flag could lie; behavior is truth):**
1. Sample newest ≤15 `documents.file_path` via GET-only PostgREST
   (`?select=file_path&order=created_at.desc&limit=15`; on query error retry once without
   `order` — column-shape tolerance). 15, not 5, per r1 finding 6.
2. 0 rows → sub-test SKIPS with reason (legitimate on a fresh test project; assertion A has
   already run). Missing DATA ≠ missing ENV, but an empty table cannot be probed.
3. Existence gate: for each sampled path, service-key GET on
   `/storage/v1/object/authenticated/documents/<path>` with `Range: bytes=0-0`; 200/206 =
   exists. First verified path proceeds. Rows exist but NONE verify → FAIL with diagnostic
   (anomaly: every sampled row orphaned — tripwire cannot certify; aligns with the known
   single-orphan side-find which only affected the OLDEST row, newest rows verified 206 in
   the audit).
4. Anonymous probe on the verified path: `GET /storage/v1/object/public/documents/<path>`
   with ZERO headers (truly anonymous, the exact route `getPublicUrl()` builds, confirmed
   against storage-js source in the audit), `Range: bytes=0-0`, redirects followed →
   assert `!res.ok` (any 2xx after redirects = anonymously readable = FAIL, regardless of
   flag).

## Hygiene

- `file_path` URL-encoded per segment (`split('/').map(encodeURIComponent).join('/')`) —
  slashes stay separators, matching SDK URL construction.
- Every assertion/log message masks paths (first 6 + last 10 chars, audit convention);
  no full owner UUID / content sha in any output.
- Each fetch gets `AbortSignal.timeout(15000)`; network failure with env set FAILS loudly
  (same posture as phase27 — a paused/unreachable project is a real signal once you opted
  into integration runs).

## Gates (in order, before commit)

1. `npx vite build` clean.
2. `node scripts/run-node-tests.mjs` — new test must show as SKIP, zero failures, count
   grows by the new tests only; restate observed numbers.
3. Live run: `npm run test:privacy` (dedicated script — tripwire file only, decoupled from
   phase27/survey-test health per r1 findings 2+3) with prod probe vars in local `.env.test`
   — must PASS green against production (GET-only), verified by the test NAME appearing as
   `ok` in the run output, not just exit code 0. The file also stays in `test:integration`
   so integration runs exercise it too.
4. Codex result review until converged; one local commit (never push); both boards updated
   (Linear flip pending per baton).

## Out of scope

S1 (dead fallback removal — code change, cap/ack gated), S3 (policies into migrations —
Isaiah-run), any bucket/dashboard change, any write to any Supabase project.
