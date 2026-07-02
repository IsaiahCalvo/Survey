# Autonomous goal — work this queue unattended, no check-ins

_Written 2026-07-02. This is a directive for an unattended/scheduled session
(or a long-running autonomous one) to execute without asking Isaiah anything
mid-task. Every fork below already has a decided default so it never needs to
stop and ask "what should I do here" — it only stops for the conditions
listed at the bottom._

## Isaiah's standing rule for this queue (confirmed 2026-07-02)

**Never push to `main`. Ever, for any item in this queue, no matter how
small or how confident you are.** Commit locally, gate on build + tests,
browser-verify, then mark the item DONE-AWAITING-PUSH in this file's log
below and move to the next item. Isaiah reviews and pushes in his own time.
This is the one rule that overrides "bias to action" — it does not override
"do the work," only "publish the work."

## Work item 1 — invite-email delivery fix

Full technical scope is in `HANDOFF-post-launch-push.md` section 1. Summary
+ the pre-decided defaults so this never needs a check-in:

1. Add an email-existence check before sending any project/document/template
   invite (small edge function or RPC — do not put a service-role key in
   client-side service files).
2. No existing account → `supabase.auth.admin.inviteUserByEmail()` with a
   custom "Invite" email template (set via the Supabase dashboard's Auth →
   Email Templates, or via the Management API if that's scriptable — check
   before assuming dashboard-only) matching current branded invite copy, and
   `redirectTo` pointing at the existing `/invite/<token>` accept page.
3. Existing account → **default: keep sending via the current Resend /
   walkthru.tools path.** Before starting this item, do ONE real check: send
   a real invite (not a synthetic test blast) and confirm in the actual
   Resend dashboard/API whether it's now landing (several days have passed
   since DMARC was added — reputation may have already recovered). If it's
   still silently failing, only THEN build the fallback: verify a dedicated
   `mail.surveytool.app` subdomain in Resend (surveytool.app's own DNS is now
   live — see `OWNER-ACTIONS-BEFORE-LAUNCH.md`) and switch just the invite
   path to it. Do not spend more than one round of investigation on this
   sub-decision — pick the working option and move on.
4. This is auth-adjacent, security-relevant code: gate on build + tests,
   then run at least two independent adversarial review passes on the diff
   before considering it done (spawn subagents for this — do not skip it to
   save time). Browser-verify the full loop live: mint a real invite, accept
   it as a second real account, confirm access — same standard as every
   other piece of this app.
5. Never touch the account-recovery email path (signup confirm, password
   reset) as part of this — it must stay on Supabase's built-in mailer,
   confirmed working. If you're not sure whether a change affects it, it
   affects it — check `supabase auth config`'s `smtp_host` is still `null`
   before and after your change.

## Work item 2 — design-polish backlog

Full ticket list is in `HANDOFF-post-launch-push.md` section 2 (palette
unification, empty-state redesign, Survey panel polish, copy-tone pass,
confirm-dialog consistency). Pull each ticket's current description from
Linear before starting — do not work from a summary that might have drifted.
No product decision is needed for any of these; if you find one that
actually does require a call, skip it and log why in this file's log below —
do not guess on a genuine design decision.

## Work item 3 — minor cleanup (only after 1 and 2, only if time allows)

KAL-266/267/275 remainders — see `HANDOFF-post-launch-push.md` section 3.
Lower priority than 1 and 2; skip entirely if you're running low on
context/turns rather than doing a rushed job.

## Stop conditions — these are the only reasons to end the session and wait for Isaiah

- A genuine product/design decision that isn't already covered by a default
  above (e.g. anything from the "work through these together" list in
  `HANDOFF-post-launch-push.md` — Stripe, Microsoft, image/stamp
  annotations, print-panel J/K, imported-ink policy, same-name-upload UX,
  free vs paid).
- A test or build failure you cannot root-cause after real investigation
  (per the project's systematic-debugging practice) — leave the failing
  state committed on a clearly-named branch or documented in this file's
  log, do not force it green.
- You've completed everything in items 1–3, or determined nothing remains
  that's safe to do without Isaiah — end cleanly, do not idle/heartbeat.
- Anything that would require pushing to `main`, changing a live/production
  setting outside this repo (Supabase dashboard, Stripe, DNS, Vercel), or
  spending real money.

## Log (append one line per item completed or skipped, newest first)

_(empty — first run starts here)_

## Baseline to gate every change on

Build: `npx vite build` clean. Tests: `node scripts/run-node-tests.mjs` —
baseline at goal-write time is **1810 tests / 1726 pass / 0 fail / 84
skipped**. Never let the pass count go down.
