# Tier B item 1 — duplicate-upload handling + storage re-key (decision 6, KAL-277/267/290/281)

Session 2026-07-08 (worktree `duplicate-upload-storage-cleanup-6b2d6e`). Locked spec:
MASTER-PLAN-2026-07-07 §3 Tier B #1 + decision 6 (DECISION-BATCH-2026-07-07). LOCAL ONLY —
not pushed, prod DB not written (dry-runs only) until Isaiah's go.

## What already existed at HEAD (do not re-build)
- `documents.content_sha256` + unique index `documents_user_project_sha_uidx`
  (rebuild migration 20260606, live in prod).
- Content-addressed uploads `{user}/{sha}.pdf` + silent identical-bytes reuse/unarchive
  in `createDocument` (8b0a3577) + KAL-267 23505 race fix (ffb12ec9).

## Built this session
1. **Three-way upload UX (decision 6)** — `src/utils/incomingFileResolver.js` rewritten
   (hash-based `resolveIncomingUpload` + `shouldOfferAlias`; old name+size heuristic deleted),
   new `src/components/DuplicateUploadModal.jsx` (modes: version / alias), wired into BOTH
   Dashboard upload paths + project-create bulk path now content-addresses too.
   - identical bytes, same name → silent reuse (unchanged, server-enforced)
   - identical bytes, different name → reuse + alias offer (gated: only when the row
     has `name_aliases`, so the app is safe before the prod migration is applied);
     opens the EXISTING doc by its own identity (prevents a double tab of one document)
   - same name, different/unknown bytes → modal: Open existing / Upload as new version
     (new version archives the old row; marks preserved). Escape/backdrop = cancel upload.
   - Alias names are searchable in the Documents search box.
2. **Migration** `supabase/migrations/20260716043104_document_name_aliases.sql`
   (`name_aliases TEXT[] NOT NULL DEFAULT '{}'` — additive, metadata-only default).
   NOT applied to prod yet (owner-gated, applies with the push).
3. **Maintenance script** `scripts/content-hash-maintenance.mjs` — modes `audit` (read-only) /
   `backfill` / `rekey`, dry-run DEFAULT, `--apply` gated, service key via .env/.env.local or
   `SUPABASE_MAINT_URL/KEY`. Backfill: download+hash legacy rows, write sha; unique-index
   collisions reported + skipped (manual merge). Rekey: copy → verify → repoint row
   (service_role passes the file_path-immutability trigger) → delete old object only after
   ALL referencing rows moved. Orphans (both directions) report-only — deletion is
   decision-7/Trash territory.

## Evidence
- Gates: `npx vite build` clean; `node scripts/run-node-tests.mjs` 1879/1795 pass/0 fail/84 skip
  (HEAD baseline same skips, +10 tests from this work).
- Prod dry-runs (READ-ONLY), reports in `debug/content-hash/` (gitignored — they
  carry live document names/paths; local artifacts only):
  - AUDIT: 122 rows (21 active), 119 need sha backfill, 164 legacy time-named objects,
    4 content-addressed, 15 orphan rows, 61 orphan objects, 0 sha collisions recorded yet.
  - BACKFILL DRY-RUN: 89 clean writes, 15 collisions (the known KAL-286 duplicate residue —
    manual keep-oldest merge), 15 missing-object rows skipped, 0 errors.
- survey-test E2E (write path proven on the TEST project, seeded + cleaned up):
  backfill --apply wrote shas, skipped collision + missing-object; rekey --apply moved
  objects, repointed rows through the trigger, deleted old objects only when safe. PASS.
- Browser verification (worktree dev server, port 5199, real backend, Playwright):
  all five scenarios pass — new upload; identical re-upload silent reuse (no dup);
  version modal → Open existing; version modal → new version (old archived, list correct);
  identical-bytes-different-name reuse (no dup tab, alias offer correctly suppressed
  pre-migration). Screenshot: `.playwright-mcp/duplicate-version-modal.png` (untracked).
  Found+fixed during verification: alias path used to open a SECOND tab of the same
  document (name-keyed tab matcher) → presence-channel crash; now opens the existing doc.
  Test artifacts removed from prod afterward (rows + objects).

## Review log
Round 1 (all three independent; findings consolidated and ALL addressed):
- Adversarial reviewer #1 (upload flow, Opus): 6 findings — archive-before-create
  non-atomicity (High); version-ask could target collaborator-owned rows; throw
  path could lock the file input; misleading modal copy for null-sha legacy rows;
  stale/empty candidate lists could skip the ask; overlapping modals dropped a promise.
- Adversarial reviewer #2 (script safety, Opus): rekey refcount blind to non-moving
  rows sharing an object (could orphan a null-sha row's file); cross-tenant doctored
  file_path rows (pre-immutability-trigger IDOR residue) must be skipped; 409-copy
  destination never byte-verified; pagination caps could silently truncate; live-app
  race accepted as documented operator-run limitation.
- Codex (GPT-5.5) round 1: VERDICT REVISE — overlapped the above, plus: shared
  content-addressed object could be deleted by deleteDocumentEverywhere while another
  row references it (fixed with a sharer check); project-create bulk path could mint
  same-name twins (fixed with in-batch numbering); debug/content-hash reports carry
  live metadata (now gitignored, local-only).

Fixes verified by: unit tests (2 added), survey-test E2E re-run incl. the null-sha
sharer scenario (shared old object KEPT), fresh browser pass (version modal, open
existing, zero console errors), build + full suite green (1879/1797/0/84).

Rounds 2–6 (iterative re-verification until ALL THREE agreed on the same code):
- Reviewer #2 (scripts): ROUND2 APPROVED — all script fixes verified in code;
  error-mid-loop keeps objects (leak not loss); snapshot race accepted on
  concrete grounds (app can never re-reference a legacy path).
- Codex rounds 2–5 kept finding real residue, each fixed: archive must wait for
  STORAGE durability (moved into the post-upload continuation, both paths);
  sharer-check must fail SAFE on query error (keep object); bulk path now
  auto-records the alias for identical-bytes/different-name; the dedup-reuse
  branch now upserts the held bytes to the ROW'S OWN storage key before
  archiving/opening (heals missing-object rows; kills the 404 → auto-cleanup
  hard-delete cascade). Codex round 6: **VERDICT: APPROVED**.
- Reviewer #1 (upload flow): ROUND3/4 APPROVED the interim states, ROUND5
  caught the browser path missing the retargeted heal (raced the edit),
  ROUND6: **APPROVED** — confirmed both paths identical, ordering and
  single-archive guarantees intact.
Final gates after the last fix: build clean, 1881 tests / 1797 pass / 0 fail / 84 skip.

## Run order when Isaiah says go
1. Apply `20260716043104_document_name_aliases.sql` to prod (dashboard SQL, additive).
2. `node scripts/content-hash-maintenance.mjs backfill --apply` (89 rows; collisions stay for manual merge).
3. `node scripts/content-hash-maintenance.mjs rekey --apply` (re-keys backfilled rows).
4. Push the app code.
5. Leftovers for later slices: 15 collision rows (KAL-286 keep-oldest merge), 15 orphan rows,
   61 orphan objects (deletion belongs to the decision-7 Trash system).
