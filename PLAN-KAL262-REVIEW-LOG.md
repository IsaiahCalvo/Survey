# Plan Review Log: KAL-262 zero-loss verification harness (dry-run, no writes)
Started 2026-06-11 12:14 (autonomous loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL262.md.

## Round 1 — Codex
13 findings, VERDICT: REVISE. Full critique:

- App shape mismatch: plan stores plain normalized DB rows in Y.Map, but sealed-doc hydrate expects nested Y.Map values with id/type/pageNumber/fabric/meta and callout submaps → materialize with production bridge shape, or explicitly change app reader.
- Hash verifier underspecified for real app-shaped Y.Doc (bridge shape may not preserve the row projection) → define exact YDoc-to-row reconstruction or store payload_sha256 sidecar.
- Baseline integrity can be self-tampered (output_sha256 read from migration_baseline.json, which is itself unpinned) → pin all three file sha256s as literals.
- Cutoff ambiguity (current time vs baseline time) → hard-pin cutoff to migration_baseline.generated_at.
- KAL-261 pass1-count-vs-live-total assert incompatible with post-baseline inserts → reuse fetch primitives only.
- Drift masking hole: missing baseline ids could be labeled drift-explained when the harness itself dropped them → by-id GET each missing id; still-present pre-cutoff row = UNEXPLAINED FAIL.
- Snapshot total+max(updated_at) misses balanced changes → authority is the full id/hash diff; snapshot demoted to signal.
- Write-leak guard not a test gate → fake-fetch + source-token tests forbidding supabase-js, /rpc/, bodies, non-GET.
- makeRoGet host pin allows non-HTTPS → require exact https origin.
- Negative self-test too narrow → add dropped embedded key, wrong survivor on divergent key, callout shape, survey-marker row, wrong-shape rejection.
- 403/615 user-drawn are survey-marker; live backfill excludes them → explicit survey-marker materialization/verification path.
- Output leak guard is blacklist-based → strict allowlist schema for verdict JSON.
- Delete-on-failure can erase previous committed report → temp files + atomic rename.

### Claude's response
Verified the two load-bearing claims in code before accepting: (1) crdtAnnotationBridge.js:249-303 confirms the nested {id,type,pageNumber,fabric,meta} Y.Map shape; (2) useAnnotationCloudSync.js fan-out (Pitfall 30-4) confirms survey-marker + callout types are deliberately excluded from getMap('annotations'), and the checkpoint confirms 403/615 survey-marker + 11 callout. ACCEPTED all 13, with one substitution: finding 2's sidecar-hash alternative is REJECTED (comparing stored hash strings would pass on corrupted payloads — a verifier blind spot); instead the materialized value IS the full normalized row (the only shape that can satisfy zero-loss), hashes are always recomputed from extracted content via a pluggable entry adapter, and the bridge-shape incompatibility (cannot carry full row; cannot represent 414/615 marks) is reported as explicit KAL-266 decision input rather than resolved here. Cutoff pinned to baseline generated_at; all three baseline sha256s pinned as literals; by-id probe for missing ids; snapshot demoted to signal; https origin assert; self-test widened to 7 injections; allowlist verdict schema + atomic renames; write-leak unit gate added. Plan rewritten (r1).

## Round 2 — Codex
3 findings, VERDICT: REVISE:
- HIGH stale-baseline false pass: pinned cutoff + signal-only snapshot lets a post-14:38Z mark go unseen while the harness exits 0 → any live-snapshot mismatch or post-cutoff rows must force exit 2.
- MEDIUM callout incompatibility overclaim: callouts DO have a dedicated callouts Y.Map read path; the real gap is hash-domain reconstructability → split "renderable" from "hash-domain complete".
- LOW embedded normalization not explicit → state excludeAnnotationId:true for embedded survivors, default for user-drawn.

### Claude's response
ACCEPTED all 3. Stale-baseline guard added: exact count of created_at > cutoff rows (with timeout fallback) + snapshot compare; any of {snapshot mismatch, post-cutoff count > 0, drift-explained diffs} caps the run at exit 2 with per-doc post-cutoff counts in the report — exit 0 now requires the live table to still BE the baseline. Shape section reworded into two distinct gaps (hash-domain completeness for both maps vs representability, survey-markers only). Embedded vs user-drawn normalization domains spelled out. Plan rewritten (r2).

## Round 3 — Codex
VERDICT: APPROVED. No blocking findings. Two non-blocking notes: keep exit-code precedence strict (FAIL beats DRIFT beats PASS) and put the stale-baseline guard under unit test, not just live-run prose.

### Claude's response
Both notes adopted into the test list (precedence test + stale-baseline guard classification tests). Plan FINAL (r2, approved r3). Proceeding to implementation per loop protocol.

## Result review — Codex round 1
VERDICT: APPROVED, no blocking defects. Codex verified: GET-only network path through roGet, exact HTTPS origin assert, no direct fetch/RPC/Supabase client/Yjs-state-table tokens, export-only KAL-261 diff, pinned 3-file sha gates, pinned cutoff, stale-baseline exit precedence, positive drift attribution, content-hash verifier, 7/7 self-test, survey-marker/callout coverage, allowlist + leak guard on the verdicts JSON, atomic writes, live PASS totals internally consistent. One non-blocking note: a literal NUL byte in the verifier's internal tag separator made some tools treat the file as binary.

### Claude's response
NUL byte replaced with the backslash-u0000 escape sequence (behavior identical); unit tests 18/18 and live dry-run PASS exit 0 re-confirmed after the change. RESULT FINAL.
