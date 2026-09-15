# Survey native shell (Expo)

This is a thin native WebView shell. **It does not bundle the Survey web app.**
It loads the hosted UI from `https://surveytool.app/mobile` (see
`DEFAULT_SURVEY_URL` in `App.tsx`), always forcing `mobileNav=tabs` and
`nativeShell=expo`.

That split is the single most important thing to understand here:

| What changed | How it reaches the iPhone |
| --- | --- |
| Survey web app (`src/`, the Vite bundle) | Deploy to `surveytool.app`. The phone picks it up on the next cold launch. **No Expo step.** |
| Native shell (`App.tsx`, `src/`, `app.json`, assets, deps) | `npm run mobile:phone` from the repo root. |

Each cold launch appends a launch-scoped `shellLaunch` parameter, so the shell
can never render stale HTML while still keeping the signed-in WebView profile.

## What to open on your phone

1. Open **Expo Go** (signed in once as Expo user `isaiahcalvo`). The shell is
   published at Expo SDK 57, so Expo Go must be an SDK 57 build — an older Expo
   Go says "Project is incompatible with this version of Expo Go".
2. Open **Survey** from the list — or, the first time, open this permanent link
   on the iPhone:

   ```text
   exp://u.expo.dev/7522d24f-7afd-4d5b-a5c0-58f2ea863c28/branch/019fd954-cd01-705b-a108-2e1ac9f755d7
   ```

3. If Survey was already running, **force-quit and reopen it**. Expo Go only
   fetches a new shell on a cold launch.

This link never changes. It needs no Metro, no Vite, no Tailscale, no cable, no
shared Wi-Fi, and it keeps working when this Mac is offline.

Safari fallback, same hosted UI, no install: `https://surveytool.app/mobile`.

**Expo Go cannot certify Google sign-in.** Expo Go does not own Survey's custom
OAuth return scheme, so `App.tsx` deliberately refuses the native Google flow
when `Constants.executionEnvironment === ExecutionEnvironment.StoreClient`. Use
the Survey development app (below) to test identity.

## Push the next update

From a clean, committed repo root:

```bash
npm run mobile:phone
npm run mobile:phone -- "Describe the shell change"
```

That wrapper computes the release gate's own `shell:<sha256>` marker, stamps it
with the current `release:<commit>`, and publishes to the `expo-go` branch for
iOS at runtime `exposdk:57.0.0`. It refuses to run on a dirty worktree, because
the hash has to describe reviewed, committed source — the fail-closed release
gate (`npm run release:mobile:readiness`) reads that exact marker back out of
Expo's read-only `update:list` metadata and blocks deployment if it drifts.

A web-only change does not alter the shell hash, so it needs no publish at all.

Requires a cached Expo login for `isaiahcalvo` (`npx eas-cli whoami`). If it
asks you to log in, run `npx eas-cli login` yourself.

## Local development lanes

These are for live, uncommitted work and need this Mac running:

```bash
npm run start:tunnel          # dev client over a public exp.direct tunnel
npm run start:remote          # dev client against the Tailscale-served Vite worktree
npm run start:remote:expo-go  # same, but UI-only in Expo Go
npm run start:simulator       # iPhone Simulator against local Vite on :5177
npm run check                 # tsc --noEmit + expo config validation
```

## Native builds

The **Survey development app** (`npx expo run:ios --device …`) is the lane for
Google sign-in and anything else that must be compiled into the native app.
There are currently **no EAS builds** for this project and the EAS account has
no Apple team linked, so `eas build` is not a working path today — the native
install goes through Xcode with the free Personal Team `T3KR4X5869`, and
TestFlight still needs a paid Apple Developer Program membership.

Full runbook, including the Tailscale and TestFlight paths: `docs/MOBILE-RUN.md`.

Expo SDK 57 — read the versioned docs at <https://docs.expo.dev/versions/v57.0.0/>
before changing anything here.
