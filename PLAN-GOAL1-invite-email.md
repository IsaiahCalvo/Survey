# PLAN v3 — GOAL-1 invite-email delivery fix (two-branch invite send)

_2026-07-07 scheduled session. Governing spec: GOAL-autonomous-post-launch.md
work item 1 (pre-decided defaults). Never push to main; commit locally,
DONE-AWAITING-PUSH. v3 after Codex rounds 1–2 REVISE (log:
PLAN-GOAL1-REVIEW-LOG.md)._

## Problem

Invite/share emails (document/project/template) go out via the `send-email`
edge function → Resend on `walkthru.tools`. Gmail silently discards them
(zero-reputation domain; Resend reports `delivered`). Account emails
(confirm/reset) deliver fine via the Supabase auth mailer.

## What changed since the goal was written (verified live, read-only)

- `smtp_host` is NO LONGER `null` — Isaiah configured **Brevo SMTP**
  (`smtp-relay.brevo.com:587`, sender `Survey <no-reply@surveytool.app>`).
  The goal's "check smtp_host is still null" guard is stale; the invariant
  becomes: **change NOTHING in auth config; snapshot before/after proves it.**
- `site_url = https://surveytool.app`; `uri_allow_list` contains
  `https://surveytool.app/**` → `redirectTo` to `/invite/<token>` permitted.
- A branded **Invite template is already installed** (subject "You've been
  invited to Survey", body uses `{{ .ConfirmationURL }}`) — goal step 2's
  template sub-task is owner-done. Auth email rate limit: 30/hr.

## Design v2 — one edge function `send-invite-email`, both branches server-side

Client sends `{ token, displayName, inviterName }`. Only `token` is
security-relevant; displayName/inviterName are cosmetic email copy (escaped
downstream by send-email's existing escapeHtml). Recipient, role, kind, and
ALL URLs are derived server-side from the invite row — never from the client.
**The response is generic (`{ sent: true }` / error status) in both branches —
no `exists` field, so the function is not an account-existence oracle
(round-1 #3) and dev-origin localhost links can never be emailed (round-1 #8).**

Function flow:

1. **Caller auth**: `Authorization: Bearer <jwt>` must resolve via
   `auth.getUser()` to a real user; reject missing/anon-key tokens.
   Deployed with **`verify_jwt = false`** + a config.toml entry with the
   standard comment — the gateway JWT check rejects CORS preflight OPTIONS;
   same documented pattern as `excel-apply-changeset` (round-1 #2).
2. **Ownership check with the CALLER's OWN authority (round-1 #9)**: build a
   caller-scoped client (anon key + the caller's Bearer JWT) and SELECT the
   token from `document_invites` → `project_invites` → `template_invites`.
   RLS owner-select policies (`user_can_access_document/project/template(id,
   'owner')`) make the row visible only to CURRENT owners of the resource —
   exactly the same semantics as the existing resend/revoke RPCs, so
   co-owner resends work. No bespoke `created_by === caller` rule.
   Require: row found, `target_email` non-null, `revoked_at IS NULL`,
   `accepted_at IS NULL`, `expires_at > now()`. Otherwise 404/403 (uniform
   "invite not found or not yours" error — token, not email, is the input,
   so this rejects relay attempts without leaking anything).
3. **Branch A (new user)**: service-role
   `auth.admin.inviteUserByEmail(target_email, { redirectTo:
   'https://surveytool.app/invite/<row.token>' })` — canonical origin
   hardcoded (the only allowlisted origin). supabase-js admin calls RETURN
   `{ data, error }` — they do not throw; detect the existing-account case by
   `error.code === 'email_exists'` (fallback: `error.status === 422` +
   message match) (round-1 #4). Success → email goes out via the proven
   Brevo auth mailer + installed template → `200 { sent: true }`.
4. **Branch B (existing account)**: on `email_exists`, the function itself
   calls the deployed `send-email` function server-to-server with the
   SERVICE-ROLE key (its documented trusted-caller path), template
   `document-invite`, `to = row.target_email`, `inviteUrl =
   https://surveytool.app/invite/<row.token>` (canonical, server-built),
   role/expiry from the row, kind-phrased display name from client copy
   (`the project "X"` etc. — same phrasing the client uses today).
   → `200 { sent: true }`. Resend/walkthru.tools stays the transport per the
   goal's default (a).
5. Any other invite error or fallback-send failure → 502 `{ sent: false }`
   (no branch information). CORS wildcard + OPTIONS preflight with the
   INTENTIONAL comment block (CLAUDE.md enforced rule).
6. **Testable core (round-1 #10)**: the whole handler lives in
   `supabase/functions/send-invite-email/handler.js` (plain-JS pure function
   with injected deps: `getUserFromToken`, `findInviteAsCaller`,
   `inviteUserByEmail`, `sendFallbackEmail`). `index.ts` is a thin Deno.serve
   wrapper wiring real deps. Node tests exercise the handler directly.

### Client changes (minimal)

`shareEmailService.js`: new `sendInviteEmailSmart({ token, displayName,
inviterName, kind })` → `supabase.functions.invoke('send-invite-email', ...)`;
never throws. **NO legacy client-side fallback at all (round-2 #1): on ANY
function failure we console.warn and send nothing** — a 403/404/409 means the
server refused for a reason (revoked/accepted/expired/not-owner race) and a
client-built email could carry a localhost or stale link. Email delivery is
already best-effort by contract; the failure mode is the same silent-warn the
app has today. The three legacy client invite senders
(`sendDocumentInviteEmail`/`sendProjectInviteEmail`/`sendTemplateInviteEmail`)
become dead and are DELETED in the same diff (the permission-changed and
access-removed senders stay — still used). Six call sites (create + resend ×
3 services) swap to the smart call inside the existing best-effort try/catch.
Link-only invites (no email) untouched. Account-recovery paths untouched.

## Round-1 findings NOT built, with reasons (documented, not dropped)

- **#1 send-email open-relay hardening** (any signed-in user, arbitrary
  to/subject/template): PRE-EXISTING surface, unchanged by this work — our
  new function narrows its own sends to owner-verified minted invites and
  does not widen send-email. Re-architecting the shared mailer (also used by
  stripe-webhook) is outside GOAL-1's decided scope; **filed as a follow-up
  security item in the GOAL log + decision batch** so it is not lost.
- **#5 free-tier invite gating is UI-only**: also pre-existing (RLS insert
  policies check ownership, not tier). Our function's bound is honestly
  documented as "current resource owner with a live minted invite row" — the
  tier gap is part of the same follow-up item as #1. No overclaim of RLS.

## Resend "one real check" (round-1 #7 — honest scope)

No Resend API key and no inbox access exist on this machine (function-secret
API returns digests only). The check is therefore EXECUTED but its
confirmation is owner-only: during live verification we send one REAL invite
to isaiahcalvo123@gmail.com (existing account → Branch B → Resend), and the
wind-down message asks Isaiah the single decisive question — did it land in
Gmail. Building fallback (b) (verify mail.surveytool.app in Resend) requires
the Resend dashboard = owner-only, so default (a) stands regardless of the
answer; if Isaiah reports "still not landing", (b) becomes his 5-minute
dashboard step + one secret update, already documented in
OWNER-ACTIONS-BEFORE-LAUNCH.md.

## Known limits (accepted, documented)

- User invited via Branch A who never accepts: on resend they now exist →
  Branch B (Resend). Rare; acknowledged.
- Branch A creates the auth user at send time (GoTrue invite semantics);
  revoking the app invite doesn't delete the auth user; kal31 RPCs still
  gate all access.
- New-user accepts land signed-in but passwordless; the (working) reset flow
  sets a password later. Out of scope.
- displayName/inviterName remain client-supplied copy (escaped; same power
  as naming your own document).

## Tests (node suite; executable handler tests, not regex-only)

`tests/goal1SendInviteEmailFn.test.mjs` — import handler.js with mocked deps:
- 401: missing token / anon-key-style rejection (getUser returns null).
- 404: token not visible to caller (non-owner / unknown).
- 403/409-family: link-only (no target_email), revoked, accepted, expired.
- Branch A success → inviteUserByEmail called with row email + canonical
  redirectTo; response {sent:true}; no exists field.
- email_exists (error.code + 422 variants) → fallback send invoked with
  canonical URL; response {sent:true} identical to Branch A.
- fallback failure → 502 {sent:false}.
- OPTIONS → 200 with wildcard CORS headers.
`tests/goal1InviteClientContract.test.mjs` — source-contract assertions:
six call sites call sendInviteEmailSmart; **NO legacy invite-sender
import/call/fallback remains anywhere** (sendDocumentInviteEmail /
sendProjectInviteEmail / sendTemplateInviteEmail deleted from
shareEmailService and unreferenced); config.toml has verify_jwt=false +
comment for the new function; index.ts wires handler.js thin and builds the
invite lookup client from ANON key + caller Authorization header.

## Gates & verification

1. `npx vite build` clean; `node scripts/run-node-tests.mjs` — pass count
   never drops (last recorded 1810/1726/0/84; restate observed).
2. Deploy `send-invite-email` (--use-api, no Docker) to prod ref
   cvamwtpsuvxvjdnotbeg with verify_jwt=false. Additive-only until Isaiah
   pushes the client.
3. Auth config snapshot before/after — byte-identical (we write nothing).
4. **Live verify (mint on local dev client against prod backend; accept on
   the LIVE surveytool.app bundle):**
   - Branch A: invite `isaiahcalvo123+survey-invite-a@gmail.com` → 200
     {sent:true}; service-role admin lookup shows the new user with
     `invited_at` set → the real Brevo email is in Isaiah's actual Gmail
     (plus-alias) as his clickable artifact. LEFT UNTOUCHED.
   - Full accept loop, REAL invite-verify path (round-1 #6, round-2 #2/#3):
     second alias `+survey-invite-b` → invite via the function (real email
     also sent) → `admin.generateLink({ type: 'invite', email:
     '<alias-b>', options: { redirectTo:
     'https://surveytool.app/invite/<app-token>' } })` — the
     SAME verify-URL class + redirect the email's `{{ .ConfirmationURL }}`
     carries (regenerated token) → consume in the browser → GoTrue verify →
     session → redirect to live `/invite/<token>` → accept → confirm access
     (collaborator visible / document opens). Only the literal mail-client
     click is untested; alias-a covers that when Isaiah opens it.
     **If GoTrue refuses invite-type generateLink for an already-invited
     user, live verification is INCOMPLETE — do not mark the item done;
     document the state and leave the final click to Isaiah's alias-a
     email.** No magiclink substitute counts as a pass.
   - **Real-dependency negative probes (round-2 #4), run live:** call the
     deployed function with (i) the anon key only → expect 401; (ii) a
     second real account's JWT + the first account's invite token → expect
     404 (RLS owner-scoped lookup denies). This exercises the REAL
     caller-scoped RLS wiring, not a mock. Plus source-contract assertions
     that index.ts builds the lookup client from the ANON key + caller
     Authorization header (service-role only for auth.admin + fallback send).
   - Branch B: invite `isaiahcalvo123@gmail.com` (existing account) → 200
     {sent:true} → send-email logs show the Resend id (the "one real check"
     artifact; inbox confirmation = Isaiah's one-liner).
5. Two independent adversarial review passes on the diff (subagents) +
   Codex result review until converged.
6. Commit locally with explicit staging (never `-A`). DONE-AWAITING-PUSH in
   GOAL log. Never push.

## Files touched

- NEW `supabase/functions/send-invite-email/index.ts` + `handler.js`
- `supabase/config.toml` (verify_jwt=false entry + comment)
- `src/services/shareEmailService.js` (smart helper)
- `src/services/{document,project,template}InviteService.js` (2 sites each)
- NEW `tests/goal1SendInviteEmailFn.test.mjs`,
  `tests/goal1InviteClientContract.test.mjs`
- Docs: GOAL log, OWNER-ACTIONS Brevo note, baton, review log.

No high-risk files. No auth-config writes. No DNS/Stripe. No pushes.
