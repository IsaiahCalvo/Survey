# Syncfusion → EmbedPDF Migration Audit

_Date: 2026-05-30 · Status: investigation only, no code changed · Method: 15-agent parallel audit (7 codebase mappers, 6 EmbedPDF researchers, 1 synthesis, 1 completeness critic), ~1.27M tokens analysis._

---

## Bottom line

EmbedPDF is the strongest replacement found, and the rare case where the new library is **better aligned with the project's north star ("own the zoom")** than the incumbent. It is MIT-licensed (kills the paid Syncfusion dependency), built on PDFium-WASM (the same engine lineage as Chrome and as Syncfusion's own renderer — not a downgrade), worker-by-default, and headless so the app keeps 100% of its custom React chrome. It ships **source-verified cursor-centric zoom**, virtualized continuous scroll, deep-zoom tiling, and a per-page render seam that maps almost 1:1 onto the app's existing DOM-based overlay contract.

But this is a **migration, not a swap**. About 85% of the document-feature surface and ~100% of the byte pipeline (pdf-lib export, pdf.js geometry/import, exceljs) carry over with low effort because they never depended on the viewer. The cost is concentrated in re-homing the per-page overlay seam, two genuine feature builds (text-markup hit-testing; AcroForm field authoring), and proving the "feel" — none of which a docs read can retire.

**Verdict: spike-first, then go.** Build the already-scaffolded EmbedPDF arm of the renderer spike inside the real Electron/Vite shell and measure it. That one spike answers every open question below.

---

## The four goals

| Goal | Verdict | Why |
|---|---|---|
| **Cursor-centric zoom-to-pointer** | **Native (strongest result)** | Confirmed in EmbedPDF source (`zoom-gesture-logic.ts`, `zoom-plugin.ts`), not just docs. Ctrl/cmd+wheel and pinch both compute a focal point from the pointer/touch midpoint and `computeScrollForZoomChange` re-anchors scroll so the pixel under the cursor stays fixed. This is the app's literal north star and Syncfusion's worst pain point. |
| **Zoom while annotations stay live & interactive** | **Achievable — unverified pending spike** | EmbedPDF's structural strength: overlay layers mount per-page inside the `renderPage` slot via `PagePointerProvider` and re-read one shared `scale` from document state. This is the exact problem the app's snapshot/freeze/settle lifecycle exists *only* to work around (because Syncfusion destroys/recreates page DOM on every zoom). If page hosts stay stable across zoom, several hundred lines of snapshot machinery delete. High architectural confidence; the heavy Fabric stack staying 60fps mid-zoom at high annotation counts is unmeasured. |
| **Butter-smooth continuous scrolling** | **Achievable — unverified pending spike** | Native virtualized scroll (renders only visible pages + buffer, default 2) + worker-thread rasterization + tiling for instant feedback. Structurally better than today. But fling-feel at 200–1000 pages and on heavy large-format CAD/survey sheets was read from source, not benchmarked. The app also drives scroll by mutating the Syncfusion container directly in 10+ places; EmbedPDF owns its scroller, so those must route through its viewport API. |
| **Overall professional polish** | **Achievable with assembly + tuning** | All ingredients present and MIT: tiling for crisp deep zoom, virtualized scroll, live annotation layers, a commands plugin for toolbar/shortcuts, history (undo/redo). The app uses **zero** Syncfusion UI widgets today, so there is no widget-porting cost. Polish work is concentrated in re-tuning blank-page gating and the page-render-ready signal, not porting.

> The completeness critic's correction: goals #1/#2/#3 "feel" verdicts all hinge on a spike that has not been run. Treat them as **unverified-pending-spike**, not done deals.

---

## What Syncfusion is actually used for (the full footprint)

Syncfusion is overwhelmingly concentrated in `PDFViewer.jsx` (~1,531 references across ~32.5k lines) and `SyncfusionPDFContainer.jsx` (~2.8k lines), with a thin tail elsewhere. The live viewer is created **exactly once**, in standalone client-side mode (`serviceUrl=""`, no ASP.NET backend), rendering via the bundled PDFium-WASM in `public/ej2-pdfviewer-lib/`. `useSyncfusionRenderer` is hardcoded `true` — Syncfusion is the only live render path.

**10 ej2 modules are injected:** Magnification, Navigation, BookmarkView, TextSelection, TextSearch, Annotation, Print, LinkAnnotation, FormFields, FormDesigner.

Grouped by what the app leans on:

**Load-bearing (the viewer core):**
- Viewer instantiation + PDFium-WASM standalone engine + `viewer.load(bytes,'')` from in-memory ArrayBuffer.
- Module injection / feature gating.
- **The central seam:** per-page DOM host discovery (`.e-pv-page-div`, MutationObserver) → overlay portal anchoring. The page-container `{pageNumber: element}` map is consumed across ~15 files. Annotation geometry is read as `effectiveScale = hostWidth / pdf.js pageWidth` (the container-aware-sizing invariant).
- Zoom lifecycle: `magnificationModule.zoomTo / initiateMouseZoom / fitToWidth / fitToPage`, plus `zoomChange` driving the settle lifecycle. Notably the app **actively distrusts** Syncfusion's reported zoom and re-anchors itself.
- Continuous virtualized scroll + direct `scrollTop/scrollLeft` read **and write** on the viewer container.
- Page navigation + current-page truth (`pageChange` event).
- Page-render-ready gating (probing `.e-pv-*` CSS classes to avoid flashing annotations over a blank page).

**Important but thinner:**
- License registration (`registerLicense` in `main.jsx`) — pure deletion target.
- 10 ej2 theme CSS imports + ~12 `.e-pv-*` override selectors that **hide** built-in chrome.
- `documentLoadFailed` + a pdf-lib sanitize/retry that strips `/Widget`+`/AcroForm` to work around a Syncfusion 32.1.19 form-field crash — this is dead weight on migration, not a feature to port.
- Native text-markup annotations (highlight/underline/strikeout/squiggly) select-by-point and erase-by-point — **the one place Syncfusion's annotation _model_ is load-bearing.**
- AcroForm FormDesigner (place/edit/delete text/checkbox/radio/signature fields — the Forms toolbar, KAL-47).
- Bookmark/outline extraction + destination navigation (page + Y + zoom).
- The `zoomGeneration` auto-commit signal (Fabric canvases flush in-progress strokes before resize).

**Already NOT Syncfusion (carries over for free):**
- Page manipulation (insert/delete/reorder/duplicate/rotate) — **100% pdf-lib** today.
- Document + annotation export — **100% pdf-lib**; `viewer.saveAsBlob` is explicitly skipped.
- Page geometry / annotation import — **pdf.js** (`getViewport scale:1`).
- Text layer + text search — primarily **pdf.js**; Syncfusion search is only an optional bounds enhancer.
- Print — blob-URL iframe + pdf.js canvas; Syncfusion `printModule` is dead (`PRINT_PANEL_ENABLED=false`).
- Excel — exceljs.
- **Zero** ej2 UI widgets are used. All the non-viewer ej2 packages in package.json are transitive deps of the viewer, not direct UI usage.

The separate `pdf.worker.js.js` + `workers/pdfRender.worker.js` + `PDFWorkerManager.js` are a **dead pdf.js render spike** — not wired into the app.

---

## What EmbedPDF offers (researched against real source, not just docs)

- **Engine:** `@embedpdf/pdfium` (PDFium → WASM, Apache-2.0 engine) + `@embedpdf/engines`. Worker-by-default (`usePdfiumEngine({worker:true})`). WASM is ~4–7.5MB and **self-hostable** offline via `wasmUrl` / `init({wasmBinary})` — important for packaged Electron.
- **Architecture:** framework-agnostic core (a plugin registry + reactive per-document store) with thin React adapters. ~47 tree-shakable packages where *you* own the render/zoom/scroll loop — the inverse of the 1.5MB black-box viewer.
- **Scroll:** `plugin-scroll` + `plugin-viewport` — real virtualization (visible pages + buffer), vertical/horizontal strategies, rich `onScroll`/`onPageChange`/`visiblePages` metrics, programmatic `scrollToPage`. Spread (1-up/2-up) via `plugin-spread`. **Gap vs Syncfusion:** no built-in discrete single-page (non-continuous) mode — only continuous; DIY-able.
- **Zoom:** `plugin-zoom` — fit-width/page/automatic, numeric programmatic zoom, marquee/area zoom, configurable min/max, an `onZoomChange` event stream (can drive the existing `zoomGeneration` signal), and source-verified zoom-to-pointer for both wheel and pinch. Live CSS-transform preview during the gesture so page + overlays scale together with zero per-frame re-render.
- **Annotations:** `plugin-annotation` natively ships ink/pen, ink-highlighter, highlight/underline/strikeout/squiggly, square/circle/line/arrow/polyline/polygon, freeText, **callout-freeText** (notable — callout is the app's historical odd-one-out), stamp, link, caret — all with interactive create/select/move/resize/rotate/delete, undo/redo, and portable export/import. Renderer-extensible (`customAnnotationRenderer`, `annotationRenderers[]`).
- **Custom overlay seam:** `Scroller.renderPage` + `PagePointerProvider` give a real per-page `position:relative` div sized to `pageSize*scale`, and `@embedpdf/models` exposes a full public coordinate-transform API (`transformRect`, `restorePosition`, `buildUserToDeviceMatrix`, etc.). **You can mount your own SVG/Fabric layer per page, page-coordinate-aligned, kept in sync through scroll+zoom** — DIY-extensible, idiomatic, but you wire it.
- **Other plugins exist:** bookmark, form (fill), signature, redaction, print, thumbnail, history, rotate, search, selection, export, commands.
- **Licensing:** MIT across core + all standard plugins (PDFium under Apache-2.0). No key, no per-seat fee.
- **Maturity:** young but moving fast — first publish June 2025, currently v2.14.3, weekly cadence, ~4.1k stars, ~240k weekly downloads on core. **Single-maintainer** (bobsingor / openbook.io) is the key risk; mitigated by MIT (forkable) + standard PDFium engine.

---

## Capability-by-capability mapping

Support: `native` = EmbedPDF does it · `plugin` = a plugin does it · `diy-on-embedpdf` = app already owns it, viewer-independent · `gap` = genuine build.

| Capability (Syncfusion today) | EmbedPDF equivalent | Support | Effort | Note |
|---|---|---|---|---|
| Viewer + PDFium-WASM standalone, in-memory bytes | `<EmbedPDF>` + `usePdfiumEngine` + DocumentManager `openDocumentBuffer` | native | high | Risk is Electron+Vite WASM/worker self-hosting (no first-party guide). |
| Module injection (10 modules) | `createPluginRegistration()` per plugin | native | medium | Maps cleanly module→plugin. |
| License registration | none needed (MIT) | native | low | Pure deletion. Removes paid dep + key-rotation chore. |
| **Per-page DOM host + overlay portal (central seam)** | `renderPage` + `PagePointerProvider` | native | high | Highest leverage AND highest touch. Preserve the `{pageNumber: element}` abstraction; re-point every `.e-pv-*` selector. |
| Zoom lifecycle | `useZoom` (`requestZoom/By`, fit modes, `onZoomChange`) | native | medium | Tiny well-isolated surface. Verify exact min/max + wheel-preview continuity. |
| Continuous virtualized scroll + scroll writes | `plugin-scroll` + `plugin-viewport` (`scrollTo`, `gate`) | native | high | App's 10+ direct scroll mutations must route through viewport API. `gate()` replaces `restrictZoomRequest`. |
| Page nav + current-page truth | `useScroll` `scrollToPage` + `onPageChange`/`visiblePages` | native | medium | Current page re-sourced from visibility metrics. |
| Per-page rendered-scale (`effectiveScale`) | `renderPage` gives `scale`, or measure host/pdf.js width | native | medium | Logic carries verbatim; likely removes the Electron device-zoom-factor hack. |
| Page-render-ready gating | RenderLayer layout/render-ready signals | native | medium | Re-point the hydration cover off `.e-pv-*` classes. |
| Text-markup annotations select/erase by point | `plugin-annotation` + `plugin-selection` | plugin | high | EmbedPDF has the types natively, but the point-based hit-test/erase plumbing is a **reimplementation, not a port**. |
| **AcroForm FormDesigner (author fields)** | `plugin-form` fills, doesn't author | **gap** | very-high | Biggest gap. Field authoring/placement has no equivalent — DIY (pdf-lib + custom overlay). |
| Bookmark/outline + destination nav | `plugin-bookmark` + `scrollToPage(pageCoordinates)` | plugin | medium | Destination semantics (page+Y+zoom) need reimplementation; parity unverified. |
| Page insert/delete/reorder/duplicate/rotate | already pdf-lib (viewer-independent) | diy-on-embedpdf | low | **Zero migration cost.** The "EmbedPDF has no page-op plugin" gap does NOT bite this app. |
| Text search + highlight | already pdf.js; drop the Syncfusion bounds enhancer | plugin/keep | low | Keep pdf.js search untouched. |
| Printing | already blob/iframe + pdf.js | plugin/keep | low | No change needed. |
| Thumbnails | re-point canvas scrape, or `plugin-thumbnail` | plugin | low | One real dependency: previews must regenerate after pdf-lib page edits. |
| Document/annotation export + byte pipeline | keep unchanged (pdf-lib + pdf.js + exceljs) | diy-on-embedpdf | low | **Zero load-bearing Syncfusion.** Cleanest slice. |
| Selectable text layer + native copy | pdf.js TextLayer + `plugin-selection` for copy | plugin | low | Renderer-agnostic. |
| Hyperlinks (LinkAnnotation) | `plugin-annotation` link handling / pdf.js | plugin | low | Verify link-click emits the URL for external-open routing. |
| `documentLoadFailed` sanitize/retry | drop entirely | native | low | Dead weight — PDFium won't hit that Syncfusion bug. |
| UI widgets + theme CSS | headless — keep all custom chrome | native | low | Pure deletion (10 imports + ~12 selectors). No widget porting. |
| `zoomGeneration` auto-commit signal | drive from `onZoomChange` | native | medium | Signal contract is renderer-independent; may simplify if DOM is stable across zoom. |

---

## Three capabilities the first pass missed (from the blind-spot critic)

1. **Real-time collaboration / presence (Yjs CRDT).** The app has a full collab stack (CRDT annotations, presence list, remote editor cursors). Good news: those hooks contain **zero** `.e-pv-`, `getBoundingClientRect`, `scrollTop`, or `effectiveScale` references — collab is geometry-decoupled and rides the same overlay seam, so it inherits the re-point at no extra cost. The spike must still confirm remote cursors stay pixel-locked through zoom.
2. **The Survey Marker + Counter annotation types** (the app's namesake). These are pure Fabric/SVG custom annotations that round-trip through pdf.js viewport, not Syncfusion — they carry over with the overlay seam at zero Syncfusion cost. Confirm in the spike.
3. **Native-annotation double-render risk.** Annotation import reads `page.getAnnotations()` (arrow/callout/circle/line/FreeText/Ink/highlight…) and converts each to Fabric. PDFium rasterizes embedded annotations into the page canvas by default — so EmbedPDF could **double-draw** the same annotations under the app's overlay. Must confirm there's a render flag to suppress PDFium's native annotation rendering.

---

## Real gaps (be honest about these)

- **AcroForm field authoring (FormDesigner).** EmbedPDF fills forms; it does not let you place/edit/delete new fields on a page. If the Forms toolbar ships, this is a dedicated DIY sub-project (pdf-lib persistence + custom overlay). No XFA, no flatten.
- **Text-markup hit-testing/erase** is a feature build against `plugin-annotation`+`plugin-selection`, not a port.
- **No discrete single-page (non-continuous) scroll mode** — only continuous; DIY-able if needed.
- **16× zoom cap risk.** Docs say min/max 0.2/60, but source comments say 0.25/10. The app zooms to 1600% (16×) — if the installed build caps at 10×, that's a hard blocker until raised. Verify against the pinned version.
- **No first-party Electron+Vite recipe.** Self-hosting the WASM offline + wiring the worker through a bundler is normal but undocumented integration work.

---

## Risks

- **Single-maintainer, ~1-year-old project** vs a commercial vendor with SLAs. Mitigated by MIT (forkable) + standard PDFium, but enterprise support is DIY.
- **Docs are thinner than the source.** Several load-bearing behaviors (cursor-zoom focal math, the `gate` mechanism, render-ready signals, search method names) are confirmed only by reading code. Adopting EmbedPDF means committing to read source.
- **The migration touches the highest-risk files** (`PDFViewer.jsx`, `SyncfusionPDFContainer.jsx`). The correctness invariants still bind: container-aware sizing, single-name fontFamily, the `zoomGeneration` contract, no JS zoom coordination in `SVGAnnotationLayer`.
- **The `.e-pv-*` selector dependency is broad (~15 files).** An incomplete re-point silently breaks overlay positioning — preserve the `{pageNumber: element}` map as the single seam.
- **Two genuine feature builds** (form authoring, text-markup hit-testing) are easy to under-scope when the headline reads "mostly native parity."
- **Dead-scaffolding history.** The app has a pattern of unused parallel paths (the dead pdf.js worker trio, the never-built spike arm). This should be a committed cutover with a spike gate, not an indefinite both-renderers limbo.
- **The 10 plugins the claims depend on are NOT installed** in `node_modules` yet (only the 11 core/scroll/zoom/render/tiling ones are). Every annotation/form/search/bookmark claim is from docs/source of un-installed packages — the spike must `npm i` and exercise them. Existence ≠ capability.

---

## Open questions the spike must answer

1. **Does EmbedPDF keep per-page DOM hosts STABLE across zoom (no destroy/recreate)?** This single fact determines whether the entire snapshot/freeze/settle lifecycle (~several hundred lines) deletes.
2. On the heaviest large-format CAD/survey sheet at 400%/1600%, does tiling stay crisp with no clamp/blur, and does ctrl-wheel cursor-zoom + fling scroll hold ~60fps / <18ms worst frame?
3. Can the existing heavy Fabric/SVG overlay stack mount on `renderPage`/`PagePointerProvider` and stay hit-testable AND 60fps mid-zoom at realistic annotation counts (100s of shapes)?
4. Can the app drive scroll through EmbedPDF's viewport API given it mutates `scrollTop/scrollLeft` directly in 10+ places and uses gate-style freezes (incl. during collab remote edits)?
5. Does the WASM + worker bundle cleanly through Vite and run offline in the **packaged** Electron renderer (real CSP — `wasm-unsafe-eval`, `file://`), not just a browser tab?
6. Exact min/max zoom in the pinned build (is 16× reachable?), and is text-markup select/erase achievable without a custom hit-test engine?
7. Does form-field **authoring** actually need to ship? If yes, scope the DIY designer; if it's fill-only in practice, `plugin-form` covers it.
8. Does PDFium double-render embedded annotations, and is there a flag to suppress it?

---

## Recommendation

**SPIKE-FIRST, then GO.**

Build the EmbedPDF arm of the renderer spike (`src/prototype/RendererSpike.jsx` is currently a placeholder; see `src/prototype/NOTES.md`). Wire it headless — core + engines + viewport + scroll + render + tiling + zoom + interaction-manager + one annotation tool — **inside the real Electron/Vite shell**, self-host the WASM, `npm i` the not-yet-installed plugins you need to test, and run it in the **packaged renderer with the real CSP** (a `vite dev` browser test will hide the CSP/`file://` blockers).

Acceptance criteria for the spike:
1. Per-page host stays **stable** across zoom (the fact that collapses the snapshot lifecycle).
2. fps/worst-frame during a ctrl-wheel cursor-zoom sweep **and** a fling scroll — measured on (a) one giant CAD/survey sheet at 1600% and (b) a 500+ page document, with a heap-MB readout for (b).
3. Tiling stays crisp at 400%/1600% with no clamp/blur.
4. A live SVG/Fabric overlay (plus a remote-presence cursor) stays pixel-locked **and** interactive through zoom + 90/270 rotation.
5. Every PDF that historically hit `documentLoadFailed` opens cleanly (that corpus is the exact test set).
6. ctrl+wheel zoom feels continuous, not stepped (if stepped, write a custom zoom plugin against the Store — MIT/headless makes this an escape hatch).

If the spike passes: green-light a committed cutover, scope the two real feature builds (text-markup hit-testing; form-field authoring **if** it ships) as named sub-projects, then delete `src/prototype` and record the verdict.

---

_Source evidence (EmbedPDF): docs at embedpdf.com/docs/react/headless/plugins/{plugin-zoom, plugin-scroll, plugin-viewport, plugin-tiling, plugin-annotation, plugin-render}; source at github.com/embedpdf/embed-pdf-viewer (packages/plugin-zoom/src/shared/utils/zoom-gesture-logic.ts, packages/plugin-interaction-manager/src/shared/components/page-pointer-provider.tsx, packages/models/src/geometry.ts). Pinned reference version: 2.14.3._
