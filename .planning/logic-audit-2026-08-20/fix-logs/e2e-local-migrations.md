# E2E leftovers — local/dev migration apply

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Verdict:** **blocked** — not applied  
**Does not mark the audit goal complete.**

Did **not** `db push` / `db reset` / apply to any remote. Did **not** wipe, Stripe-pay, create accounts, or use plus-aliases. No commit.

## Filenames on disk (confirmed)

| File | Bytes |
|---|---|
| `supabase/migrations/20260820010000_invite_tier_gate_and_revoke_access.sql` | 4882 |
| `supabase/migrations/20260820020000_account_deletion_collaborator_guard.sql` | 2304 |
| `supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql` | 1356 |
| `supabase/migrations/20260820220000_kal31_guard_last_owner_lock.sql` | 3173 |
| `supabase/migrations/20260820230000_kal309_create_identity_guard.sql` | 28939 |

## Exact blocker

Two independent stops. Either one is enough to refuse apply.

1. **Linked to production.** `supabase projects list` reports project **Survey** (`cvamwtpsuvxvjdnotbeg`, `us-east-1`, `ACTIVE_HEALTHY`) with `linked: true`. `supabase/.temp/linked-project.json` and `supabase/.temp/project-ref` match that ref. `config.toml` `project_id = "Survey"`. Client URL in the gitignored env is the same remote host. Instruction: if linked to production, **stop**.
2. **No local `supabase start` stack.** CLI `2.111.0` is installed (`/opt/homebrew/bin/supabase`). `supabase status` fails: `docker: command not found (podman also not found)`. Docker.app / Colima / Podman are not present. Nothing listens on `54321` / `54322`.

No local project ref to record. Remote production ref above was **not** targeted.

## Contracts (no live local DB)

Could not re-prove P2-01 / P2-03 / P2-28 / P2-29 / P2-10 / P2-23 against an applied local database.

Existing Node file/SQL-shape tests still pass:

```
node --test \
  tests/kal31InviteContract.test.mjs \
  tests/sharingInvitesLogicAudit.test.mjs \
  tests/accountSettingsLogic.test.mjs \
  tests/billing.test.mjs \
  tests/excelIdentityCreateGuard.test.mjs \
  tests/kal31LastOwnerLockMigration.test.mjs \
  tests/kal31LastOwnerCascadeMigration.test.mjs \
  tests/goal1InviteClientContract.test.mjs \
  tests/goal1SendInviteEmailFn.test.mjs
```

**84 / 84 pass.** Includes P2-01 / P2-05 invite gate + revoke, P2-03 collaborator deletion guard, P2-28 / P2-29 trial + Stripe event id, P2-10 / P2-21 identity create, P2-23 last-owner `FOR UPDATE`.

## Live leftovers this pass

Vite reused `http://localhost:5173` (this worktree; not killed). Harness: `debug/scenarios/e2e-local-migrations.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`. **1 / 1 passed** (5.8s). Owner-relay auto-login. No secret values logged here.

| ID | Result | Proof |
|---|---|---|
| A-03 / UL-24 leftover (email Send) | **pass** (fail-closed) | Signed-in Share → Invite → Send `not-an-email`. UI: `Enter at least one valid email.` No mint, no delivery, no plus-alias. |
| A-02 / UL-21 leftover (desktop Microsoft Connect) | **skipped** | Connected-services row already **Connected as**. Connect / Reconnect not shown. Did not Disconnect. Did not start OAuth. Did not type a password. |

## Still blocked

| Leftover | Why |
|---|---|
| Five in-tree SQL files | Production-linked + no local Docker. Not applied. |
| P2-01 / P2-03 / P2-28 / P2-29 / P2-10 / P2-23 live DB | Need those files applied on a **local** stack, then RPC/SQL against that DB. |
| A-02 live MSAL / OAuth cancel | Connect not visible on this auto-login user (already connected). |
| A-03 live email delivery | Invalid-address Send only. Did not send to a real inbox. |
| Stripe / captcha / two-client roster / Capacitor / identity-churn | Unchanged. |

## Files

- `debug/scenarios/e2e-local-migrations.spec.mjs`
- `.planning/logic-audit-2026-08-20/COMPLETION-AUDIT.md` — leftover list only

No product file edited. Invariants untouched.

No commit.
