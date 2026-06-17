# Deploy Checklist — Survey (written 2026-06-17)

**Bottom line from the full deployment-readiness audit:** nothing in the *code*
blocks a first launch. Every prior engineering "blocker" was investigated and
refuted (the annotation-loss-on-reload fear was live-disproven across four
scenarios). The only true gates are a handful of owner actions — credentials,
one database step, and a few dashboard settings.

**Launch vehicles (confirmed 2026-06-17):** downloadable desktop app **plus**
phone/tablet apps. The desktop side publishes through the existing release
pipeline (tag a version → it builds the Mac/Windows installers and publishes them
to GitHub Releases). The phone/tablet side is already wrapped for iOS and Android
and the current app bundles into both native projects cleanly — verified today.
A browser-hosted website is **optional and deferred** (it would need a host,
web-side sign-in redirects, and web export/print entry points; nice-to-have,
not required for first launch).

The app's identity is unified across all three as the **Kalvoe** brand
(`com.kalvoe.survey`). This is the permanent store identifier — if you want a
different brand name in the App Store / Play Store, decide it **before** the
first store submission, because it can't change afterward.

---

## What only you can do (in order)

### 1. Rotate two secrets  *(urgent-ish; not a public leak)*
The dev GitHub token and the dev database password live in your local-only
`.env.local` (correctly git-ignored, so they are NOT in the public repo). But
the token has write access to a public repo and gets baked into any installer
you build *on your own machine*. The official pipeline already strips it, so
shipped installers are clean — rotate anyway for hygiene.
- Revoke the old GitHub personal access token; if you still want the
  push-logs-to-GitHub debug feature on end-user machines, store the new one as a
  **non-`VITE_` env var** so it never enters a browser bundle (the app no longer
  reads it from the client after today's change).
- Rotate the dev Supabase database password.

### 2. Apply the two pending database migrations to production
Two migrations are validated on the test database but not yet on production:
`20260611120000_kal307_workbook_registrations.sql` and
`20260611130000_kal313_annotation_trash_events.sql`. Impact is low (the app
catches their absence and keeps working) — this is audit-trail + retention
hardening. When ready, from the project root:

```bash
supabase db push          # do NOT use --include-all
```

Post-apply sanity check (should both succeed):
- the new registration RPC rejects an anonymous (logged-out) call, and
- the trash/immutability trigger is present.

### 3. Make new-user sign-up actually work in production
The app's sign-in screen promises an email-confirmation link. In the hosted
Supabase dashboard, confirm these match the app's behavior, or new accounts
break silently:
- email confirmation on/off set to match the "check your email" copy,
- a real email sender (SMTP) configured,
- your production address plus the password-reset and invite return-links added
  to the allowed redirect list.

### 4. Decide free/trial vs paid for launch
Payments are currently in **test mode** (no real card can be charged). For a
free or trial-only first launch, nothing to do. If you want to sell a paid tier
on day one, switch to the live payment key + live prices and run one real
checkout to confirm the account upgrades.

### 5. (Optional, for the Microsoft 365 sales pitch) — or soften the pitch
Fully-automatic two-way Excel sync with Microsoft 365 / SharePoint needs a
one-time Microsoft Azure setup plus a real work-account sign-in that has never
been completed; automatic write-back is held off until that's validated.
**Either** do that Azure step and validate on a real work account, **or** launch
describing it as "Excel import + review" and turn on full live write-back later.
Sign-in and outbound Excel export already work without this.

### 6. Set up the phone/tablet stores (for the mobile apps)
The iOS and Android apps build from the same code and are already in sync. To get
them onto devices you'll need, one-time:
- An Apple Developer Program membership (about $99/year) and a signing identity,
  then build in Xcode and submit to TestFlight / the App Store.
- A Google Play Console account (one-time $25) and a signing key, then build the
  signed Android package and submit to Play.

The current app bundle is large, so expect to watch load time and memory on older
phones; it works, but slimming it down is a good early follow-up — not a blocker.

### 7. Ship it
Desktop: tag a version so the pipeline builds and publishes the installer.
Phone/tablet: build and submit each store app per step 6. Then install each
published build and walk the core loop end to end — sign in, open a PDF, draw,
reload (marks persist), export to Excel.

---

## Already done for you this session
- Verified the core loop (open, draw, save, reload, history) works against
  production — annotations persist reliably; the old "data loss" alarm was a
  misleading internal counter, not real loss.
- Ran a full six-angle deployment audit with every blocker adversarially
  re-checked.
- Unified the app identity to the Kalvoe brand across desktop and mobile (the
  desktop side was still a placeholder and mismatched the phone/tablet apps).
- Verified the phone/tablet apps: the current build bundles into both the iOS
  and Android projects cleanly, so mobile is wrapped and in sync — not a rebuild.
- Removed the app's client-side use of the baked GitHub write-token so your
  rotation is a clean cutover (build clean, full test suite still green).

## Explicitly NOT needed for first launch (defer)
The big Excel-security server wave, the annotation-storage rebuild, physically
removing the old PDF engine (the new one is already the default), automatic M365
write-back, a hosted-website surface, slimming the large app bundle, and the
cosmetic / UI-polish queue. These are post-launch. (Phone/tablet apps are NOT
deferred — they're in scope per step 6.)
