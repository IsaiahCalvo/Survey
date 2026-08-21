# sharing-invites-restore — P2-01, P2-05, P2-33

Date: 2026-08-20
Status: restored (stomped landing re-landed; migration not applied)

## IDs restored

- **P2-01** (CRITICAL) — Free-tier sharing paywall is client-side only
- **P2-05** (HIGH) — Revoke pending invite does not remove already-granted access
- **P2-33** (MED) — Invite link → sign-in → dashboard; invite abandoned

## Why restore

`fix-logs/sharing-invites.md` (transcript) claimed these closed. Reconcile found the landing gone or contradicted:

- `20260820010000_invite_tier_gate_and_revoke_access.sql` was absent
- `send-invite-email/handler.js` had no `invite_blocked_free_tier` / `claimEmailSend` Branch A gate
- Live `kal31_revoke_document_invite` (`20260521000100`) only set `revoked_at`
- `pendingInviteResume.js` and `PendingInviteResumeGate` were absent
- `InviteAcceptPage` still wrote `kal31_pending_invite_token` then bounced to `?signIn=1` with no post-auth resume

## Files changed

- `supabase/migrations/20260820010000_invite_tier_gate_and_revoke_access.sql` (new; **not applied**)
- `supabase/functions/send-invite-email/handler.js`
- `supabase/functions/send-invite-email/index.ts`
- `src/services/documentInviteService.js`
- `src/services/pendingInviteResume.js` (new)
- `src/home/InviteAcceptPage.jsx`
- `src/home/ShareModal.jsx` (comment only: server also gates)
- `src/main.jsx` (`PendingInviteResumeGate` — required so post-auth dashboard boot can read `kal31_pending_invite_token`)
- `tests/sharingInvitesLogicAudit.test.mjs` (new)
- `tests/goal1SendInviteEmailFn.test.mjs`
- `tests/kal438ExistingUserInvite.test.mjs`
- `tests/inviteDeliveryConcurrency.test.mjs`
- `tests/inviteDeliveryMigration.test.mjs`
- `tests/kal31InviteContract.test.mjs`
- `tests/phase28/rls/08_document_invites_rls.sql` (seed owner as Pro so owner INSERT still tests ownership)

CORS `Access-Control-Allow-Origin: '*'` left unchanged. `PDFViewer.jsx` not edited.

## P2-01 — server-side tier gate + Branch A `claim_email_send`

- Intended: paid Branch A still claims `claim_email_send` (`document-invite`, recipient, `isInvite=true`) then calls `inviteUserByEmail` with the canonical `/invite/<token>` URL and returns `{sent:true}`.
- Break: free-tier `invite_blocked_free_tier` → 403, **no** `inviteUserByEmail`, delivery claim released so an upgrade can retry. Missing/error budget → 502 fail-closed. Rate-limit → 429. INSERT trigger + RLS `get_user_tier <> 'free'` on document/project/template invite tables; `auth.uid() IS NULL` left open for service-role/fixtures.
- Edges: `createDocumentInvite` maps `42501` / "Pro subscription" to the ShareModal upgrade copy. ShareModal UI gate kept.

## P2-05 — revoke drops `document_collaborators`

- Intended: `kal31_revoke_document_invite` still stamps `revoked_at` on pending invites **and** `DELETE`s the matching active collaborator (`LOWER(email)` = invite `target_email`).
- Break: never deletes `documents.user_id` (the creator) even if emails match. Link-only invites with no email grant delete 0 collaborator rows (invite still revoked).
- Edges: service still goes through the RPC (atomic with the grant drop).

## P2-33 — post-auth resume `/invite/<token>`

- Intended: after auth, `resumePendingInviteAfterAuth` reads `kal31_pending_invite_token` and `location.assign`s `/invite/<token>`. `PendingInviteResumeGate` in `main.jsx` runs only when `user.id` exists.
- Break: pre-auth (`user` null) does **not** navigate (so `/?signIn=1` can show login). Already on `/invite/<same-token>` is a no-op (no loop). Garbage / short tokens rejected. `wrong_account` keeps the key; accepted/expired/revoked/invalid/already_accepted clear it. `goHome` still clears.
- Edges: sign-in bounce still writes the key before leaving `/invite/`.

## Proof grep (after restore)

```
invite_blocked_free_tier          handler.js + claimEmailSend wiring
kal31_guard_invite_creator_tier   20260820010000_invite_tier_gate_and_revoke_access.sql
DELETE FROM public.document_collaborators
                                  same migration (revoke RPC)
PendingInviteResumeGate           src/main.jsx
resumePendingInviteAfterAuth      src/services/pendingInviteResume.js
kal31_pending_invite_token        pendingInviteResume + InviteAcceptPage + main comment
Access-Control-Allow-Origin: '*'  handler.js (unchanged)
```

## Test command + result

```
node --test tests/sharingInvitesLogicAudit.test.mjs tests/goal1SendInviteEmailFn.test.mjs tests/kal438ExistingUserInvite.test.mjs tests/inviteDeliveryConcurrency.test.mjs tests/inviteDeliveryMigration.test.mjs tests/kal31InviteContract.test.mjs tests/kal439SendEmailPolicy.test.mjs
```

**83/83 pass** (fail 0).

## Remaining risk

- The new SQL is not applied until this migration is deployed; until then a free-tier JWT can still INSERT invite rows and Branch A is only gated in the **next** deployed `send-invite-email`.
- Existing-account Branch A→B still spends one `claim_email_send` slot on the failed auth-mailer attempt, then send-email claims again (double-count toward the 30/hour cap, not a bypass).
- Revoke deletes **any** active collaborator whose email matches the pending invite, including a person who already had access before this invite. Creator row is protected; last-owner trigger could still block a delete of the only remaining owner-collaborator.
- Project/template revoke RPCs were not changed (P2-05 is document_collaborators only).
- `main.jsx` is outside the original file allowlist; the gate is the only way to resume after the dashboard bounce without editing AuthContext/AppShell.
