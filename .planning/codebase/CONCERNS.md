# Codebase Concerns

**Analysis Date:** 2026-07-19

> Replaces the 2026-03-17 Syncfusion / `App.jsx` concerns sheet. Historical bug
> write-ups that named Syncfusion freeze timers or `src/App.jsx` as the app root
> are obsolete — see git history if you need them.

## Tech Debt (current)

**`PDFViewer.jsx` monolith (~34k lines):**
- Still the highest-risk file: zoom lifecycle, overlay portals, save/sync, history.
- Many helpers/hooks have been extracted (`viewerShared.js`, `utils/*`,
  `hooks/usePageOperations.js`, …) but the stateful core remains huge.
- Rule: minimum viable diffs; never drive-by refactors; `npm test` after touches.

**`PageAnnotationLayer.jsx` (~10k lines):**
- Legacy Fabric PAL; default create/edit path is SVG + TextEditOverlay.
- Still load-bearing for `?renderer=canvas` / Ctrl+Shift+V and some import paths.
- Do not recreate deleted Drawing/Edit canvases to “simplify” PAL.

**Callout / survey-marker contract forks:**
- Documented in `docs/ANNOTATION-CONTRACT.md` + `docs/ANNOTATION-PARITY-MAP-2026-07-16.md`.
- KAL-81 keystone (make `annotationsByPage` primary for callouts) is the structural fix;
  do not chip at dependent forks piecemeal.

**No ESLint / Prettier in root:**
- Closest automated hygiene: Fallow audits (`npm run audit:*`). Never auto-delete
  from fallow findings — see `CLAUDE.md` and `debug/fallow-audit/REPORT.md`.

**Hardcoded Azure MSAL client ID in `authConfig.js`:**
- Public client IDs are normal for SPA/public clients, but moving to `VITE_*` would
  still clarify env-specific redirect URIs. Microsoft auth is intentionally kept.

## Fragile areas (do not casually rewrite)

| Area | Why fragile |
|---|---|
| `beginPdfjsScaleConfirmPending` / `zoomGeneration` | Overlay auto-commit at zoom-start; consumers: SVG, eraser, PdfjsViewerContainer |
| SVG viewBox scaling | Must stay the only zoom path for annotation display |
| Container-aware canvas sizing | Electron/browser zoom factor mismatch |
| Published chrome APIs (`leftRailApi`, …) | Identity-churn guard prevents max-update-depth loops |
| Edge-function CORS `*` | Required for web + Electron `file://` + Capacitor; Bearer-JWT |

## Resolved / obsolete concerns (do not re-open as current)

- Syncfusion zoom freeze / `SyncfusionPDFContainer` / `@syncfusion/ej2-*` — **removed**
- `FabricDrawingCanvas` / `FabricEditCanvas` as live edit path — **deleted**
- `AnnotationContext` pub-sub engine — **deleted**
- `src/App.jsx` as 32k-line app root — **split** into `AppShell` + `PDFViewer` + `viewerShared`

## Where to look instead

- Invariants: `CLAUDE.md` / `AGENTS.md`
- Architecture map: `docs/ARCHITECTURE.md`
- Annotation forks: `docs/ANNOTATION-PARITY-MAP-2026-07-16.md`
- Stack / structure: sibling files in this directory (rewritten 2026-07-19)

---

*Concerns analysis: 2026-07-19*
