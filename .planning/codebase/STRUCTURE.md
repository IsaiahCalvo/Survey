# Codebase Structure

**Analysis Date:** 2026-07-19 (rewritten; prior 2026-03-17 tree described Syncfusion + `App.jsx` and is obsolete)

## Directory Layout

```
Survey-BetaSafeS2/
├── src/
│   ├── main.jsx                 # React entry + DEV routes (?testPdf, ?hubPreview, ?spike=features)
│   ├── AppShell.jsx             # App root (tabs, auth, chrome hosts)
│   ├── PDFViewer.jsx            # Document viewer (~34k lines; HIGH-RISK)
│   ├── Dashboard.jsx            # Home / projects / templates
│   ├── viewerShared.js          # Shared helpers/constants (leaf; not an app root)
│   ├── PageAnnotationLayer.jsx  # Legacy Fabric PAL (~10k lines)
│   ├── SurveySpacesRail.jsx     # Survey right rail
│   ├── electron-main.js         # Electron main process
│   ├── preload.js               # IPC bridge
│   ├── DevTestRoute.jsx         # Dev rapid test route
│   ├── components/              # PdfjsViewerContainer, SVGAnnotationLayer,
│   │                            # FabricEraserCanvas, TextEditOverlay, panels, modals
│   ├── utils/                   # geometry, sync, export, pdfNativeExport, …
│   ├── services/                # Excel/Graph, document I/O, locks
│   ├── hooks/                   # React hooks
│   ├── home/                    # SurveyHub + home pieces
│   ├── sidebar/                 # Left-rail pieces
│   ├── contexts/                # AuthContext, MSGraphContext
│   ├── reorder/                 # Page reorder
│   ├── workers/                 # PDF workers
│   └── prototype/               # DEV spikes (FeatureSpike)
├── public/                      # static assets (no ej2-pdfviewer-lib)
├── tests/                       # node --test unit tests
├── debug/                       # Playwright scenarios + fixtures
├── docs/                        # living architecture + audits + handoffs
├── .planning/                   # GSD roadmap / phases / codebase maps
├── scripts/                     # bootstrap, test runners, audits
├── supabase/                    # migrations + edge functions
├── ios/ android/                # Capacitor shells
├── landing/                     # marketing site
├── package.json
├── vite.config.js
├── README.md
├── CLAUDE.md
└── AGENTS.md
```

## Entry Points

| Entry | Role |
|---|---|
| `src/main.jsx` | Browser/Electron renderer bootstrap |
| `src/AppShell.jsx` | Application root component |
| `src/electron-main.js` | Electron main process |
| `src/preload.js` | Context-isolated IPC bridge |
| `scripts/run-node-tests.mjs` | `npm test` harness |

## Core Runtime Path

1. `main.jsx` mounts `AppShell` (or a DEV route).
2. `AppShell` shows `Dashboard` (no open doc) or `PDFViewer` (open doc).
3. `PDFViewer` mounts `PdfjsViewerContainer` for pages and portals per-page overlays.
4. Annotations render in `SVGAnnotationLayer`; text edit uses `TextEditOverlay`; eraser uses `FabricEraserCanvas`.
5. Persistence / sync goes through Supabase services + Yjs dual-write helpers.

## What is NOT in the tree anymore

- `src/App.jsx` as app root (renamed/split → `viewerShared.js` + `AppShell` + `PDFViewer`)
- `SyncfusionPDFContainer.jsx` / `@syncfusion/ej2-*` / `public/ej2-pdfviewer-lib`
- `FabricDrawingCanvas.jsx` / `FabricEditCanvas.jsx`
- `AnnotationContext.jsx` / `OptimizedPDFPage.jsx`
- Stub `src/components/PageAnnotationLayer.jsx` (real PAL is `src/PageAnnotationLayer.jsx`)

For invariants and high-risk file rules, see `CLAUDE.md` / `AGENTS.md`. For a deeper architecture narrative, see `docs/ARCHITECTURE.md`.

---

*Structure analysis: 2026-07-19*
