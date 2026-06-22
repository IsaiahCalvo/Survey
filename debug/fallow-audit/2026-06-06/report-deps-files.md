# Fallow Audit — 2026-06-06 — Dependencies & Files Investigation

**Investigator:** subagent (Claude Sonnet 4.6)
**Scope:** Unused Files (5), Unused Deps (25), Unused DevDeps (6), Unlisted Dep (1)
**Date:** 2026-06-06
**Method:** grep across src/, agent-cli/, scripts/, supabase/, tests/; vite.config.js + package.json inspection; git log -p for removed usages; node_modules dependency tree inspection.

---

## Verdict Legend

| Verdict | Meaning |
|---|---|
| **KEEP-DOCUMENTED** | Matches a known intentional keep in CLAUDE.md or REPORT.md |
| **KEEP-IN-USE** | Fallow false positive — real usage found |
| **KEEP-UNCERTAIN** | No direct import found, but non-trivial risk to remove — needs human judgment |
| **REMOVABLE** | Zero reachability confirmed; safe candidate for deletion |

---

## 1. Unused Files

| Item | Category | Verdict | Evidence |
|---|---|---|---|
| `debug/fallow-audit/validate-strict.mjs` | Unused File | **KEEP-IN-USE** | Standalone one-shot audit script committed in `ddb07438` as fallow audit tooling. Not imported (entry-point by design). Reads `dead-code3.json` and performs path-resolving importer analysis. Fallow is blind to standalone scripts. |
| `debug/fallow-audit/validate-unused.mjs` | Unused File | **KEEP-IN-USE** | Companion script from same commit. Scans codebase for references to fallow-flagged filenames. Not imported by design. Entry-point tool. |
| `src/App.css` | Unused File | **KEEP-DOCUMENTED** | Not JS-imported (main.jsx imports `./styles.css` only). However: `PDFViewer.jsx` cites `--font-primary in src/App.css (~line 8)` in a comment; three component CSS files declare they use the App.css CSS variable system (`ReSignInModal.css`, `QuarantineMarkerOverlay.css`, `StorageFailureBanner.css`). App.css contains the `:root` CSS-variable block. CLAUDE.md/REPORT.md explicitly defers both stylesheets. Do NOT remove without CSS diff + visual verification. |
| `src/index.css` | Unused File | **KEEP-DOCUMENTED** | Not JS-imported. `SVGAnnotationLayer.jsx` cites `src/index.css` twice as the definition source for `.callout-handle` class (which is used at runtime). `index.css` contains `.callout-handle`, `.callout-text-box`, and `@keyframes slideInFromRight` rules. CLAUDE.md/REPORT.md explicitly defers both stylesheets. |
| `src/components/pdfEngineContract.js` | Unused File | **KEEP-IN-USE** | File header explicitly states it is "DOCUMENTATION + a machine-checkable spec… intentionally not imported by PDFViewer's render path." Phase 37 WIP contract for the Syncfusion→pdf.js cutover seam. `PDFViewerEngineSelector.jsx` and `PdfjsViewerContainer.jsx` both cite it in comments. CLAUDE.md lists WIP pdf.js cutover files as an intentional keep category. |

---

## 2. Unused Dependencies (25)

| Item | Category | Verdict | Evidence |
|---|---|---|---|
| `@azure/msal-node` | Unused Dep | **REMOVABLE** | Server-side Node.js MSAL library. Zero imports anywhere in src/, scripts/, agent-cli/, supabase/. `src/authConfig.js` imports from `@azure/msal-browser` (browser variant). No git history of use. No role in Electron+browser app. |
| `@capacitor/android` | Unused Dep | **KEEP-IN-USE** | `android/` folder exists. `android/capacitor.settings.gradle` line 3 directly references `node_modules/@capacitor/android/capacitor`. `npm run mobile:sync` (`npx cap sync`) requires platform package installed. Fallow blind to Capacitor native build toolchain. |
| `@capacitor/ios` | Unused Dep | **KEEP-IN-USE** | `ios/` folder exists (App/, capacitor-cordova-ios-plugins/, debug.xcconfig). `npm run mobile:ios` runs `npx cap open ios`. Capacitor CLI requires platform package to manage the iOS project. |
| `@embedpdf/pdfium` | Unused Dep | **KEEP-IN-USE** | Direct dependency of `@embedpdf/engines` (listed in `@embedpdf/engines/package.json` dependencies). `EmbedpdfArm.jsx` imports `usePdfiumEngine` from `@embedpdf/engines/react`. Also, EmbedpdfArm.jsx references `pdfium.wasm` at runtime. Fallow blind to transitive peer-pulled packages. |
| `@stripe/stripe-js` | Unused Dep | **REMOVABLE** | No `import … from '@stripe/stripe-js'` or `loadStripe(` call in any source file. `StripeCheckout.jsx` uses Supabase edge function + `window.electronAPI.openExternal` redirect — no client SDK needed. Supabase edge functions use `https://esm.sh/stripe@11.1.0?target=deno` (Deno CDN, not this package). No git history of prior import. |
| `@syncfusion/ej2-calendars` | Unused Dep | **KEEP-DOCUMENTED** | CLAUDE.md: "Leave the unused `@syncfusion/ej2-*` sub-packages for the deliberate Syncfusion-removal migration." No direct import. |
| `@syncfusion/ej2-compression` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-data` | Unused Dep | **KEEP-DOCUMENTED** | Same. Also a direct dependency of `@syncfusion/ej2-pdfviewer` (in its package.json deps). |
| `@syncfusion/ej2-drawings` | Unused Dep | **KEEP-DOCUMENTED** | Same. Also a direct dependency of `@syncfusion/ej2-pdfviewer`. |
| `@syncfusion/ej2-excel-export` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-file-utils` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-filemanager` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-grids` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-icons` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-inplace-editor` | Unused Dep | **KEEP-DOCUMENTED** | Same. Also a direct dependency of `@syncfusion/ej2-pdfviewer`. |
| `@syncfusion/ej2-layouts` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-pdf` | Unused Dep | **KEEP-DOCUMENTED** | Same. Also a direct dependency of `@syncfusion/ej2-pdfviewer`. |
| `@syncfusion/ej2-pdf-data-extract` | Unused Dep | **KEEP-DOCUMENTED** | Same. Also a direct dependency of `@syncfusion/ej2-pdfviewer`. |
| `@syncfusion/ej2-pdf-export` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-react-base` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `@syncfusion/ej2-richtexteditor` | Unused Dep | **KEEP-DOCUMENTED** | Same. No direct import. |
| `annotpdf` | Unused Dep | **REMOVABLE** | Sole importer was `src/utils/pdfAnnotations.js` (`import { AnnotationFactory } from 'annotpdf'`). That file was **deleted** in commit `f84e048b` (2026-06-04). Zero remaining imports of `annotpdf` or `AnnotationFactory` in src/, scripts/, or tests/. |
| `isomorphic-fetch` | Unused Dep | **REMOVABLE** | Zero imports anywhere in src/, scripts/, agent-cli/, supabase/. App runs in Electron (native fetch) and modern browsers. No reference in vite.config.js define/alias. No git history of prior import. |
| `polygon-clipping` | Unused Dep | **REMOVABLE** | Git commit `375e01f5` explicitly removed the import from `PageAnnotationLayer.jsx` with comment "polygon-clipping removed - using clipPath-based erasing instead." Zero remaining imports in current source. Distinct package from `martinez-polygon-clipping` (v0.7.4), which IS actively used by 4 source files. |
| `react-window` | Unused Dep | **REMOVABLE** | Sole importer `src/components/PDFPageList.jsx` was deleted in commit `f84e048b` (2026-06-04). Zero remaining imports of `react-window`, `VariableSizeList`, `FixedSizeList`, `VariableSizeGrid`, or `FixedSizeGrid` in src/. |

---

## 3. Unused DevDependencies (6)

| Item | Category | Verdict | Evidence |
|---|---|---|---|
| `buffer` | Unused DevDep | **KEEP-UNCERTAIN** | `vite-plugin-node-polyfills` resolves Buffer through its own `shims/buffer.js` AND via `node-stdlib-browser`, which has its own nested `buffer@5.7.1`. The root `buffer@6.0.3` in devDeps is a different version. No source file imports it by name. Risk: removing it may change how npm deduplicates buffer across the dep tree. Requires build verification. |
| `events` | Unused DevDep | **KEEP-UNCERTAIN** | `node-stdlib-browser` lists `events` as a dep; root `events@3.3.0` satisfies it (no nested copy). No source file imports it directly. Removing forces a nested install under `node-stdlib-browser`. Low actual risk but requires build test. |
| `license-checker` | Unused DevDep | **KEEP-IN-USE** | `scripts/check-licenses.mjs` explicitly calls `npx license-checker@^25.0.1` (line 129). `npm run check:licenses` in package.json invokes this file. It is a production compliance gate. Fallow blind to `npx`-invoked CLIs. |
| `stream-browserify` | Unused DevDep | **KEEP-UNCERTAIN** | `node-stdlib-browser` lists `stream-browserify` as a dep; root `stream-browserify@3.0.0` satisfies it (no nested copy). No source file imports it directly. Same risk profile as `events`. |
| `util` | Unused DevDep | **KEEP-UNCERTAIN** | `node-stdlib-browser` lists `util` as a dep; root `util@0.12.5` satisfies it (no nested copy). No source file imports it directly. Same profile as `events`/`stream-browserify`. |
| `ws` | Unused DevDep | **KEEP-UNCERTAIN** | No `import … from 'ws'` found in any non-node_modules file. Phase 28 transport benchmark uses `ws://` URL strings in comments only (no import). Likely a forward-planning install for the Phase 28 Hocuspocus spike (`@hocuspocus/provider` would depend on `ws`). Safe to remove if the spike outcome is confirmed as Supabase transport. |

---

## 4. Unlisted Dependency

| Item | Category | Verdict | Evidence |
|---|---|---|---|
| `@hocuspocus/provider` | Unlisted Dep | **KEEP-DOCUMENTED** | Dynamically imported via `await import('@hocuspocus/provider')` in `src/lib/collab/HocuspocusYjsProvider.js`. File header (line 8) explicitly states this is a conditional dep not installed by default. Package NOT installed (`node_modules/@hocuspocus/` absent). Dynamic import has explicit error-handling for missing package. CLAUDE.md lists "the Phase-28 collab fallback provider (@hocuspocus/provider)" as intentional keep. |

---

## Corrected Verdict Counts

| Verdict | Count |
|---|---|
| KEEP-DOCUMENTED | 19 (src/App.css, src/index.css, 11× @syncfusion/ej2-*, @hocuspocus/provider unlisted) |
| KEEP-IN-USE | 8 (validate-strict.mjs, validate-unused.mjs, pdfEngineContract.js, @capacitor/android, @capacitor/ios, @embedpdf/pdfium, license-checker devDep) |
| KEEP-UNCERTAIN | 5 (buffer, events, stream-browserify, util, ws) |
| REMOVABLE | 6 (@azure/msal-node, @stripe/stripe-js, annotpdf, isomorphic-fetch, polygon-clipping, react-window) |

---

## REMOVABLE Items — One-line Evidence Each

1. **`@azure/msal-node`** — server-side Node.js MSAL; app uses `@azure/msal-browser`; zero imports in any file; no git history of use.
2. **`@stripe/stripe-js`** — `loadStripe` never called; `StripeCheckout.jsx` uses Supabase function redirect; Deno edge functions use CDN Stripe; zero imports of `@stripe/stripe-js`.
3. **`annotpdf`** — sole importer `src/utils/pdfAnnotations.js` deleted in commit `f84e048b` (2026-06-04 cleanup); zero remaining imports.
4. **`isomorphic-fetch`** — zero imports anywhere; Electron and modern browsers have native `fetch`.
5. **`polygon-clipping`** — removed from `PageAnnotationLayer.jsx` in commit `375e01f5` ("using clipPath-based erasing instead"); zero remaining imports; different package from active `martinez-polygon-clipping`.
6. **`react-window`** — sole importer `PDFPageList.jsx` deleted in commit `f84e048b` (2026-06-04 cleanup); zero remaining imports.

---

## Recommended Next Steps

- **Gate removals behind:** `npx vite build` + `node scripts/run-node-tests.mjs` per CLAUDE.md instructions.
- **Polyfill devDeps (buffer/events/stream-browserify/util):** Can be batched in one npm uninstall + build test; failure means npm was relying on the explicit declaration for deduplication. Low risk.
- **ws:** Remove only after confirming Phase 28 spike outcome is Supabase (not Hocuspocus).
- **Do NOT delete any source file or edit package.json based on this report alone.**
