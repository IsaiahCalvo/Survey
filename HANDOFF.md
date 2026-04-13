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
| 1b | ⏳ NEXT | Load-time React↔Syncfusion scale desync | `App.jsx` onDocumentLoad path | low |
| 2 | ⏳ | Fit-to-height possibly broken | unknown — find `ZOOM_MODES.FIT_HEIGHT` handler | low |
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

## Bug #1b root cause (discovered, not fixed)

Proof in `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log` lines 1-1507 (the log the user shared this session):
- Before any zoom: `syncfusionViewerScale=0.1` (React state) while `measuredPageScale=1.1732` (actual rendered DOM)
- First zoom+ click: `zoom_start scale=0.1 → 0.12` — multiplier ran on stale React scale
- Result line 1509: container shrinks `1436 → 196px` in one click

React `scale` at `App.jsx:9146` initializes from `initialViewState?.scale || initialZoomPreferences.manualScale` — persisted from last session. Syncfusion opens at its own default (~1.17x). Nothing reconciles them at mount. Was hidden before ZOOM-09 because the old 50% floor clamped persisted values up to 0.5 where the mismatch was smaller / less catastrophic.

**Proposed fix:** in `handleSyncfusionDocumentLoad` (or the first `handleSyncfusionZoomChange` call post-mount), read `syncfusionViewerRef.current.getZoomValue()` and reconcile React `scale` + `zoomInputValue` to match. Do NOT call `controller.setScale(persisted)` — that fights Syncfusion's own fit-to-width default. Just trust Syncfusion's reported zoom as source of truth at mount.

Second App.jsx carve-out needed. Keep surgical.

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
2. Read `.planning/STATE.md` and the Session Moments file at `/Users/isaiahcalvo/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-04-12.md` (critical — has all 4 INSIGHT/SHIFT entries from this session)
3. Ask user: "Did bug #1 fix (`b77405f`) verify — does zoom input now track canvas 1:1? If yes, I'll start bug #1b."
4. Do NOT start instrumenting bug #1b until user confirms #1 is good. If they say no, re-investigate #1 — don't move on.

## Context-budget suggestion

Bugs #1b, #2, #3 should comfortably fit in one fresh session (~40% context each or less). Bug #4 is the big one — get its own fresh session with `/clear` right before, because edit-mode handle diagnosis will need heavy instrumentation across `FabricEditCanvas.jsx`, `PageAnnotationLayer.jsx`, and `SVGSelectionOverlay.jsx`, and the logs will be large.
