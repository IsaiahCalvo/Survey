# PRE-REBUILD READINESS — Save-and-Restore Rebuild (Yjs Single Source of Truth)

_Synthesis of four readiness lanes — collaboration/offline, data-migration, regression safety net, security. Prepared 2026-06-05 against HEAD `1c7f1eec`. Claims marked [verified] were re-checked against live code during synthesis._

---

## 1. Readiness Verdict

**NOT-YET — but the gap is closable in days, not weeks.**

We are not ready to write rebuild code today, and the single biggest blocker is the **complete absence of an end-to-end "draw → save → close → reopen → mark survives" regression test against a real cloud document** — every persistence spec that would prove the save path works is either `test.fixme`'d (`phase27-roundtrip.spec.mjs`) or deliberately bypasses Supabase (`?testPdf=` route), so we would be deleting the three patches that currently prevent mark-vanishing with no automated tripwire to catch the regression. Compounding this, a live GitHub PAT and a dev-account password are confirmed baked into the shipped bundle `dist/assets/index-DJ7KCQXV.js` [verified] and must be rotated before any new build ships. The data side is actually in good shape: the flat `document_annotations` table is the unambiguous single source of truth (the Yjs layer holds only 114 empty seed rows), so there is no store-divergence to untangle — only ~489 irreplaceable user-drawn marks to carry forward and ~52.7k re-import duplicates to dedup. The realtime layer is structurally sound but architecturally inverted (Supabase-first, Yjs-as-cache) with one genuinely dangerous line that wipes peer CRDT state on every open [verified: `durableYMap.clear()` at `useAnnotationCloudSync.js:1401`]. Close the safety net and the two critical security items first, run the migration verification dry-run, and this flips to **GO**.

---

## 2. The Mandatory Safety Net — Build BEFORE Any Rebuild Code

These are ordered. Each must be concrete and assertable. Nothing in Section 6 starts until all of these are green.

### 2.1 — Cloud roundtrip regression test (THE primary gate)
`agent-cli/roundtrip-save-reopen.mjs`. Using the real authenticated agent-cli client (model after `survey-roundtrip.mjs`, stub nothing):
- Open real cloud doc **SE-011 live `00e1cde9`** (known baseline: 51 user-drawn marks).
- Commit a new pen stroke via the real `upsertAnnotationsByPage` path; **poll until the `document_annotations` row is confirmed present** via the Supabase client (do not trust a fire-and-forget promise).
- Clear local state, re-run `loadAllNonSurveyMarkerAnnotations`.
- **Assert:** the new mark plus all 51 baseline marks are present in the reloaded `annotationsByPage`.
- This test must fail loudly if the mark is missing. It becomes the merge gate for every rebuild PR.

### 2.2 — Re-upload (same-file) survival test
- Open a cloud doc with known marks → trigger `classifyIncomingFile` with the same PDF → assert it returns `kind:'reuse'` with the correct existing `doc.id` (not a new doc) → reopen → **assert all prior marks visible.** This is the only regression guard for the `load-then-vanish` fix (`a9fc855d` / `1c7f1eec`), which currently has zero automated coverage.

### 2.3 — Un-fixme `phase27-roundtrip.spec.mjs`
- Either wire the `window.__test_openPdf` / `window.__test_goToPage` seams it depends on, or rewrite it to open via the real Dashboard UI. It directly asserts the **SC1 single-user Y.Doc round-trip** that is the foundation of the rebuild. While `test.fixme`, the rebuild's core contract is unproven.

### 2.4 — Patch-deletion safety tests (one per patch slated for removal)
Each proves that **deleting the patch would cause a visible regression** — so the new Y.Doc path can be validated against the same scenario:
- **`mergePreservingImportedMarks`:** draw an app mark + import a PDF mark on the same page → save → clear → hydrate from cloud → assert both survive.
- **`resolveSafeSnapshot` (empty-cloud guard):** simulate a cloud hydrate returning empty while local has marks → assert the guard fires and does not blank the canvas.
- **Self-heal re-import:** doc with blank Y.Doc snapshot but populated `document_annotations` rows → assert marks still display on open.

### 2.5 — Turn on the six skipped integration tests
- Set `SUPABASE_TEST_URL` in `.env.test` / CI and un-skip `byteaRoundTrip`, `schemaPresence`, `cryptYjsUpdatesSchema`. `byteaRoundTrip` in particular proves the Yjs binary-encoding persistence path works end-to-end — the exact path the rebuild stands on. (The two Hocuspocus tests stay skipped unless Hocuspocus is adopted.)

### 2.6 — Migration zero-loss verification harness (data side of the net)
Before any data is moved, build the verification script described in Section 4. It must compare per-annotation payload hashes between the pre-migration flat-table snapshot and the post-migration materialized Y.Doc, and refuse to promote any document that fails.

**Baseline to preserve:** 905 tests, 899 pass / 6 skip / 0 fail, ~1.7s. Do not let the new integration tests (which are slower) regress this count; gate them separately so a missing `SUPABASE_TEST_URL` skips rather than fails.

---

## 3. Realtime, Concurrency & Offline Readiness

### Current state vs target

| Dimension | Today | Target |
|---|---|---|
| Source of truth | **Supabase `document_annotations` flat table.** Yjs is a secondary cache, fanned out only after a successful Supabase upsert. | Y.Doc is the single writer; Supabase becomes a derived projection. |
| Conflict resolution | Blind last-write-wins per `(document_id, annotation_id)` on the Postgres row (`ON CONFLICT DO UPDATE`), debounced 800ms. Yjs LWW is authoritative **only in-memory, only for `cutover_completed_at`-sealed docs.** | Server-ordered CRDT merge via an append-only op log. |
| Durable op log | **Does not exist.** `doc_yjs_updates` table is present but deny-all RLS, zero client writes. All Yjs state is a single overwritten gzip snapshot in `doc_yjs_state`. | Immutable per-mutation append + periodic compaction checkpoint. |
| Offline | IndexedDB write always succeeds synchronously (good). Supabase/broadcast failures queue in two localStorage queues. `beforeunload` flush is fire-and-forget. | Local-commit-first, guaranteed eventual replay. |

### The dangers (severity-ranked)

- **CRITICAL — Cutover hydrate wipes peer CRDT state on every open.** [verified] At `useAnnotationCloudSync.js:1399-1406`, even when the comment says "Supabase durable snapshot wins initial load; Y.Doc is reshaped for live collaboration," the code unconditionally calls `durableYMap.clear()` + `durableCalloutYMap.clear()` then re-fans the Supabase snapshot. Any annotation a peer pushed into the Y.Doc since the last Supabase row-write is erased. This is the single most dangerous line in the file and a structural violation of the CRDT model.
  - **Nuance / conflict resolved:** the collaboration lane states sealed docs "always run the legacy SELECT and the durable result wins." That is **partially overstated** — at lines 1160-1199 there is a real cutover short-circuit: when `cutoverTs && phase30Ydoc`, the code reads `phase30Ydoc.getMap('annotations')` first and `ydocAuthoritativeRef` is set [verified]. The clear-and-refan danger lives on the **fallback / non-cutover branch** and the initial-load comparison path, not on every sealed-doc open. The risk is real; its blast radius is narrower than the lane's prose implied.
- **CRITICAL — Concurrent multi-device write race.** Two devices upserting the same annotation within the 800ms debounce: the later HTTP request silently wins. No `updated_at` compare, no advisory lock, no vector clock. For non-cutover docs this is the *only* conflict resolution.
- **HIGH — Large Y.Doc updates (>600KB pre-base64) silently dropped from realtime broadcast** (`SupabaseYjsProvider.js:206-219`). Documents with 22k+ imported strokes hit this on the first post-import update. Peers only catch up at next open. No retry, no NACK.
- **HIGH — `beforeunload` data-loss window** (up to 800ms). A stroke drawn and the tab closed within the debounce has its push killed by the browser.
- **HIGH — Focus-rehydrate overwrite race.** The `skipReplace` guard (line ~3272) compares *total* fabric counts, not per-annotation identity — "cloud has 3 more from another device" is indistinguishable from "queued local edits are missing."
- **MEDIUM** — Awareness routed through `globalThis.__crdtAwareness` side-channel (`useRemoteEditors.js:59`); document lock is advisory UI unless `document_annotations` RLS actually queries `documents.locked_at` (unconfirmed).

### What the rebuild must guarantee

1. **Y.Doc-first write ordering** — Supabase becomes a projection written by a server-side observer, never the authority. (Requires a working op log first — do not flip ordering until 3.2 exists.)
2. **A real append-only op log** in `doc_yjs_updates` (or a fresh `annotation_updates`): INSERT-only RLS for members, every mutation a durable row, ordered by a **server-assigned `server_ts = NOW()`** — never client `Date.now()` (Electron/mobile clock skew).
3. **Delete the `clear()`-and-refan** and replace with a per-key merge that only writes rows absent from the Y.Doc.
4. **No silent drops** — large updates go to the op log directly (bypassing the 600KB broadcast cap) and peers discover them via the log.
5. **Guaranteed offline replay** — write-ahead local journal so any user-acknowledged gesture is in IndexedDB before the network push; reconnect drain must be guarded against a concurrent hydrate overwriting queued state.
6. **Database-enforced locking** — confirm/add the `documents.locked_at` check in the `document_annotations` RLS policy, or document locking is pure theater.

---

## 4. Data-Migration Plan — Zero-Loss

**Ground truth (good news):** the two stores have never diverged. `document_annotations` is the only durable source (53,216 rows / 66 docs). `doc_yjs_state` is 114 empty seeds (`through_seq=0`); `doc_yjs_updates` is empty. So this is a **clean one-way bootstrap from the flat table**, not a reconciliation. The entire initial Yjs state is constructed during migration.

**What must survive:** ~489 user-drawn marks live + the archived user work (notably **SE-011-ARCH `97f95b32`: 388 user-drawn**, **Package2-ARCH `d30ac66b`: 30**). What must NOT bloat the op log: ~52,727 re-import duplicates (the 70dadd86 doc alone = 24,449 rows representing only **3,056 unique** `(page, pdfAnnotationId)` pairs from 9 re-import sessions).

### Ordered, zero-loss plan

**STEP 0 — Full backup (irreversible-action insurance).** `pg_dump` / JSONB export of `document_annotations` to a file stored *outside* the database. The table has no soft-delete; any wrong-delete is unrecoverable without this. **Gate everything below on this existing.**

**STEP 1 — Baseline + dedup-preview queries (read-only, no writes).** Run the three SQL queries to establish ground truth and save as `migration_baseline.json` + `user_drawn_marks_checkpoint.json`:
- Per-doc/type counts with `user_drawn = COUNT(*) FILTER (WHERE (annotation_data->'fabricObject'->>'isPdfImported')::boolean IS NOT TRUE)`.
- Dedup preview grouped by `(document_id, page_number, pdfAnnotationId) WHERE isPdfImported = true` — **must show 3,056 unique embedded refs for 70dadd86.**
- Full user-drawn inventory dump.

**STEP 2 — Resolve the archived-document policy (USER DECISION — see §7).** Do not write migration code until this is decided. If archived docs are excluded, 419+ real user marks (388 in SE-011-ARCH alone) become permanently unrecoverable. **Recommendation: include all documents, archived or not.**

**STEP 3 — Compute deduped canonical set per document (no writes).** Node/Python script: split rows by `isPdfImported` **first** (this ordering is critical — see risks). Keep **all** user-drawn marks (every one irreplaceable). For embedded marks, dedup by `(page_number, pdfAnnotationId)`, keeping the **latest by `created_at`**. Dedup key is `(document_id, page_number, pdfAnnotationId)` — **page-number is mandatory** (the same `pdfAnnotationId` appears on multiple pages, e.g. page 11 `6400R` × 14). Validate: 70dadd86 → 1 user-drawn + 3,056 embedded (not 24,450).

**STEP 4 — Bootstrap Y.Doc snapshots from the deduped set (smallest docs first).** For each doc build a `Y.Doc`, `annotationsMap.set(id, payload)`, `Y.encodeStateAsUpdate`, write via **`UPSERT` on `doc_yjs_state`** (`ON CONFLICT (document_id) DO UPDATE` — a plain INSERT fails on the 66 already-seeded docs). Use deterministic embedded IDs `import:<page>:<pdfAnnotationId>` until `content_sha256` exists. Order: (1) test/debug docs → (2) live non-archived (SE-011, Package2-live) → (3) archived-with-user-work → (4) remaining archived test docs. **Add a `migration_source` column** (`backfill-v1-flat-table` / `backfill-embedded-only` / `live-app`) to make rollback and regeneration distinguishable.

**STEP 5 — Per-document zero-loss verification (the harness from §2.6).** After each snapshot: deserialize it back into a Y.Doc, extract the map, and assert (a) every user-drawn mark from the checkpoint is present by original `annotation_id`, (b) embedded count = expected deduped count, (c) per-mark payload hash matches the pre-migration baseline. **On any failure, write that doc's `doc_yjs_state.state` as NULL** (keeping it on the flat-table read path) and log the diff. Do not promote a failing doc.

**STEP 6 — `content_sha256` backfill (parallel, non-blocking).** One-off script: download each PDF, compute SHA-256, write back in batches of 10 with backoff. Then `CREATE UNIQUE INDEX CONCURRENTLY ... ON documents(user_id, content_sha256) WHERE content_sha256 IS NOT NULL`. This is the only additive-but-irreversible step; run it after annotation bootstrap so it never blocks mark migration.

**STEP 7 — Dual-write validation on ONE doc, then expand.** Enable `isCRDTEnabled()` for SE-011 live `00e1cde9` only. Verify reads come from the Yjs snapshot, new marks dual-write to both stores, and a reload shows the 51 baseline + any new marks. Only after this is green does the flag expand.

**Rollback:** disable `isCRDTEnabled()` → app instantly reads `document_annotations` (never modified in Steps 0-5). Safe at any point before Step 7 expansion.

**Embedded-only docs (Package2-live `21cca3f9`, `b8f0c934`, `eddb45fc` — 0 user-drawn):** under the target, embedded marks re-derive from PDF bytes on first open via the deterministic import gate, so they need not be carried at all. As a migration-window safety net, still write their deduped set tagged `backfill-embedded-only` for cheap regeneration once the deterministic importer is live.

---

## 5. Security Must-Fixes

### Block launch (do BEFORE any new build ships)

1. **CRITICAL — Live GitHub PAT in the shipped bundle.** [verified: `VITE_GITHUB_LOG_TOKEN` present in `.env.local`; the literal `github_pat_11AKWFFEQ0…` string confirmed in `dist/assets/index-DJ7KCQXV.js`.] `contents:write` scope on `IsaiahCalvo/Survey` — anyone extracting the asar can push arbitrary files.
   - **Fix:** rotate the PAT now. Remove `VITE_GITHUB_LOG_TOKEN` from `.env.local`. Delete the browser/mobile direct-push fallback in `SaveLogBanner.jsx` (~lines 190-269) and the `fallbackToken` IPC param in `preload.js`. Route all pushes through the existing `electron-main.js` `gh`-CLI path; fail gracefully if unavailable.
2. **HIGH — Dev-account password in the bundle.** [verified: `VITE_DEV_AUTO_LOGIN_PASSWORD` in `.env.local`, bundled.] The `import.meta.env.DEV` guard stops auto-login firing in prod, but the plaintext creds are extractable and directly replayable against Supabase auth.
   - **Fix:** rotate the Supabase password for `isaiahcalvo123@gmail.com`; delete all `VITE_DEV_AUTO_LOGIN_*` vars; use a non-live test account loaded only by the dev server.
3. **HIGH — Unconstrained `fs:readFile`/`writeFile`/`appendFile` IPC.** `electron-main.js:783-820` accepts any renderer-supplied absolute path with no validation; the one guarded handler (`fs:clearDir`, "must contain TestLogs") is path-traversal-bypassable (`/etc/TestLogs/../passwd`). Any renderer XSS → arbitrary host read/write.
   - **Fix:** central path-allowlist middleware — `path.resolve()` then `startsWith()` check against `userData`, app Logs, and dialog-returned paths held in a main-process `Set`; reject with `EPERM`. **This blocks launch and matters more in the rebuild** if more sync runs through IPC.

### Can follow (fix during the rebuild window, not a launch gate)

4. **MEDIUM — `documents` storage bucket INSERT/UPDATE/DELETE policies are Dashboard-managed, unauditable from the repo;** `getPublicUrl` (`useDatabase.js:714`) hints the bucket may be public (path-guessable PDF read). Confirm in Dashboard → if public, switch to short-TTL signed URLs → move all bucket policies into SQL migrations. **The content-addressed dedup plan depends on trustworthy write policies**, so close this before Step 6 ships.
5. **MEDIUM — `user_can_access_document()` helper has been broken/restored 3×** (migrations `20260522010000`, `20260527130000`). All Yjs-table RLS depends on it. Run `SELECT prosrc FROM pg_proc WHERE proname='user_can_access_document'` against prod and confirm it matches the canonical `documents.user_id` body before the CRDT layer trusts it as a security boundary.
6. **LOW** — `debugFixturesPlugin` path traversal (dev-server only; `path.resolve` + starts-with fix, 2 lines). **LOW** — `oauth:openWindow` `redirectUri` unvalidated (exploitable only post-XSS; add a hard-coded origin allowlist).

**Clean surfaces (no action):** service-role key correctly excluded (no `VITE_` prefix, absent from bundle); anon key exposure is by-design.

---

## 6. Revised Rebuild Sequence

The original PERSISTENCE-ARCHITECTURE.md path was a 7-step data migration. Re-ordered to put the safety net and security blockers first, interleave migration checkpoints, and only flip the source-of-truth after proof exists:

**Phase A — Safety net + blockers (no rebuild code yet)**
- **A1.** Rotate PAT + dev password; strip `VITE_` secrets; ship the bundle clean (Security #1, #2). *Launch blocker.*
- **A2.** Add IPC path-allowlist (Security #3).
- **A3.** Build the cloud roundtrip regression test (§2.1) — the merge gate.
- **A4.** Build re-upload survival + the 3 patch-deletion safety tests (§2.2, §2.4).
- **A5.** Un-fixme `phase27-roundtrip.spec.mjs` (§2.3); turn on the 6 skipped integration tests with `SUPABASE_TEST_URL` (§2.5).
- **Gate A:** all of A3-A5 green, plus the 899-test baseline intact.

**Phase B — Migration dry-run (read-only + verification)**
- **B1.** Full backup (Step 0). **B2.** Baseline/dedup-preview queries (Step 1). **B3.** Decide archived-doc policy (§7). **B4.** Build + run the zero-loss verification harness (§2.6) against computed deduped sets — **no writes.**
- **Gate B:** dedup counts match expectations (70dadd86 → 3,056); harness passes for every user-drawn mark in dry-run.

**Phase C — Op-log infrastructure (the missing foundation)**
- **C1.** Activate `doc_yjs_updates` as a real append-only log (INSERT-only RLS, server `server_ts`). **C2.** Confirm `user_can_access_document()` in prod (Security #5). **C3.** Add the compaction/checkpoint job. *No source-of-truth flip yet.*

**Phase D — Bootstrap the data**
- **D1.** Steps 3-5: compute deduped set → write Y.Doc snapshots smallest-first → per-doc verification, failing docs stay on flat-table read.
- **D2.** Step 6: `content_sha256` backfill + UNIQUE index. Close storage-bucket policies (Security #4) before this. **D3.** Step 7: dual-write validation on SE-011 live only.

**Phase E — The source-of-truth pivot (the actual rebuild)**
- **E1.** Delete the `clear()`-and-refan (`useAnnotationCloudSync.js:1401-1402`); replace with per-key merge. **E2.** Invert write ordering to Y.Doc-first; stand up the server-side observer that projects into `document_annotations`. **E3.** Route large updates through the op log (kill the 600KB silent drop). **E4.** Harden offline: write-ahead journal + hydrate-guarded drain. **E5.** Fix the focus-rehydrate guard to compare per-annotation identity. **E6.** Wire awareness through a typed `getAwareness()` handle; enforce locking in RLS.
- **Gate E:** the §2.1 roundtrip test + re-upload test + un-fixme'd phase27 spec + `byteaRoundTrip` all pass. **Only now delete the three patches.**

**Phase F — Expand the flag** doc-by-doc, watching the roundtrip gate per document.

---

## 7. Open Decisions for the User

1. **Archived-document policy (blocks migration code).** Include archived docs in the Yjs migration? SE-011-ARCH `97f95b32` holds **388 real user-drawn marks**; Package2-ARCH `d30ac66b` holds 30. If excluded, these become permanently unrecoverable once the flat table is demoted. *Recommendation: include all documents.*
2. **Are the four Package 2 document rows (`70dadd86`, `5fa31b86`, `d30ac66b`, `21cca3f9`) genuinely distinct revisions to keep separate, or duplicates to consolidate?** Same filename, different sizes. The migration treats them as independent unless told otherwise.
3. **Confirm `documents` storage bucket is public or private** (Dashboard). This determines whether Security #4 is a "convert to signed URLs now" launch concern or a follow-up.
4. **Mobile/web log-upload story.** Removing `VITE_GITHUB_LOG_TOKEN` kills the browser direct-push path. Electron keeps working via the `gh` CLI. If a future mobile/web build needs log upload, it must go through a server-side function holding the PAT — confirm whether that path is needed now or deferred.
5. **`doc_yjs_updates` vs a fresh `annotation_updates` table** for the op log — revive the existing (currently deny-all, empty) table or create new? Either works; this is a naming/clean-slate preference.
6. **Server `server_ts` ordering** confirms we accept Postgres `NOW()` as the authoritative conflict order over client `Date.now()` — standard, but it means clients can momentarily see local-clock ordering differ from final server order. Confirm that's acceptable UX.
