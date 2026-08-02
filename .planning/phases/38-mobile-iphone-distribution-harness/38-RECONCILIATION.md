# Phase 38 Reconciliation

## Delivery paths

- Immediate no-cable path: Expo Go SDK 54 shell through `npm run start:tunnel`.
  The shell defaults to `https://surveytool.app/` and accepts
  `EXPO_PUBLIC_SURVEY_URL` for an unpushed worktree served privately through
  Tailscale Serve.
- Durable installed path: internal TestFlight. The repository is ready to build,
  but upload remains blocked on selecting the paid Apple team, provisioning, and
  verifying the App Store Connect record for `com.kalvoe.survey`.
- Zero-install fallback: `https://surveytool.app/?mobileNav=tabs`, verified at
  390x844 in the real deployed mobile UI.
- Local native path: `npm run mobile:ios:sim`, verified on iPhone 17 Pro Max / iOS
  26.5 with Xcode 26.6.

## Harness contract

- Real viewer route: `?testPdf=clickable-link-test.pdf&mobileNav=tabs&nativeShell=expo`.
- 390x844 mobile viewport, DPR 3, trusted Chromium CDP touch drags/taps/long-press.
- Assertions use exact persisted models and stable IDs after hard reload, not pixels.
- Each run receives its own loopback Vite port and exact storage cleanup.
- Pinch zoom is explicitly not automated: desktop synthetic input is not native
  iOS multi-touch proof.

## Evidence

- Final full default: PASS 58.584s, 13 requested tools / 15 scenarios,
  trusted CDP touch, zero browser errors,
  `.playwright-mcp/mobile-annotations/2026-08-02T20-12-18-681Z-24476/summary.json`.

- Space + Region: PASS 20.865s,
  `.playwright-mcp/mobile-annotations/2026-08-02T19-43-42-612Z-651/summary.json`.
- Pen, Highlighter, Line, Arrow, Rectangle, Ellipse, Counter, Eraser combined:
  PASS 37.974s,
  `.playwright-mcp/mobile-annotations-combined-nontext/2026-08-02T19-46-40-098Z-3363/summary.json`.
- Survey Marker: PASS,
  `.playwright-mcp/mobile-annotations/2026-08-02T19-56-58-725Z-11345/summary.json`.
- iOS Simulator final synced paint proof: PASS 5.8s,
  `/var/folders/r_/yk6_hpnj2mgbf03dcdd15w900000gn/T/survey-ios-simulator-b7f0b562/survey-2026-08-02T20-18-50-469Z.png`.

## Product defects found by the harness

- Region drawing and transforms were mouse-only; migrated to pointer capture and
  exposed Select/Delete mobile controls.
- Space/Survey Marker history prefixes were omitted from legacy history dispatch.
- Survey Marker had no reachable mobile touch delete control.
- A post-Undo history hash could suppress the next Survey Marker deletion snapshot.
- Text formatting overflow clipped Font color entirely on a 390px viewport.
- Font color pointer-down blurred and committed the active editor before click.
- Callout text state could remain active after commit and hide the callout shape
  formatting controls.

## Final gates

- `npx vite build`: PASS.
- `node scripts/run-node-tests.mjs`: PASS, zero failures. One timing-sensitive
  pagehide test failed only while the Node gate was incorrectly run concurrently
  with browser QA; its focused serial rerun and the complete serial rerun passed.
- `npm test`: PASS, zero failures.
- `mobile-expo/npm run check`: PASS (TypeScript + Expo SDK 54 config).
- `npm run mobile:ios:sim -- --no-open`: PASS after full Capacitor sync and build.
- `graphify update .`: PASS, 54,018 nodes / 106,652 edges. Generated graph output
  was not committed because it produced an unrelated million-line regeneration.
- Local branch only: `codex/mobile-iphone-harness`. No push.
