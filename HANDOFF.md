# HANDOFF — Phase 12 gap bugs (bug #1 shipped, bugs #1b–#4 remaining)

**Session:** 2026-04-12 evening · **Branch:** `post-v2.0/cleanup` · **Context at handoff:** 23%

## Where we are

Executing `/gsd:execute-phase 12`. Wave 1 (Plan 12-01: EDIT-11 + ZOOM-09) shipped 3 atomic commits with 79/79 tests green. User's manual verification surfaced 5 issues; #5 is just Wave 2 not built yet, the other 4 are real. Bug #1 was diagnosed from existing debug logs (no new instrumentation needed) and shipped as commit `b77405f`.

**Do NOT close Plan 12-01 or advance to Wave 2 until bugs #1b–#4 are resolved and the user re-verifies.**

## Commits landed this session

```
b77405f fix(12-01): live-update zoom input during deferred setScale (bug #1)
9b0c6f1 feat(12-01): wire snapAngleToNearest45 into rotate branch — EDIT-11
df43b0f feat(12-01): lower zoom floor 50%→10% — ZOOM-09 atomic 2-file commit
8ed6b70 test(12-01): add snapAngleToNearest45 helper + test scaffolds
```

All on `post-v2.0/cleanup`. `dist/index.html` modified (build artifact, ignore).

## Bugs — ordered for momentum

| # | Status | Bug | File(s) | Risk |
|---|--------|-----|---------|------|
| 1 | ✅ SHIPPED `b77405f` | Zoom input display lag vs canvas | `App.jsx:~12202` | — |
| 1b | ✅ SHIPPED `3a3db09` | Load-time React↔Syncfusion scale desync | `App.jsx` onDocumentLoad path | — |
| 2 | ⏳ NEXT | Fit-to-height possibly broken | `App.jsx:~12623` handleZoomModeSelect FIT_HEIGHT branch — Syncfusion has no direct fit-height API, falls through to `zoomControllerRef.current?.setMode(mode)`. Likely the regression point. | low |
| 3 | ⏳ | Blue glow/hitbox scales with zoom in selection mode | `SVGSelectionOverlay.jsx` — missing `vector-effect="non-scaling-stroke"` on glow shape | low |
| 4 | ⏳ HARDEST | Edit-mode shape handles misaligned (circles hit/miss, rectangles slightly off, circles scale/transform unreliable) | `FabricEditCanvas.jsx` — container-aware measurement race at small zooms | high, needs heavy logging |

Do not skip ahead. Each fix validates the testing apparatus for the next.

## Bug #1 root cause (reference for similar classes)

`handleSyncfusionZoomChange` at `src/App.jsx:12193+` defers `setScale()` by up to 1000ms while `zoomOverlayTransformActiveRef` is active (prevents PAL unmount churn during rapid zoom, by design). Canvas updates instantly via CSS overlay transform at `App.jsx:12263-12278`. Zoom input reads `scale` state via `useEffect` at `App.jsx:21967` — so it waits for settle.

**Fix shipped** (7 LOC) right after `scaleRef.current = nextScale;` at `App.jsx:12202`:
```js
if (document.activeElement !== zoomInputRef.current) {
  setZoomInputValue(String(Math.round(nextScale * 100)));
}
```
`setZoomInputValue` only re-renders the toolbar input, not PAL — no churn risk.

**User must verify:** hard-reload http://localhost:5173/, zoom rapidly with `Cmd+=` / `Cmd+-`, confirm the `%` number now tracks the canvas 1:1 with no lag. If good → proceed to #1b. If lag persists → diagnosis was wrong, re-investigate.

## Bug #1b root cause + fix (SHIPPED `3a3db09`)

Diagnosis from instrumented `doc_load_scale_diag` + `_settled` debugMarks:
- `payloadZoomValue: 10`, `viewerGetZoomValue: 10` (still 10 at 300ms AND 1500ms)
- `measuredPageScale=1.1732` in DOM the whole time
- `initialViewStateScale: null`, `restoreSnapshotTargetMode: null`

**Syncfusion's React wrapper `getZoomValue()` lies at mount** — it reports
last-persisted state (10%) while the viewer itself has already rendered at
its own fit-to-width default (117%). The original handoff's proposed fix
("trust getZoomValue") would have reproduced the bug.

**Fix shipped:** measure scale from DOM via the existing
`measureSyncfusionPageScale` helper, retry via RAF + setTimeout, update
`scaleRef.current` + React `scale`/`manualZoomScale`/`zoomInputValue`. Did
NOT call `magnificationModule.zoomTo` — would trigger the zoom overlay flow
with a bogus 11.7x ratio. Third App.jsx carve-out in Plan 12-01.

**User must verify when resuming:** hard-reload, open PDF, wait 2s, single
Cmd+= — page should grow from ~117% to ~140%, NOT shrink to 12%. Already
verified this session.

## Bug #2 hint (next)

`handleZoomModeSelect` at `App.jsx:~12603` — FIT_HEIGHT branch at ~12623
falls through to `zoomControllerRef.current?.setMode(mode)` because
Syncfusion exposes no direct fit-height API. That zoomController path
likely doesn't know about the Syncfusion renderer and sets the wrong scale.
Instrument the FIT_HEIGHT branch first, reproduce, diagnose, ship.

## User's workflow rule (enforce for #1b–#4)

> "Implement the most aggressive and invasive debugging to record in the logs. Then I share the logs with you and you decipher them to diagnose and fix the issue."
> "Fix each of these items one at a time. I don't want to be testing a million things because it makes it impossible to track."

**Per-bug loop:**
1. Instrument (or find existing logs if sufficient — #1 didn't need new instrumentation)
2. User reproduces, saves console to `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log` (overwritten per bug — they reuse the same path)
3. Diagnose from logs
4. Ship minimal fix as its own commit
5. Remove/gate the instrumentation
6. User verifies one thing, not fifteen
7. Next bug

## Phase discipline reminders

- `CLAUDE.md` Always Protected files: `App.jsx`, `PageAnnotationLayer.jsx`, `FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx`, `SVGAnnotationLayer.jsx`, `package.json`, `vite.config.js`. Each carve-out must be surgical and justified in the commit message.
- Plan 12-01 is NOT yet complete. Don't write `12-01-SUMMARY.md` or advance `STATE.md` until the user approves the checkpoint after all 4 bugs are fixed. Keep 12-01 open.
- Plan 12-02 (EDIT-12 RotationInputField) has not started. Do not start it while 12-01 is open.
- Phase 12 needs a `12-RECONCILIATION.md` before closing. Don't skip it.
- Skip Wave 2 entirely in `/gsd:execute-phase 12` resume if bugs aren't cleared — the checkpoint on 12-01 blocks it anyway.

## Environment

- Dev server: should still be running at http://localhost:5173/ (PID 8990 per pre-checkpoint report — verify with `lsof -i:5173` before relying on it)
- Test PDF: `Package 2 - Rev 4 -- IC.pdf`, page 6
- User preference: laymen's explanations, terse output, no emojis, no multi-file testing, diagnostic logs over Kapture MCP
- Tests: `npm test` — must stay at 79/79 or newer green baseline
- User is on Electron wrapper (affects zoom factor — see CLAUDE.md gotcha 2026-03-22)

## First actions in the new session

1. Read this file
2. Read `.planning/phases/12-shape-edit-polish/.continue-here.md`
3. Ask user: "Bugs #1 and #1b are both user-verified. Ready to start bug #2 (fit-to-height)?"
4. If yes → instrument `handleZoomModeSelect` FIT_HEIGHT branch at App.jsx:~12623 and the `zoomControllerRef.setMode` path, ask user to repro, diagnose, ship.
5. After bug #2 user-verifies → bug #3 (SVGSelectionOverlay glow, likely 1-line fix).
6. Bug #4 gets its own `/clear` session — heavy cross-file work.

## Context-budget suggestion

Bugs #1b, #2, #3 should comfortably fit in one fresh session (~40% context each or less). Bug #4 is the big one — get its own fresh session with `/clear` right before, because edit-mode handle diagnosis will need heavy instrumentation across `FabricEditCanvas.jsx`, `PageAnnotationLayer.jsx`, and `SVGSelectionOverlay.jsx`, and the logs will be large.
