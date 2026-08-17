# Phase 38 — Wireless iPhone Delivery + Mobile Annotation Harness

**Created:** 2026-08-02
**Source:** Isaiah's mobile usability directive, clarified 2026-08-02

## Goal

Make Survey usable on Isaiah's iPhone without a cable, run the same native shell in an
iOS Simulator on this Mac, and build a fast automated harness that exercises the real
mobile viewer like a person would. The harness—not Isaiah—owns routine annotation QA.

The work has three proof layers:

1. A cable-free iPhone distribution path for the native shell.
2. A locally built and launched iOS Simulator app with automated native smoke coverage.
3. A touch-enabled browser harness for exhaustive, fast annotation lifecycle coverage.

## Locked Decisions

- No cable is required for routine installation or updates on Isaiah's phone.
- Native phone navigation uses `mobileNav=tabs`; mobile Safari uses `mobileNav=rail`.
- Survey Marker placement remains a drag-drawn box.
- Native orientation is portrait-only.
- The old mobile demo is a visual reference only; tests drive the real app.
- Browser emulation and physical-device proof are reported separately. Never claim an
  iPhone result from desktop Playwright alone.
- Synthetic pinch zoom is not accepted as proof of native pinch behavior.

## Acceptance Criteria

- **Given** Isaiah has only his iPhone and an internet connection, **when** he opens the
  documented install/update URL or QR code, **then** he can install or refresh Survey
  without connecting the phone to this Mac.
- **Given** a clean iOS Simulator, **when** the documented simulator command runs, **then**
  the production mobile shell builds, installs, launches in portrait, and displays the
  real Survey mobile home/viewer.
- **Given** the Simulator app is running, **when** the native smoke suite runs, **then** it
  launches Survey, opens the viewer, performs representative touch interactions, and
  captures machine-verifiable evidence without human input.
- **Given** the real mobile viewer at 390x844 with touch enabled, **when** the exhaustive
  harness runs, **then** it covers Pen, freehand Highlighter, text-selection Highlight,
  Line, Arrow, Rectangle, Ellipse, Text, Callout, Counter, Survey Marker, Region, and
  Space as separate lifecycle rows.
- **Given** a lifecycle row supports an operation, **when** the harness exercises it,
  **then** create, persisted edit, geometry move, undo/redo, delete, undo-delete, and hard
  reload/reopen are asserted by stable ID plus exact stored type/geometry/style/text or
  category data. Genuinely meaningless operations are marked N/A with a reason.
- **Given** the eraser tool, **when** it crosses the middle of a completed stroke, **then**
  the harness verifies live preview before release, no premature persisted commit, split
  fragments after release, reload survival, and undo restoration. Full-object erase gets
  the same delete/reload/undo proof.
- **Given** one failing tool scenario, **when** a developer reruns the harness with its
  focused tool filter, **then** only that scenario runs and produces useful state/DOM/
  screenshot diagnostics quickly. Target: under 30 seconds warm.
- **Given** a warm local environment, **when** the full mobile annotation matrix runs,
  **then** it completes in under 3 minutes or records the measured bottleneck and an
  optimization plan.
- **Given** any source change, **when** it is committed, **then** `npm run build`, `npm test`,
  the relevant focused mobile scenario, and the full mobile harness are green with zero
  failures; the exact test baseline is recorded rather than hardcoded.

## Persistence Contract

- The app's serialized annotation/domain state is the primary assertion surface.
- PDF export is an output projection and may be tested additionally, never as the sole
  proof of persistence.
- The full deterministic matrix may use the dev-only stable `testPdf` route and exact
  per-document local storage cleanup.
- Real-auth/cloud coverage, if exercised, uses coordinator-owned account leases and exact
  cleanup/attestation/release per `AGENTS.md`.

## DO NOT CHANGE

- Do not change the five owner decisions in
  `.planning/mobile-demo-parity-2026-07-12/SPEC.md`.
- Do not reintroduce JavaScript zoom coordination in
  `src/components/SVGAnnotationLayer.jsx`.
- Do not remove or rename `zoomGeneration`.
- Do not size a canvas as `pageSize * scale`; use container-aware measurement.
- Do not use CSS fallback stacks as Fabric Textbox `fontFamily`.
- Do not tighten wildcard CORS on the protected edge functions.
- Do not recreate deleted Fabric drawing/edit canvas components.
- Do not refactor `src/PDFViewer.jsx`, `src/PageAnnotationLayer.jsx`,
  `src/viewerShared.js`, or annotation components while fixing a mobile tool. Minimum
  viable, harness-proven diffs only.
- Do not push the git branch. Remote mobile distribution is allowed only to satisfy the
  explicit cable-free installation goal and must not imply a git push.
- Do not overwrite unrelated user changes or generated artifacts from other tasks.

## Expected Edit Lanes

- Wireless shell/distribution: `mobile-expo/`, `capacitor.config.ts`, `ios/`,
  `docs/MOBILE-RUN.md`, narrowly scoped package scripts.
- Harness: `agent-cli/mobile-annotations-e2e.mjs`, new `agent-cli` helpers, test fixtures,
  and mobile-specific Playwright configuration/tests.
- Product fixes: only files directly implicated by a failing lifecycle scenario.
- Planning: this phase's context, plans, summaries, and reconciliation.

## Verification Evidence

- Exact cable-free install/update URL or QR workflow.
- Simulator build log, app launch proof, and automated native smoke result.
- Per-tool lifecycle matrix with pass/fail/N/A reasons.
- Persisted before/after records for reload assertions.
- Focused and full harness timings.
- `npm run build`, `npm test`, and mobile harness summaries.
- Browser screenshots and Simulator stream screenshot for user-visible flows.

## Status: IN PROGRESS
