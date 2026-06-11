# PLAN — KAL-260: Full backup of all annotation rows before any migration write (r1)

**Ticket:** KAL-260 (Urgent). PRE-REBUILD-READINESS.md §4 Step 0 / Gate B1.
**Acceptance:** a restorable export confirmed off-database; row count matches live.
**Classification:** backup/audit tooling — GET-only against production, zero DB writes, cap-free.

## Context

- `document_annotations` is the ONLY durable annotation store (no soft-delete); §4 Step 0 gates every later migration step on a full off-database export existing.
- KAL-261 (c2c8545d) established constraints: PostgREST caps responses at 1,000 rows regardless of `limit=`; `created_at`-filtered exact counts hit the 8s statement timeout; unfiltered `count=exact` works. Baseline saw 53,229 rows; live count at run time is authoritative.
- KAL-262 (dea0b564) confirmed the table unmoved as of 2026-06-11 ~12:40 and exports the full verifier toolkit this plan reuses (`PINNED_BASELINE_SHA256`, `verifyCheckpointIntegrity`, `buildExpectations`, `anchorUserDrawn`, `anchorSurvivors`, `classifyContentDiff`, `classifyMissingId`, `aggregateExitCode`, `writeAtomically`).
- **`pg_dump` is genuinely unavailable** (verified: no pg_dump/psql binaries; no `DATABASE_URL`/DB password in any env file; Supabase CLI dump path needs Docker, which is banned). The spec allows "pg_dump / JSONB export"; the mechanism is PostgREST.

## Deliverable

New `scripts/kal260-backup-annotations.mjs` (+ unit tests in the normal gate). One run produces, under a directory **outside the repo and outside the database**:

```
~/SurveyBackups/kal260/<UTC-timestamp>/
  raw-pages/page-00001.json …    # each PostgREST response body, byte-exact as received
  document_annotations.jsonl     # derived: one full row per line, parsed from raw pages
  schema.openapi.json            # prod PostgREST OpenAPI introspection (GET /) — column types, PKs, FK relationships
  MANIFEST.json                  # counts, sha256s (raw pages + jsonl), snapshots, sweep result, verdicts, restore runbook
```

plus a committed, payload-free `.planning/optimization/migration-baseline/KAL-260-BACKUP-MANIFEST.md` (counts, digests, verdicts, gate statement — passes a structural leak guard before write).

## Design

### 1. Fetch layer — own wrapper, KAL-261 posture (review finding 5)

The script defines its OWN `roGet` wrapper (not a bare import): exact `https://cvamwtpsuvxvjdnotbeg.supabase.co` origin assert, table whitelist **`{document_annotations}` only** (plus the bare `/` OpenAPI root as an explicit named allowance), GET method only, no `/rpc/`, no bodies, no supabase-js. Hash/normalization helpers are imported from the KAL-261 script; verifier machinery from the KAL-262 script — no reimplementation of either.

### 2. Dump is byte-exact at the page level (review finding 6)

Keyset pagination `select=*&order=id.asc&limit=1000`, `id=gt.<last>` until short page. Every response body is written verbatim to `raw-pages/` BEFORE parsing — the raw pages are the authoritative backup artifact (no parse/reserialize fidelity question; JSON number-precision risk is moot at this layer). `document_annotations.jsonl` is derived from the parsed pages for convenient streaming restore, explicitly labeled "semantic JSON, derived" in the manifest. A precision tripwire scans raw pages for integer-valued number tokens that fail `Number.isSafeInteger` and records any hits in the manifest (none expected; uuid ids are strings).

### 3. Consistency — read-twice sweep, not just count+max (review finding 3)

1. `snapshotTable` (unfiltered `count=exact` + newest-`updated_at` top row) BEFORE the pull.
2. Full dump pull (~54 pages).
3. `snapshotTable` AFTER.
4. **Verification sweep:** an independent second keyset pass of `select=id,updated_at` over the whole table; its `(id, updated_at)` multiset must EXACTLY equal the dump's. Same-count delete+insert swaps change the id set; mid-pull updates change `updated_at` — both are caught. Sweep also re-proves no page-boundary dups/gaps.
5. Any mismatch in 3 or 4 → discard, retry whole pull (3 attempts). Still unstable → exit 2 (DRIFT), dump dir renamed `<timestamp>.UNSTABLE`, manifest stamped, gate NOT satisfied.

### 4. Verification (all local, all read-only)

1. **Count match (acceptance):** rows written == distinct ids == `count=exact` from the stable window.
2. **File integrity:** re-read raw pages + JSONL from disk; recount, recompute sha256s; must match manifest values.
3. **Schema completeness:** union of top-level row keys must be a superset of `{id, document_id, user_id, annotation_type, annotation_id, page_number, annotation_data, created_at, updated_at}` AND must equal the column set in `schema.openapi.json` for the table; extras recorded verbatim.
4. **Checkpoint integrity gate first (review finding 4):** `verifyCheckpointIntegrity` from KAL-262 with its `PINNED_BASELINE_SHA256` literals — tampered/regenerated local checkpoints refuse to run.
5. **Ground-truth cross-check (review finding 2 — full KAL-262 strength, not count-only):** restricted to rows with `created_at <=` baseline cutoff, reuse `buildExpectations` + `anchorUserDrawn` + `anchorSurvivors`: every one of the 615 user-drawn ids present with matching recomputed payload hash, AND every one of the 10,960 embedded keys present with the correct survivor id + hash under ALL THREE policies. Any diff needs positive attribution (`classifyContentDiff`/`classifyMissingId` by-id probe semantics); attributed post-baseline changes → exit 2 with per-id report; unattributed → exit 1 (FAIL).
6. **Exit precedence:** `aggregateExitCode` semantics — FAIL (1) beats DRIFT (2) beats PASS (0); only exit 0 satisfies Gate B1; the committed markdown states the gate verdict explicitly.

### 5. Restorability — strongest evidence available without a live write (review finding 1)

Confirmed-restorable is built from four artifacts, each closing a gap Codex named:

- **Schema + constraints captured from prod itself:** `schema.openapi.json` via GET `/` introspection records column types, required fields, PK, and FK relationships (`document_id → documents`, `user_id`) — so the runbook's FK-ordering and conflict-mode instructions are grounded in the real schema, not assumptions.
- **Restore-request builder (inert by construction):** exported pure `buildRestoreBatches(rows, batchSize)` returns complete restore-request DESCRIPTIONS as data — `{ method: 'POST', path, headers, preferResolution, body }` literals that are never executed by this script (it contains no code path that can send them; see §6) — unit-tested including a real-JSONL-line parse→build→reparse round-trip and a fixture asserting batch bodies are byte-identical rows.
- **Written runbook in MANIFEST.json:** target table, FK prerequisites and ordering (parent `documents`/auth users must exist or FKs dropped first — stated explicitly), conflict mode choice, batch size vs the 1,000-row cap, sequence/identity notes, and the verification-after-restore procedure (re-run this script's hash cross-check against the restored table).
- **Live restore drill residual, stated honestly:** the only end-to-end proof is a real restore. That is a deliberate write operation (survey-test creds exist locally, but prod FK parents don't exist there and the project seeds KAL-257 integration fixtures — polluting it autonomously is the wrong call). The ticket gets a residual: "restore drill into a scratch schema/project on Isaiah's go". The plan claims "restorable export with documented, schema-grounded, unit-tested restore path", not "restore-drilled".

### 6. Leak guards

- The committed `KAL-260-BACKUP-MANIFEST.md` carries counts/digests/ids/timestamps only — never `annotation_data` content; serializer is allowlist-based; a poisoned-input unit test asserts rejection.
- Write-leak guard targets executable SINKS, not inert data (resolves the round-2 contradiction with `buildRestoreBatches`): the source scan asserts exactly ONE `fetch(` call site in the script (inside the roGet wrapper), no supabase-js import, and no `/rpc/` in any URL-constructing code; the roGet wrapper hard-asserts `method === 'GET'` at runtime (unit-tested). `buildRestoreBatches` may contain `method: 'POST'` as a string literal in returned data — the guard test explicitly covers that this literal exists while proving no code path can execute it (no second fetch reference anywhere).
- The dump itself lives outside the repo; nothing under `~/SurveyBackups` is ever committed.

### 7. Tests (added to the normal node gate)

- keyset loop: page assembly, `gt` cursor, short-page exit, cross-page duplicate-id detection
- sweep comparator: equal multisets PASS; same-count id swap FAIL; updated_at drift FAIL
- drift/retry classification; UNSTABLE rename path (fs mocked)
- checkpoint verification glue: missing id, unattributed hash mismatch, attributed post-baseline change, survivor-policy mismatch
- `buildRestoreBatches`: batching, fidelity, JSONL round-trip, header/conflict-mode completeness
- exit precedence FAIL > DRIFT > PASS
- write-leak source scan; manifest allowlist + poisoned-input rejection; precision tripwire unit test

### 8. Run + report

Run live once (~54 dump pages + ~54 sweep pages + 2 snapshots + OpenAPI GET + worst-case a handful of by-id probes). Commit: script, tests, committed manifest, plan + review log. Gates: `npx vite build` + full node suite (current observed baseline 1540/1526/0 fail/14 skip) before commit. Both boards updated (Linear flip pending — no Linear access from scheduled sessions today, recorded in the ticket file status log).

## Out of scope

- Any write to any Supabase project (prod or test); restore drill is a ticket residual.
- Backing up other tables (`documents`, history events) — Step 0 names `document_annotations` only; the OpenAPI schema capture incidentally documents FK parents for the runbook.
- Offsite/cloud copy of the dump — manifest carries the recommendation.
- KAL-258 token rotation (standing instruction: untouched).

## DO NOT CHANGE

- `scripts/kal261-baseline-dedup-preview.mjs`, `scripts/kal262-zero-loss-harness.mjs` — import-only; add `export` keywords only if one is missing (KAL-262 precedent), nothing else.
- `.planning/optimization/migration-baseline/*.json` checkpoints — read-only inputs.
- `src/**` — no product code is touched by this task.
