# Migration version dedupe — Duplicate `20260820010000`

- Date: 2026-08-20
- Status: **closed**
- IDs: releaseIntegrity `Duplicate Supabase migration version`
- Worktree: `nifty-elion-773074`
- No commit. Migrations renamed in-tree only — **not applied**. SQL contents unchanged.

## Verdict

Parallel restore workers reused `20260820010000` for both invite-tier and account-deletion. Only those two collided. Bumped the account-deletion restore copy to a free slot; left invite, billing, last-owner, and excel versions alone.

## Old → new

| Old | New |
| --- | --- |
| `20260820010000_account_deletion_collaborator_guard.sql` | `20260820020000_account_deletion_collaborator_guard.sql` |
| `20260820010000_invite_tier_gate_and_revoke_access.sql` | unchanged |
| `20260820120000_billing_trial_used_and_event_idempotency.sql` | unchanged |
| `20260820220000_kal31_guard_last_owner_lock.sql` | unchanged |
| `20260820230000_kal309_create_identity_guard.sql` | unchanged |

## Files changed

- `supabase/migrations/20260820020000_account_deletion_collaborator_guard.sql` (renamed; contents identical)
- `tests/accountSettingsLogic.test.mjs` — hardcoded path updated to the new filename

Invite-path tests (`kal31InviteContract`, `sharingInvitesLogicAudit`) still read `20260820010000_invite_tier_gate_and_revoke_access.sql`.

## Tests

```
node --test tests/releaseIntegrity.test.mjs
node --test tests/accountSettingsLogic.test.mjs
node scripts/run-node-tests.mjs
```

- `tests/releaseIntegrity.test.mjs`: **7/7 pass**
- `tests/accountSettingsLogic.test.mjs`: **15/15 pass**
- Full Node suite (`run-node-tests.mjs`): **exit 0** — no remaining failures

## Remaining risk

Rename is local-only. Remote/applied history is untouched. If a remote already recorded `20260820010000` as account-deletion (unlikely; both were unapplied restore copies), apply order would need a human check before `supabase db push`.
