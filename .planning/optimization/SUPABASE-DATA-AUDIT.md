# Supabase Database Audit — Survey BetaSafeS2

_Project `cvamwtpsuvxvjdnotbeg` · audited 2026-06-05 · synthesized from three independent read-only lanes (live production data, schema/index/RLS, query/access patterns)_

---

## 1. Bottom line

**No — not yet at a professional production-grade level, though the core design is closer than the symptoms suggest.** The read architecture (keyset pagination, column projection, delta-only writes, watermark skip, request coalescing) is genuinely well-engineered and above the bar for a one-engineer product, but three things keep it short of production-ready. **First (reliability):** every annotation upsert calls a bare `.select()` that returns all 26 columns for every written row, so any full-fanout on a large document streams back tens of megabytes the app immediately discards — this is the most likely cause of the intermittent "Failed to fetch" errors and it is a one-line fix. **Second (data hygiene):** the database is dominated by dead weight — 83% of documents and **97.9% of all annotation rows** belong to soft-deleted documents that no user can open, with zero cascade or cleanup job, so this leaks further on every archive. **Third (fragility):** the `user_can_access_document` RLS gate — the predicate behind every annotation read/write/delete — has been rewritten six times, including a version that shipped a broken `created_by` reference and silently failed every policy in production, and it can re-break if `supabase db push --include-all` is ever used again.

---

## 2. The live data, by the numbers

All counts are exact (PostgREST `Content-Range`, service-role, ordered fetch). The earlier "17,575 duplicate annotations" scare was a **REST cursor artifact** from paginating without `ORDER BY` — re-run with `ORDER BY id`, all 53,216 PKs are unique. There is **no annotation_id re-import bloat at the row level** and **zero true orphans**: every annotation, YJS-state, and history row maps to a real `documents` row.

### Every table, row count, health flag

| Table | Rows | Health | Note |
|---|---:|:---:|---|
| `documents` | 119 | 🟠 | 99 archived / 20 active — 83% archive rate, no purge |
| `document_annotations` | 53,216 | 🔴 | 97.9% belong to archived docs; no `(document_id, annotation_id)` issue but heavy dead weight |
| `doc_yjs_state` | 114 | 🟠 | 85% (97 rows) back archived docs; grows unbounded |
| `doc_yjs_updates` | 0 | 🟡 | Empty — Phase 27 schema, compaction never ran. Verify updates aren't being dropped |
| `document_revisions` | 0 | 🟡 | Empty — feature deployed but unused |
| `document_history_events` | 152 | 🟢 | 55 back archived docs; small, fine for now |
| `document_collaborators` | 26 | 🟢 | Healthy |
| `document_presence` | 66 | 🟢 | WAL-delta forwarding already landed |
| `projects` | 5 | 🟢 | — |
| `user_subscriptions` | 13 | 🟢 | (the `subscriptions` table named in the brief does **not** exist) |
| `survey_sessions` | 1 | 🟡 | Superseded by document-centric path; still in realtime publication |
| `survey_items` | 0 | 🟡 | Dead-ish; referenced by `kal48_restore_revision` |
| `document_invites` | 0 | 🟢 | But `created_by` cascade is wrong (see §3) |
| `document_locks` | — | ⬜ | **Does not exist** in schema (PGRST205); lock state lives on `documents` columns |
| `public.annotations` (legacy) | — | ⬜ | Not in PostgREST schema cache; likely dropped — confirm |

> **Conflict resolved — `doc_yjs_state`:** the schema lane reported **0 rows**; the live-data and query lanes both reported **114**, and the live lane confirmed all 114 reference valid documents. The "0" was a misread empty `Content-Range` header. **Authoritative value: 114.**

### Soft-delete pile-up (the headline problem)
- **52,108 annotation rows (97.9%)** belong to archived documents. Active docs hold only **1,108** annotation rows combined.
- The two heaviest archived docs — both old copies of *"Package 2 - Rev 4 -- IC.pdf"* (`70dadd86` = 24,450 rows, `5fa31b86` = 22,105 rows) — hold **46,555 rows (87.5% of the whole table)** by themselves.
- **97 of 114 YJS-state rows (85%)** and 55 history rows are also archived-doc dead weight.
- Archiving does **not** cascade. Every archive permanently leaks its annotation, YJS, and history rows. With no cleanup job, this only grows.

### Duplicate documents (8 clusters, all under user `170d915c`)
| Name (size) | Copies | Active | Archived | Note |
|---|---:|---:|---:|---|
| Package 2 - Rev 4 -- IC.pdf (6.3 MB) | 7 | 1 | 6 | 3 archived have **0 annotations** (load-then-vanish bug residue) |
| clickable-link-test.pdf (23 KB) | 5 | **2** | 3 | ⚠️ two *active* duplicates — sync-ambiguity risk |
| 1.pdf (10/5/17 KB) | 4+2+2 | 0 | all | test artifacts |
| Isaiah Calvo Profile.pdf (548 KB) | 2 | 2 | 0 | both zero-annotation bug residue |
| test.pdf (2.4 KB) | 2 | 1 | 1 | — |
| text-search-glyph-lab.pdf (3.2 KB) | 2 | 0 | 2 | — |

Schema lane corroborates from a different angle: **21 rows named "1.pdf"**, 9 "clickable-link-test.pdf", 7 "Package 2" — under one user, with **no `UNIQUE(user_id, name)` constraint** to stop it.

### Bug-residue: 13 active zero-annotation documents
Five `test-rpc-doc` entries (2026-05-22), two `Isaiah Calvo Profile.pdf`, plus `New document.pdf`, `sync-test.pdf`, `Benjamin Franklin Elementary.pdf`, and two more resume PDFs. These are import-failure / test artifacts that were never cleaned up.

### Storage
~153 objects, **~449 MB**, almost all under `170d915c/general/` (97 objects, the 449 MB; avg 4.7 MB, max 25 MB). The rest are tiny debug stubs. **Filenames are time-based** (`1779028738489.pdf`), **not** keyed to document UUIDs — so storage objects cannot be cross-referenced to document rows via REST, and there is no reliable way to GC a document's file when it's archived or deleted. Much of the 449 MB backs archived-only documents that will never be opened.

---

## 3. Schema, indexing & security review

**Per-table verdict.** The `document_annotations` design — one row per annotation, JSONB `annotation_data` payload — is the right call at this volume and access pattern; 53k rows is well below the regime where per-document fan-out hurts. `documents`, `document_collaborators`, `document_presence`, `document_history_events` are all sound. The weak spots are the **dead/stub tables** (`survey_sessions`/`survey_items`/`survey_presence`/`survey_sync_log`/`excel_schema_mapping` from the abandoned Excel path; `doc_yjs_updates`/`activity_log`/`document_revisions` from Phases 27/31 that never activated — `cutover_completed_at` is NULL on every row) and the **migration history itself**.

**Indexing.** Good: keyset index `(document_id, id)` (the KAL-241 fix for the OFFSET timeout), GIN on `annotation_data` for counter-chain lookups, composite `(document_id, page_number)`, and the `UNIQUE(document_id, annotation_id)` constraint **does exist** — it prevents client-duplicate IDs from doubling rows.

> **Conflict resolved — the UNIQUE constraint:** the live-data lane recommended *adding* `UNIQUE(document_id, annotation_id)` as if absent; the schema lane, which read all 57 migrations, confirms it **already exists** and is enforced. **Authoritative: it exists.** The live lane's recommendation is moot — keep the constraint, drop that action item. (This is why no row-level re-import duplicates were found: the DB is already guarding them.)

**Missing constraints/indexes worth adding:**
- `UNIQUE(user_id, name)` on `documents` — or a partial `CREATE UNIQUE INDEX ... WHERE archived = FALSE`. Nothing stops the duplicate-document accumulation today.
- Partial index `ON document_annotations(document_id, page_number) WHERE annotation_type = 'survey-marker'` — the "load only this doc's survey markers" path currently scans the whole document; ink dominates the table (~849/1000 sampled), so this could be ~10x cheaper.
- `CHECK(file_size > 0)` and `CHECK(page_number > 0)` — a 10-byte ghost document already exists.
- `UNIQUE(document_id, target_email) WHERE target_email IS NOT NULL` on `document_invites`.

**RLS correctness & cost.** Every `SELECT`/`UPDATE`/`DELETE` on `document_annotations` evaluates `user_can_access_document(document_id, 'viewer')` per row. Because PostgREST issues `WHERE document_id = $1` (all rows share one arg) **and** the current (post-`20260527`) function is `STABLE SECURITY DEFINER`, the planner caches it per statement — so it's ~2 sub-SELECTs per query, **not** 546×. The cost only fans out on multi-document admin queries. The real RLS hazard is **fragility, not cost**: `user_can_access_document` has 6 rewrites with semantic drift, including `20260521000000` which referenced a non-existent `created_by` column and **broke every policy in production** (error 42703) until `20260527130000` restored it. That broken version is permanently in history and **re-wins if `--include-all` is used on `db push`** — the migration set is not safely replayable from scratch. The `kal31_accept_document_invite` function was likewise rewritten 4×. Stub deny-all RLS on `doc_yjs_updates`/`doc_yjs_state`/`activity_log` is correct *while empty*, but is a latent trap: ship Phase 32 client reads without updating these policies and clients get a silent empty-state.

**FK/cascade issues:**
- `document_invites.created_by → auth.users ON DELETE CASCADE` — **wrong**; deleting an inviter hard-deletes accepted invites that are part of the collaborator audit trail. Should be `SET NULL`.
- `document_annotations.user_id → auth.users ON DELETE CASCADE` — debatable; `SET NULL` would preserve historical authorship.
- `survey_sessions.document_id → documents ON DELETE SET NULL` with `survey_items → sessions CASCADE` produces zombie rows (session survives doc deletion, items survive with a dangling session). Low impact given the tables are near-empty.

**WAL/replication:** `REPLICA IDENTITY FULL` on `document_annotations` writes the **entire old row** to WAL on every UPDATE. On a high-write collaborative table this inflates WAL volume and replication lag linearly with annotation count. Switching to `REPLICA IDENTITY USING INDEX` on the existing `(document_id, annotation_id)` unique index is sufficient for the realtime DELETE handler and cuts per-UPDATE WAL from ~800 B to ~50 B.

---

## 4. Query & access-pattern review

**What scales (genuinely good):** keyset hydrate via `collectKeysetRows` (pageSize 1000, narrow 8-of-26 column projection), single-flight `inFlightHydrateReads` dedup, watermark-skip on re-open backed by the single-row `documents.annotations_changed_at` marker, delta-only writes via `buildFabricSyncDelta` (one new pen stroke = one upserted row, not 500), and the CRDT fan-out wrapped in a single `ydoc.transact()` (collapsing ~22k observer firings to one). The boot-burst `coalesceRead` and short-TTL metadata resolver are also above-bar.

**The bulk-upsert failure (CRITICAL, the reliability headline):** `upsertAnnotationsByPage` and `upsertCallouts` call `.upsert(batch, {...}).select()` — **bare `.select()`, no projection** — returning all 26 columns for every written row, which the caller only uses for an error check + log. On the delta path (1–5 rows) this is harmless. But any **full-fanout** — first-open migration, reconnect replay, manual `forceFlush` — on a large document returns the whole row set: a 22,105-row fanout is 89 sequential batches totaling **~64 MB** of discarded response body. That exceeds the browser's per-request memory budget / gateway response limit and is the **most likely root cause of the "Failed to fetch" errors**. Fix is one line: `.select('annotation_id, updated_at')`.

**Read pagination:** the new path is keyset and correct. The **legacy surveyMarker reader** `getDocumentAnnotations` still uses **OFFSET** pagination (`.range(from, to)`), forcing Postgres to scan + RLS-check every skipped row on each deeper page — the exact quadratic pattern KAL-241 already fixed on the non-survey path. At 3,434 survey markers it's only ~4 pages today, but it's a re-introduced statement-timeout risk as surveys grow. Migrate it to `collectKeysetRows`.

**Realtime:** **two channels per document subscribe to the same `document_annotations` filter** — `document-annotations:{id}` (legacy/surveyMarker) and `all-annotations:{id}` (new types) — so every annotation INSERT/UPDATE/DELETE is delivered to the client twice, doubling realtime message volume against the plan quota. The legacy channel is only needed until the surveyMarker migration completes (Phase 32+), then it halves.

**Other real-but-minor:** `upsertAnnotationsByPage` is a fully sequential `await` loop (89 round-trips on a full fanout — add a 3–5 concurrency cap for replay/migration paths only); `getOtherSurveysUsingTemplate` has **no `.limit()`** (unbounded cross-user query — the caller only needs `count > 0`, so add `.limit(100)`); `countSurveyMarkersReferencingChecklistItemFallback` scans up to 5,000 JSONB rows client-side (replace with a server-side RPC); list queries use `SELECT *` and pull the growing `tool_preferences` JSONB into list views that only need id/name.

**Service-role key exposure: NONE.** The browser client uses only the anon key. `SUPABASE_SERVICE_ROLE_KEY` lives in `.env.local` without the `VITE_` prefix, is not imported anywhere in `src/`, and is correctly server/script-only. The auth-lock timeout clamp (2,500 ms vs default 5,000) is a thoughtful cold-start mitigation. No security finding here.

---

## 5. Prioritized fix list

Effort: S < 1h · M a few hours · L a day+. "When": **Now** = safe standalone change; **Rebuild** = fold into the persistence-architecture migration.

| # | Fix | Tag | Effort | Risk | When |
|---|---|---|---|---|---|
| 1 | `.select()` → `.select('annotation_id, updated_at')` in `upsertAnnotationsByPage` & `upsertAnnotations` — kills the ~64 MB payload, the likely "Failed to fetch" cause | query | **S** | Low | **Now** |
| 2 | Pin `user_can_access_document`: integration test asserting owner→TRUE, gate `db push` on it, header comment **never use `--include-all`** | security | S | Low | **Now** |
| 3 | Nightly GC job: delete annotations / yjs_state / history for docs `archived AND updated_at < now()-30d` — reclaims ~52k rows immediately | data-cleanup | M | Med | **Now** (test on staging) |
| 4 | `REPLICA IDENTITY FULL` → `USING INDEX` on the `(document_id, annotation_id)` unique index — cuts WAL ~16x per UPDATE | schema | S | Low | **Now** |
| 5 | Partial `UNIQUE INDEX documents(user_id, name) WHERE archived = FALSE` — stops active-duplicate accumulation at the DB level | schema | S | Low | **Now** |
| 6 | Migrate legacy `getDocumentAnnotations` from OFFSET → keyset (`collectKeysetRows`) | query | M | Low | **Now** |
| 7 | Fix `document_invites.created_by` cascade → `ON DELETE SET NULL` (preserves accepted-invite audit trail) | schema | S | Low | **Now** |
| 8 | Clean up 13 active zero-annotation docs + the 2 active `clickable-link-test.pdf` dupes (pick canonical, archive the rest) | data-cleanup | S | Low | **Now** |
| 9 | `.limit(100)` on `getOtherSurveysUsingTemplate`; project columns in list `SELECT *` queries | query | S | Low | **Now** |
| 10 | Partial index `ON document_annotations(document_id, page_number) WHERE annotation_type='survey-marker'` | index | S | Low | **Now** |
| 11 | Concurrency cap (3–5) on the upsert batch loop for replay/migration paths only | query | M | Low | **Now** |
| 12 | Add `CHECK(file_size>0)`, `CHECK(page_number>0)`, `UNIQUE(document_id,target_email) WHERE NOT NULL` | schema | S | Low | **Now** |
| 13 | Hard-delete pathway for archived docs aged past 90d (rows **and** the storage object) | data-cleanup | M | Med | Rebuild |
| 14 | **Storage path scheme** → `{user_id}/{document_id}.pdf` so files are GC-able; backfill/migrate the 97 time-named objects | schema | L | Med | **Rebuild** |
| 15 | Remove the legacy `document-annotations:{id}` realtime channel once surveyMarker migration lands (halves realtime traffic) | query | S | Low | Rebuild (Phase 32) |
| 16 | Replace deny-all stubs on `doc_yjs_updates`/`doc_yjs_state`/`activity_log` with real `user_can_access_document` policies, shipped **in the same `db push`** as Phase 32 client code | security | M | Med | Rebuild |
| 17 | Disposition the dead Excel + CRDT tables (`survey_*`, `activity_log`); confirm 0 rows + no app refs, then drop from realtime publication, then drop | schema | M | Low | Rebuild |
| 18 | Investigate why `doc_yjs_updates` = 0 — confirm collaborative updates aren't silently dropped before relying on them | query | M | Med | Rebuild |
| 19 | Replace `countSurveyMarkersReferencingChecklistItemFallback` 5,000-row client scan with a server RPC | query | M | Low | Rebuild |

> **Dropped from the action list:** "Add `UNIQUE(document_id, annotation_id)`" — it already exists and is enforced (see §3). Keep it.

---

## 6. Diagnostic SQL to run in the Supabase SQL editor

Deduped across all three lanes. Run these to confirm the findings against live state (REST couldn't reach `pg_stat_*`, `storage.objects`, or `information_schema` from the lanes).

```sql
-- 1. Annotation count per document, archived flag, NULL marker
SELECT d.id, d.name, d.archived, d.annotations_changed_at, COUNT(a.id) AS annotation_count
FROM documents d
LEFT JOIN document_annotations a ON a.document_id = d.id
GROUP BY d.id, d.name, d.archived, d.annotations_changed_at
ORDER BY annotation_count DESC
LIMIT 30;

-- 2. Annotations on archived vs active docs (expect ~97.9% archived)
SELECT d.archived, COUNT(a.id) AS annotation_rows
FROM document_annotations a JOIN documents d ON d.id = a.document_id
GROUP BY d.archived;

-- 3. Rows purgeable by the proposed 30-day GC job
SELECT COUNT(*) AS purgeable_annotation_rows
FROM document_annotations a JOIN documents d ON d.id = a.document_id
WHERE d.archived = TRUE;

-- 4. YJS state for archived docs (expect 97 of 114)
SELECT COUNT(*) AS yjs_state_for_archived
FROM doc_yjs_state s JOIN documents d ON d.id = s.document_id
WHERE d.archived = TRUE;

-- 5. Duplicate document clusters (same user + name + size)
SELECT user_id, name, file_size, COUNT(*) AS copies,
       SUM((archived)::int) AS archived_copies,
       SUM((NOT archived)::int) AS active_copies
FROM documents
GROUP BY user_id, name, file_size
HAVING COUNT(*) > 1
ORDER BY copies DESC;

-- 6. Active zero-annotation docs (bug residue)
SELECT d.id, d.name, d.created_at, d.file_size
FROM documents d
LEFT JOIN document_annotations a ON a.document_id = d.id
WHERE d.archived = FALSE AND a.id IS NULL
ORDER BY d.created_at;

-- 7. Full annotation_type distribution (lanes only sampled)
SELECT annotation_type, COUNT(*) AS cnt
FROM document_annotations
GROUP BY annotation_type
ORDER BY cnt DESC;

-- 8. Confirm the UNIQUE(document_id, annotation_id) constraint exists
SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'document_annotations'
ORDER BY tc.constraint_type, kcu.column_name;

-- 9. Verify user_can_access_document body has NO created_by reference
SELECT proname, prosrc
FROM pg_proc JOIN pg_namespace n ON pg_proc.pronamespace = n.oid
WHERE n.nspname = 'public' AND proname = 'user_can_access_document';

-- 10. Current REPLICA IDENTITY (expect FULL — target is INDEX)
SELECT relname,
  CASE relreplident WHEN 'd' THEN 'DEFAULT (pk)' WHEN 'f' THEN 'FULL (whole row)'
                    WHEN 'i' THEN 'INDEX' WHEN 'n' THEN 'NOTHING' END AS replica_identity
FROM pg_class
WHERE relname IN ('document_annotations','document_presence','documents');

-- 11. Index usage / unused-index hunt on document_annotations
SELECT indexrelname AS indexname, idx_scan, idx_tup_read, idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname = 'document_annotations'
ORDER BY idx_scan ASC;

-- 12. Table bloat + autovacuum status
SELECT relname, n_live_tup, n_dead_tup,
       round(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 1) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN ('document_annotations','document_history_events','documents')
ORDER BY n_dead_tup DESC;

-- 13. RLS policy inventory on document_annotations
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy JOIN pg_class ON pg_class.oid = pg_policy.polrelid
WHERE pg_class.relname = 'document_annotations'
ORDER BY polcmd;

-- 14. annotations_changed_at trigger present?
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'document_annotations';

-- 15. doc_yjs_state PK structure (lanes hit no `id` column)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'doc_yjs_state'
ORDER BY ordinal_position;

-- 16. Does the legacy public.annotations table still exist?
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('annotations','document_annotations');

-- 17. Storage objects by size (requires SQL-editor access to storage schema)
SELECT name, bucket_id, created_at, (metadata->>'size')::bigint AS size_bytes
FROM storage.objects
WHERE bucket_id = 'documents'
ORDER BY size_bytes DESC NULLS LAST
LIMIT 20;

-- 18. OFFSET vs keyset cost on the heavy doc (swap the UUID)
EXPLAIN ANALYZE
SELECT * FROM document_annotations
WHERE document_id = '<heavy-doc-uuid>' AND annotation_type IN ('survey-marker','surveyMarker')
ORDER BY page_number ASC OFFSET 1000 LIMIT 1000;

-- 19. Dead-table emptiness check before any disposition decision
SELECT 'survey_items' t, COUNT(*) c FROM survey_items
UNION ALL SELECT 'survey_sessions', COUNT(*) FROM survey_sessions
UNION ALL SELECT 'doc_yjs_updates', COUNT(*) FROM doc_yjs_updates
UNION ALL SELECT 'document_revisions', COUNT(*) FROM document_revisions
UNION ALL SELECT 'activity_log', COUNT(*) FROM activity_log;
```

---

## 7. How this changes the rebuild plan

The live data doesn't invalidate the persistence-architecture migration — but it **reorders the front of it and adds three steps the current plan probably assumes away.**

1. **Promote a "lifecycle & retention" workstream to the front.** The plan likely treats archive/delete as a UI concern. The data says it's the dominant structural problem: 97.9% dead annotation rows, 85% dead YJS state, no cascade, no purge, growing on every archive. **Cascade-on-archive + a retention/GC job must be a named early phase**, not a cleanup epilogue — otherwise you migrate 52k rows of garbage into the new schema and pay to carry it.

2. **Make storage-path keying a first-class migration step, and sequence it before any storage GC.** Time-based filenames mean you *cannot* GC storage today. Re-keying to `{user_id}/{document_id}.pdf` (step 14) is a prerequisite for the hard-delete path (step 13) — they're coupled and must land in that order. This is new scope if the plan currently treats storage as "already fine."

3. **Treat the `--include-all` / `user_can_access_document` fragility as a migration-safety blocker.** If the rebuild involves a schema cutover via `db push`, the broken `created_by` version can silently re-win and take down all RLS. The plan needs an explicit "migrations are not replayable from scratch — pin and test the access helper, never `--include-all`" guardrail before any cutover phase runs.

4. **The good news — don't over-scope the read layer.** Keyset pagination, delta writes, watermark skip, and the `UNIQUE(document_id, annotation_id)` guard already exist and work. The rebuild should **preserve** these, not re-derive them. The two carry-forward items that fold naturally into the rebuild are finishing the surveyMarker→new-path migration (which then lets you delete the duplicate realtime channel and the OFFSET reader) and wiring real RLS on the YJS/activity tables **in the same push** as the Phase 32 code. Everything else in §5 marked **Now** is safe to land ahead of the rebuild and will make the migration start from a cleaner, smaller, more reliable base.

**Net:** the rebuild's sequencing should become **retention/cascade → storage re-keying → migration-safety guardrails → surveyMarker cutover (+ realtime/OFFSET cleanup) → YJS/activity RLS**, with the §5 "Now" fixes (especially #1, #2, #4) landed immediately and independently, since they reduce reliability and WAL risk regardless of when the larger rebuild ships.
