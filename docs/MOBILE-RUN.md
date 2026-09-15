# Run Survey on iPhone without a cable

## Permanent Expo Go UI preview — no Mac server

This is the always-available UI preview. It opens Survey inside Expo Go and does not need
Metro, Vite, Tailscale, a cable, shared Wi-Fi, or this Mac to remain online. Do not use it
to certify Google sign-in: Expo Go cannot own Survey's OAuth return scheme.
Metro is only the temporary local code server used for live, uncommitted development.

1. Install Expo Go and sign in once as Expo user `isaiahcalvo`.
2. Scan the permanent QR in the Codex handoff or open this URL on the iPhone:
   `exp://u.expo.dev/7522d24f-7afd-4d5b-a5c0-58f2ea863c28/branch/019fd954-cd01-705b-a108-2e1ac9f755d7`
3. Expo Go opens Survey as an iPhone app. It is not Safari. The shell loads the hosted
   Survey UI from `https://surveytool.app/mobile`, which is how this native shell is designed.

Each cold launch uses a launch-scoped hosted URL so Expo cannot reuse stale HTML. The
WebView profile is retained, so this freshness check does not clear cookies or signed-in data.

The QR and branch URL stay the same. From a reviewed, committed, clean worktree,
publish a newer native-shell bundle to them:

```bash
EXPO_SHELL_HASH=$(node scripts/verify-mobile-rollout-readiness.mjs --print-expo-hash)
cd mobile-expo
CI=1 EXPO_PUBLIC_SURVEY_URL='https://surveytool.app/mobile' \
  npx eas-cli update --branch expo-go --platform ios \
  --message "shell:${EXPO_SHELL_HASH} release:$(git -C .. rev-parse HEAD) Describe the mobile change"
```

The `shell:<sha256>` marker covers the Expo entry point, configuration,
dependencies, assets, and native-shell helpers. The release gate compares it
with Expo's read-only `update:list` metadata. A web-only change does not alter
this hash; any shell change blocks release until its reviewed update is
published.

Verified on 2026-08-06 in Expo Go on the iPhone 17 Pro Max Simulator with Metro stopped.
The published update uses Expo Go's SDK 57 runtime and renders the production sign-in flow.
Expo's free plan hosts this preview. Use the Survey development app below for full native
testing, including Google identity and its return to the signed-in Survey session.

`https://surveytool.app/mobile` remains the direct Safari fallback and the same hosted UI
loaded by the native shell.

Use the **Survey development app** for immediate testing from this worktree. It replaces
Expo Go because Survey's iOS identity and direct Google sign-in must be compiled into the
native app. After the one-time wireless install, it keeps Expo's fast refresh and QR workflow.
Use **TestFlight** for a Survey build that keeps working when this Mac is offline.

The development app does **not** require the Mac and iPhone to share Wi-Fi during normal
testing. `npm run start:tunnel` publishes Metro through an `exp.direct` internet URL, so the
iPhone can use cellular or any other network. A `100.x.x.x:8081` or other local address means
Metro was started in LAN mode; stop it and use the tunnel command below.

## Remote testing while Isaiah is away: Survey development app

This uses the already-installed Survey development app. Expo's public tunnel delivers the
native shell and Tailscale HTTPS delivers the Vite app, so the iPhone may be on cellular or
any Wi-Fi. Manual sign-out stays signed out. The real native Google flow uses
`accounts.google.com`, returns an ID token directly to Survey, and never opens a Supabase
OAuth callback.

Keep the existing Vite server and Tailscale Serve route running, then run:

```bash
cd mobile-expo
npm run start:remote
```

Open `https://survey-ios-install.vercel.app/` on the iPhone and tap
**Open Survey Development App**.
The terminal must say `Tunnel ready` and show an `exp.direct` address. Never use a QR or URL
containing `100.x.x.x:8081`; that is LAN mode and will fail when the phone leaves the Mac.

Verified on 2026-08-03 in the iPhone 17 Pro Max Simulator: the public development-client
tunnel loaded the Tailscale-served worktree, manual sign-out remained signed out, and Google
opened `accounts.google.com` with **continue to Survey**. The interactive Simulator is also
mirrored into Codex at `http://localhost:3200/` while `serve-sim` is running.

Expo Go remains available with `npm run start:remote:expo-go` for UI-only fallback testing,
but Expo does not support custom-scheme OAuth/OIDC in Expo Go. It cannot prove Google sign-in.

## Interactive iPhone Simulator inside Codex

Keep Vite running on port 5177, then start the Simulator-specific native bundle:

```bash
cd mobile-expo
npm run start:simulator
xcrun simctl openurl 54E7DD27-F277-4EB2-9F3B-8CA7939F5AC6 'exp+survey://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084'
```

Mirror that exact Simulator into Codex with `serve-sim`, then open its printed local URL in
the Codex in-app browser. The current verified mirror is `http://localhost:3200/`. It renders
the real Simulator frame, accepts clicks and typing, and exposes screenshot and device tools.
The local Metro and Vite origins avoid Simulator-only DNS failures while keeping the same
native and web source used by the phone.

## Immediate: Survey development app

This Mac is signed into Isaiah's free Apple Personal Team and has a valid development
identity. The one-time local installation requires Xcode to reach the unlocked iPhone, but
the phone does not need to stay near this Mac afterward. A fully remote initial installation
requires TestFlight or EAS distribution and therefore a paid Apple Developer Program team.

### One-time wireless install

On the Mac:

```bash
cd mobile-expo
npm ci
npx expo prebuild --platform ios
xcrun devicectl list devices
npx expo run:ios --device "Isaiah Calvo’s iPhone"
```

The final command builds, signs, installs, and launches **Survey**. It also starts Metro.
If the phone is unavailable, unlock it, enable Settings → Privacy & Security → Developer
Mode, confirm both devices are on the same Wi-Fi, and rerun the command. If Xcode reports
`No Account for Team`, complete the Xcode account sign-in above and rerun it.

### Every later test: no rebuild and no cable

```bash
cd mobile-expo
npm run start:tunnel
```

Open **Survey** on the iPhone. If Metro prints a QR, scanning it opens the link in Survey,
not Expo Go. Native TypeScript changes fast-refresh; a newly added native dependency or iOS
configuration change requires rerunning the one-time install command.

Google sign-in is intentionally handled by the Survey development app. iOS first says
**Survey wants to use accounts.google.com**, then Google says **continue to Survey**. Both
screens can be cancelled or closed. A `supabase.co` Google screen means the shell loaded an
older deployed web bundle; use the unpushed-worktree steps below or deploy the bridge first.

With no configuration, the shell opens
`https://surveytool.app/mobile?mobileNav=tabs&nativeShell=expo`. The shell always sets
`mobileNav=tabs` and `nativeShell=expo`, even if the configured URL contains conflicting
values.

Both the Mac and iPhone need internet access while the Expo tunnel is running. Expo's
tunnel URL is public but difficult to guess; do not put secrets in the shell bundle.

### Test unpushed worktree code

This uses private Tailscale HTTPS for the real web app and the Expo tunnel only for the
native shell. Install Tailscale on the iPhone and sign it into the same tailnet as this
Mac.

In terminal 1 at the repository root:

```bash
npm run dev:ui -- --host 127.0.0.1 --port 5177
```

In terminal 2, publish that local Vite port privately inside the tailnet:

```bash
tailscale serve --bg http://127.0.0.1:5177
tailscale serve status
```

The first command may print a one-time Tailscale approval link to enable HTTPS. Copy the
reported `https://<mac-name>.<tailnet>.ts.net` URL. Then, in terminal 3:

```bash
cd mobile-expo
npm ci
EXPO_PUBLIC_SURVEY_URL='https://<mac-name>.<tailnet>.ts.net/' npm run start:tunnel
```

Open Survey or scan the QR code into Survey. Keep Vite, Tailscale Serve, and Expo running
while testing. Changes to the web app come from the current worktree and do not require a
git push. Native-shell TypeScript changes use Expo Fast Refresh; if the URL itself changes,
stop and restart Expo with the new `EXPO_PUBLIC_SURVEY_URL`.

If the shell says it cannot connect, verify all three processes, open the Tailscale HTTPS
URL in iPhone Safari, then tap **Try again**. Do not fall back to an insecure public Vite
port.

## Durable: Capacitor through internal TestFlight

TestFlight is the recommended installed-app path. The Capacitor app embeds the Vite
`dist` produced from the current local worktree, so it can deliver unpushed branch code
and does not need this Mac after installation.

One-time requirements:

- Active paid Apple Developer Program membership.
- An App Store Connect app record whose bundle ID is `com.kalvoe.survey`.
- A development team selected for the `App` target in Xcode.
- Isaiah added to an internal TestFlight group with an eligible App Store Connect role.

Current repository/machine status as of 2026-08-03: Xcode exposes the free Personal Team
`T3KR4X5869`, and the Expo project uses that exact team for local development signing. A paid
Apple team and App Store Connect app record have not been verified; those are the remaining
TestFlight distribution blockers.

Build the current worktree and open its native project:

```bash
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode:

1. Select target **App** → **Signing & Capabilities**, enable automatic signing, and
   select the paid developer team.
2. Set a build number higher than every prior upload.
3. Select **Any iOS Device (arm64)**, then **Product → Archive**.
4. In Organizer choose **Distribute App → App Store Connect → Upload** and complete the
   export-compliance questions accurately.
5. In App Store Connect → Survey → TestFlight, add the processed build to Isaiah's
   internal group.
6. On iPhone, install Apple's **TestFlight**, accept the invitation, and install Survey.

Internal TestFlight builds do not require external beta review. Apple still has to process
each upload, and each build expires after 90 days. Every update needs a new build number,
archive, and upload. No cable or device UDID is required.

Do not substitute EAS ad-hoc distribution for this path. The active Expo shell has no EAS
project configuration, and iOS ad-hoc installs require a paid Apple account plus the
iPhone UDID in the build's provisioning profile.

## Run the native app in iOS Simulator

The repository has a repeatable simulator command that builds the current worktree, syncs
Capacitor, boots the newest installed iPhone 17 Pro Max simulator, installs Survey, launches
it, and fails if the app never paints visible UI:

```bash
npm run mobile:ios:sim
```

For sign-in and live development, run Vite first, then launch the Simulator against that
same dev origin. This gives the native Simulator the same development auth relay and current
unbuilt code as the browser; the URL is injected only into a disposable native-project copy:

```bash
# one-time setup on this Mac (requires `npx supabase login`)
npm run dev:auth:configure -- --email isaiahcalvo123@gmail.com

# terminal 1
npm run dev:ui -- --host 127.0.0.1 --port 5177

# terminal 2
npm run mobile:ios:sim -- --dev-server
```

The checked-in Capacitor configuration and normal production/TestFlight builds never receive
the dev URL. Use `--dev-server=https://<host>/` or `MOBILE_IOS_DEV_SERVER_URL=...` to select a
different reachable Vite origin.

The command writes a screenshot and JSON metadata to a temporary artifact directory printed
at the end. After the first successful sync, use the faster rebuild loop when the bundled web
assets have not changed:

```bash
npm run mobile:ios:sim -- --skip-sync
```

Optional overrides:

```bash
MOBILE_IOS_DEVICE_NAME='iPhone 16e' npm run mobile:ios:sim
MOBILE_IOS_SIMULATOR_UDID='<exact-udid>' npm run mobile:ios:sim
```

Verified on 2026-08-02 with Xcode 26.6, iOS 26.5, and an iPhone 17 Pro Max simulator:
the native build installed, launched, and painted the real Survey UI. Use `--dev-server` for
the development auth relay; embedded production builds continue to use normal production
authentication.

## Mobile Safari fallback

The deployed mobile web viewer works without an install. Open this exact URL in iPhone Safari:

```text
https://surveytool.app/mobile
```

Use Safari as the lowest-friction fallback. Use the Survey development app for the native
WebView shell, and TestFlight once its App Store Connect prerequisites are complete.

## Remote crash and load diagnostics

Survey emits privacy-bounded app-load, PDF parse/raster, pinch, zoom-settle,
and JavaScript error events through Survey's same-origin
`https://surveytool.app/api/analytics/track` Vercel proxy. The Agent Native key
is server-only. Never put it in `VITE_*`, `EXPO_PUBLIC_*`, a native bundle, or a
browser request. Netlify and a second Supabase project are not used.

The proxy accepts only a valid signed-in Supabase session. Guest and signed-out
activity is not sent. It redacts sensitive fields, disables session replay and
automatic retries, limits each client to 60 events/minute, then atomically caps
ingestion in the primary Survey database at 500 events/user/day and 10,000
events/global/day.

Production rollout order is fail-closed:

1. Apply all five required Supabase migrations:
   - `20260802010000_allow_last_owner_document_cascade.sql`
   - `20260810010000_integration_test_bytea_roundtrip.sql`
   - `20260811120000_account_deletion_user_references.sql`
   - `20260811130000_analytics_ingestion_daily_cap.sql`
   - `20260811140000_atomic_template_snapshot.sql`
2. Deploy the `delete-account` Edge function.
3. Configure these **server-only** Vercel Production variables through the
   protected Vercel environment: `AGENT_NATIVE_ANALYTICS_PUBLIC_KEY`,
   `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
4. If the Expo shell hash changed, publish its reviewed `expo-go` update using
   the hash-bearing command above.
5. Before any Vercel code deployment, run this fail-closed gate from the linked
   project:

   ```bash
   SUPABASE_PROJECT_ID='<primary-project-ref>' npm run release:mobile:readiness
   ```

The gate first requires a clean Git worktree, builds the current Vite source,
requires `dist/release.json` to name the exact HEAD commit, type-checks Expo,
checks Expo dependency compatibility,
and creates then deletes a temporary iOS export. Its remote operations are
read-only metadata lists: Supabase `migration list` and `functions list`,
Vercel `env ls`, and Expo `update:list`. It never invokes the production app,
an Edge endpoint, or an analytics collector, and never deploys or changes cloud
data. The latest `expo-go` iOS metadata must have the pinned runtime and exact
current `shell:<sha256>` marker.

If build evidence, Electron packaging, Expo freshness, any migration, function,
or environment-variable name is absent, the command prints
`BLOCK CODE DEPLOYMENT` and exits nonzero. Environment values are never
printed. The lightweight evidence is the terminal's exact build commit,
`dist/release.json`, Expo shell hash, update group, runtime, and the command's
final `READY` line; videos and large Playwright caches are not release evidence.

The Expo shell keeps the last 24 PDF diagnostics outside WKWebView. If iOS
terminates the WebContent process, the surviving shell uploads the termination
plus those diagnostics before recovery. No PDF bytes/text, filenames, email,
auth token, or annotation payload is sent. Use Survey Clips separately for an
iOS screen recording and attach the Analytics session/correlation ID.

Official references:

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo CLI tunneling](https://docs.expo.dev/more/expo-cli/#tunneling)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Apple internal TestFlight testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/)
- [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
