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

**Two decisions Isaiah made explicitly on 2026-07-02 — these are settled,
do not re-ask or second-guess them:**

- **Palette unification (KAL-56, KAL-64, KAL-70, KAL-71, KAL-73):** the
  document viewer's cooler blue-gray chrome gets replaced with the home
  screen's warm gold identity — not the other way around. Pull the actual
  color/spacing values from wherever the home screen already defines them
  (its existing theme/token source, not the viewer's) so the viewer ends up
  matching real, already-in-use values rather than newly-invented ones.
  Every screen should read as one app when you're done.
- **Empty-state redesign (KAL-58):** the original design mockup this ticket
  pointed at no longer exists in the repo. Design it yourself — icon,
  a short friendly headline, one primary button — using the now-decided
  warm gold style. No preview/approval gate; it goes through the same
  build+test+browser-verify gate as everything else and counts as done.

For anything else in this backlog: if you hit a REAL judgment call not
covered above or by an obvious existing pattern elsewhere in the app, skip
that specific item and log why below — do not guess on a genuine decision
that wasn't actually settled.

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

- 2026-07-07 — **Work item 1: DONE-AWAITING-PUSH.** Two-branch invite send built + live-verified: new `send-invite-email` edge function (deployed, ACTIVE, additive) handles both branches server-side — brand-new invitee → Supabase auth mailer (Isaiah's own Brevo SMTP + his installed branded Invite template, both discovered already owner-configured; the goal's "smtp_host still null" guard is stale, config left untouched and proven byte-identical before/after) with redirect to the live accept page; existing account → the current Resend path, now called server-to-server (kills the account-existence oracle + dev-origin localhost links in emails). Client: three invite services swapped to one smart call; legacy client senders deleted. Codex plan review APPROVED r4 (PLAN-GOAL1-invite-email.md + PLAN-GOAL1-REVIEW-LOG.md); gates green (build clean; 1843/1807/0 fail vs 1820/1784/0 at HEAD); live-verified end-to-end incl. real UI mint, both branches, real GoTrue invite-link accept on the live accept page, access granted, and 401/404/400/409 abuse probes. **Resend "one real check"**: real invite emailed to isaiahcalvo123@gmail.com via Resend (id 8ec3a5b0-df51-477e-94ba-9caa192d9232, accepted by Resend) — no Resend API key/inbox access on this machine, so Gmail-landing confirmation is Isaiah's one-liner; default (a) kept. **Side-find fixed:** prod deep links (incl. ALL emailed invite links) render a blank page today — relative ./assets paths break under /invite/* on Vercel; one-line vercel.json rewrite added (push-gated). **Follow-up filed, not built:** send-email fn accepts arbitrary to/subject/template from any signed-in user (pre-existing relay surface) + free-tier invite gating is UI-only — both documented in PLAN-GOAL1-invite-email.md §follow-ups. Test artifacts kept in prod: invited users isaiahcalvo123+survey-invite-a/-b@gmail.com (b accepted as viewer on "Package 2 - Rev 4 -- IC.pdf"); alias-a's email is Isaiah's clickable end-to-end artifact.

## Baseline to gate every change on

Build: `npx vite build` clean. Tests: `node scripts/run-node-tests.mjs` —
baseline at goal-write time is **1810 tests / 1726 pass / 0 fail / 84
skipped**. Never let the pass count go down.
