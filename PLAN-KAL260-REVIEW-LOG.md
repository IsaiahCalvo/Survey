# Plan Review Log: KAL-260 full backup of all annotation rows (off-DB, GET-only)
Started 2026-06-11 14:35 (autonomous loop session, recovery lane). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL260.md.

## Round 1 — Codex
6 findings, VERDICT: REVISE:
1. HIGH — restorability acceptance not met by batch-builder unit tests alone (no proof of headers, conflict mode, constraints, JSONB roundtrip, or target).
2. HIGH — embedded checkpoint verification count-only (10,960) can pass missing-key/new-key swaps and survivor payload drift; KAL-262 verifies every key + survivor hash under all 3 policies.
3. HIGH — count+max(updated_at) before/after snapshots can false-pass (same-count delete+insert; non-max updated_at churn) because GET pagination is not one DB snapshot.
4. MEDIUM — checkpoint integrity pinning missing; local tampered checkpoints could self-certify (KAL-262 pins sha256 literals).
5. MEDIUM — reuse claim overstated: kal261's makeRoGet whitelists two tables; plan needs its own wrapper + origin assert.
6. LOW — "verbatim" overclaimed if rows are parse/reserialized.

### Claude's response
First verified the pg_dump alternative is truly closed (no pg_dump/psql binary, no DB password in any env file, Supabase CLI dump needs Docker which is banned) — PostgREST stands. ACCEPTED all 6:
(1) restorability rebuilt on four artifacts: prod OpenAPI introspection captured as schema.openapi.json (real column types/PK/FKs grounding the runbook), exported buildRestoreBatches producing complete requests (unit-tested incl. real-JSONL round-trip), a full written runbook (FK ordering, conflict mode, batch size, post-restore verification), and an HONEST residual — the live drill into survey-test is deliberately NOT autonomous (prod FK parents absent there; project carries KAL-257 fixtures); claim downgraded to "restorable export with documented, schema-grounded, unit-tested restore path".
(2) full KAL-262-strength verification adopted by importing its exported anchorUserDrawn/anchorSurvivors/buildExpectations — every key, every survivor hash, all 3 policies.
(3) added an independent second keyset sweep of (id, updated_at) whose multiset must exactly equal the dump's — catches same-count swaps and mid-pull updates; mismatch → bounded re-pull → DRIFT.
(4) verifyCheckpointIntegrity + PINNED_BASELINE_SHA256 imported from KAL-262 and run as the first gate.
(5) script defines its own roGet wrapper: exact-origin assert, {document_annotations}-only whitelist plus a named allowance for the OpenAPI root.
(6) raw response bodies are now written byte-exact to raw-pages/ as the authoritative artifact BEFORE parsing; the JSONL is explicitly labeled derived; a safe-integer precision tripwire scans raw pages.
Plan rewritten (r1).

## Round 2 — Codex
1 finding, VERDICT: REVISE:
1. MEDIUM — restorability/write-safety contradiction: buildRestoreBatches must produce complete insert requests, but the write-leak scan bans non-GET method tokens; a complete PostgREST restore request needs POST/upsert semantics.
(Codex also independently confirmed from migrations that document_annotations has a BEFORE UPDATE updated_at trigger, making the sweep's content-change proxy defensible.)

### Claude's response
ACCEPTED. Guard redefined to target executable sinks, not inert data: the source scan asserts exactly one fetch( call site (inside the GET-asserting roGet wrapper), no supabase-js, no /rpc/ in URL-constructing code; buildRestoreBatches returns request DESCRIPTIONS as data ({method:'POST',...} literals never executed — no second fetch reference exists), and the guard test explicitly covers the literal's presence alongside proof of non-executability. Plan rewritten (r2).

## Round 3 — Codex
VERDICT: APPROVED. No findings. Plan FINAL (r2, approved r3). Proceeding to implementation per loop protocol.

## Result review — Codex round 1
6 findings, VERDICT: REVISE:
1. HIGH — ground-truth cross-check anchored a fresh prod re-pull, not the backup artifact (corrupted dump could pass while prod is healthy).
2. HIGH — attributed checkpoint drift rendered in the verdict string but not wired into exit aggregation; drift>0 could still exit 0.
3. HIGH — schema completeness implemented as a prose note, not the planned assert (row-key union vs OpenAPI column set).
4. MEDIUM — file-integrity gate hashed in-memory strings; no reread-from-disk verification.
5. MEDIUM — runbook's "re-run this script against the restored table" is impossible as written (prod origin hard-pin).
6. LOW — raw pages parsed before persisted; parse failure loses fetched pages.
Pre-review parent-session fixes (before submission, found by self-review): restore batch body NDJSON → JSON array (PostgREST has no NDJSON bulk insert); Gate-B1 verdict sentence aligned to the plan's agreed claim; live run re-executed after both.

### Claude's response
ACCEPTED all 6; dispatched to the implementation agent: anchor verification rows parsed from the dump itself (probes still hit prod for attribution only), drift>0 wired into exit aggregation + test that drift cannot exit 0, schema equality gate vs schema.openapi.json both directions, reread-from-disk integrity gate, honest runbook verification wording acknowledging the origin pin, write-each-raw-page-on-receipt. Live run + full gates to be re-executed after fixes; result resubmitted as round 2.

## Result review — Codex round 2
VERDICT: APPROVED. All 6 round-1 findings verified fixed. Final live run (hardened script): PASS exit 0 — 53,229 rows / 54 pages, snapshots identical, sweep PASS, file-integrity reread PASS, schema completeness PASS (26 columns exactly equal the OpenAPI set; 17 extras beyond the required 9 recorded), ground-truth dump-derived 615/615 user-drawn + 10,960/10,960 embedded drift=0. Canonical dump: ~/SurveyBackups/kal260/2026-06-11T19-11-29-612Z (two earlier superseded dump dirs retained as extra redundancy). Gate B1 SATISFIED. RESULT FINAL.
