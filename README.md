# Survey — PDF Annotation App

An Electron + React desktop app for marking up engineering and construction PDFs. Survey adds the high-fidelity annotation tools (highlight, pen, callouts, counter chains, shapes, text, sticky notes) on top of a Syncfusion PDF viewer, with a Supabase cloud database as the live source of truth so annotations sync across devices.

## Quick Start

```bash
npm install
npm run dev          # Vite dev server + Electron (port 5173)
npm test             # Node test runner — recursive over tests/
npm run build        # Production web build → dist/
npm run dist         # Web build + electron-builder installers
```

A `.env` file in the project root supplies Supabase credentials and the Syncfusion license key:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SYNCFUSION_LICENSE_KEY=...
```

In development, `.env.development.local` can also auto-sign-in a test user — see `feedback_dev_auto_login.md` in the auto-memory folder for details.

## Architecture (high level)

- **Display layer (SVG).** Every annotation type renders as SVG with a `viewBox` that auto-scales on zoom — no JavaScript zoom timers, no Canvas mounted unless the user is actively editing. Lives in `src/components/SVGAnnotationLayer.jsx`.
- **Edit layer (Fabric.js).** When the user picks a tool (pen, eraser, text, shape edit), a small per-page Fabric.js Canvas mounts on top of the SVG layer and unmounts when the tool exits. Lives in `src/components/FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`, `FabricEditCanvas.jsx`.
- **Cloud sync.** All annotation writes go to Supabase. The annotation database is canonical for every device, and multi-device sync propagates within ~1 second. The PDF file itself is never the source of truth — it's only an output projection at print/export/download time.
- **Print, export, download (in flight).** A new "bake on demand" pipeline (under `src/utils/pdfNativeExport/`) is being built behind a feature flag — at output time, app annotations are converted into native PDF annotation dictionaries so Adobe Acrobat treats them as editable annotations rather than flat pixels. See the v3.0 plan in `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md`.

## Tech Stack

- React 18 + Vite + Electron 38
- Syncfusion ej2-react-pdfviewer 32.1.19 (read-only viewer; the app's annotation toolbar is custom)
- Fabric.js 5.5.2 (edit-time Canvas only)
- pdf-lib 1.17 (low-level PDF manipulation) and annotpdf 1.0 (high-level PDF annotation creation, used by the bake pipeline)
- Supabase (auth + database)
- Node built-in test runner + Playwright for e2e
- electron-builder + electron-updater for desktop installers and auto-update
- Capacitor for the iOS / Android shells (under `ios/` and `android/`)

## Project Layout

```
src/
  App.jsx                 # main app (~1.3MB; render loop, zoom logic, portal hosts)
  electron-main.js        # Electron main process
  preload.js              # IPC bridge (window.electronAPI)
  components/             # SyncfusionPDFContainer, SVG/Fabric layers, panels
  utils/                  # pdf helpers, geometry, pdfNativeExport bake pipeline
  workers/                # PDF.js render worker + paint worker
public/                   # static assets copied into dist/ at build
tests/                    # node --test unit tests (recursive)
debug/                    # Playwright scenarios + analyzer scripts
docs/                     # docs, handoffs, superpowers plans, security audits
.planning/                # GSD workflow: roadmap, phases, milestones, requirements
scripts/                  # bootstrap, backup, dev-env helpers
ios/ android/             # Capacitor mobile shells
landing/                  # marketing landing page
supabase/                 # Supabase migrations
```

## Where to Find Things

- **Roadmap and progress:** `.planning/ROADMAP.md`. Per-phase work lives under `.planning/phases/<N>-<slug>/`. Each phase carries a CONTEXT, plans, summaries, and a RECONCILIATION.md.
- **Active milestone plans:** `docs/superpowers/plans/`. Latest is the v3.0 PDF-native annotations plan (started 2026-04-25).
- **Session handoffs:** `docs/handoffs/` (date-prefixed).
- **Project memory and gotchas:** `CLAUDE.md` (project-level rules, hard invariants, gotchas).
- **Security review notes:** `docs/SECURITY_AUDIT_REPORT.md`.
- **Stripe / webhook setup:** `docs/STRIPE_SETUP.md`, `docs/WEBHOOK_DEBUGGING.md`.

## Critical Project Invariants (do not break)

These are enforced both by `CLAUDE.md` and by the GSD discipline hook. Touching code in any of the following without explicit scope is a boundary violation:

- `src/App.jsx` — load-bearing main file, do not refactor without explicit approval
- `src/components/PageAnnotationLayer.jsx` — per-page Fabric overlay, ~9.8k lines
- `src/components/SVGAnnotationLayer.jsx` — owns all SVG zoom scaling via `viewBox`
- The Fabric Canvas trio (`FabricDrawingCanvas`, `FabricEditCanvas`, `FabricEraserCanvas`) — all rely on the `zoomGeneration` signal contract
- `package.json` and `vite.config.js` — infra; touching requires explicit approval

Specific gotchas (canvas sizing must use container-aware measurement, single-name fonts only, etc.) are documented in `CLAUDE.md`.

## Contributing

This codebase uses a phased planning workflow (GSD) under `.planning/`. New work flows through:

1. **Discuss** the phase intent — write a `CONTEXT.md` with Acceptance Criteria (Given/When/Then) and a DO NOT CHANGE list.
2. **Plan** — break the phase into bite-sized tasks with failing-test-first TDD steps.
3. **Execute** — atomic commits per task, with verification runs.
4. **Reconcile** — close the phase with a `RECONCILIATION.md` (plan vs actual, criteria results, lessons).

Follow the existing code style. Run `npm test` before committing. Manual smoke testing in the dev app is required for any UI change.

## License

Proprietary — all rights reserved.
