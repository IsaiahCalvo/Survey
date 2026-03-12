# BetaSafe Survey Tool

## What This Is

A PDF survey annotation tool built on Syncfusion React PDF Viewer with a custom Fabric.js canvas annotation layer. The Electron desktop app supports 16 annotation types (pen, highlighter, shapes, arrows, text, callouts, etc.), project management, and cloud sync via Supabase. Used for professional survey/inspection workflows.

## Core Value

Annotations must render correctly and reliably across all user interactions — zoom, pan, page navigation, creation, editing, and deletion.

## Current Milestone: v2.0 Debug Annotations

**Goal:** Build an automated debugging and analysis pipeline that can drive the app, capture synchronized evidence of rendering problems, and produce structured artifacts for LLM-assisted diagnosis.

**Target features:**
- Dev-only test route for Playwright automation (bypass auth)
- Playwright harness with deterministic scenario scripts
- Synchronized artifact capture (video, screenshots, events, console, performance)
- Session bundle storage (folder-per-run)
- Extended debug API exposing internal app state
- Post-processing pipeline (anomaly detection, keyframe extraction, timeline summaries)
- LLM-friendly analysis output (chunked, structured)

**First target bug:** Post-zoom annotation flicker — annotations flash to wrong position/size after zoom ends, then snap back to correct position. Race condition between CSS transform removal and Fabric.js canvas repaint.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Annotations stay visible during zoom operation (CSS transform overlay) — v1.0
- ✓ Annotations scale smoothly with page during zoom (GPU-accelerated transforms) — v1.0
- ✓ Three-ref freeze prevents portal host disconnection during Syncfusion page rebuilds — v1.0

### Active

<!-- Current scope. Building toward these. -->

- [ ] Post-zoom flicker eliminated — no wrong-position/size flash after zoom ends
- [ ] Automated test harness can drive the app through deterministic scenarios
- [ ] Debugging artifacts captured with synchronized timeline
- [ ] Session bundles stored in structured folders for analysis
- [ ] LLM can analyze chunked artifacts alongside source code

### Out of Scope

- Gemini Embedding 2 / semantic retrieval — v3, after artifact quality is proven
- CI pipeline integration — v3, local-only for now
- Electron-specific automation — targeting Vite dev server in Chromium instead
- Real-time monitoring dashboard — files and folders are sufficient
- Automated fix generation — LLM analyzes, human decides
- Database storage — folder-per-run until file-based retrieval becomes painful

## Context

- Electron app (electron 25.2.1) with React UI served by Vite on port 5173
- Syncfusion React PDF Viewer renders PDF pages; custom Fabric.js 5.5.2 canvas overlay renders annotations
- App.jsx is a 1.3MB monolith containing zoom logic, portal host resolution, render loop
- PageAnnotationLayer.jsx (384KB) handles per-page canvas annotation rendering
- Existing debug APIs: `window.pdfPerf` (performance metrics), `window.__pdfHistoryDebug` (undo/redo history), `pdfDebug.js` (counters, event rates)
- PDFs stored in Supabase Storage (`documents` bucket), downloaded as blobs, passed as Uint8Array to Syncfusion
- 16 annotation tools: pen, highlighter, eraser, text, rect, ellipse, line, arrow, underline, strikeout, squiggly, callout, note, highlight, select, pan
- Post-zoom flicker: CSS transforms removed before Fabric.js finishes repainting at new scale — ~50-200ms gap where annotations show at wrong position/size

## Constraints

- **Tech stack**: Syncfusion React PDF Viewer + Fabric.js 5.5.2 — cannot replace either
- **Automation target**: Vite dev server (localhost:5173) in Chromium via Playwright — not Electron directly
- **Artifact format**: Folder-per-run, no database — must be manually inspectable
- **Philosophy**: Deterministic scripts, not AI agent improvisation. LLM analyzes evidence, doesn't generate it
- **Backwards compatibility**: Debug infrastructure must not affect production builds or existing functionality

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CSS transform scaling during zoom | GPU-accelerated, instant, no re-render needed during transition | ✓ Good |
| Debounced re-render after zoom settles | Avoids expensive canvas re-draws during active zooming | ✓ Good |
| Three-ref freeze for portal host stability | Prevents Syncfusion page rebuilds from disconnecting annotation canvases | ✓ Good |
| Playwright targeting Vite dev server (not Electron) | More stable automation, same rendering behavior, built-in video/trace | — Pending |
| Dev-only test route bypassing auth | Clean automation without fragile login flows | — Pending |
| Folder-per-run storage (no database) | Simple, inspectable, diffable — database only when file-based becomes painful | — Pending |
| Embeddings deferred to v3 | Capture quality must be proven before indexing makes sense | — Pending |
| Headless by default with --headed flag | Faster runs, video captures everything, headed for debugging | — Pending |

---
*Last updated: 2026-03-11 after v2.0 milestone initialization*
