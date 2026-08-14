# Mobile Annotation Lifecycle Matrix

Status legend: `REQ` = harness must prove; `N/A` = operation is not meaningful for this
domain type. Every `REQ` requires a stable model assertion and final hard-reload proof.

| Row | Create | Persisted edit | Move | Undo/redo | Delete/undo-delete | Primary store |
|---|---:|---:|---:|---:|---:|---|
| Pen | REQ | width/color | REQ | REQ | REQ | `annotationsByPage_*` |
| Freehand Highlighter | REQ | width/color/opacity | REQ | REQ | REQ | `annotationsByPage_*` |
| Line | REQ | style/width/color | REQ | REQ | REQ | `annotationsByPage_*` |
| Arrow | REQ | style/head/width/color | REQ | REQ | REQ | `annotationsByPage_*` |
| Rectangle | REQ | fill/stroke/style | REQ | REQ | REQ | `annotationsByPage_*` |
| Ellipse | REQ | fill/stroke/style | REQ | REQ | REQ | `annotationsByPage_*` |
| Text | REQ | content/font/color | REQ | REQ | REQ | `annotationsByPage_*` |
| Callout | REQ | content/style | REQ | REQ | REQ | `annotationsByPage_*` + compatibility cache |
| Counter | REQ | series/value/style | REQ | REQ | REQ | `annotationsByPage_*` |
| Survey Marker | drag box | name/detail/category | REQ if product supports | REQ | REQ | `surveyMarkers_*` |
| Region | draw area | geometry/page assignment | REQ | region undo | REQ | `pdfSidebar_*` |
| Space | create | rename/page assignment | N/A: container, not geometry | space undo where supported | REQ | `pdfSidebar_*` |
| Eraser: partial | cross completed stroke | size/mode | N/A: action | REQ | N/A: result mutation | `annotationsByPage_*` |
| Eraser: full object | cross object | size/mode | N/A: action | REQ | N/A: result mutation | `annotationsByPage_*` |

## Locked Harness Surface

- URL: `/?testPdf=clickable-link-test.pdf&mobileNav=tabs&nativeShell=expo&eraserLifecycleE2E=1&surveyTransitionE2E=1`
- Viewport: 390x844, mobile + touch enabled.
- Primary engine: Chromium CDP touch events for real drags. WebKit is an additional
  render/tap/reload smoke until a native iOS driver supplies drag gestures.
- Exact identity: fixture file name + size (`getPDFId`) determines storage keys.
- Real annotation DOM: `g[data-anno-id]` inside `[data-svg-annotation-layer="1"]`.
- Tool groups: Draw → Pen/Highlighter/Eraser; Shapes → Rectangle/Ellipse/Line/Arrow/
  Counter; Text → Text/Callout.
- Text editor: `[data-text-edit-overlay] [contenteditable]`.
- Counter overlay: `[data-counter-overlay="1"]`.
- Eraser surface: `[data-diag-eraser-wrapper="1"]`.
- Survey Marker: `[data-survey-marker-id]`.

## Eraser Contract

Partial erase crosses the middle of a completed pen stroke. Assert:

1. Live preview changes before pointer-up.
2. Persisted model is unchanged before pointer-up.
3. Pointer-up commits stable split fragments.
4. Hard reload preserves those fragments.
5. Undo restores the original stable stroke after reload.

Full-object erase uses the same sequence, expecting object absence then undo restoration.

## Native Proof Boundary

Desktop Playwright does not prove native iPhone drag or pinch behavior. Simulator/native
automation separately proves the shell, safe areas, portrait lock, relaunch, and selected
touch flows. Pinch remains explicitly unautomated until a native driver performs it.
