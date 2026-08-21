# P2-10 / P2-21 / P2-23 — SQL identity + last-owner restore

- Date: 2026-08-20
- Status: **restored** (in-tree only; **not applied** to prod)
- IDs: **P2-10**, **P2-21**, **P2-23**
- Source: transcript [excel / last-owner SQL](75ba2e73-eb59-45ff-8eb2-37172dbe1f68) (`excel-identity-sql.md`, `last-owner-race.md`). Reconstructed from those Write/StrReplace payloads + live `20260626180000_kal309_store_applied_fingerprints.sql`.

Did **not** edit: `PDFViewer.jsx`, CORS `Access-Control-Allow-Origin: '*'`, `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`. Did **not** apply migrations. No commit.

## Verdict

**SQL landings are back on disk.** Create now runs the apply-path field/template whitelist (P2-21) and reuses a same-scope non-empty identity fingerprint instead of minting a second Survey Marker (P2-10). Last-owner UPDATE/DELETE now `FOR UPDATE` sibling owner rows before `COUNT(*)` (P2-23). Existing cascade tests against `20260802010000` still pass.

## Files restored

| Path | IDs |
|---|---|
| `supabase/migrations/20260820230000_kal309_create_identity_guard.sql` | P2-10, P2-21 |
| `supabase/migrations/20260820220000_kal31_guard_last_owner_lock.sql` | P2-23 |
| `tests/excelIdentityCreateGuard.test.mjs` | P2-10, P2-21 |
| `tests/kal31LastOwnerLockMigration.test.mjs` | P2-23 |

## What was restored

### P2-10 — Excel create identity / fingerprint guard

`kal308_apply_changeset` create used to mint a new `marker_annotation_id` every time. A SharePoint-tier re-import of the same Excel row therefore created a second Survey Marker.

Create now looks up `(document_id, template_id, scope_id, identity_vector_fingerprint)` for a **non-empty** fingerprint (`identityRecord` first, else `baseFingerprints`). A hit converts the op to apply-against-existing (`v_outcome := 'applied'`, `v_op_type := 'apply'`, same marker id). Open `client_conflict_review` on that row routes to `review` (no second mint). Empty fingerprints never match — two blank imports still mint independently.

Belt-and-suspenders: partial unique index `excel_sync_state_identity_fingerprint_uidx` on the same tuple, excluding `NULL` / `''`.

### P2-21 — create runs the apply whitelist

Create skipped the apply-path field/template whitelist. It now uses the same allowed keys (`changedBy|changedDate|item|entity|notes` + `answer:` / `answer.`) and, when `p_template_config` is present, the same checklist-id / entity-value checks. Missing `changedFieldKeys` falls back to `fields` object keys. Empty/absent fields are structurally ok. A `secret` / `answerKeys` / unknown `answer:` / entity not in the template sets `v_outcome := 'review'` and never mints.

### P2-23 — last-owner lock before counting

`kal31_guard_last_owner` counted remaining owners without locking. Two concurrent owner removals could each observe the other as still active and leave the document ownerless.

Both UPDATE (demote) and DELETE (remove) now `PERFORM … FOR UPDATE` on every active owner row for the document **before** `COUNT(*)` excluding `OLD.user_id`. Parent-document FK cascade still returns before the lock (`IF NOT EXISTS documents … RETURN OLD`). Grants / `SECURITY DEFINER` / `search_path = ''` unchanged.

## Grep-proof

```
rg -n "excel_sync_state_identity_fingerprint_uidx|identity_vector_fingerprint = v_base_iv|v_op_type := 'apply'" \
  supabase/migrations/20260820230000_kal309_create_identity_guard.sql
# 6: unique index
# 366: fingerprint lookup
# 377: convert create → apply

# create branch contains:
#   changedFieldKeys
#   v_key NOT IN ('changedBy','changedDate','item','entity','notes')
#   v_key NOT LIKE 'answer:%'
#   p_template_config IS NOT NULL
#   v_outcome := 'review'
#   v_changed_keys := '[]'::jsonb

rg -n "FOR UPDATE" supabase/migrations/20260820220000_kal31_guard_last_owner_lock.sql
# 29: UPDATE branch lock
# 61: DELETE branch lock
# both precede SELECT COUNT(*) INTO remaining_owners
```

## Test command + result

```
node --test \
  tests/excelIdentityCreateGuard.test.mjs \
  tests/kal31LastOwnerLockMigration.test.mjs \
  tests/kal31LastOwnerCascadeMigration.test.mjs
```

**16/16 pass.** P2-10/P2-21: 9/9. P2-23 lock: 4/4. Existing cascade contract (`20260802010000`): 3/3.

## Remaining risk

- **Not applied.** Prod still runs the mint-always create branch and the unlocked last-owner count until these two files are migrated. This restore did not `db push`.
- **P2-10 unique index apply can fail** if prod already has two non-empty identical fingerprints in the same `(document, template, scope)`. Clean those rows before apply.
- **Empty fingerprints still mint duplicates** (intentional; same as the original landing).
- **Two concurrent first-creates of the same new fingerprint** can both miss the `SELECT … FOR UPDATE` and race the INSERT. The unique index fails the second; the RPC is not given an explicit unique-violation → `applied` handler.
- **Clients that ignore `outcome=applied`** can still locally mint a second marker. Client matcher is out of this allowlist.
- **Client `overlayChangedFields` still does not validate `answer:<id>`** (out of allowlist).
- **P2-23 tests are SQL-contract + a lock protocol model**, not a live READ COMMITTED isolation race against Postgres.
- **`FOR UPDATE` of all owner rows** can deadlock if two removers lock in different physical orders. Same-query lock order usually matches; not proven live.
