# PLAN — KAL-261: Baseline + dedup-preview queries (read-only ground truth)
_Round 2 revision — incorporates all 14 round-1 + all 5 round-2 Codex findings._

**Ticket:** KAL-261 (High, Pre-MVP). PRE-REBUILD-READINESS.md §4 Step 1 — read-only, NO WRITES.
**Goal:** establish the migration ground truth and save it as committed JSON checkpoints plus a validation report, confirming the audit's expected numbers (70dadd86 → 3,056 unique embedded refs; ~489 live+archived user-drawn marks; 388 in SE-011-ARCH 97f95b32; 30 in Package2-ARCH d30ac66b).

## Context (verified live 2026-06-11)

- Production Supabase project `cvamwtpsuvxvjdnotbeg`; `document_annotations` currently holds **53,229 rows** (audit said 53,216 on 2026-06-10 — drift is live-use inserts; the report restates observed numbers).
- Schema probed live: `annotation_data.fabricObject.{isPdfImported,pdfAnnotationId}`, `annotation_data.pageNumber`, `documents.archived` all exist.
- **App ground truth for dedup semantics** (verified in code): `getPdfImportDedupeKey` (src/services/annotationTypeSerializers.js:92) keys on `(annotation_data.pageNumber ?? row.page_number) : pdfAnnotationId` and requires truthy `isPdfImported` AND truthy `pdfAnnotationId`; `preferFabricRow` (:101) keeps the latest by `updated_at || created_at` and prefers non-survey-marker rows. `mapSurveyMarkerRowToLocalAnnotation` (src/services/documentSurveyMarkerMapper.js:62) reconstructs markers from TOP-LEVEL columns (bounds, name, notes, category/module/entity, checklist_responses, color, opacity, …), so payload hashing must cover the full row, not just `annotation_data`.
- Credentials from gitignored `.env`/`.env.local` via `agent-cli/lib/env.mjs` (service-role; RLS bypass needed since rows span users). No secret printed or written to outputs.

## Approach — structural read-only

PostgREST exposes no GROUP BY, so the script pulls a projected slice of every row via paginated GETs and aggregates locally in Node.

Safety invariants (enforced in code):

1. **Single `roGet(table, params)` call site**: hardcodes `method: 'GET'`, no request body ever, and whitelists table ∈ {`document_annotations`, `documents`} — anything else (including any `/rpc/` path) throws before fetch. No supabase-js import.
2. **Host pin**: hard fail unless the resolved Supabase URL host is exactly `cvamwtpsuvxvjdnotbeg.supabase.co` (shell-env override cannot silently retarget).
3. **Snapshot stability**: run-start cutoff applied as `created_at=lte.<cutoff>`; PLUS drift detection — exact count (`Prefer: count=exact`) and `max(updated_at)` (order=updated_at.desc, limit=1) captured before and after the full pull; on mismatch the run aborts and retries (≤3) — updates/deletes mid-run cannot silently skew output.
4. **Keyset pagination** ordered by `id.asc` with `id=gt.<last>`, page 5,000 — no OFFSET drift.
5. **Output-leak guard**: after writing, the script re-reads every committed JSON, parses it, and **structurally walks the object tree** asserting no key path inside row/entry arrays is named `annotation_data`/`fabricObject`/`bounds`/`checklist_responses` (documentation strings in the `hash_scheme` header are exempt — the check is on object keys, not substrings) and that no string value matches secret markers (JWT prefix, service-role key prefix); violation deletes outputs and fails.

## Passes

- **Pass 1 (projection, all rows)**: `id, annotation_id, document_id, page_number, annotation_type, user_id, created_at, updated_at`, plus **JSON-typed** projections (`->`, NOT `->>`, so booleans/numbers keep their JSON types): `annotation_data->pageNumber`, `annotation_data->fabricObject->isPdfImported`, `annotation_data->fabricObject->pdfAnnotationId`. Local classification:
  - `embedded` = `isPdfImported === true` (strict boolean — matches the §4 SQL `::boolean IS TRUE` semantics AND the app's truthiness for well-formed data). Any present-but-non-boolean value (e.g. string `"true"`/`"false"`) → **anomaly bucket**, counted under both interpretations in the report.
  - `user_drawn` = everything else. Rows with a truthy `pdfAnnotationId` but non-true `isPdfImported` are counted user-drawn (spec predicate) but flagged in a dedicated anomaly bucket.
  - Effective page for dedup = `dataPageNumber ?? page_number` (app semantics), **pinned to finite integers**: each side parsed; non-integer/non-finite/string-number values → anomaly bucket; rows where the two sides disagree are flagged. Dedup keys are JSON tuples `[document_id, effectivePage, pdfAnnotationId]` internally (no delimiter-collision risk); the report notes the delimiter risk in the planned `import:<page>:<id>` ID scheme for Step 4.
  - Embedded rows with missing/null `pdfAnnotationId` or null effective page → anomaly buckets (they cannot dedup; the migration plan must know).
- **Pass 2 (full rows, by PK list)**: `select=*` with `id=in.(…)` batches of 100, for (a) every user-drawn row and (b) every embedded **dedup survivor**. Asserts the returned ID set is exactly the requested set (consistency with pass 1; drift → abort/retry).
- **Survivor policy**: recorded under THREE candidate policies — `app_exact` (full `preferFabricRow` semantics: non-survey-marker rows win over survey-marker rows, then latest `updated_at || created_at`, candidates iterated in PK-asc order so the comparator's `>=`-keeps-candidate behavior is deterministic), `latest_updated_at` (timestamp-only + PK-desc tie-break), and `latest_created_at` (readiness-doc Step 3 wording + PK-desc tie-break). Keys where policies diverge are counted + listed. Choosing the final Step-3 policy is explicitly surfaced to Isaiah in the report (data provided, decision not pre-empted).

## Hashing scheme (the KAL-262 contract)

`payload_sha256` = SHA-256 over canonical JSON (recursively key-sorted, no whitespace) of the **normalized full row**, with **class-specific domains**:

- **user-drawn**: all columns EXCEPT `id`, `created_at`, `updated_at` (server bookkeeping, recorded as plaintext metadata alongside), with `annotation_data.clientSessionId` deleted (volatile). `annotation_id`, `version`, `changed_by/changed_date`, `last_modified_by`, `user_id`, `bounds`, `checklist_responses`, etc. are all INSIDE the hash — zero-loss means they survive too.
- **embedded survivors**: same domain but ALSO excluding `annotation_id` (Step 4 mints deterministic `import:<page>:<pdfAnnotationId>` IDs, so the original random annotation_id will not survive migration by design; it is recorded as metadata, not hashed).

The exact scheme (per-class field exclusions + canonicalization rules) is embedded as a `hash_scheme` header object in each checkpoint so KAL-262 reproduces it byte-exactly. The header explicitly states the disposition of nested embedded ID fields (`fabricObject.id`, `fabricObject.annotationId`, `fabricObject.data.id`): all preserved as-stored inside the hash (only top-level `annotation_id` is class-excluded; nested IDs are part of the payload the migration must carry). Note for KAL-262: the materialized Y.Doc payload may legitimately normalize fields (e.g. deserializer-added `fabricObject.data.id`); the harness compares via this documented normalized domain, not raw equality.

## Deliverables

`scripts/kal261-baseline-dedup-preview.mjs` — standalone one-off, pure helpers exported for unit testing, main guarded. Outputs to `.planning/optimization/migration-baseline/`:

1. **`migration_baseline.json`** — run metadata (cutoff, before/after counts + max-updated_at, page count, first/last PK per page batch, exact Content-Range totals, query predicates, retry count, output hashes); per doc: name, archived, per-type counts, total, user_drawn, embedded_raw, embedded_unique, dupe factor; 70dadd86 detail (per-page top duplicate pdfAnnotationIds, id+count only); all anomaly buckets with counts + example PKs.
2. **`user_drawn_marks_checkpoint.json`** — every user-drawn mark: PK id, annotation_id, document_id, effective + raw page, annotation_type, user_id, created_at, updated_at, `payload_sha256`. Hash-scheme header. NO raw payloads committed (KAL-260's backup owns payload durability).
3. **`embedded_dedup_survivors.json`** — per dedup key: all three policies' survivor PK + payload_sha256, divergence flag. Gives KAL-262 full embedded validation, not just counts.
4. **`KAL-261-BASELINE-REPORT.md`** — observed vs expected for every audit claim, anomaly analysis, the survivor-policy divergence question for Isaiah, what KAL-260/262/266 consume from these files.

## Validation & gates

- **Targeted unit tests** (`tests/kal261-baseline-helpers.spec.mjs`, runs in the normal node-test gate): canonical-stringify + SHA-256 known test vector; `roGet` rejects non-whitelisted table, `/rpc/`, and any non-GET; classification predicate truth table (true/false/missing/string values); effective-page fallback + mismatch flag; survivor selection determinism incl. tie-break; drift-abort logic.
- Acceptance per ticket: checkpoints exist; 70dadd86 → 3,056 confirmed (if observed differs, report states observed and investigates — fail-honest).
- Repo gates: `npx vite build` + `node scripts/run-node-tests.mjs` (restate observed baseline).
- Codex result review before commit.

## Out of scope

- No writes to production of any kind; no backup (KAL-260); no snapshot computation (KAL-266); no archived-doc policy call (§7 #1, Isaiah); no schema changes; no RPC creation; no app code touched.
