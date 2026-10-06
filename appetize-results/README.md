# Appetize.io probe — real iOS simulator driven from a Linux cloud container

Date: 2026-10-06. Result: **it works.** One iPhone 16 Pro / iOS 26.0 session ran
Survey in Mobile Safari and then the Survey project inside Expo Go 57.0.9, all
driven by the `appetize` CLI from this container.

**Minutes used: 1 session, 200 s (~3.3 min)** of the 30 min/month free plan
(Appetize API `sessionLengthSeconds: 199.876`). Plus one failed start that the
server refused before booting a device (0 min).

## What worked

| Step | Result | Screenshot |
| --- | --- | --- |
| Upload Expo Go 57.0.9 simulator build | OK, build id `b_iysen3lso3aqr7grkm6yksiiuq` (appId `host.exp.Exponent`) | — |
| Start iPhone 16 Pro, iOS 26.0 | Ready in ~19 s | — |
| Run A: open `/mobile?mobileNav=tabs&nativeShell=expo` in Safari | Page loads; a "Welcome back" sign-in sheet opens on load **with the iOS keyboard already up** (email field autofocus) | `a1-home.jpg` |
| Close sign-in sheet | Documents home, bottom tabs, Safari bar | `a2-after-close.jpg` |
| Tap search field, type `plan` | iOS keyboard opens, text lands in the field | `a3-search-keyboard.jpg` |
| Scroll list to bottom (two upward swipes) | Swipes delivered, but the list is empty (signed out, 0 files) so there is nothing to scroll; screen is unchanged after release. Rubber-band not provable here. | `a4-scrolled-bottom.jpg` |
| Open `/mobile?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1&mobileNav=tabs&nativeShell=expo` | **No document opened.** Sign-in sheet again, then the empty Documents list. The `testPdf` hook does not fire on this hosted build (likely dev/E2E-only or needs sign-in). | `a5-document.jpg` |
| Pen tool + stroke | **Skipped** — no document on screen | — |
| Run B: `appetize open exp://u.expo.dev/…/branch/019fd954-…` | iOS "Open in Expo Go?" prompt | `b1-open-in-expo-go-prompt.jpg` |
| Tap Open | Expo Go downloads and starts the **Survey** project (SDK 57.0.0, v1.0.0); first-run dev-menu intro shows | `b2-survey-loaded-devmenu-intro.jpg`, `b3-survey-devmenu.jpg` |

Note: the Expo branch id came from `mobile-expo/README.md` (the permanent
`expo-go` branch link). No separate "cloud-testing" branch id was found.

Note: b2/b3 show the hosted `/mobile` page behind the Expo Go dev-menu sheet
(the status bar's back link reads "Safari", so it may still be Safari's page,
not yet the shell's WebView). We stopped before dismissing the dev menu to
stay near 3 minutes — the next run should close it and screenshot.

## Errors / gotchas

- **No Device Sandbox via API/CLI.** The Safari-only sandbox needs a
  `standalone_…` id that is only shown in the logged-in web UI
  (appetize.io/app/standalone). `GET /api/v2/apps` and `/api/v2/builds` were
  empty; target `standalone` failed with "Error requesting session" (no
  minutes charged). **Work-around:** start any uploaded iOS build, then
  `appetize open https://…` — iOS opens the URL in Mobile Safari.
- The Expo Go release tarball holds the `.app` *contents* at its root.
  Appetize needs a `.app` folder, so repack it:
  `mkdir -p pack/Exponent.app && tar xzf Expo-Go-57.0.9.tar.gz -C pack/Exponent.app && (cd pack && tar czf ../ExpoGo-sim.tar.gz Exponent.app)`
  then `appetize build upload ../ExpoGo-sim.tar.gz --wait --timeout 300000 --json`.
- The hosted page auto-opens the sign-in sheet on every load. Close it with
  two taps: keyboard "✓" at `0.897,0.62`, then the sheet's X at `0.892,0.158`.
- Screenshots are 1206×2622 PNG (~150–900 KB); stored here as 40% JPEGs.

## How a parent session should ask a child for runs

A child session must be started fresh in an environment that has
`APPETIZE_API_TOKEN` set (the CLI reads it from the env; never print it).
Ask it to run exactly this, with your own URLs and steps:

```bash
npm i -g @appetize/cli                       # Node 22+
# Expo Go 57.0.9 is already uploaded; reuse this build id as the target:
BUILD=b_iysen3lso3aqr7grkm6yksiiuq
appetize session start iphone16pro $BUILD --device-os-version 26.0 --session-id run --json --quiet

# Safari: open any https URL
appetize open 'https://sonic-tassel-snt8.here.now/mobile?mobileNav=tabs&nativeShell=expo' --json --quiet
sleep 9
appetize tap --select-position 0.897,0.62 --json --quiet   # keyboard ✓
appetize tap --select-position 0.892,0.158 --json --quiet  # close sign-in sheet
appetize screenshot shot.png --json --quiet

# Input
appetize tap --select-position 0.26,0.149 --json --quiet   # search field
appetize type 'plan' --json --quiet
appetize swipe --from-position 0.5,0.75 --to-position 0.5,0.15 --duration 300 --json --quiet

# Expo Go with the Survey project
appetize open 'exp://u.expo.dev/7522d24f-7afd-4d5b-a5c0-58f2ea863c28/branch/019fd954-cd01-705b-a108-2e1ac9f755d7' --json --quiet
appetize tap --select-position 0.684,0.543 --json --quiet  # "Open" in the Open-in-Expo-Go dialog
sleep 25 && appetize screenshot expo.png --json --quiet

appetize session stop --json --quiet                       # ALWAYS stop; billing runs until this
```

Tips for the parent's request:

- Give the child a minute budget and the exact steps; ask it to `Read` each
  screenshot before the next tap (positions are fractions `x,y` of the screen).
- Batch several commands in one shell call — each round of thinking costs
  session seconds.
- Check the bill afterwards: `GET https://appetize.io/api/v2/sessions` with
  header `X-API-KEY` shows `sessionLengthSeconds` per session.
- `appetize device list --platform ios` lists models; iPhone 17 Pro and
  16 Pro both offer iOS 26.0.
- To test a document/pen flow, the parent must supply a URL that really opens
  a PDF on the hosted build (the `testPdf` param did not), or a signed-in path.
