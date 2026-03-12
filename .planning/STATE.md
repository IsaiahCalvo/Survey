---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Debug Annotations
status: defining_requirements
stopped_at: null
last_updated: "2026-03-11T00:00:00.000Z"
last_activity: 2026-03-11 -- Milestone v2.0 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** Annotations must render correctly and reliably across all user interactions
**Current focus:** Defining requirements for automated debugging pipeline

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-11 — Milestone v2.0 Debug Annotations started

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

- Playwright targeting Vite dev server in Chromium (not Electron directly)
- Dev-only test route (`?testPdf=...`) to bypass auth for automation
- Folder-per-run session bundles (no database)
- Embeddings deferred to v3
- Headless by default with --headed flag
- First target bug: post-zoom flicker (CSS transform removal race condition)

### From v1.0 (Zoom Fix)

- CSS transform scaling during zoom (GPU-accelerated) — working
- Three-ref freeze prevents portal host disconnection — working
- Two-phase settle with confirm-pending — working but causes post-zoom flicker
- Root cause of flicker: CSS transforms removed before Fabric.js finishes painting at new scale
- Timing window: ~50-200ms gap between transform removal and canvas repaint completion

### Pending Todos

None.

### Blockers/Concerns

- Post-zoom flicker still present — first target for debug system
- App.jsx is 1.3MB monolith — adding debug hooks requires care
- Fabric.js renderAll() is synchronous 200-800ms per page — fundamental timing constraint

## Session Continuity

Last session: 2026-03-11
Stopped at: Defining requirements for v2.0 Debug Annotations milestone
Resume file: —
