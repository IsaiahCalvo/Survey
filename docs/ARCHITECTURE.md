# Architecture Guide — Survey BetaSafeS2

Reference map for multiple AI agents / engineers working in parallel. Every
structural claim below was verified mechanically (`ls`/`grep`) on 2026-05-29.
When in doubt, re-verify — do not trust prose over `grep`.

Authoritative sources this doc is built from (read them too): `CLAUDE.md`
(the "CRITICAL — DO NOT BREAK" rules + Gotchas), `HANDOFF.md`, and the
file-header comments at the top of the five top-level modules.

---

## 1. Orientation

- **Stack:** Electron + Vite + React. Desktop shell is `src/electron-main.js`
  / `src/preload.js`; the web build is Vite (`vite.config.js`, `npm run build`
  = `vite build`).
- **Entry:** `src/main.jsx` imports the default from `./AppShell`
  (`import App from './AppShell'`, main.jsx:223). `src/DevTestRoute.jsx` also
  imports the default from AppShell. **`AppShell.jsx` is the real application
  root**, not `App.jsx`.
- **`src/App.jsx` is MISNAMED.** Per its own header (App.jsx:1-20) it is no
  longer the app — it is a shared module of constants + helper functions
  (Supabase/auth helpers, annotation↔Fabric conversion, page/scale math,
  persistence, survey-marker helpers, UI constants) imported by `PDFViewer.jsx`
  and `AppShell.jsx`. Rename candidate: `src/shared/viewerShared.js`. Do not
  assume "App = the app".

---

## 2. `src/` map

### Significant top-level files (role verified from header/exports)

| File | Lines (approx) | Role |
|---|---|---|
| `AppShell.jsx` | ~2,850 | **App root.** Tabs, auth/entity state, chrome host divs, top-right zoom/page pill, router between `Dashboard` (home) and `PDFViewer` (open doc). Receives the panel APIs. |
| `PDFViewer.jsx` | ~34,000 (1.5MB) | **The document viewer** — bulk of the app. Syncfusion canvas, annotation overlays, zoom/scroll lifecycle, save/sync, history. HIGH-RISK. |
| `Dashboard.jsx` | ~3,900 | **Home screen** — project tree, document grid, template management, SurveyHub host. Talks to shell via props + forwarded ref only. |
| `App.jsx` | ~2,360 | **Shared helpers/constants module** (misnamed — see §1). |
| `SurveySpacesRail.jsx` | ~3,000 | **Survey right rail** (module/category controls, survey-marker toolbar, export block). Publishes `rightRailApi`. Renders NO Spaces UI — the Spaces panel is the LEFT rail (`PDFSidebar`). Rename candidate: `SurveyRail.jsx`. |
| `PageAnnotationLayer.jsx` | 408KB (~10k lines) | Per-page Fabric.js canvas overlay. HIGH-RISK; touch only when required. (A dead stub `src/components/PageAnnotationLayer.jsx` was deleted 2026-05-28 — do not recreate.) |
| `RegionSelectionTool.jsx`, `SpaceRegionOverlay.jsx`, `TextLayer.jsx`, `PDFSidebar.jsx`, `TabBar.jsx`, `Icons.jsx` | — | Viewer/shell sub-pieces (region select, region overlay, text layer, left rail, tab bar, icon set). |
| `supabaseClient.js`, `authConfig.js`, `theme.js` | — | Supabase client, MSAL/auth config, design tokens. |

### Subdirectories (top-level code-file counts)

| Dir | Code files (top-level) | Purpose |
|---|---|---|
| `src/components/` | 48 (79 incl. nested) | Reusable components: Fabric canvases, SVG layer, modals, toolbars, panels. Houses the four NO-GO Fabric/SVG files. |
| `src/utils/` | 78 (93 incl. nested) | Pure utilities (zoomController, hydration gate, loggers, etc.). |
| `src/services/` | 16 | External I/O: Excel/Graph, document annotation, document lock, etc. |
| `src/hooks/` | 15 (20 incl. nested) | React hooks (`useDatabase`, `useSubscriptionLimits`, …). |
| `src/home/` | 14 | Home-screen pieces (`SurveyHub`, template reorder utils, …). |
| `src/sidebar/` | 8 | Left-rail / sidebar pieces. |
| `src/contexts/` | 5 | React contexts (`AuthContext`, `MSGraphContext`, …). |
| `src/reorder/` | 3 | Page-reorder UI/logic. |
| `src/shims/` | 2 | Build/runtime shims. |
| `src/workers/` | 1 | Web worker(s). |
| `src/types/` | 1 | Type defs. |
| `src/lib/` | nested only | Vendored/library glue. |
| `src/assets/` | static | Images/assets. |

Total: 260 `.js/.jsx/.ts/.tsx` files under `src/`.

---

## 3. Import hierarchy (top-five modules)

Verified edges (grep on actual `from '…'` statements):

```
main.jsx  ──▶  AppShell.jsx                 (default export = app root)
DevTestRoute.jsx ──▶ AppShell.jsx

AppShell.jsx ──▶ PDFViewer.jsx              (import { PDFViewer })
AppShell.jsx ──▶ Dashboard.jsx              (default)
AppShell.jsx ──▶ SurveySpacesRail.jsx       (default)
AppShell.jsx ──▶ App.jsx (shared helpers)   (FONT_FAMILY, hexToRgba, …)

PDFViewer.jsx ──▶ App.jsx (shared helpers)  (large named import block)
```

- `App.jsx` imports **none** of AppShell / PDFViewer / Dashboard (verified: 0 hits).
- `PDFViewer.jsx` imports **neither** AppShell nor Dashboard (0 hits).
- `Dashboard.jsx` imports **neither** AppShell, PDFViewer, nor App (0 hits) —
  it depends only on `home/`, `hooks/`, `services/`, `utils/`, contexts.

**The graph is one-directional with no cycles among these five.** App.jsx is a
pure leaf in this subgraph (both PDFViewer and AppShell depend on it; it depends
on neither).

---

## 4. Inter-component communication: published-API objects

Panels do **not** reach into each other. Instead each panel publishes a bundle
of handlers/state **up to the shell**, which stores it in state and re-exposes
it where needed (e.g. AppShell's top-right pill reads `bottomToolbarApi`).

The three confirmed API channels:

| API object | Published by | Received by |
|---|---|---|
| `leftRailApi` | `PDFViewer.jsx` (`onLeftRailApiChange`, ~25527) | `AppShell.jsx` `setLeftRailApi` (399) |
| `rightRailApi` | `PDFViewer.jsx` (`onRightRailApiChange`, ~25699) | `AppShell.jsx` `setRightRailApi` (400) |
| `bottomToolbarApi` | `PDFViewer.jsx` (`onBottomToolbarApiChange`, ~20608) | `AppShell.jsx` `setBottomToolbarApi` (283) |

Mechanism: AppShell renders `<PDFViewer onLeftRailApiChange={setLeftRailApi}
onRightRailApiChange={setRightRailApi} onBottomToolbarApiChange={setBottomToolbarApi}
… />` (AppShell.jsx:2363-2366). PDFViewer effects build the next API object and
call the setter with a functional updater. (`SurveySpacesRail` mirrors this
pattern as the right-rail content — header note + grep confirm.)

### INVARIANT — the 2026-05-13 identity-churn guard (do not remove)

Each publisher effect must compare the next API against the previous one and
**return the previous object when nothing real changed**, treating
function-only callback identity changes as "unchanged". The verbatim guard
lives in PDFViewer's publisher effects, e.g. `onLeftRailApiChange((prev) => …)`
at PDFViewer.jsx:25604-25619:

```js
onLeftRailApiChange((prev) => {
  if (prev) {
    const keys = Object.keys(nextLeftRailApi);
    if (keys.length === Object.keys(prev).length && keys.every((key) => {
      const previousValue = prev[key];
      const nextValue = nextLeftRailApi[key];
      if (typeof previousValue === 'function' && typeof nextValue === 'function') return true;
      return previousValue === nextValue;
    })) return prev;            // <-- bail out: no real change
  }
  return nextLeftRailApi;
});
```

**Why:** without it, the publisher fires a shell `setState` on every render
(callback identities differ each render), the shell re-renders, the panel
re-publishes → **maximum-update-depth loop**. See CLAUDE.md Gotchas (2026-05-13).
(Note: CLAUDE.md describes this guard at the shell level; the actual guard code
currently lives in the PDFViewer publisher effects. Keep it wherever it is —
do not delete it from either side.)

---

## 5. NO-GO zones & the four correctness invariants

These are never extraction targets and never get rewritten. Relocating an
entire file verbatim has been acceptable; rewriting the engines is not.

**NO-GO zones (inside `PDFViewer.jsx`):**
1. The **zoom/scale lifecycle** — `beginSyncfusionScaleConfirmPending`
   (PDFViewer.jsx:1780) and its callers. `setZoomGeneration(prev => prev + 1)`
   fires here at zoom-start (PDFViewer.jsx:1783).
2. The **per-page Syncfusion overlay portal render loop** — the `createPortal`
   per-page overlay rendering. NO-GO banners flagged in the file header
   (PDFViewer.jsx:1-13).

**The four invariants (CLAUDE.md "CRITICAL — DO NOT BREAK"):**

1. **Container-aware canvas sizing** — measure `containerEl.offsetWidth /
   pageSize.width` for `effectiveScale`; never `pageSize * scale` (Electron zoom
   factor mismatch). Lives in the Fabric canvas components + PAL canvas init.
2. **SVG viewBox owns ALL zoom scaling** — `src/components/SVGAnnotationLayer.jsx`
   (248KB). Scales via `viewBox="0 0 pageWidth pageHeight"` with zero JS zoom
   coordination. Never reintroduce JavaScript zoom coordination here.
3. **Never remove the `zoomGeneration` signal** — fired in PDFViewer at
   zoom-start; watched by `FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`,
   `FabricEditCanvas.jsx` (and `FabricTextCanvas.jsx`) to auto-commit in-progress
   work before the container resizes. (Verified: signal present in all of
   PDFViewer + AppShell + the four Fabric components.)
4. **Single-name Fabric.js `fontFamily`** — never a CSS fallback stack (causes
   cursor drift). Applies to `DEFAULT_FONT_FAMILY` in `FabricEditCanvas.jsx` and
   any font picker.

The four Fabric/SVG files all exist under `src/components/`:
`FabricDrawingCanvas.jsx`, `FabricEditCanvas.jsx`, `FabricEraserCanvas.jsx`,
`SVGAnnotationLayer.jsx`.

`src/App.jsx` and `src/PDFViewer.jsx` are HIGH-RISK: minimum-viable diffs,
`npm test` after every touch (standing waiver granted 2026-04-29 lets you edit
them without per-edit approval, but the invariants above still bind).

---

## 6. How to work safely (verification workflow)

Every change must pass both:
- `npm run build` (`vite build`)
- `npm test` (`node scripts/run-node-tests.mjs`) — **baseline: 834 pass / 0 fail
  / 6 skip** (per HANDOFF.md). Report this baseline before declaring done.

**No automated test renders the viewer/home/shell.** Build + tests cover
*static* correctness only; behavioral/visual changes still want a dev-server
look (`npm run dev`, logged-in account).

**Helper scripts (use them for any extraction):**
- `scripts/check-undef.mjs <file.jsx>` — scope-aware unresolved-identifier
  checker (Babel `scope.globals`). A freshly extracted module must produce ZERO
  globals outside the App.jsx baseline. Diff the sets with **Python, not shell
  `comm`** (comm mis-sorts case → false positives).
- `scripts/derive-slice-deps.mjs <startLine> <endLine>` — reconstructs the exact
  import statements + App.jsx module-symbol deps a slice needs (classifies each
  free identifier as IMPORTS / MODULE / GLOBALS / UNKNOWN). Derive deps
  mechanically — do not trust prose dependency analysis.

**Source-guard tests:** several tests scan source files for required patterns.
If you move code, repoint the guard to read the new file.

**Rule: verify render/call sites with `grep` before claiming code is dead or
used.** Multiple "extractions" in past sessions turned out to be dead code.
(Example confirmed dead: `src/components/LocateModal.jsx` is imported nowhere;
the live Locate dialog is inline JSX in PDFViewer.jsx via `showLocateModal`.)

---

## 7. Parallel work

- The big pieces are now **separate files**, so different agents can own
  `Dashboard.jsx`, `SurveySpacesRail.jsx`, `PDFViewer.jsx`, a `components/`
  subtree, etc. **concurrently** without merge collisions.
- **Extractions out of a SINGLE file must be sequential.** Two agents both
  slicing `PDFViewer.jsx` (or both editing `App.jsx`) will collide — coordinate
  so only one agent mutates a given big file at a time.
- **NO-GO zones (§5) are never extraction targets** in any parallel plan.
- Cross-cutting work that touches a published API (`leftRailApi` /
  `rightRailApi` / `bottomToolbarApi`) spans both `PDFViewer.jsx` (publisher)
  and `AppShell.jsx` (receiver) — treat those two as a coordinated pair and keep
  the identity-churn guard intact on every edit.
- Recommended low-risk next extractions (HANDOFF.md): rename/clean `App.jsx`
  into `shared/`; lift PDFViewer's undo/redo engine into
  `src/hooks/useAnnotationHistory.js`. Each must pass check-undef + build + test.
