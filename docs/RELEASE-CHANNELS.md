# Release channels and feature flags

One codebase, one database, two copies of the app.

| Channel | Address | Built from | Who sees unfinished features |
| --- | --- | --- | --- |
| Stable | https://surveytool.app | `main`, after CI is green (`deploy-production.yml`) | Only people a flag is turned on for at `/flags` |
| Nightly | https://surveytool-nightly.vercel.app | the same `main` commit, right after the stable deploy (`deploy-nightly.yml`) | Everyone: every flag is on (`VITE_RELEASE_CHANNEL=nightly`) |

Both copies talk to the same production Supabase project, so there is never a
second schema to keep in step. That is why nightly is built from `main` and not
from a long-lived side branch: a side branch's migrations would have to touch
the live database before its code was merged.

## Feature flags

`src/featureFlags.js` lists every flag. Each one is, in the `feature_flags`
table:

- `off`: hidden for everyone (the default for new work)
- `testers`: on only for the emails in `tester_emails`
- `on`: on for everyone

Admins (rows in `feature_flag_admins`, added by hand, never in this public
repo) switch them at **/flags**. A change shows for each person on their next
reload. One browser can also force a flag with
`localStorage.setItem('survey.flag.<key>', '1')` (or `'0'`).

### Shipping unfinished work

1. Add the key to `FEATURE_FLAGS` in `src/featureFlags.js`.
2. Add a migration that inserts its row as `off`.
3. Wrap the new UI in `isFeatureOn('<key>')`. Keep the old path working when
   the flag is off, so stable stays exactly as it was.
4. Merge to `main` as usual. Stable hides it; nightly shows it.

### Moving a feature from nightly to stable

1. Use it on nightly until it feels done.
2. At `/flags`, set it to **Testers only** and add a few people.
3. When nobody hits problems, set it to **Everyone**. No deploy is needed.
4. A week or so later, delete the flag: remove the `isFeatureOn` check and the
   old path, drop the key from `FEATURE_FLAGS`, and delete its row in a
   migration. Flags that stay forever turn into clutter.

If a feature misbehaves on stable, set it back to **Off** at `/flags`: that is
the rollback.

## Phones (native apps)

The phone apps load the hosted web app, so most changes reach them with the
web deploy. The phone "nightly" is a separate test build that points at the
nightly address.

- **iPhone: TestFlight.** An internal TestFlight group is the iPhone nightly.
  Needs Isaiah's paid Apple Developer Program team, an App Store Connect app
  record for `com.kalvoe.survey`, and an App Store Connect API key stored as
  GitHub secrets (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`) so CI can
  upload builds. Internal testers need no Apple review. Steps today:
  `docs/MOBILE-RUN.md` → "Durable: Capacitor through internal TestFlight".
- **Android: internal testing track.** Needs a Google Play developer account
  ($25 once), the app created in Play Console, an upload key, and a service
  account JSON stored as a GitHub secret (`PLAY_SERVICE_ACCOUNT_JSON`) so CI
  can upload. Internal testing allows up to 100 testers with no review wait.
- **Which URL each build opens:** the stable store build uses
  `https://surveytool.app/mobile`; the test builds set
  `EXPO_PUBLIC_SURVEY_URL=https://surveytool-nightly.vercel.app/mobile`
  (Expo shell) or embed a `VITE_RELEASE_CHANNEL=nightly` bundle (Capacitor).
