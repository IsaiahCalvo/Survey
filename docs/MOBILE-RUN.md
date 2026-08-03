# Run Survey on iPhone without a cable

Use **Expo Go** for immediate testing from this worktree. Use **Capacitor through
TestFlight** for a normal Survey icon that keeps working when this Mac is offline.

## Immediate: Expo Go QR

This path requires no Apple developer account, signing, cable, or git push. Expo Go on
iPhone currently supports this shell's Expo SDK 54. The Expo tunnel carries the small
native shell bundle; the shell then opens either the deployed Survey site or this Mac's
current worktree.

### Test the deployed site

1. Install **Expo Go** from the iPhone App Store.
2. On the Mac:

   ```bash
   cd mobile-expo
   npm ci
   npm run start:tunnel
   ```

3. Scan the terminal QR code with the iPhone Camera and open it in Expo Go.

Verified on 2026-08-02: the tunnel connected, reported ready, and emitted an iOS Camera/
Expo Go QR. A first `CI=1` diagnostic attempt failed inside ngrok; normal interactive
`npm run start:tunnel` connected successfully and is the supported command.

With no configuration, the shell opens
`https://surveytool.app/?mobileNav=tabs&nativeShell=expo`. The shell always sets
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

Scan the QR code. Keep Vite, Tailscale Serve, and Expo running while testing. Changes to
the web app come from the current worktree and do not require a git push. Native-shell
TypeScript changes use Expo Fast Refresh; if the URL itself changes, stop and restart
Expo with the new `EXPO_PUBLIC_SURVEY_URL`.

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

Current repository/machine status as of 2026-08-02: an iOS signing identity exists, but
the Xcode project has no selected development team, no provisioning profile is installed,
and an App Store Connect app record has not been verified. Those are the remaining
distribution blockers.

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
https://surveytool.app/?mobileNav=tabs
```

Use Safari as the lowest-friction fallback. Use Expo Go when testing the native WebView shell,
and TestFlight once its Apple signing/App Store Connect prerequisites are complete.

Official references:

- [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/)
- [Expo CLI tunneling](https://docs.expo.dev/more/expo-cli/#tunneling)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Apple internal TestFlight testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/)
- [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
