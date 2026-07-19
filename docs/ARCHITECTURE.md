# Architecture Guide — Survey BetaSafeS2

Reference map for multiple AI agents / engineers working in parallel. Structural
claims below were re-verified against `src/` and `package.json` on **2026-07-19**.
When in doubt, re-verify — do not trust prose over `grep` / `ls`.

Authoritative companions: `CLAUDE.md` / `AGENTS.md` (invariants + gotchas),
`README.md` (quick start), `docs/ANNOTATION-CONTRACT.md` +
`docs/ANNOTATION-PARITY-MAP-2026-07-16.md` (annotation lifecycle).

**North star:** own the PDF render + zoom path (pdf.js) and keep annotations on
one SVG pipeline so select / edit / erase / undo stay unified. Syncfusion has
already been removed from `package.json`; do not reintroduce it.

---

## 1. Orientation

- **Stack:** Electron 43 + Vite 8 + React 18. Desktop shell is
  `src/electron-main.js` / `src/preload.js`; web build is Vite
  (`vite.config.js`, `npm run build` = `vite build` + pdf.js demo assert).
- **Entry:** `src/main.jsx` → default export from `./AppShell`.
  `src/DevTestRoute.jsx` also mounts AppShell. **`AppShell.jsx` is the real
  application root.**
- **PDF engine:** `src/components/PdfjsViewerContainer.jsx` — owned pdf.js
  viewer (page metrics, scroll, zoom). Scale confirm lives in
  `PDFViewer.jsx` as `beginPdfjsScaleConfirmPending`.
- **`src/viewerShared.js`:** shared helpers/constants (auth helpers,
  annotation↔Fabric conversion, page/scale math, persistence helpers, UI
  constants). Renamed from the misleading `App.jsx` on 2026-05-29 — it is NOT
  the app root and has no JSX. Leaf in the top-five graph (no cycles).
- **Annotation display:** `SVGAnnotationLayer.jsx` is view truth. Text content
  edits use `TextEditOverlay.jsx`. Eraser mounts `FabricEraserCanvas.jsx`.
  Drawing/Edit Fabric canvases are deleted (2026-07).

---

## 2. `src/` map

### Significant top-level files

| File | Lines (approx) | Role |
|---|---|---|
| `AppShell.jsx` | ~3,170 | **App root.** Tabs, auth/entity state, chrome host divs, top-right zoom/page pill, router between `Dashboard` and `PDFViewer`. |
| `PDFViewer.jsx` | ~34,300 | **Document viewer** — pdf.js host, annotation overlays, zoom/scroll lifecycle, save/sync, history. HIGH-RISK. |
| `Dashboard.jsx` | ~2,060 | **Home screen** — project tree, document grid, templates, SurveyHub. |
| `viewerShared.js` | ~2,120 | Shared helpers/constants leaf. |
| `SurveySpacesRail.jsx` | ~3,000 | Survey right rail (module/category controls, survey-marker toolbar, export). |
| `PageAnnotationLayer.jsx` | ~9,625 | Per-page Fabric.js overlay (legacy / `?renderer=canvas`). HIGH-RISK. |
| `RegionSelectionTool.jsx`, `SpaceRegionOverlay.jsx`, `TextLayer.jsx`, `PDFSidebar.jsx`, `TabBar.jsx`, `Icons.jsx` | — | Viewer/shell sub-pieces. |
| `supabaseClient.js`, `authConfig.js`, `theme.js` | — | Supabase client, MSAL/auth config, design tokens. |

### Subdirectories

| Dir | Purpose |
|---|---|
| `src/components/` | PdfjsViewerContainer, SVGAnnotationLayer, FabricEraserCanvas, TextEditOverlay, modals, toolbars, panels. |
| `src/utils/` | Pure utilities + modules extracted from `PDFViewer.jsx` (history, export, sync helpers, …). |
| `src/services/` | External I/O: Excel/Graph, document annotation, document lock, etc. |
| `src/hooks/` | React hooks (`useDatabase`, `useSubscriptionLimits`, annotation sync, …). |
| `src/home/` | Home-screen pieces (`SurveyHub`, template reorder, …). |
| `src/sidebar/` | Left-rail / sidebar pieces. |
| `src/contexts/` | `AuthContext`, `MSGraphContext` only (AnnotationContext deleted). |
| `src/reorder/` | Page-reorder UI/logic. |
| `src/workers/` | Web worker(s). |
| `src/prototype/` | DEV-only spikes (`FeatureSpike`). |

### Viewer helper modules (extracted from `PDFViewer.jsx`)

Capture-free helpers lifted into focused modules (examples):

| Module | Helpers |
|---|---|
| `src/utils/viewState.js` | `normalizeViewState`, `areViewStatesEqual` |
| `src/utils/historyHelpers.js` | history serialize/diff/classify helpers |
| `src/utils/regionGeometry.js` | region/page geometry helpers |
| `src/utils/annotationData.js` | Fabric materialization helpers |
| `src/utils/bookmarkOutline.js` | PDF outline / bookmark helpers |
| `src/utils/counterGeometry.js` | counter drag/preview geometry |
| `src/utils/exportHelpers.js` | export error / file-lock helpers |
| `src/utils/overlayDebug.js` | overlay lag / trackpad debug summaries |
| `src/components/annotationHydrationCover.jsx` | hydration page cover |

Stateful extractions include `src/hooks/useAnnotationContextMenu.jsx` and
`src/hooks/usePageOperations.js`.

---

## 3. Import hierarchy (top modules)

```
main.jsx  ──▶  AppShell.jsx                 (default export = app root)
DevTestRoute.jsx ──▶ AppShell.jsx

AppShell.jsx ──▶ PDFViewer.jsx              (import { PDFViewer })
AppShell.jsx ──▶ Dashboard.jsx              (default)
AppShell.jsx ──▶ SurveySpacesRail.jsx       (default)
AppShell.jsx ──▶ viewerShared.js            (shared helpers)

PDFViewer.jsx ──▶ viewerShared.js
PDFViewer.jsx ──▶ PdfjsViewerContainer.jsx
PDFViewer.jsx ──▶ SVGAnnotationLayer.jsx / TextEditOverlay / FabricEraserCanvas
```

- `viewerShared.js` imports **none** of AppShell / PDFViewer / Dashboard.
- `PDFViewer.jsx` imports **neither** AppShell nor Dashboard.
- Graph among these modules is one-directional (no cycles).

---

## 4. Inter-component communication: published-API objects

Panels do **not** reach into each other. Each panel publishes a bundle of
handlers/state **up to the shell**, which stores it and re-exposes it (e.g.
AppShell's top-right pill reads `bottomToolbarApi`).

| API object | Published by | Received by |
|---|---|---|
| `leftRailApi` | `PDFViewer.jsx` (`onLeftRailApiChange`) | `AppShell.jsx` `setLeftRailApi` |
| `rightRailApi` | `PDFViewer.jsx` (`onRightRailApiChange`) | `AppShell.jsx` `setRightRailApi` |
| `bottomToolbarApi` | `PDFViewer.jsx` (`onBottomToolbarApiChange`) | `AppShell.jsx` `setBottomToolbarApi` |

### INVARIANT — the 2026-05-13 identity-churn guard (do not remove)

Each publisher effect must compare the next API against the previous one and
**return the previous object when nothing real changed**, treating function-only
callback identity changes as unchanged. Without it, every render republishes →
shell `setState` → **maximum-update-depth loop**. See CLAUDE.md Gotchas
(2026-05-13). Keep the guard wherever it currently lives (PDFViewer publisher
effects and/or shell).

---

## 5. NO-GO zones & correctness invariants

**NO-GO zones (inside `PDFViewer.jsx`):**
1. The **zoom/scale lifecycle** — `beginPdfjsScaleConfirmPending` and its
   callers. `setZoomGeneration(prev => prev + 1)` fires at zoom-start here
   (and on pdf.js `gesture-start` via `onZoomPhase`).
2. The **per-page overlay portal render loop** — `createPortal` per-page
   overlay rendering (file-header NO-GO banners).

**Correctness invariants (CLAUDE.md / AGENTS.md):**

1. **Container-aware canvas sizing** — measure
   `containerEl.offsetWidth / pageSize.width` for `effectiveScale`; never
   `pageSize * scale`.
2. **SVG viewBox owns ALL zoom scaling** —
   `src/components/SVGAnnotationLayer.jsx`. Never reintroduce JavaScript zoom
   coordination here.
3. **Never remove the `zoomGeneration` signal** — live consumers:
   `SVGAnnotationLayer`, `FabricEraserCanvas`, `PdfjsViewerContainer`.
4. **Single-name Fabric.js `fontFamily`** — never a CSS fallback stack. Text
   edit now lands in `TextEditOverlay.jsx`; any remaining Fabric text path
   (legacy PAL) still obeys this rule.
5. **Edge-function CORS `*` is intentional** — web + Electron `file://` +
   Capacitor; Bearer-JWT auth. Do not tighten to an origin allowlist.

Live Fabric/SVG files under `src/components/`:
`FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, plus
`PdfjsViewerContainer.jsx` and `TextEditOverlay.jsx`.
Do **not** recreate `FabricDrawingCanvas.jsx` / `FabricEditCanvas.jsx`.

`src/PDFViewer.jsx` and `src/PageAnnotationLayer.jsx` are HIGH-RISK:
minimum-viable diffs, `npm test` after every touch. `src/viewerShared.js` is a
shared leaf — build + test after any change.

---

## 6. How to work safely (verification workflow)

Every change must pass both:
- `npm run build` (`vite build`)
- `npm test` (`node scripts/run-node-tests.mjs`) — baseline verified 2026-07-19:
  **2233 pass / 0 fail / 36 skip**. Re-run and report the current counts before
  declaring done (the absolute numbers drift as tests are added).

**No automated unit test fully renders the viewer/home/shell.** Build + tests
cover static correctness; behavioral/visual changes still want a running app
(`npm run dev` or `npm run dev:ui`).

**Helper scripts:**
- `scripts/check-undef.mjs <file.jsx>` — unresolved-identifier checker.
- `scripts/derive-slice-deps.mjs <startLine> <endLine>` — reconstructs import
  deps for a viewer slice.

**Rule:** verify render/call sites with `grep` before claiming code is dead.
Prefer adversarial verification for protected-file deletions.

---

## 7. Parallel work

- Separate files (`Dashboard.jsx`, `SurveySpacesRail.jsx`, `PDFViewer.jsx`,
  `components/` subtrees) can be owned concurrently.
- Extractions out of a **single** big file must be sequential.
- NO-GO zones (§5) are never rewrite targets.
- Cross-cutting published APIs (`leftRailApi` / `rightRailApi` /
  `bottomToolbarApi`) span `PDFViewer.jsx` + `AppShell.jsx` — keep the
  identity-churn guard intact.
- Annotation contract work: prefer
  `docs/ANNOTATION-PARITY-MAP-2026-07-16.md` for callout fork status; do not
  chip at the KAL-81 keystone piecemeal.
