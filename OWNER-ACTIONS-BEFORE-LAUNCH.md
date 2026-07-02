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

## 3. Pick the app's web address (blocks the last two sign-up settings)

The sign-up system's site URL is still a localhost placeholder and the redirect
allow-list is empty — both need the real hosted web address, and none exists
yet. Decision needed: host the web app now on a free temporary address (agent
can do it, swap in a branded domain later) or wait until you pick/buy the
domain. Once an address exists, the agent finishes both settings in minutes.

## 4. Small product choices (decide one at a time, as they come up)

Image/stamp annotations in or out; the exact print/export options; the
imported-ink policy; the few dead-end buttons; free vs paid at launch.

## 5. Mobile stores (only if shipping the phone/tablet apps day one)

Apple Developer membership + signing identity → TestFlight/App Store; Google
Play Console + signing key → Play. The current bundle builds into both native
projects cleanly.
