# last-owner-race

## P2-23 — Two owners removing each other can leave a document ownerless
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/migrations/20260820220000_kal31_guard_last_owner_lock.sql` (new)
- Intended behavior confirmed: `kal31_guard_last_owner` now `PERFORM … FOR UPDATE` on every active owner row for the document before `COUNT(*)` on both UPDATE (demote) and DELETE (remove). Concurrent removals serialize; the waiter re-counts after the first commit.
- Break / adversarial attempts: a COUNT-only DELETE branch (the old race) is rejected by the migration contract. Protocol model: unlocked snapshots leave 0 owners; lock-then-count leaves 1.
- Edges covered: parent-document FK cascade still returns before the owner lock (`IF NOT EXISTS documents … RETURN OLD`). Function hardening/grants unchanged. Existing cascade tests against `20260802010000` still pass.
- Test command + result: `node --test tests/kal31LastOwnerLockMigration.test.mjs tests/kal31LastOwnerCascadeMigration.test.mjs` → 7/7 pass.
- Remaining risk: migration is not yet applied to prod. Tests are SQL-contract + a lock protocol model, not a live READ COMMITTED isolation race against Postgres.
