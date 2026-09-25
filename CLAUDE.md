# Survey BetaSafeS2 — Claude Code Instructions

## Phase Discipline — ENFORCED

This project uses the global GSD phase discipline rules from `~/.claude/CLAUDE.md`
(PAUL-style acceptance criteria, DO NOT CHANGE boundaries, RECONCILIATION.md at
phase close). A SessionStart hook at `~/.claude/hooks/gsd-phase-discipline.py`
checks `.planning/phases/` and flags gaps.

When creating or editing a phase CONTEXT.md in this project, **always** include:

1. `## Acceptance Criteria` with Given/When/Then bullets
2. `## DO NOT CHANGE` with an explicit file allowlist (start from the "Always
   Protected" list below, then add phase-specific files)

Never close a phase without writing `<phase>/<phase>-RECONCILIATION.md`.

### High-Risk Files (handle with care; standing waiver granted 2026-04-29)

These files are load-bearing for v2.0 and remain high-risk. The user has granted
a standing waiver to edit them without per-edit approval — see
`~/.claude/projects/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2/memory/feedback_protected_files_waiver.md`.
Treat them as high-risk: keep edits
small, scoped, and never refactor while you're in there. Always run `npm test`
after touching them and report baseline state before declaring done.

The Enforced Rules in the next section still bind regardless of the waiver:
container-aware canvas sizing, single-name fontFamily, `zoomGeneration` signal
contract, no JavaScript zoom coordination in `SVGAnnotationLayer.jsx`. Those are
not protection-list items — they are correctness invariants.

- `src/PDFViewer.jsx` — ~1.5MB / ~34k-line document viewer: the pdf.js
  zoom/scale lifecycle (`beginPdfjsScaleConfirmPending` / `PdfjsViewerContainer`),
  the per-page overlay portal render loop, save/sync, and the history engine.
  The single highest-risk file; minimum viable diff only.
- `src/viewerShared.js` — shared constants + helper functions imported by
  PDFViewer and AppShell. Renamed from the misleading `App.jsx` on 2026-05-29
  (it is NOT the app root and is not the 1.3MB monolith — that history belonged
  to the old pre-extraction App.jsx). Not fragile itself, but both big files
  import it, so run build + `npm test` after any change.
- `src/PageAnnotationLayer.jsx` — per-page Fabric.js canvas overlay
  (~10,097 lines). Only touch when actually needed for the current task.
  (The real file is `src/PageAnnotationLayer.jsx`. A dead 41-line stub at
  `src/components/PageAnnotationLayer.jsx` was deleted 2026-05-28 — do not
  recreate it.)
- `src/components/FabricEraserCanvas.jsx` — uses the `zoomGeneration` signal
  contract; do not remove or rename that signal. (FabricDrawingCanvas and
  FabricEditCanvas were deleted in the 2026-07 dead-code passes — do not
  recreate them.)
- `src/components/SVGAnnotationLayer.jsx` — SVG viewBox owns all zoom scaling.
  Never reintroduce JavaScript zoom coordination here.
- `package.json` / `vite.config.js` — infra. Touch sparingly and document the why.

### Session Moments

Follow the PSMM logging rules in `~/.claude/CLAUDE.md`. Today's file is at
`~/.claude/projects/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2/memory/session-moments/YYYY-MM-DD.md`
and is auto-created at session start.

## CRITICAL — DO NOT BREAK (Enforced Rules)

- **Canvas sizing MUST use container-aware measurement, not pageSize * scale.** The Electron/browser zoom factor creates a mismatch. Always measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale`. This applies to FabricEraserCanvas and any future Canvas component. See Gotchas section for details.

- **SVG viewBox handles all zoom scaling.** The old 5-timer Syncfusion zoom system (beginSyncfusionScaleConfirmPending, onScaleApplied, 300ms settle, freeze/snapshot/confirm-pending) was removed in Phase 11 of the v2.0 SVG Migration; Syncfusion itself is gone from `package.json`. SVG annotations scale via `viewBox="0 0 pageWidth pageHeight"` with zero JavaScript coordination. Canvas/overlay consumers use the `zoomGeneration` signal for auto-commit during zoom.

- **NEVER remove the zoomGeneration signal.** `setZoomGeneration(prev => prev + 1)` fires at zoom-start inside `beginPdfjsScaleConfirmPending` (and on pdf.js `gesture-start` via `onZoomPhase`). The LIVE consumers are SVGAnnotationLayer, FabricEraserCanvas, and PdfjsViewerContainer — they watch this signal to auto-commit in-progress work before the container resizes. (The former FabricDrawingCanvas/FabricEditCanvas consumers were deleted in the 2026-07 dead-code passes; the signal contract itself is unchanged.)

- **Edge-function CORS `Access-Control-Allow-Origin: '*'` is INTENTIONAL — never "tighten" it to an origin allowlist.** If a security scan/audit flags the wildcard on `create-checkout-session`, `create-portal-session`, `send-email`, `send-profile-change-notification`, or `excel-apply-changeset`, **it's a false positive — leave it.** The one `dist` bundle ships to four runtimes with four different origins: web (`https://surveytool.app`), web/Electron **dev** (`http://localhost:5173`), **Electron production** (`loadFile` → `file://` → `Origin: null`), and **Capacitor iOS/Android** (`capacitor://localhost` / `https://localhost`; there's no `@capacitor/http`, so the webview enforces CORS). An origin allowlist would CORS-**block** email, Excel sync, and payments on the desktop app and BOTH mobile apps — and keeping Electron working would require allowlisting `Origin: null`, which is the exact hole tightening is supposed to close. These functions auth via `Authorization: Bearer <jwt>` (not cookies) and each calls `auth.getUser()`, so wildcard CORS is **non-exploitable** (a cross-origin page has no ambient credential to abuse). For a Bearer-token API consumed by web + Electron(`file://`) + Capacitor, `*` is the correct design, not a flaw. Investigated + closed 2026-07-05; full write-up in `HANDOFF-post-launch-hardening.md`.

## Codebase Hygiene — Fallow Audit (standing practice)

Run the fallow audit periodically on your own judgment (after landing a sizeable
chunk of code, around big refactors, or as a session winds down) —
`npm run audit:code | audit:dead | audit:dupes | audit:health`.
A committed `.fallowrc.jsonc` declares the real entry points; keep it current.

Fallow's raw findings are mostly false positives here — it's blind to
vite-alias wiring, dynamic/lazy imports, feature flags, and CSS classes used by
live code. NEVER auto-delete. Resolve real importers, check git history for prior
wiring, confirm the feature is unreachable, and for anything ambiguous run an
investigate + adversarial-verify agent pass. Gate every deletion behind
`npx vite build` + `node scripts/run-node-tests.mjs` and commit in small batches.
Intentional keeps fallow will keep flagging: the parked Microsoft/MSAL sign-in
config (Microsoft auth is staying), the Phase-28 collab fallback provider, two
kept stylesheets, and residual pdf.js cutover helpers. Syncfusion packages and
`public/ej2-pdfviewer-lib` are already gone from the tree — do not reintroduce
them. Full record: `debug/fallow-audit/REPORT.md`.

## Gotchas & Lessons Learned

- **2026-09-25 — martinez-polygon-clipping mis-cuts on bit-identical shared edges (w38 eraser artifacts):** Martinez 0.7.4 returns garbage whenever its two operands share EXACTLY coincident edges/vertices; moving one operand by ~1e-9 of its size makes it correct. In the eraser this painted erased dabs back in, dropped blocks of ink and left 1 px slivers/hairlines when two eraser lanes' survivors of one stroke (both cut from the same outline) were intersected, and lost ink when the same spot was erased twice. Never feed Martinez two polygons derived from the same outline without `separateCoincidentVertices` (an unconditional 1e-9 nudge) (paperAnnotationGeometry.js; `intersectSharedOutlinePolygonSets` for survivor ∩ survivor). Still open (w38 follow-up): float-noise turns on evenly sampled straight diagonal drags push the eraser into a capsule union with false holes (islands of ink inside a wipe); simply treating them as straight made a retraced drag's exactly collinear sides send Martinez out of memory — do not ship that shortcut. Renderers clip an erased authored curve with the SURVIVOR polygons (SVG, canvas and PDF alike), never bounds-minus-`paperEraserCuts`. Real-data fixture: tests/eraserLaneCompositionRealData.test.mjs.

- **2026-07-08 — fabric 7 enliven/serialize contracts (three traps found fixing the 7.4.0 upgrade):** (1) `enlivenObjects` uses `Promise.allSettled` and SILENTLY drops any object whose `fromObject` rejects — and the resolved array COMPACTS, so index-pairing enlivened objects back to their inputs misaligns after a drop. Pass a `reviver` (called in input order; `(serialized, instance, error)`) to log rejections and rebuild an index-aligned array (see FabricEraserCanvas). (2) `Group.fromObject` spreads unrecognized props onto the new instance, so a serialized object carrying a `getObjects()` convenience method (calloutAnnotationBridge / calloutEditAdapter projections) SHADOWS the real `Group#getObjects` and crashes groupInit — strip function props before enliven. (3) `toObject()` emits capitalized `type` ('Path', 'Rect') while live instances report lowercase `obj.type` and legacy fabric-5 saves store lowercase — never compare a SERIALIZED object's `type` against a lowercase literal; compare the live instance's type or lowercase first. Also: `toJSON()` takes no arguments in fabric 7 and drops custom props — always `toObject(CUSTOM_PROPS)` (fixed app-wide in efa23941/cfa8136b).

- **2026-05-13 — App-shell chrome publish effects must suppress identity-only API churn:** Lifting PDF chrome out of `PDFViewer` by publishing a large API object to App can create a maximum-update-depth loop if the effect calls an App `setState` every render. The left-rail lift hit this after moving `<PDFSidebar>` to `#chrome-left-host`. Fix: compare the next API against the previous one before returning a new state object, and treat function-only callback identity churn as unchanged; also no-op collapse notifications when the collapsed value is already current. This preserves current callbacks on real state/data changes without republishing on every render.

- **2026-04-10 — Canvas 2D and SVG path rasterizers produce visibly different strokes at non-integer sub-pixel coordinates — NOT fixable in JS:** When a shape on a Fabric canvas appears "bolder" or "thicker" than the same shape in SVGAnnotationLayer, this is not a code bug (historical: observed in the since-deleted FabricEditCanvas; still applies to any Canvas-vs-SVG comparison). Canvas 2D's `lineTo()` / `rect()` / `stroke()` anti-aliases edges at sub-pixel positions (e.g. `left=18.37`) across 2 pixels with a uniform gradient, producing a visually bolder result. The browser's SVG rasterizer handles the same coordinates via different heuristics and typically produces crisper single-pixel edges. Verified mathematically in Phase 11: all geometry deltas between SVG `getBoundingClientRect()` and Fabric's screen-space shape rect were sub-pixel (max 0.28px from stroke half-width bleed), with `backingRatio=2.0000` and `strokeUniform: true` honored everywhere. The inputs are identical — the rasterizers are different engines. If this ever becomes a UX problem, the fix is structural: hide the Fabric shape (`opacity: 0`) during edit and keep SVG visible as the visual truth, with Fabric only providing selection handles + hit zone. Do NOT chase this with pixel-snapping, DPR tweaks, or stroke-offset hacks — the hypothesis is mathematically confirmed.

- **2026-04-08 — Fabric.js Textbox fontFamily MUST be a single font name, never a CSS fallback stack:** Multi-font fallback stacks like `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` cause progressive cursor drift in Fabric.js Textbox/IText. Root cause: Fabric.js measures character widths at `CACHE_FONT_SIZE=400px` and scales down — the browser may resolve different fonts in the fallback chain at 400px vs the actual size, producing wrong measurements. Fix: use single-name fonts only (e.g. `"Helvetica"`, `"Arial"`, `"Times New Roman"`). This applies to any Fabric text default (originally DEFAULT_FONT_FAMILY in the since-deleted FabricEditCanvas.jsx) and any future font picker — only offer single-name standard PDF fonts.

- **2026-03-22 — Canvas sizing must use container-aware measurement, not pageSize * scale:** The Electron/browser zoom factor creates a mismatch between a computed canvas size (`pageSize.width * reportedScale`) and the actual page container size. (Originally observed against Syncfusion page divs; the same rule applies to pdf.js page containers today.) At 50% PDF zoom with a 4/3 Electron zoom factor, the page div was 816x528 but the Fabric.js canvas was only 612x396, causing annotations to appear smaller and offset up-left. Fix: measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale` instead of trusting the viewer-reported zoom percentage. Applied in PAL's canvas init (`PageAnnotationLayer.jsx:~5192`), direct resize path, and settle callback in the scale useEffect.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Wiki Knowledge Base

Path: `/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault` (the durable knowledge brain, powered by the
claude-obsidian plugin). This is NOT coding-session memory and NOT the code
graph — it holds synthesized knowledge: tools, research, decisions, comparisons.

When you need durable context not already in this project or the code graph:
1. Read `"/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/wiki/hot.md"` first (recent context, ~500 words).
2. If not enough, read `"/Users/isaiahcalvo/.openclaw/workspace/Second Brain Vault/wiki/index.md"` (full catalog).
3. Only then read individual wiki pages.

Do NOT read the wiki for general coding questions, language syntax, or anything
already in this repo, the conversation, or graphify-out/. To file something
durable into the brain, use the claude-obsidian `/wiki` and `ingest` operations
against that vault — never duplicate coding-session memory there.
