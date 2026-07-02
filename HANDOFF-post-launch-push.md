# Handoff — post-launch push (continues from HANDOFF-mvp-wrapup.md)

_Written 2026-07-02, end of a long MVP-wrapup session. Everything below is
verified against the real live site and real production data — not assumed._

## Where things actually stand

**The live site is real and current.** `https://surveytool.app` resolves,
has a valid TLS cert, and is aliased to a Vercel production deployment built
from `main` at commit `432e6001`. Verified by downloading the actual served
JS bundle and grepping for feature strings — not just checking deploy status.
Everything from the MVP-wrapup session is live: real project/document/template
sharing, owner/editor/viewer roles enforced in the UI and on the server,
browser PDF export, account flows (signup/confirm/resend/reset/change
password), the save-reliability fix (BL-24 / KAL-316), and a security-advisor
hardening pass on the database (141 findings → 81, rest is by-design).

**Owner-only, explicitly parked — do not re-surface as a blocker:**
- Microsoft 365 / Excel live sync. Isaiah's company tenant blocks the app
  registration. The sync engine is fully built and dormant behind
  `LIVE_WRITEBACK_ENABLED`. No code work remains — this is 100% blocked on
  Isaiah finding a path (tenant-admin consent, a personal M365 Business
  tenant, or launching with "Excel import + review" wording). See
  `HANDOFF-excel-sync-next.md` for the technical checklist for whenever it
  unblocks.
- Stripe going live. No live keys exist anywhere on this machine; creating
  them requires Isaiah's Stripe dashboard login. See `OWNER-ACTIONS-BEFORE-LAUNCH.md`
  for the exact steps once he's ready.

## Do this first — no owner input needed

### 1. Invite-email delivery (investigated tonight, NOT built — do this first)

The problem: invite/share emails (project, document, template) go out via
the `send-email` edge function through Resend on the `walkthru.tools` domain
(borrowed from Isaiah's other product). SPF/DKIM/DMARC are all correctly
configured and verified, but Gmail is silently accepting-then-discarding
these emails — confirmed via Resend's own delivery API (`last_event:
delivered`) combined with the message never appearing anywhere in Gmail
(inbox/spam/trash/all-mail all checked). This is a known pattern: a brand-new
sending domain with zero engagement history gets silently filtered by Gmail
regardless of correct authentication. It self-resolves over real sending
volume, not instantly.

Account emails (signup confirm, password reset) are NOT affected — those go
through Supabase's own built-in mailer (`mail.app.supabase.io`), which has
established reputation and is confirmed delivering (a real password-reset
email was observed landing in Isaiah's inbox tonight). Auth SMTP is currently
rolled back to `null` (built-in mailer) in the Supabase auth config —
**do not repoint it at Resend/walkthru.tools without a real fix**, or account
recovery emails will silently break again the way invite emails already have.

**What was investigated tonight (verified against real Supabase/GitHub
source, not assumed):**
- `supabase.auth.admin.generateLink()` does NOT send an email itself — it
  only returns a link/token for the caller to email through their own system.
  It does not solve the delivery-reliability problem at all.
- `supabase.auth.admin.inviteUserByEmail()` DOES send a real email through
  the project's configured mailer (the same reliable one that delivers
  password resets), with a customizable email template and a `redirectTo`
  + `data` payload you control. This is the real lever.
- **The catch, confirmed against Supabase's own Go source
  (`internal/api/apierrors/errorcode.go`, `ErrorCodeEmailExists`):**
  `inviteUserByEmail` hard-errors (`email_exists`) if the target email
  already has a Supabase Auth account. Most real collaborator invites in this
  app are to people who ALREADY have a Survey account — so this only cleanly
  covers the brand-new-user case, not the common case.

**The actual scoped task for next session:**
1. Design a two-branch invite-send path in `documentInviteService.js` /
   `projectInviteService.js` / `templateInviteService.js` (all three, they're
   mirrors of each other): before sending, check whether the target email
   already has an account (an admin `listUsers`/`getUserByEmail`-style lookup,
   or a dedicated RPC since these files run client-side and shouldn't hold a
   service-role key — this likely needs a small edge function or RPC to do
   the existence check safely).
   - No existing account → call `inviteUserByEmail(email, { redirectTo:
     buildInviteUrl(invite), data: { surveyInviteToken: invite.token } })`
     with a customized "Invite" email template (Supabase dashboard → Auth →
     Email Templates → Invite user) matching the current branded invite copy.
     Reliable delivery via the proven mailer.
   - Existing account → still needs a working send path. Two options, pick
     one with Isaiah if it needs a call, otherwise default to (a):
     (a) keep using Resend/walkthru.tools — by next session it will have
     several more days of real accrued sending history and may already be
     landing; re-test with a real (non-synthetic) send before assuming it's
     still broken.
     (b) verify a dedicated subdomain (e.g. `mail.surveytool.app`, now that
     the site's own domain works) exclusively for Survey's transactional
     mail, isolating its reputation from Walkthru's domain entirely — cleaner
     long-term, same warm-up-time cost.
2. Do NOT touch the account-email SMTP config as part of this — keep it on
   the built-in mailer regardless of what's decided for invites.
3. This touches auth-adjacent, security-relevant code (email-bound invite
   acceptance, account-existence checks) — treat with the same care as the
   sharing/roles work from tonight: gate on build + tests, adversarially
   review before shipping, browser-verify the full loop live (mint an invite,
   accept it as a second real account, confirm access).

### 2. Design-polish backlog (from the Linear/Obsidian audit tonight, all confirmed still real and unblocked)

No owner decision needed for any of these — they're straightforward
consistency work. Pull full current descriptions from Linear before starting
(tickets may have drifted further since this was written):
- Unify the hub's warm dark/gold palette with the viewer's cooler chrome —
  two visually distinct apps today (KAL-56, KAL-64, KAL-70, KAL-71, KAL-73).
- Redesign the empty states (Documents/Projects/Templates tabs) with an icon
  + headline + primary action instead of the current bare text line
  (KAL-58).
- Survey panel polish: shared background color with the rail, shared button
  classes instead of ad-hoc styling (KAL-59, remaining sub-items only —
  the typo and tooltip sub-items were already fixed and confirmed tonight).
- Copy-tone pass (title case vs sentence case) across the app (KAL-63).
- Confirm-dialog button-order/color consistency for destructive actions
  (KAL-72).

### 3. Minor cleanup, low priority, do only if time allows

- KAL-266: backfill ~489 live + 418 archived pre-rebuild user-drawn marks
  into the new op-log. This is Isaiah's own historical test data (app is
  unpublished) — not a real-user data-loss risk, so it's genuinely low
  priority. Two hash-domain gaps need resolving first per the epic
  reconciliation report from earlier tonight.
- KAL-267 remainder: the "create project with initial files" bulk-upload
  path still uses the legacy time-based storage path instead of
  content-addressed (the main single/multi-upload path was already fixed
  tonight, commit `ffb12ec9`, for the race-condition half of this ticket).
- KAL-275: delete the dead legacy CRDT dual-write code
  (`useAnnotationCloudSync.js`, `safeSnapshot.js`'s cloud-backed branch) —
  partially blocked by source-assertion tests per project memory
  (`reference_pdfviewer_source_assertion_tests.md`), so check that first.

## Then — work through these one at a time with Isaiah

Bring each individually, with a recommendation, never batched:
- Image/stamp annotations: in or out at launch (KAL-126).
- The exact print/export sub-choices — the print panel has two competing
  layout variants (J/K) still both shipping in code, needs his pick
  (KAL-295, KAL-315).
- Imported-ink policy decision (KAL-91).
- Same-name-different-content upload behavior — build the collision modal
  once the UX choice is made (KAL-290, KAL-277).
- The few remaining dead-end buttons (KAL-82 audit).
- Free vs paid at launch — this gates whether the Stripe live-flip work
  matters at all before launch.

## Things worth knowing before you start (gotchas from tonight)

- **Linear scoping**: the "KAL" identifier is the whole team ("Kal Voe"),
  which contains FOUR separate projects — Survey, Walkthru, Takeoff, EDC
  Calculators. Filter by **project name "Survey"**, not by team key, or
  you'll pull in ~50 unrelated tickets from Isaiah's other products. (Learned
  the hard way tonight — see the correction in project memory.)
- **Verifying a live deploy actually shipped new code**: `vercel ls --prod`
  showing "Ready" only proves *a* deployment succeeded, not that the *alias*
  moved or that the bundle has what you expect. Confirm via `vercel inspect
  <domain>` for the aliased deployment URL, then actually fetch the served JS
  and grep for a feature string unique to the new code. Vite serves a small
  loader shim (`assets/index-*.js`) that dynamically imports the real bundle
  (`assets/main-*.js`) — fetch the real one, not the shim, or you'll see a
  suspiciously tiny file and think something's broken.
- **Cloudflare's dashboard is bot-blocked for automated browser tools** —
  operate through Isaiah's own logged-in browser tab/session instead of
  trying to get a dedicated Cloudflare integration.
- **Raw HTTP calls to `api.supabase.com` get a Cloudflare 403 (error 1010)
  with Python's default `urllib` User-Agent.** Always set `User-Agent:
  curl/8.4.0` (or similar) on any direct Management API call outside the
  `supabase` CLI.
- **A brand-new TLS cert doesn't always finish automatically in a reasonable
  time** — if a domain was just pointed at Vercel, force it with
  `vercel certs issue <domain> www.<domain>` rather than telling the user to
  wait.
- Direct-to-main workflow holds: commit locally, gate on build + tests,
  **push only with Isaiah's explicit go each time** — don't infer standing
  permission from one approval.
- Sync/CRDT/auth-adjacent changes (which the invite-routing fix above is)
  get the adversarial-verify-realtime treatment: at minimum two independent
  adversarial review passes before it's considered safe to ship, per
  standing project practice.

## Baseline to gate every change on

Build: `npx vite build` must be clean. Tests: `node scripts/run-node-tests.mjs`
— baseline at handoff time is **1810 tests / 1726 pass / 0 fail / 84 skipped**.
Any new work should raise the pass count, never lower it.
