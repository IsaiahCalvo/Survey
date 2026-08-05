# Mobile hosting and physical-device observability

Research date: 2026-08-05

## Verdict

Yes. The production Vite app can live permanently at
`https://surveytool.app/mobile`, and the Expo/React Native shell can load that
URL in its WebView. That removes the Mac, Tailscale, Cloudflare tunnel, and Vite
development server from normal phone testing.

Vercel does **not** replace Metro for Expo Go. Expo Go still needs a development
JavaScript bundle. For a phone experience that launches from the Home Screen
without any server running on the Mac, use either:

1. `https://surveytool.app/mobile` directly in Safari/PWA form; or
2. an installed Survey development/preview/release build whose bundled shell
   loads `https://surveytool.app/mobile`.

Expo documents that production apps ship their JavaScript bundle inside the
app, whereas development loads it from `expo start`; Expo also recommends a
development build rather than Expo Go for a real project. EAS Update can then
publish later shell JavaScript updates without a local Metro server. [Expo
development-build FAQ](https://docs.expo.dev/develop/development-builds/faq/),
[EAS Update](https://docs.expo.dev/eas-update/getting-started/)

## Recommended topology

```text
surveytool.app/mobile
        |
        +-- Vercel: same Vite build as desktop/web
        |
        +-- Safari: permanent mobile-web access
        |
        `-- Installed Survey shell: WKWebView loads the same URL
                    |
                    +-- web diagnostics -> survey-analytics
                    `-- native termination snapshot -> survey-analytics
```

Use `/mobile` on the existing origin now, not a separate subdomain. This keeps
Supabase browser storage and cookies on the same origin as `surveytool.app`, and
keeps the current `window.location.origin` OAuth behavior valid. A dedicated
`mobile.surveytool.app` is reasonable only if mobile later needs independent
deployments and rollbacks; it would be a different browser origin, so it would
need separate Supabase redirect allowlisting and would not share the root
domain's localStorage session.

The current shell already defaults to `https://surveytool.app/` and adds
`mobileNav=tabs&nativeShell=expo`; changing its stable base to `/mobile` is
small. [Current shell source](../../mobile-expo/App.tsx)

## Vercel fit and the repository's current state

- Vercel officially supports Vite static builds. A Vite SPA needs a catch-all
  rewrite to `index.html` for direct/deep links. [Vite on
  Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- This repository already has SPA asset/catch-all rewrites, so `/mobile` can
  resolve to the same production `index.html`. [Current Vercel
  configuration](../../vercel.json)
- `/mobile` still needs app-side meaning. Today mobile mode is query-driven.
  The web bootstrap should treat `location.pathname === "/mobile"` as the
  canonical mobile-tabs surface while preserving the existing query flags for
  compatibility.
- Automatic deployments are currently disabled by
  `git.deploymentEnabled: false`. Vercel documents that this setting disables
  Git deployments for all branches. Remove or narrow it, or deploy through an
  explicit CI/release job, if the goal is for the stable URL to update without
  a manual terminal deploy. [Vercel Git
  configuration](https://vercel.com/docs/project-configuration/git-configuration),
  [current configuration](../../vercel.json)
- Normal Vercel Git integration creates preview deployments for branches and a
  production deployment for the production branch; the custom domain then
  follows production. [Vercel Git deployments](https://vercel.com/docs/git)

Hosting the shell on Vercel should improve availability and delivery of the
Vite bundle, but it will not by itself fix slow PDFs. Cloud documents still
come from Supabase/storage, then PDF.js must parse and render them on the phone.
Measure those phases separately.

## Routing, auth, and deep links

### Web and WebView route

- Canonical phone URL: `https://surveytool.app/mobile`.
- Preserve the route through login. The current browser OAuth fallback uses
  `window.location.origin`, which returns to `/`; for mobile web, use a fixed
  allowlisted `/mobile` redirect or preserve the full safe URL so the user does
  not return to desktop mode.
- The installed iOS shell's Google flow exchanges the Google ID token directly
  with Supabase, so it does not need the browser page to host the Google OAuth
  callback. [Current auth source](../../src/contexts/AuthContext.jsx), [current
  shell source](../../mobile-expo/App.tsx)
- Keep password reset at `/reset-password`; the existing SPA rewrite can serve
  it directly.

### Native links

The installed Survey app can later claim `https://surveytool.app/mobile/...`
as an iOS Universal Link and fall back to the same mobile website when the app
is absent. Expo notes that Universal Links require a native app/website
association and cannot be implemented by Expo Go, so this belongs in the
Survey development/release build. [Expo linking
guide](https://docs.expo.dev/linking/into-your-app/), [Expo development-build
FAQ](https://docs.expo.dev/develop/development-builds/faq/)

## Analytics and diagnostics

Use two layers, because they answer different questions.

### 1. Vercel: traffic and real-user performance

- Vercel Web Analytics can collect automatic page views and custom events.
  The Vite/React integration is `@vercel/analytics`. [Web Analytics
  quickstart](https://vercel.com/docs/analytics/quickstart), [custom
  events](https://vercel.com/docs/analytics/custom-events)
- Vercel Speed Insights collects real-device web performance metrics and can
  break them down by path, which makes `/mobile` separately measurable.
  [Speed Insights](https://vercel.com/docs/speed-insights/using-speed-insights)
- This is useful for route load time, Web Vitals, device/browser distribution,
  and aggregate feature events. It is not enough for this PDF crash.
- Vercel Runtime Logs are produced by Functions, Routing Middleware, and static
  requests. They do not automatically contain the JavaScript console inside an
  iPhone WebView. [Vercel Runtime
  Logs](https://vercel.com/docs/logs/runtime)

### 2. `survey-analytics`: errors, replay, console, network, PDF breadcrumbs

The existing `survey-analytics` project is the better diagnostic system. It is
an Agent-Native Analytics app and already contains:

- first-party browser event ingestion with a public write key;
- automatic uncaught-error/unhandled-rejection capture;
- grouped issues linked to session replay;
- replay console capture and fetch/XHR metadata capture; and
- scoped agent-readable replay summaries/timelines.

The integration is a single `configureTracking()` call with the Analytics
public key and endpoint. Agent Native's replay recorder masks inputs by default,
scrubs URLs, never records request bodies or headers, and captures only a
bounded/redacted snippet for 5xx responses. [Agent Native tracking source and
documentation](https://github.com/BuilderIO/agent-native/blob/f92b1e88a65b19266b7d825314417bd4361d2c06/packages/core/docs/content/tracking.mdx),
[local Analytics error-capture contract](/Users/isaiahcalvo/Documents/Projects/Active/survey-analytics/docs/error-capture.md),
[local first-party ingestion contract](/Users/isaiahcalvo/Documents/Projects/Active/survey-analytics/docs/schemas/first-party-analytics.md)

Do **not** enable rrweb canvas recording for the PDF. The PDF pages are canvas
heavy, and extra canvas capture is exactly the wrong direction while debugging
WKWebView memory termination. Record the DOM/chrome plus lightweight PDF
telemetry instead.

Recommended production events/spans:

- `pdf.open.requested`
- `pdf.fetch.started` / `pdf.fetch.completed` with bytes and duration
- `pdf.parse.completed`
- `pdf.first_page.rendered`
- `pdf.ready`
- `pdf.zoom.started` / `pdf.zoom.committed`
- `pdf.render.started` / `pdf.render.completed` with scale, page, pixel area,
  canvas count, and duration
- `pdf.webview.terminated` with last known scale and the diagnostic ring buffer

Do not transmit every pinch frame. Keep a bounded in-memory ring buffer and
sample the gesture/render state at a low rate; attach the final snapshot to a
termination event.

## The missing piece: native crash handoff

The browser recorder alone cannot report the final failure when iOS kills the
WebView process, because that JavaScript process is already gone. React Native
WebView exposes `onContentProcessDidTerminate`, but its event reports that the
process ended, not why. Its own documentation notes that iOS may terminate a
WebView independently to free memory. [React Native WebView
reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md#oncontentprocessdidterminate)

Implement this bridge:

1. Web PDF code periodically sends a small diagnostic snapshot through
   `window.ReactNativeWebView.postMessage(...)`.
2. The native shell stores the last 30-60 snapshots outside the WebView.
3. On `onContentProcessDidTerminate`, the shell sends
   `pdf.webview.terminated` directly to `survey-analytics`, including build,
   device/OS, route, last scale, last page, active renders, estimated canvas
   pixels/bytes, and the ring buffer.
4. The shell then reloads/recover as it does today.

React Native WebView officially supports web-to-native `postMessage` /
`onMessage`; the message payload must be a string. [React Native WebView
messaging](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md#onmessage)

This is the highest-value change for the remaining slow-zoom-out termination:
it preserves the evidence that otherwise dies with WKWebView and makes the
incident remotely diagnosable without Metro, USB, or a screenshot.

## How Agent Native and `survey-clips` help

Agent Native is not a mobile emulator or a replacement for the current E2E
harness. Its useful role here is the diagnostics workflow:

- one Analytics event/replay/error surface that an agent can query;
- scoped agent-readable replay links instead of giving an agent the user's
  Analytics login; and
- a Clips bug-report flow for visual reproduction evidence.

The Agent Native Clips template supports an embedded `/bug-report` launcher and
returns a temporary scoped agent link containing transcript, timestamped frames,
and diagnostics. However, the official source explicitly says a popup only sees
diagnostics emitted inside the Clips window; diagnostics from the host product
must be attached separately. Its Chrome-extension capture is also for desktop
Chrome, not an iPhone WebView. [Agent Native Clips developer
documentation](https://github.com/BuilderIO/agent-native/blob/f92b1e88a65b19266b7d825314417bd4361d2c06/packages/core/docs/content/template-clips-developers.mdx)

Therefore:

- Add a **Report problem** action that creates/opens a `survey-clips` report and
  attaches the Survey diagnostic/session IDs.
- Let the user optionally attach an iOS screen recording for visual evidence.
- Keep the automatic technical evidence in `survey-analytics`; Clips is the
  human narration/video layer, not the crash logger.

## Recommended rollout

1. Deploy the current Vite build to Vercel and make `/mobile` canonical.
2. Install/distribute the Survey development or preview build pointing to that
   URL; stop depending on Expo Go for normal testing.
3. Enable Agent Native first-party tracking, error capture, and sampled session
   replay on production `/mobile` sessions.
4. Add the native diagnostic ring-buffer and termination upload before more
   guess-and-check zoom work.
5. Instrument PDF fetch/parse/first-page/render timing, then optimize the slowest
   measured stage.
6. Add the Clips report action once the automatic incident link is available.
7. Optionally enable Vercel Web Analytics. Enable Speed Insights only if its
   separate Pro pricing is acceptable; Vercel currently lists a $10/project
   monthly base fee on Pro. [Speed Insights pricing](https://vercel.com/docs/speed-insights/limits-and-pricing)
