# Survey — PDF Annotation App

An Electron + React desktop app for marking up engineering and construction PDFs. Survey provides high-fidelity annotation tools (highlight, pen, callouts, counter chains, shapes, text, sticky notes) on an owned **pdf.js** viewer, with a Supabase cloud database as the live source of truth so annotations sync across devices.

## Quick Start

```bash
npm install
npm run dev          # Vite dev server + Electron (port 5173)
npm run dev:ui       # Vite only (no Electron) — use for headless / browser
npm test             # Node test runner — tests/** + src/**/__tests__/**
npm run test:eraser-lifecycle # 16 mounted-app eraser lifecycle/gesture scenarios
npm run build        # Production web build → dist/
npm run dist         # Web build + electron-builder installers
```

`npm install` runs `scripts/bootstrap-dev-env.mjs` (via `postinstall`), which creates a gitignored `.env` with the public Supabase URL + anon key when missing. Optional keys (Stripe, Microsoft Graph, etc.) are documented in `.env.example`.

For signed-in local flows, put auto-login secrets in `.env.local` (see `AGENTS.md`).

## Architecture (high level)

- **PDF engine (pdf.js).** `src/components/PdfjsViewerContainer.jsx` owns page rendering, viewport, and zoom. Syncfusion has been removed from the dependency tree.
- **Display layer (SVG).** Annotations render as SVG with a `viewBox` that auto-scales on zoom — no JavaScript zoom timers. Lives in `src/components/SVGAnnotationLayer.jsx`.
- **Text edit (HTML overlay).** Content edits for textboxes/callouts use `src/components/TextEditOverlay.jsx` (same-surface `contentEditable`), not a Fabric edit canvas.
- **Eraser (Fabric.js).** The eraser tool mounts `src/components/FabricEraserCanvas.jsx` only. Drawing/edit Fabric canvases were deleted in the 2026-07 dead-code passes — do not recreate them.
- **App shell.** `src/main.jsx` → `src/AppShell.jsx` (tabs, auth, chrome hosts) → `Dashboard.jsx` (home) or `PDFViewer.jsx` (open document). Shared helpers live in `src/viewerShared.js` (not an app root).
- **Cloud sync.** Annotation writes go to Supabase (plus Yjs dual-write for sealed docs). The PDF file is an output projection at print/export/download time, not the source of truth.
- **Print / export.** Bake-on-demand helpers under `src/utils/pdfNativeExport/` convert app annotations toward native PDF dictionaries behind feature flags.

## Tech Stack

- React 18 + Vite 8 + Electron 43
- pdf.js (`pdfjs-dist` ^6) — owned viewer engine
- Fabric.js 7.4.0 — eraser canvas only (live path)
- pdf-lib 1.17 — low-level PDF manipulation / export
- Supabase (auth + database) + Yjs (CRDT dual-write)
- ExcelJS + Microsoft Graph (Excel / OneDrive sync)
- Capacitor (`ios/` / `android/`) for mobile shells
- Node built-in test runner + Playwright (`debug/`) for e2e
- electron-builder + electron-updater for desktop installers

## Mobile (iOS)

Capacitor wraps the same Vite bundle as the desktop app. Two runners build,
install, and launch it — one for the Simulator, one for a real phone:

```bash
npm run mobile:ios:sim                  # Simulator, embedded bundle
npm run mobile:ios:sim -- --dev-server  # Simulator, live Vite reload

npm run mobile:ios:device                 # Paired iPhone, embedded bundle
npm run mobile:ios:device -- --dev-server # Paired iPhone, live Vite reload
npm run mobile:ios:device -- --help       # All flags and env overrides
```

`mobile:ios:device` (`scripts/run-ios-device.mjs`) builds `dist`, runs
`npx cap sync ios`, builds the Debug app for the device, then installs and
launches it with `xcrun devicectl`. In bundled mode it verifies the
`release.json` commit inside the built `.app` matches the worktree HEAD, so the
phone can never quietly run stale code. There is no `devicectl device
screenshot`, so unlike the Simulator runner it cannot capture a painted frame —
confirm the UI on the phone.

`--dev-server` makes the phone load a Vite server running on this Mac, so edits
hot-reload on the device. The URL defaults to this Mac's Tailscale MagicDNS host
(when Tailscale is up) or its `en0` LAN IP on port 5177; `localhost` is rejected
because the phone cannot reach the Mac's loopback. Start Vite with
`npm run dev -- --host` first, and keep it running. The live URL is written only
into a disposable copy of `ios/` — the checked-in Capacitor config stays
production-safe.

**First-time device setup (one time per Mac / per phone):**

1. Sign in to Xcode: **Xcode → Settings… (Cmd+,) → Accounts → "+" → Apple ID**.
   Without an account, automatic signing fails with `No Accounts` and no
   provisioning profile can be created.
2. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**
   (the phone reboots), and after the first install
   **Settings → General → VPN & Device Management → tap the developer entry → Trust**.
3. The App target signs automatically against the personal team
   (`DEVELOPMENT_TEAM` in `ios/App/App.xcodeproj`). Personal-team builds expire
   after 7 days — re-run the command to refresh. The store bundle id
   `com.kalvoe.survey` must not change; if a free team cannot register it, pass a
   dev-only id to xcodebuild instead of editing the project.

## Project Layout

```
src/
  main.jsx                  # React entry + DEV-only routes (?testPdf, ?hubPreview, ?spike=features)
  AppShell.jsx              # App root (tabs, auth, chrome hosts)
  PDFViewer.jsx             # Document viewer (~34k lines; HIGH-RISK)
  Dashboard.jsx             # Home / projects / templates
  viewerShared.js           # Shared helpers/constants (leaf module)
  PageAnnotationLayer.jsx   # Legacy Fabric PAL (~10k lines; ?renderer=canvas path)
  electron-main.js          # Electron main process
  preload.js                # IPC bridge (window.electronAPI)
  components/               # PdfjsViewerContainer, SVG/Fabric eraser, panels, modals
  utils/                    # geometry, sync, export, pdfNativeExport, …
  workers/                  # PDF.js / paint workers
public/                     # static assets copied into dist/ at build
tests/                      # node --test unit tests
debug/                      # Playwright scenarios + fixtures
docs/                       # living architecture + handoffs + audits
.planning/                  # GSD workflow: roadmap, phases, milestones
scripts/                    # bootstrap, backup, test runners
ios/ android/               # Capacitor mobile shells
landing/                    # marketing landing page
supabase/                   # migrations + edge functions
```

## Where to Find Things

- **Living architecture:** `docs/ARCHITECTURE.md`, `CLAUDE.md` / `AGENTS.md` (invariants)
- **Annotation lifecycle:** `docs/ANNOTATION-CONTRACT.md` (banner for SVG-era CREATE/EDIT) and `docs/ANNOTATION-PARITY-MAP-2026-07-16.md` (callout forks)
- **Roadmap / phases:** `.planning/ROADMAP.md`, `.planning/phases/`
- **Session handoffs:** `docs/handoffs/` and root `HANDOFF-*.md` (historical snapshots)
- **Stripe / webhooks:** `docs/STRIPE_SETUP.md`, `docs/WEBHOOK_DEBUGGING.md`
- **Security notes:** `docs/SECURITY_AUDIT_REPORT.md`, `SECURITY-AUDIT-REPORT.md`

## Critical Project Invariants (do not break)

Enforced by `CLAUDE.md` / `AGENTS.md`. Touching these without explicit scope is a boundary violation:

- `src/PDFViewer.jsx` — load-bearing viewer; minimum viable diff only
- `src/PageAnnotationLayer.jsx` — per-page Fabric overlay (legacy/canvas path)
- `src/components/SVGAnnotationLayer.jsx` — owns all SVG zoom scaling via `viewBox`
- `src/components/FabricEraserCanvas.jsx` — relies on the `zoomGeneration` signal
- `src/components/PdfjsViewerContainer.jsx` — owned pdf.js engine + scale lifecycle
- `package.json` / `vite.config.js` — infra; document the why

Canvas sizing must use container-aware measurement (`containerEl.offsetWidth / pageSize.width`), never `pageSize * scale`. Fabric text `fontFamily` must be a single font name. Edge-function CORS `Access-Control-Allow-Origin: '*'` is intentional (web + Electron `file://` + Capacitor). Details in `CLAUDE.md`.

## Contributing

This codebase uses a phased planning workflow (GSD) under `.planning/`. New work flows through:

1. **Discuss** the phase intent — write a `CONTEXT.md` with Acceptance Criteria (Given/When/Then) and a DO NOT CHANGE list.
2. **Plan** — break the phase into bite-sized tasks with failing-test-first TDD steps.
3. **Execute** — atomic commits per task, with verification runs.
4. **Reconcile** — close the phase with a `RECONCILIATION.md` (plan vs actual, criteria results, lessons).

Follow the existing code style. Run `npm test` before committing. Manual smoke testing in the running app is required for any UI change.

### Backend eraser-permission E2E

Run `npm run test:e2e:eraser-permissions`. It loads the three
`SUPABASE_TEST_*` credentials from the main repository's gitignored
`.env.test`, starts an isolated Vite server, and runs exactly nine serial
scenarios against fresh disposable documents. Missing credentials, an unknown
backend host, a missing seam, or cleanup failure is fatal; the suite never
skips.

Set `ERASER_PERMISSION_E2E_ENV_ROOT=/absolute/repo/path` only when Git cannot
discover the main repository.

### Click-every-control walkthrough (run before merging UI work)

```
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
  --config debug/playwright.config.mjs debug/scenarios/click-every-control.spec.mjs
```

It starts its own Vite on that port, uses only local fake data (no account,
no database), and on a 1440x900 desktop and a 390x844 touch phone presses
every toolbar / rail / dock / tab button, every tool's sub-tools and style
controls, the tool letters, Ctrl/Cmd+F, Ctrl/Cmd+Z, zoom keys, `?`, Escape,
every Home tab, the row menus, Share, the account menu and Settings. Each
control must visibly do something and throw no page error. It prints one
`ok` / `FAIL` line per control and saves a screenshot of each failure under
`test-results/`. About 5 minutes. It needs a browser, so it is not in the CI
shards. No Playwright Chromium installed? Add
`PW_CHROMIUM_PATH=/path/to/chrome`.

## License

Proprietary — all rights reserved.
