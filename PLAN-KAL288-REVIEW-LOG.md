# Plan Review Log: KAL-288 storage-bucket-privacy audit (read-only, cap-free)

Started 2026-06-11 18:12 (autonomous loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL288.md.
Codex session 019eb8be-7500-7e62-8329-54db756c206c.

## Round 1 — Codex

9 findings, VERDICT: REVISE:
1. False-private risk: one arbitrary `documents.file_path` not proven to exist in storage — "400/404 → closed" invalid without a service-auth existence check + multiple sample paths.
2. P3/P4 full GETs may download PDF bytes — use HEAD or `Range: bytes=0-0`; treat 200/206 as readable.
3. P4 probed `/object/authenticated/...` but the app's `download()` uses a different route — prove the probed route matches runtime SDK behavior.
4. Anon-key denial over-claimed as RLS validation — it proves only that anon is denied, not that owner/collaborator access works.
5. No conflict matrix — `public=true`+404 and `public=false`+200 need pre-committed conclusions; 200 proves anonymous readability regardless of flag.
6. Scope contradiction — "ZERO writes" vs report/ticket/board/commit deliverables; board update needs explicit gating language.
7. Secret/data-leak gap — env-expanded curl exposes keys in argv; masked owner UUID insufficient (path fragments are reusable URL components).
8. Bucket-404 fallback is scope creep — if `documents` is absent report misconfig; don't chase other bucket names.
9. "PRIVATE = fallback dead code that 400s every execution" too strong without a verified existing object + exact SDK URL construction.

### Claude's response

ACCEPTED all 9; probes re-run live before resubmission:
(1) Existence gate added and executed on 3 sample paths (newest/oldest/mid): service-key Range GET → newest+mid **206 (exist)**, oldest **400 (NOT in storage — orphaned row, new side-find for the report)**. Privacy conclusions now rest only on existence-verified objects. (2) All object probes re-run with `Range: bytes=0-0` (≤1 byte moved); 206 counted as readable. (3) SDK source read: `download()` GETs `/object/<bucket>/<path>` (storage-js index.mjs:1122-1130), `getPublicUrl` concats `/object/public/<bucket>/<path>` (:1260-1268); both byte-exact routes probed with anon key → 400. (4) Report adds "Honest limits": anon denial ≠ RLS validation; positive collaborator path not probed (no headless user JWT), claim withdrawn. (5) Interpretation matrix added to plan §matrix, conclusions pre-committed before reading results. (6) Scope reworded: "zero writes" = zero PRODUCTION writes; repo deliverables (report, ticket mirror, local commit, never push) are explicitly the task output, per KAL-287 precedent. (7) Keys moved to `umask 077` header files (`-H @file`), never argv; no `-v`; files deleted at wind-down; report masks paths to first-6+last-10 chars. (8) Bucket-404 → report-misconfig-and-stop rule; the all-buckets sweep reframed as defense-in-depth evidence only (it found exactly one bucket, private). (9) Dead-code claim now stands on three legs: existence-verified objects + byte-exact SDK URL construction from source + anon 400 on those same paths.

Live results under the corrected method: bucket `public:false`; existence-verified objects deny all three anonymous routes (400); verdict PRIVATE per matrix row 1. Plan r1 + report resubmitted together.

## Round 2 — Codex (plan r1 + report combined)

VERDICT: APPROVED. No blocking findings. Notes: report conclusion follows the matrix
(`public:false` + existence-verified objects + anon 400 = private confirmed; orphan row
correctly excluded from privacy evidence); SDK route assumptions verified against installed
storage-js; limits/scope honest; slice plan human-gated.

### Claude's response

Converged in 2 rounds. Gates run before commit: `npx vite build` clean (59s),
`node scripts/run-node-tests.mjs` 1606 tests / 1592 pass / 0 fail / 14 skipped (count grew
from the baton's 1589 baseline — other sessions added tests; zero failures). Auth header
temp files deleted. Committing audit artifacts only (no src changes).
