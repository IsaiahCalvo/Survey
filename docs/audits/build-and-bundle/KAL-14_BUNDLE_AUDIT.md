# KAL-14 — Vite bundle-size and code-splitting audit

_Run: 2026-05-19. Branch: `isaiahcalvo123/kal-14-investigate-vite-bundle-size-and-code-splitting-cleanup`._

This is an investigation note. No code changes were committed alongside this audit. Each recommendation below carries an expected benefit and a risk; concrete implementation work should land as separate, small, reviewable issues.

---

## What the current build looks like

`npm run build` (Vite 5.4.21) finishes successfully in ~17 seconds and emits four asset files:

| File | Raw size | Gzipped |
|------|---------:|--------:|
| `index-*.js` (main app chunk) | **14.88 MB** | **4.88 MB** |
| `index-*.css` | 2.36 MB | 298 KB |
| `pdf.worker.min-*.js` | 1.09 MB | (not gzipped — served as worker) |
| `pdfRender.worker-*.js` | 584 KB | (not gzipped — served as worker) |

The two worker files already live in their own chunks because Vite handles workers via separate entry points — that's correct and should stay as-is.

The main JS chunk being 14.88 MB raw is what drives Vite's "chunks larger than 500 kB" warning. Gzipped it's ~4.88 MB, which still puts cold-load time deep in the multi-second range on a typical connection. For the Electron build that's fine; for the web build it's the long-pole on first paint.

---

## Warnings the build currently emits

Two categories. Both are real but only one is worth acting on now.

### 1. pdf.js `eval` warning (LIBRARY, not actionable here)

```
node_modules/pdfjs-dist/build/pdf.js (1962:33): Use of eval in
"node_modules/pdfjs-dist/build/pdf.js" is strongly discouraged…
```

This is upstream — pdf.js uses `eval` for its sandboxed font parser. The repo has been shipping with this warning for many builds. Cannot be fixed without forking pdf.js or filing upstream. **Recommendation: defer. Document as known noise so release verification ignores it.**

### 2. Mixed static/dynamic import warnings (THREE files — actionable)

Vite cannot move a module into its own chunk if some call sites use `import()` and others use a static `import … from`. The build currently calls this out three times:

#### `pdf-lib`

| Where | How |
|-------|-----|
| `src/App.jsx` line 6 | `import { PDFDocument, degrees } from 'pdf-lib';` (static) |
| `src/App.jsx` lines 26752, 27100 | `await import('pdf-lib')` (dynamic) |
| `src/utils/pdfAnnotationsPdfLib.js` line 7 | static |
| `src/utils/pdfAnnotationImporter.js` lines 65, 1477 | dynamic |
| `src/components/SyncfusionPDFContainer.jsx` line 2089 | dynamic |

`pdf-lib` is a large dependency. Some sites intentionally lazy-load it (annotation importer is on-demand). The static imports defeat that — `pdf-lib` ends up baked into the main chunk anyway, so the dynamic imports save nothing.

#### `exceljs`

| Where | How |
|-------|-----|
| `src/App.jsx` line 8 | `import ExcelJS from 'exceljs';` (static) |
| `src/services/excelGraphService.js` line 530 | `await import('exceljs')` (dynamic) |

Same pattern. `exceljs` is heavy. The dynamic site in the Excel sync service is wasted because the static import already pulls the whole thing into the main chunk.

#### `./utils/debugBridge`

| Where | How |
|-------|-----|
| `src/App.jsx` line 189 | static |
| `src/PageAnnotationLayer.jsx` line 2 | static |
| `src/App.jsx` line 18343 | `await import('./utils/debugBridge')` (dynamic) |

This one is internal, smaller, and the dynamic site is one-off (a self-registration effect). Lowest value of the three.

---

## Recommendations

Listed cheapest-first. Each is its own follow-up issue.

### Recommendation 1 — Pick one mode per heavy dep and stick to it (HIGHEST VALUE)

For both `pdf-lib` and `exceljs`, decide whether the dep is "always loaded" (delete the dynamic imports and keep static) or "loaded on demand" (delete the static imports and route every call site through a small loader util).

**Expected benefit:** if both go dynamic, the main JS chunk shrinks meaningfully — `pdf-lib` and `exceljs` together are a multi-megabyte slice of the current 14.88 MB chunk, and gzipped together they're hundreds of KB off the cold-load budget. Vite will also stop emitting the two warnings.

**Risk:** medium. The static imports are presumably load-bearing for paths that run early (App.jsx imports `PDFDocument` at module scope; ExcelJS is at module scope). Going fully-dynamic requires every early-path consumer to `await import(...)` and tolerate the async boundary. There's some chance of subtle ordering bugs around save/export flows that run at unpredictable moments. Mitigation: ship behind targeted manual smoke tests for "open PDF, annotate, export to PDF" and "save survey, export to Excel".

**Verification:** before/after `npm run build` chunk size diff; manual smoke of save/export paths; existing test suite green.

**Suggested follow-up:** one issue per dep (KAL-14a "Make pdf-lib import strategy consistent" and KAL-14b "Make exceljs import strategy consistent").

### Recommendation 2 — Add a small `manualChunks` split for the largest deps (MEDIUM VALUE)

Even after Recommendation 1, the main chunk will still contain Syncfusion PDF viewer packages, Fabric.js, Yjs, Supabase, and Microsoft Graph — all heavy, all almost always co-resident with the app shell on cold load. A `build.rollupOptions.output.manualChunks` config can split them into long-cached vendor chunks.

**Expected benefit:** cold-load size doesn't actually shrink, but warm-load and version-upgrade re-downloads shrink dramatically (only the changed chunk is re-fetched). For an app updated frequently, that's a real user-facing win on the web build.

**Risk:** low-medium. Naive `manualChunks` can cause circular import errors or interact badly with the existing Syncfusion shims (`src/shims/ej2-interactive-chat.js` etc.). Mitigation: start with a single split (e.g., `syncfusion` packages → own chunk), prove it works, then iterate.

**Verification:** `npm run build` runs clean; cold-open the built app in the browser; confirm chunk count and that the largest chunk shrunk.

**Suggested follow-up:** KAL-14c "Add Syncfusion vendor chunk to manualChunks".

### Recommendation 3 — Fix `debugBridge` mixed import (LOW VALUE)

Either drop the dynamic import or convert the two static sites to dynamic. The module is small; this is hygiene more than performance.

**Expected benefit:** removes one warning from the build log. No measurable size impact.

**Risk:** very low.

**Suggested follow-up:** roll into Recommendation 1's PR or skip entirely.

### Recommendation 4 — Defer (NO-OP)

- The pdf.js `eval` warning. Library, not blocking, no leverage from our side.
- The Vite CJS API deprecation warning. Vite 5 still supports CJS; upgrade strategy belongs in a Vite 6 issue, not this audit.
- Touching the worker chunks. They're already split correctly.

---

## Done definition for this issue

- Build output captured ✓
- Largest chunks and likely source dependencies identified ✓
- Three actionable warnings explained with cause ✓
- Each recommendation has expected benefit, risk, and verification ✓
- At least one explicit "defer / no-op" recommendation ✓
- No runtime code changes shipped in this branch ✓

If the recommendations look right, open the follow-up issues (KAL-14a / KAL-14b / KAL-14c) and close KAL-14.
