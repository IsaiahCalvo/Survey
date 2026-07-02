# Owner actions before launch — the human-only steps

_Compiled 2026-07-01 during the MVP-wrapup build; UPDATED same evening after the
secrets/email work. Everything an agent could build/verify is done and committed
on `claude/quirky-taussig-7fda28`; the items below need Isaiah's hands (accounts,
portals, live money) and cannot be done by an agent._

## ✅ Done by the agent 2026-07-01 evening (was on this list, now off it)

- **Both secret rotations**: the leaked GitHub log token was REVOKED (confirmed
  dead) and scrubbed from every local env copy; the dev app-account password was
  ROTATED server-side, sign-in verified, and every local env copy updated (dev
  auto-login keeps working — the new password lives in `.env.local`).
- **Real email delivery**: Isaiah's Resend account already had a VERIFIED
  sending domain (`walkthru.tools`). The agent set the share/invite sender to
  `Survey <notifications@walkthru.tools>` (function secret `SEND_EMAIL_FROM`)
  and configured Supabase auth SMTP with a freshly-minted sending-only Resend
  key (named `survey-supabase-smtp` in the Resend dashboard). Confirmation,
  password-reset, and invite emails now deliver to ANY address. Two live test
  emails were sent to isaiahcalvo123@gmail.com as eyewitness proof.
  _Note: the sender domain is the Walkthru brand — swap to a Survey/Kalvoe
  domain later by verifying it in Resend and updating one secret + one setting._

## 1. Microsoft 365 + Excel live sync — PARKED (company tenant blocks the app)

Isaiah's company M365 blocks the app registration, so the Azure change + work
sign-in cannot happen right now. The entire sync engine stays built, wired, and
dormant behind its master gate — zero code work remains. Paths forward when
ready: ask the company tenant admin to approve/consent the app; OR use a
personal Microsoft 365 Business tenant for the launch pitch; OR park live
write-back and launch with "Excel import + review" wording. Full checklist for
whenever it unblocks: `HANDOFF-excel-sync-next.md` §"Recommended order".

## 2. Stripe / payments — go live (currently TEST mode; only you can)

There are no live keys anywhere on this machine, and creating them requires
your Stripe dashboard login (and possibly Stripe's business-verification step).
In the dashboard: activate live mode → create the live products/prices
(Pro $9.99/mo, Pro $99/yr, Enterprise $20/user/mo) → add a live webhook pointed
at the deployed payments listener → then hand the five live values to the agent
(publishable key, secret key, webhook secret, three price IDs) and it will wire
them in and run the one real checkout with you.
Product choice first: **free/trial vs paid at launch** — if free, skip all this.

## 3. Email + web address — updated 2026-07-02 (late-night session)

**What's confirmed working:**
- Account emails (confirm/sign-up, password reset) — reliable, on the
  built-in sender. Verified live: a real reset email landed in your inbox.
  Rate-limited (~a few per hour) — fine pre-launch, not for launch volume.
- The recurring **Supabase "action required" security emails** were the
  security advisor's 141 findings (zero critical). Hardened: 141 → 81,
  everything remaining is by-design. Those emails should quiet down.
- The recurring **Vercel "2 domains need configuration"** emails: explained,
  not yet fixed — see below.
- The missing anti-spoofing record (DMARC) for `walkthru.tools` was added in
  Cloudflare and is confirmed live in DNS.

**What's still NOT working, and why — invite/share emails:**
Even after adding DMARC, two more test invite emails (one with a real invite
link, not a placeholder) still never reached your Gmail inbox — the sending
service reports them as delivered, but Gmail shows no trace at all, not even
spam. DMARC was necessary but wasn't sufficient. The most likely remaining
cause: `walkthru.tools` has zero sending history with Gmail — a brand-new
domain gets silently filtered on its first sends even with every technical box
checked, and this typically self-resolves after a handful of real, human-opened
sends build up trust (there's no single flag to flip for this — reputation
just has to accrue). If you want a concrete signal instead of guessing, add
`walkthru.tools` in **Google Postmaster Tools** (postmaster.google.com,
free, just requires a DNS ownership check) — it shows Gmail's actual trust
score for the domain. Deliberately stopped further synthetic test-sending
tonight rather than keep guessing at your inbox — the DNS fix is correctly in
place; the next real invite you send from actual app use is the real test.

**Your fix when ready — the web address (also unlocks a Survey-branded
sending domain instead of borrowing Walkthru's):**
Log into wherever you bought `surveytool.app` and either point its
nameservers at the intended host or add the pointer record Vercel asks for
(`A @ 76.76.21.21`). If the domain lapsed, renew it or pick a new one — this
is also what's silencing the Vercel nag emails (the domain has no working DNS
anywhere, so the site is unreachable). Once it resolves, the agent finishes
the sign-up settings (site URL + redirect allow-list) and can set up a
Survey-branded sending domain with its own reputation, separate from Walkthru.

## 4. Small product choices (decide one at a time, as they come up)

Image/stamp annotations in or out; the exact print/export options; the
imported-ink policy; the few dead-end buttons; free vs paid at launch.

## 5. Mobile stores (only if shipping the phone/tablet apps day one)

Apple Developer membership + signing identity → TestFlight/App Store; Google
Play Console + signing key → Play. The current bundle builds into both native
projects cleanly.
