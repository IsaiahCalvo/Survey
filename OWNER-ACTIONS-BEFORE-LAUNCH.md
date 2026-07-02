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

## 3. Email + web address — updated 2026-07-02 after the inbox investigation

**What's true now (found + fixed during the email assessment):**
- Account emails (confirm/reset) WORK again — rolled back to the built-in
  sender after discovering Gmail silently drops mail from `walkthru.tools`
  (verified: a real reset email landed in your inbox; the two earlier "test"
  emails never arrived anywhere despite the mail service reporting delivered).
  The built-in sender is rate-limited (~a few emails/hour) — fine for testing,
  not for launch volume.
- The recurring **Supabase "action required" security emails** were the
  security advisor's 141 findings (zero critical). Hardened 2026-07-02:
  141 → 81, everything remaining is by-design. Those emails should quiet down.
- The recurring **Vercel "2 domains need configuration"** emails: your app IS
  set up on Vercel deploying to `surveytool.app` — but that domain has NO
  nameservers anywhere (likely never delegated or lapsed at the registrar), so
  the site is unreachable and Vercel keeps nagging. `survey-app.app` is in the
  same state.

**Your 2-minute fixes (agent's browser is bot-blocked from Cloudflare):**
1. **Invite emails** — in Cloudflare → walkthru.tools → DNS → Add record:
   Type `TXT`, Name `_dmarc`, Content `v=DMARC1; p=none;`
   That's the missing anti-spoofing record; without it Gmail eats the mail.
   Tell the agent when it's added and it will re-test end-to-end.
2. **The web address** — log into wherever you bought `surveytool.app` and
   either point its nameservers at the intended host or add the pointer record
   Vercel asks for (`A @ 76.76.21.21`). If the domain lapsed, renew or pick a
   new one. Once it resolves, the agent finishes the sign-up settings
   (site URL + redirect allow-list) and can also switch email sending to the
   Survey-branded domain in minutes.

## 4. Small product choices (decide one at a time, as they come up)

Image/stamp annotations in or out; the exact print/export options; the
imported-ink policy; the few dead-end buttons; free vs paid at launch.

## 5. Mobile stores (only if shipping the phone/tablet apps day one)

Apple Developer membership + signing identity → TestFlight/App Store; Google
Play Console + signing key → Play. The current bundle builds into both native
projects cleanly.
