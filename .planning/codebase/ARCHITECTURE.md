# Architecture

**Analysis Date:** 2026-07-19

> Living detail lives in `docs/ARCHITECTURE.md`. This file is the GSD codebase-map summary kept in sync with that guide.

## Pattern Overview

**Overall:** Electron + React desktop/web app with an owned **pdf.js** page engine, SVG annotation display, HTML text editing, a Fabric eraser overlay, and Supabase (+ Yjs) persistence.

**Key characteristics:**
- pdf.js container owns page metrics / scroll / zoom (`PdfjsViewerContainer`)
- SVG `viewBox` is the annotation visual truth (`SVGAnnotationLayer`) — no JS zoom coordination on that layer
- `zoomGeneration` auto-commits in-progress eraser/overlay work at zoom-start
- AppShell publishes chrome APIs from PDFViewer (`leftRailApi`, `rightRailApi`, `bottomToolbarApi`) with an identity-churn guard
- Syncfusion is removed; do not reintroduce it

## Layers

**UI / shell:** `AppShell.jsx`, `Dashboard.jsx`, `components/`, `home/`, `sidebar/`
**Document viewer:** `PDFViewer.jsx` + `PdfjsViewerContainer.jsx`
**Annotation display / edit:** `SVGAnnotationLayer.jsx`, `TextEditOverlay.jsx`, `FabricEraserCanvas.jsx`
**Legacy Fabric PAL:** `PageAnnotationLayer.jsx` (`?renderer=canvas` / Ctrl+Shift+V)
**Persistence:** Supabase client + services + edge functions; Yjs dual-write for sealed docs
**Desktop:** `electron-main.js` / `preload.js`

## Entry Points

- `src/main.jsx` → `AppShell`
- DEV: `?testPdf=`, `?hubPreview=1`, `?spike=features`
- Tests: `npm test` → `scripts/run-node-tests.mjs` (`tests/**` + `src/**/__tests__/**`)

## Data Flow (annotations)

Create/edit on SVG (+ TextEditOverlay for content) → commit into `annotationsByPage` in `PDFViewer` → serialize / dual-write → Supabase (+ Yjs). Eraser mutates paths via FabricEraserCanvas then commits on the same pipeline. Export/print project from `annotationsByPage` (plus callout / survey-marker forks — see parity map).

## Cross-Cutting Invariants

Documented in `CLAUDE.md` / `AGENTS.md`:
1. Container-aware canvas sizing
2. SVG viewBox owns zoom scaling
3. Preserve `zoomGeneration`
4. Single-name Fabric `fontFamily`
5. Edge-function CORS `*` intentional

---

*Architecture summary: 2026-07-19 — prefer `docs/ARCHITECTURE.md` for the full map*
