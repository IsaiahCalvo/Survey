# Store release checklist (Google Play first, then Apple)

How Survey's phone and tablet app gets into the stores. Written for Google Play
(first store, 2026-10-30); each step notes what the Apple App Store needs for the
same thing, so the iOS launch can follow this page.

The app is the Capacitor shell in `android/` and `ios/`. It bundles the same Vite
build as the web app (`dist/`), so a store build is "web build, `cap sync`, native
build". App id on both stores: `com.kalvoe.survey`. It can never change after the
first upload.

## 1. Accounts (owner only)

Google Play uses an **organization** developer account (Kalvoe LLC). A new
*personal* account must keep 12 opted-in testers for 14 days in a row before it
can publish; an organization account skips that. Fake or scripted testers break
Play policy and risk a ban, so that path is closed.

| Step | Google Play | Apple |
|---|---|---|
| Legal entity | Kalvoe LLC (state filing) | same LLC |
| D-U-N-S number | free, required for an organization account | same number, required for an organization membership |
| Developer account | play.google.com/console/signup, "organization", $25 once, ID check | developer.apple.com/programs/enroll, organization, $99 a year |
| App record | Play Console > Create app ("Survey: PDF Markup & Count", app, free) | App Store Connect > New app, bundle id `com.kalvoe.survey` |
| Robot access for uploads | Google Cloud service account with "Release manager" in Play Console, JSON key as a GitHub secret | App Store Connect API key (.p8) as a GitHub secret |

Click steps written for the owner: `/mnt/project-files/release/google-play/owner-steps.md`
(project files, not the repo).

## 2. Build

```sh
npm ci
npm run build                      # needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (prod)
npx cap sync android               # with CAPACITOR_SERVER_URL and CAPACITOR_E2E_LOCAL_HTTP unset
grep -c '"server"' android/app/src/main/assets/capacitor.config.json   # must print 0
node scripts/native-version.mjs "$(git rev-list --count origin/main)"
cd android && ./gradlew bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab
```

- **Version.** `versionName` is `package.json` "version". `versionCode` (Android)
  and `CURRENT_PROJECT_VERSION` (iOS) are the number of commits on `main`, so every
  later build from main is higher. Both stores refuse an upload whose build number
  is not higher than the last one. Needs full history (`git fetch --unshallow`).
  Don't commit the bumped native files; the script sets them for each build.
- **Signing.** `android/app/build.gradle` signs the release build when all four
  `SURVEY_UPLOAD_*` env vars (or `android/keystore.properties`, git-ignored) are
  set. The key is the **upload key** (`survey-upload.jks`, alias `upload`,
  SHA-256 `37:E1:67:71:81:E4:58:2A:92:9B:2F:75:B5:96:68:A0:3E:AF:07:DB:BF:E8:35:3D:CE:33:5F:11:33:22:DC:1D`).
  Play App Signing holds the real app signing key, so a lost upload key can be
  reset through Play support. Never commit the keystore or its password.
  Apple: Xcode automatic signing with the team id, or a distribution certificate.
- **App links.** `public/.well-known/assetlinks.json` lists the certificates
  allowed to open `surveytool.app/invite/...` links in the app; it holds the upload key today. After the Play
  app exists, add the **app signing key** SHA-256 from Play Console > Test and
  release > App integrity (the Play-installed app is signed with that one, not
  the upload key). Apple: `public/.well-known/apple-app-site-association`.
- **Checks on the bundle** (bundletool `dump manifest --bundle app-release.aab`):
  package `com.kalvoe.survey`, target SDK 35 or higher (Play's floor; we're on
  36), not debuggable, permissions only INTERNET, CAMERA, RECORD_AUDIO,
  MODIFY_AUDIO_SETTINGS. No native `.so` libraries, so the 16 KB page-size rule
  doesn't apply; recheck if a plugin adds one.

## 3. Store listing

Text lives in the repo in the fastlane layout, so an upload robot can read it:

- `fastlane/metadata/android/en-US/title.txt` (30 max)
- `fastlane/metadata/android/en-US/short_description.txt` (80 max)
- `fastlane/metadata/android/en-US/full_description.txt` (4000 max)
- `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` or `default.txt` (500 max)

Rules for the text: no prices, no plan names, no "upgrade at surveytool.app"
(the app sells nothing, see section 4), and no beta features (only what a stable
build shows; flags with `stage: 'beta'` never count).

Graphics (project files, `/mnt/project-files/release/google-play/`; how to redo
them is in `capture/README.md` there):

| Asset | Google Play | Apple |
|---|---|---|
| Icon | `icon-512.png`, 512x512 (from `public/logo512.png`) | 1024x1024 from `ios/App/App/Assets.xcassets` |
| Feature graphic | `feature-graphic-1024x500.png` | none |
| Phone shots | `screenshots/phone/`, 1080x1920, 2 to 8 | iPhone 6.9", 1320x2868 |
| Tablet shots | `screenshots/tablet7/` 1920x1200, `screenshots/tablet10/` 2560x1600 | iPad 13", 2064x2752 |

Play rejects a screenshot whose long side is more than twice the short side
(the old 1082x2402 phone set broke that).

Category: Productivity. Contact email: the support address on the website.
Website: https://surveytool.app/welcome. Privacy policy: https://surveytool.app/privacy.html.

## 4. Policy answers

**Payments.** The store apps sell nothing and link to no checkout. Settings,
plan-limit messages and the Pro lock prompt hide every price, Upgrade button and
billing link when `isPurchaseUiHidden()` is true (`src/utils/accountPlatform.js`,
guarded by `tests/nativeStorePurchaseUi.test.mjs`). People buy on the web and
sign in to the app. Play: "Does the app offer in-app purchases?" No.
Apple is stricter: guideline 3.1.3(b) lets an app unlock a plan bought on the
web only if it is also sold in the app, and 3.1.3(c) covers plans sold to
companies. Settle this (Apple in-app purchase for Pro, or Enterprise-only
selling) before the iOS submission.

**Sign-in.** Email and password, plus SSO. Google sign-in is hidden in both store
apps (`isGoogleSignInHidden`): on iOS it would need Sign in with Apple, and on
Android the OAuth round trip can't come back into the app yet (needs a Custom
Tab + app-link callback). SSO has the same Android gap; it is Enterprise-only.

**Account deletion** (both stores require it): Settings > General > Delete
account, type DELETE, confirm. Web link for Play's form:
https://surveytool.app/delete-account (built by `scripts/build-marketing.mjs`,
checked by `scripts/prod-smoke.mjs`). What it removes:
`supabase/functions/delete-account`.

**App access** (review login): reviewers need a working account with a sample
project. Make one on production and paste the email and password into Play
Console > App content > App access (Apple: App Review notes).

**Content rating (IARC questionnaire):** category "All other app types";
violence, fear, sexuality, language, drugs, crude humour, gambling: No. Users
interact or share content: Yes (share documents with people they invite; no chat,
no public posting). Shares location: No. Digital purchases: No. Expected:
Everyone / PEGI 3. Apple: 4+.

**Target audience:** 18 and over. Not designed for children. Ads: No.
Government, financial, health, news app: No.

**Data safety** (Play) / App Privacy (Apple):

- Collects required user data: Yes. Encrypted in transit: Yes. Users can ask for
  deletion: Yes (in app and the web link above). Shared with third parties: No
  (Supabase, Vercel, the payment provider and the analytics host act for us,
  which Play does not count as sharing).

| Data type | Collected | Optional | Purpose |
|---|---|---|---|
| Personal info: email address | Yes | Required | Account management, app functionality |
| Personal info: name | Yes | Optional | Account management, app functionality |
| Personal info: user IDs | Yes | Required | Account management, app functionality |
| Financial info: purchase history (plan status) | Yes | Optional | App functionality |
| Photos and videos | Yes | Optional | App functionality (marker photos/videos) |
| Audio: voice or sound recordings | Yes | Optional | App functionality (voice notes) |
| Files and docs | Yes | Required | App functionality (PDFs, markups) |
| App activity: app interactions | Yes | Required | Analytics (no user id attached) |
| App info and performance: crash logs, diagnostics | Yes | Required | Analytics, app functionality |
| Location, contacts, messages, health, browsing, device or ad IDs, card details | No | | |

Analytics and crash reports have no opt-out in the app, so they are "required".
If a beta feature that sends data elsewhere (AI agent, sheet sync) graduates to
stable, update this table and the privacy policy first.

**Permissions:** CAMERA and RECORD_AUDIO are used only when someone adds a photo,
video or voice note to a marker, or talks to voice input. No location, no
contacts, no storage permission (files go through the system picker).

## 5. Tracks and release

1. **Internal testing** first (up to 100 testers by email, no review wait): upload
   the AAB, install from the opt-in link on a real phone, walk sign-in, open a
   drawing, mark up, survey, export, delete a test account.
2. **Production**: create a release from the same bundle, release notes from the
   changelog file, staged rollout 20% then 100%.
3. The first upload of a new app must go through the Play Console by hand. Later
   ones can go through the Play Developer API with the service account.

Every later release: bump `package.json` version if the change is user-facing,
build from a green `main` commit, write `changelogs/<versionCode>.txt`, upload,
roll out. The web app keeps shipping on its own; the store app only needs a new
build when native code, `capacitor.config.ts` or offline-bundled behaviour changes,
but ship one at least monthly so the bundled web code stays close to the site.

## 6. Still open

- Organization account (LLC + D-U-N-S) in progress.
- Review login account on production.
- Support email: the site still lists a personal Gmail.
- Privacy and terms text: draft PR #840 is waiting on legal review.
- Play app signing SHA-256 into `assetlinks.json` once the app exists.
- Google sign-in and SSO on Android (Custom Tab + app-link return).
- A CI job that builds and uploads the signed AAB (needs the upload key and the
  Play service-account key as GitHub secrets).
