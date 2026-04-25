# PDF-Native Annotations Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Each Chunk can be executed and committed independently.

**Goal:** Make print, export, and download instant and Adobe-compatible by baking annotations into the PDF as native annotations at output time, instead of rasterizing them per page. The cloud database remains the live source of truth — multi-device sign-in, live editing, and any future real-time multi-user collaboration are unchanged.

**Architecture:** The Supabase database stays canonical for every annotation. Today's edit pipeline (Fabric.js editing, database persistence, SVG render) is preserved end-to-end. A new "bake-on-export" pipeline converts our database annotations into native PDF annotation dictionaries (highlight, ink, free text, square, circle, line, arrow, polygon, polyline, stamp, sticky note) at the moment a user prints, downloads, or exports a file. Two app-specific kinds (counter chains, callouts with knee handles) persist in the exported PDF as stamps + free-text-callouts respectively, with a sidecar metadata block that lets us re-attach their app-only behavior if we ever import an exported file back. Syncfusion's built-in annotation service stays disabled — we don't need it because we're not capturing edits from the viewer's toolbar. All work lives behind an `ENABLE_PDF_NATIVE_EXPORT` flag so we can roll forward and back per environment.

**Tech Stack:** React 18, Syncfusion ej2-react-pdfviewer 32.1.19, pdf-lib 1.17.1 (existing), annotpdf 1.x (NEW — high-level PDF annotation creation + appearance-stream synthesis), Fabric.js 5.5.2 (used for editing today, unchanged by this milestone), Supabase (annotation database, unchanged), Node built-in test runner (`node --test`), Playwright for end-to-end print latency + Adobe Acrobat verification tests.

**Reference research bundle (read first):**
- `.planning/research/PDF-NATIVE-ANNOTATIONS-PLAN.md` — high-level milestone plan (already drafted 2026-04-25; pre-revision; this plan supersedes its architecture choice)
- `.planning/research/CURRENT-REPO-AUDIT.md` — current annotation system inventory
- `src/utils/pdfAnnotationsPdfLib.js` — existing low-level pdf-lib export path (referenced for parity with current export behavior; the new bake pipeline replaces it)
- `src/utils/pdfAnnotationImporter.js` — existing PDF→database importer (left in place; inbound round-trip is out of scope for this milestone)
- `src/components/SyncfusionPDFContainer.jsx` — Syncfusion config flags stay set to `false` for editing; one tiny addition lets the viewer render native annotations on PDFs that arrive with them already

**Reference test PDFs (manual verification fixtures):**
- `/Users/isaiahcalvo/Desktop/Package 2 - Rev 4 -- IC.pdf` — 99-page mixed-orientation test set; primary print + bake-pipeline target
- `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf` — mixed Adobe + Drawboard saves; Adobe Acrobat cross-viewer verification target

**Test runner commands:**
- Full suite: `npm test`
- Single file: `node --test tests/pdfNativeExport.test.mjs`
- Single test by name: `node --test --test-name-pattern="ink adapter round-trips" tests/pdfNativeExport.test.mjs`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `package.json` | Add `annotpdf` dependency | Modify |
| `src/components/SyncfusionPDFContainer.jsx` | No change in this milestone — Syncfusion's annotation service stays disabled. Today's import flow already pulls native PDF annotations into the database, so no viewer-side change is needed. | (no change) |
| `src/utils/pdfNativeExport/index.js` | Public API surface — `bakeAnnotationsIntoPdf(pdfBytes, annotationsByPage)` returns a new PDF blob with native annotations | Create (Phase A) |
| `src/utils/pdfNativeExport/featureFlag.js` | Reads `ENABLE_PDF_NATIVE_EXPORT` from env + per-user override | Create (Phase A) |
| `src/utils/pdfNativeExport/coordinateSpace.js` | Pure conversion helpers: app annotation page-space ↔ PDF user-space points | Create (Phase A) |
| `src/utils/pdfNativeExport/adapters/index.js` | Adapter registry — `getAdapter(annotationType)` returns the right per-type adapter | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/highlightAdapter.js` | App highlight → PDF `/Highlight` with `QuadPoints` | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/inkAdapter.js` | App pen path → PDF `/Ink` with `InkList`; appearance stream regenerated for variable-width strokes | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/squareAdapter.js` | App rectangle → PDF `/Square` (with `/IC` for filled) | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/circleAdapter.js` | App circle/ellipse → PDF `/Circle` | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/lineAdapter.js` | App line → PDF `/Line` (no head) | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/arrowAdapter.js` | App arrow → PDF `/Line` with `/LE`; curved variants emit appearance stream + `SurveyBetaSafe` private dict for round-trip | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/freeTextAdapter.js` | App textbox → PDF `/FreeText` with `/DA` and embedded font program | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/polygonAdapter.js` | App polygon → PDF `/Polygon` | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/polylineAdapter.js` | App polyline → PDF `/PolyLine` | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/stampAdapter.js` | App image overlay → PDF `/Stamp` with embedded image XObject | Create (Phase B) |
| `src/utils/pdfNativeExport/adapters/stickyNoteAdapter.js` | App sticky note → PDF `/Text` (sticky note subtype) | Create (Phase B) |
| `src/utils/pdfNativeExport/counterChain.js` | Counter chains → PDF `/Stamp` with chain ID in `/NM` and `SurveyBetaSafe` sidecar metadata so chain semantics survive a re-import | Create (Phase C) |
| `src/utils/pdfNativeExport/calloutAdapter.js` | App callout → PDF `/FreeText` + `/IT /FreeTextCallout` + `/CL` (one-knee leader) | Create (Phase C) |
| `src/utils/pdfNativeExport/bakePipeline.js` | Reads database annotations + original PDF bytes, walks the adapter registry, returns a PDF blob with native annotations applied. Pure: no database writes. | Create (Phase D) |
| `src/utils/pdfNativeExport/printPipeline.js` | Replaces the per-page rasterization print path — feeds the baked PDF blob URL straight to a hidden iframe | Create (Phase E) |
| `src/components/PrintPanel.jsx` | Re-enable behind `PRINT_PANEL_ENABLED` flag; runs on top of the new instant pipeline | Modify (Phase E) |
| `src/App.jsx` | Wire print pipeline swap (minimal, gated by flag) | Modify (Phase E) |
| `tests/pdfNativeExport/coordinateSpace.test.mjs` | Pure conversion unit tests | Create (Phase A) |
| `tests/pdfNativeExport/adapters/*.test.mjs` | Per-type adapter conversion tests (one file per type) | Create (Phase B) |
| `tests/pdfNativeExport/bakePipeline.test.mjs` | Bake pipeline integration tests: database fixtures → PDF blob → annotation count + position assertions | Create (Phase D) |
| `tests/pdfNativeExport/printLatency.test.mjs` | Timing harness — print dialog open within 1s of trigger | Create (Phase E) |

---

## Cross-Chunk Invariants (never violate)

1. **Database is always source of truth.** The Supabase annotation tables remain canonical for every phase, including GA. The PDF-native annotations are an *output projection* produced at print/export/download time — never a parallel store of editable state.
2. **No regression to live editing.** Today's edit pipeline (Fabric.js editing, Supabase persistence, SVG render, multi-device sign-in) is preserved unchanged. New code only runs in the print/export/download path.
3. **Feature-flag everything.** No code path runs without checking the feature flag module until the cleanup phase removes the flag.
4. **Bake step is pure.** The bake pipeline reads from the database, produces a PDF blob, and writes nothing back to the database. A failed bake never corrupts user data — worst case, the user gets a fallback rasterized PDF (today's path).
5. **`zoomGeneration` signal contract preserved end-to-end** (CRITICAL — DO NOT BREAK in `CLAUDE.md`).
6. **Container-aware sizing rule preserved** (2026-03-22 gotcha in `CLAUDE.md`): canvas sizing uses `containerEl.offsetWidth / pageSize.width`.
7. **Single-name font rule preserved** (2026-04-08 gotcha in `CLAUDE.md`): every `/FreeText` annotation's `/DA` references a single-name standard PDF font.
8. **DO NOT CHANGE list from project `CLAUDE.md`:** `src/components/PageAnnotationLayer.jsx`, `src/components/SVGAnnotationLayer.jsx`, the Fabric canvas trio (`FabricDrawingCanvas`, `FabricEditCanvas`, `FabricEraserCanvas`) all stay untouched throughout the entire milestone — they own live editing and live editing is not changing. Touching `src/App.jsx` requires explicit Phase scope (Phases A and E only).

---

## Acceptance Criteria — Milestone-Wide (Given/When/Then)

- **Given** a 99-page document with 200+ annotations of every supported type, **when** the user presses `Cmd/Ctrl+P` after the print phase lands, **then** the OS print dialog appears in under 1 second and every annotation is visually present in the printed output.
- **Given** a document marked-up in our app, **when** the user downloads or exports it, **then** every annotation in the resulting PDF is a native PDF annotation, editable in Adobe Acrobat, and visually faithful (within the documented constraints for variable-width pen strokes and curved arrows).
- **Given** any user signed in on a second device, **when** they open a document, **then** today's behavior is unchanged — they see live edits from other devices via the existing database sync.
- **Given** any failure inside the new bake pipeline, **when** the failure is detected, **then** the system silently falls back to today's rasterized print path, no user data is touched, and the failure is logged for support.

---

## Phase A: Foundations

### Goal
Add `annotpdf`, scaffold the feature flag, the coordinate-space helpers, and the public API surface for the bake pipeline. No user-visible change. Today's edit pipeline is unchanged. Syncfusion's annotation service stays disabled — we are not capturing edits from the viewer.

### Acceptance (Given/When/Then)
- **Given** the flag is OFF or ON, **when** the user opens a document and edits an annotation, **then** the experience is byte-identical to today (no Syncfusion annotation toolbar, no event bridge, no console churn, identical database writes).
- **Given** the new public API surface exists, **when** unit tests are run, **then** the feature flag, coordinate-space, and adapter-registry skeletons all pass their tests.

### DO NOT CHANGE (Phase A scope)
- Every file in the project except: `package.json` and the new files listed under "File Structure" for Phase A.
- No edits to `src/App.jsx`, `src/components/SyncfusionPDFContainer.jsx`, or any existing source file in Phase A — wiring lands in Phase E with the print pipeline swap.

---

### Task A.1: Add `annotpdf` dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto)

- [ ] **Step 1: Run install**

```bash
npm install --save annotpdf
```

- [ ] **Step 2: Verify version pinned**

Run: `grep '"annotpdf"' package.json`
Expected: a line like `"annotpdf": "^1.x.x"`

- [ ] **Step 3: Verify it loads in Node**

Run: `node -e "import('annotpdf').then(m => console.log(Object.keys(m)))"`
Expected: a list including `createHighlightAnnotation`, `createInkAnnotation`, `createFreeTextAnnotation`, etc.

- [ ] **Step 4: Verify Vite build still passes**

Run: `npx vite build --mode development`
Expected: `✓ built in N seconds`, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add annotpdf for PDF annotation creation"
```

---

### Task A.2: Feature flag module

**Files:**
- Create: `src/utils/pdfNativeExport/featureFlag.js`
- Create: `tests/pdfNativeExport/featureFlag.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pdfNativeExport/featureFlag.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPdfNativeExportEnabled, setPdfNativeExportEnabledForDocument } from '../../src/utils/pdfNativeExport/featureFlag.js';

test('flag defaults to false when env unset', () => {
  delete process.env.ENABLE_PDF_NATIVE_EXPORT;
  assert.equal(isPdfNativeExportEnabled(), false);
});

test('flag honors env var truthy values', () => {
  process.env.ENABLE_PDF_NATIVE_EXPORT = 'true';
  assert.equal(isPdfNativeExportEnabled(), true);
  process.env.ENABLE_PDF_NATIVE_EXPORT = '1';
  assert.equal(isPdfNativeExportEnabled(), true);
});

test('per-document override wins over env', () => {
  process.env.ENABLE_PDF_NATIVE_EXPORT = 'true';
  setPdfNativeExportEnabledForDocument('pdf-123', false);
  assert.equal(isPdfNativeExportEnabled('pdf-123'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pdfNativeExport/featureFlag.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/utils/pdfNativeExport/featureFlag.js
const overrides = new Map();

const truthy = (v) => v === true || v === 'true' || v === '1';

export function isPdfNativeExportEnabled(documentId) {
  if (documentId !== undefined && overrides.has(documentId)) {
    return overrides.get(documentId);
  }
  if (typeof window !== 'undefined' && window.__pdfNativeExportForceEnable === true) {
    return true;
  }
  const envValue = (typeof process !== 'undefined' ? process.env?.ENABLE_PDF_NATIVE_EXPORT : undefined)
    || (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ENABLE_PDF_NATIVE_EXPORT : undefined);
  return truthy(envValue);
}

export function setPdfNativeExportEnabledForDocument(documentId, enabled) {
  if (!documentId) throw new Error('documentId required');
  overrides.set(documentId, !!enabled);
}

export function clearPdfNativeExportOverride(documentId) {
  overrides.delete(documentId);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/pdfNativeExport/featureFlag.test.mjs`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfNativeExport/featureFlag.js tests/pdfNativeExport/featureFlag.test.mjs
git commit -m "feat(pdf-native): add feature flag with env + per-document override"
```

---

### Task A.3: Coordinate space conversion helpers

Our database stores annotations in PDF user-space points (1/72 inch) but with Y origin at top-left (Fabric convention). The PDF spec uses Y origin at bottom-left. The bake step needs a Y-flip plus rectangle-corner conversion.

**Files:**
- Create: `src/utils/pdfNativeExport/coordinateSpace.js`
- Create: `tests/pdfNativeExport/coordinateSpace.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pdfNativeExport/coordinateSpace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appRectToPdfPoints,
  pdfPointsToAppRect
} from '../../src/utils/pdfNativeExport/coordinateSpace.js';

const PAGE_HEIGHT_PT = 792; // US Letter portrait

test('app rect (top-left origin) → PDF points (bottom-left origin)', () => {
  const rect = { left: 75, top: 75, width: 150, height: 37.5 };
  const pts = appRectToPdfPoints(rect, PAGE_HEIGHT_PT);
  assert.equal(pts.x1, 75);
  assert.equal(pts.x2, 225);
  // top-down → bottom-up flip
  assert.equal(pts.y2, 792 - 75); // 717
  assert.equal(pts.y1, 717 - 37.5);
});

test('round-trip app rect ↔ PDF points is lossless', () => {
  const original = { left: 100, top: 200, width: 50, height: 25 };
  const pts = appRectToPdfPoints(original, PAGE_HEIGHT_PT);
  const back = pdfPointsToAppRect(pts, PAGE_HEIGHT_PT);
  assert.equal(back.left, original.left);
  assert.equal(back.top, original.top);
  assert.equal(back.width, original.width);
  assert.equal(back.height, original.height);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pdfNativeExport/coordinateSpace.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/utils/pdfNativeExport/coordinateSpace.js
export function appRectToPdfPoints(rect, pageHeightPt) {
  // App rect stores in PDF user-space points with Y origin top-left;
  // PDF spec uses Y origin bottom-left.
  const x1 = rect.left;
  const x2 = rect.left + rect.width;
  const y2 = pageHeightPt - rect.top;
  const y1 = y2 - rect.height;
  return { x: x1, x1, x2, y1, y2, width: rect.width, height: rect.height };
}

export function pdfPointsToAppRect(pts, pageHeightPt) {
  return {
    left: pts.x1,
    top: pageHeightPt - pts.y2,
    width: pts.x2 - pts.x1,
    height: pts.y2 - pts.y1
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/pdfNativeExport/coordinateSpace.test.mjs`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfNativeExport/coordinateSpace.js tests/pdfNativeExport/coordinateSpace.test.mjs
git commit -m "feat(pdf-native-export): add coordinate space conversion helpers"
```

---

### Task A.4: Public API surface (skeleton)

The adapter layer and bake pipeline plug into this. Empty methods that throw `not-implemented` until later phases fill them in.

**Files:**
- Create: `src/utils/pdfNativeExport/index.js`
- Create: `tests/pdfNativeExport/index.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/pdfNativeExport/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../src/utils/pdfNativeExport/index.js';

test('exports the expected public API', () => {
  assert.equal(typeof api.bakeAnnotationsIntoPdf, 'function');
  assert.equal(typeof api.registerAdapter, 'function');
  assert.equal(typeof api.getAdapter, 'function');
});

test('bakeAnnotationsIntoPdf throws not-implemented until Phase D', () => {
  assert.rejects(
    () => api.bakeAnnotationsIntoPdf(new Uint8Array(), {}),
    /not-implemented/
  );
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `node --test tests/pdfNativeExport/index.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/utils/pdfNativeExport/index.js
const adapters = new Map();

export function registerAdapter(annotationType, adapter) {
  if (!annotationType) throw new Error('annotationType required');
  adapters.set(annotationType, adapter);
}

export function getAdapter(annotationType) {
  return adapters.get(annotationType) ?? null;
}

export async function bakeAnnotationsIntoPdf(pdfBytes, annotationsByPage) {
  throw new Error('pdfNativeExport.bakeAnnotationsIntoPdf not-implemented yet — gated by Phase D');
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/pdfNativeExport/index.test.mjs`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfNativeExport/index.js tests/pdfNativeExport/index.test.mjs
git commit -m "feat(pdf-native-export): scaffold public API surface"
```

---

### Task A.5: Phase A reconciliation

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass, including new Phase A tests.

- [ ] **Step 2: Confirm zero behavioral change**

Manual smoke test under both flag states (ON and OFF). Open the largest test PDF, draw and edit every annotation type, verify multi-device sync still propagates within 1 second. Result: no observable change between flag ON and flag OFF (Phase A is foundations only).

- [ ] **Step 3: Write `.planning/phases/<phase-A>/A-RECONCILIATION.md`**

Use the project's standard reconciliation template (CLAUDE.md). Status: `DONE` if all acceptance criteria pass, `DONE_WITH_CONCERNS` if any soft regressions, `NEEDS_CONTEXT` otherwise.

- [ ] **Step 4: Tag the milestone progress in roadmap**

Update `.planning/ROADMAP.md` to mark Phase A complete.

- [ ] **Step 5: Commit reconciliation + roadmap**

```bash
git add .planning/phases/<phase-A>/A-RECONCILIATION.md .planning/ROADMAP.md
git commit -m "docs(pdf-native): close Phase A with reconciliation"
```

---

## Phase B: Type Adapters

### Goal
For every supported annotation type, build a pure adapter that converts the database annotation record into a native PDF annotation dictionary (with appearance stream where needed). One-way: database → PDF. Each adapter ships with a conversion test against a fixture set drawn from real production data plus a visual-diff check in Adobe Acrobat.

### Acceptance (Given/When/Then)
- **Given** a database annotation record of any of the 14 supported types, **when** it is passed to its adapter's `toPdfAnnotation`, **then** the returned dict + appearance stream is spec-compliant (validated by annotpdf's parser) and renders identically to the in-app SVG version when opened in Adobe Acrobat (visual-diff fixture passes within 2px tolerance).
- **Given** a fixture set of 50+ examples per type pulled from production, **when** every example is run through its adapter, **then** zero errors thrown and every output passes the spec-compliance check.

### DO NOT CHANGE (Phase B scope)
- Today's edit pipeline is unchanged — adapters are read-only consumers of database state.
- `src/App.jsx` — no wiring changes in Phase B.
- All Phase A files except adapters/index.js.

### Adapter cookbook (per file)

For each adapter, the task pattern is identical:

```
Task B.X.1: Write the failing conversion test for <type>
Task B.X.2: Implement toPdfAnnotation
Task B.X.3: Implement appearance-stream synthesis (if type requires it)
Task B.X.4: Verify against the production fixture set
Task B.X.5: Verify visual diff in Adobe Acrobat
Task B.X.6: Commit
```

Following Phase A's task style — failing test first, minimal code, commit. Detailed step-by-step tasks for each of the 14 adapters land in this plan after Phase A's reconciliation lands and the fixture set is finalized.

**Why detail later, not now:** the adapter test fixtures must be drawn from real production data (sampled in Phase A.5). Writing the adapter task steps before the fixtures exist would require speculative test inputs that drift from reality. Phase A.5 produces the fixture file; Phase B.0 (the first task in this phase) is "extract 50 annotations per type from production fixtures into `tests/fixtures/pdfNativeExport/`," and every adapter task references those fixtures by ID.

### Adapter list (priority order — most-used first)

1. Highlight
2. Pen / freehand (Ink)
3. Rectangle (Square)
4. Circle / ellipse (Circle)
5. Line
6. Arrow (Line + LE; standard heads first, curved variant second)
7. Free text
8. Stamp
9. Sticky note
10. Polygon
11. Polyline
12. Squiggly / Underline / Strikethrough (text-markup; share QuadPoints code with Highlight)

### Phase B.0: Fixture extraction (must run before any adapter task)

Detailed steps for fixture extraction:

- [ ] Run a one-time script that walks production-saved documents (locally or in a dev-mirror Supabase) and pulls 50 annotations per type into `tests/fixtures/pdfNativeExport/<type>.json`.
- [ ] Strip user-identifiable metadata (author names, comments).
- [ ] Anonymize document IDs.
- [ ] Commit fixtures to repo.

(Concrete script + tasks added to this plan after Phase A.5 reconciliation lands.)

---

## Phase C: Custom Shape Adapters for Counter Chains and Knee-Handle Callouts

### Goal
Build adapters for the two app-specific annotation kinds that have no first-class PDF equivalent. Counter chains export as numbered stamps with a sidecar metadata block carrying chain ID + ordering. Knee-handle callouts export as PDF FreeTextCallout with a single-knee leader line. Today's app-side editing of both is unchanged — the adapters only run at bake time. Eraser is no longer in this phase: today's eraser already mutates the database directly, and the bake step simply renders whatever ink data the database holds.

### Acceptance (Given/When/Then)
- **Given** a document with 3 counter chains in the database, **when** the user exports the document, **then** every counter renders in the resulting PDF as a numbered stamp at the correct position and visible order; opened in Adobe Acrobat the numbers are visible (chain-edit semantics are not expected outside our app — matches today).
- **Given** the same exported document is re-imported into our app at some future date (out of scope for this milestone), **when** the sidecar metadata is read, **then** chain ID and ordering can be reconstructed.
- **Given** a callout with a knee handle in the database, **when** the user exports the document, **then** opened in Acrobat the callout renders correctly with the knee at the right position.

### DO NOT CHANGE (Phase C scope)
- Phase A and B files (read-only; their adapters are extended via the registry).
- Today's callout edit code in `PageAnnotationLayer.jsx` — Phase C only adds a bake-time adapter, not an edit-time replacement.
- Today's eraser code — unchanged.

### Detail
Concrete tasks for Phase C land after Phase B's reconciliation. The skeleton is:

- C.1 — Counter chain adapter: convert each counter to a numbered stamp; carry chain ID via `/NM` and full chain ordering via a `SurveyBetaSafe` sidecar dict.
- C.2 — Callout adapter: convert each callout to a PDF FreeTextCallout with `/IT /FreeTextCallout` and a `/CL` knee leader.

---

## Phase D: Bake Pipeline

### Goal
Wire the per-type adapters from Phase B and the custom-shape adapters from Phase C into a single pure function that takes the original PDF bytes plus the database annotations for the document and returns a new PDF blob with native annotations applied. The bake step is on-demand only — runs at print, export, or download — and never writes to the database. No existing user data is migrated; every existing document gets a freshly-baked PDF the first time someone exports it.

### Acceptance (Given/When/Then)
- **Given** a document with annotations stored in the database, **when** the bake pipeline is invoked with the original PDF and the annotation set, **then** it returns a PDF blob in under 1 second for the largest test document with native annotations applied at correct coordinates.
- **Given** the bake pipeline runs against a 99-page document with 200+ annotations, **when** the resulting PDF is opened in Adobe Acrobat, **then** every annotation is present, editable, and visually faithful.
- **Given** any failure inside the bake pipeline (adapter exception, unknown annotation type, malformed source PDF), **when** the failure is caught, **then** the system silently falls back to today's rasterized print path and surfaces a non-blocking warning for support.
- **Given** the bake pipeline runs twice on the same input, **when** the outputs are compared, **then** they are byte-equivalent (deterministic).

### DO NOT CHANGE (Phase D scope)
- The Supabase database schema and write paths — the bake pipeline is read-only against today's annotation tables.
- Adapter files (Phase B) and custom-shape adapters (Phase C) — read-only.
- Today's edit pipeline — unchanged.

### Tasks (outline)
- D.1 — `bakePipeline.js` core: read original PDF bytes via pdf-lib, walk annotations by page, dispatch to adapter registry, return new PDF blob.
- D.2 — Fallback wrapper: any adapter exception or unknown type triggers fallback to today's raster path and logs a warning.
- D.3 — Determinism test: bake the same input twice, byte-compare.
- D.4 — Performance harness: bake the largest test document, assert under 1 second on the test machine.

Detailed step-by-step tasks for each land after Phase B reconciliation.

---

## Phase E: Print and Export Rewrite

### Goal
Replace the per-page rasterization print path with a hand-the-PDF-blob-to-iframe path. The PDF already contains all annotations natively — printing is just printing the file.

### Acceptance (Given/When/Then)
- **Given** a 99-page document with 200+ annotations migrated under Phase D, **when** the user presses `Cmd/Ctrl+P`, **then** the OS print dialog appears in under 1 second.
- **Given** the same setup, **when** the user picks "Save as PDF", **then** the saved PDF contains all annotations natively and round-trips with Adobe Acrobat.
- **Given** the custom Print Panel is re-enabled, **when** the user opens it, **then** every option (paper size, orientation, scope, copies, mirror, rotate, color) works on top of the new instant pipeline.

### DO NOT CHANGE (Phase E scope)
- Adapters and bake pipeline (Phases B, C, D) — read-only.
- The print pipeline is the only path that runs the bake step; falls back to the existing per-page raster path when the flag is OFF or the bake fails.

### Tasks (outline)
- E.1 — `printPipeline.js`: invoke bake pipeline → blob URL → iframe → `print()`. With sub-1-second latency assertion (Playwright timing harness).
- E.2 — Wire the same path for download and export buttons, so both produce baked PDFs.
- E.3 — Re-enable `PRINT_PANEL_ENABLED` flag in `src/App.jsx`. Verify the panel's existing scope/paper-size/orientation flows still work on top of the new pipeline.
- E.4 — Remove the "Print with Markup" menu item — single Cmd+P now covers it.
- E.5 — Update `electron-main.js` if the menu accelerator routing needs a tweak.

Detailed tasks land after Phase D reconciliation.

---

## Phase F: UAT + Beta Rollout

### Goal
Run the full UAT script at 50% / 100% / 200% zoom for every annotation tool. Roll the flag out to a beta cohort. Soak for 1 week. Watch telemetry. Iterate.

### Acceptance (Given/When/Then)
- **Given** the UAT script is run, **when** every tool is exercised at every zoom level, **then** in-app behavior is identical to today and exported PDFs are visually faithful (within documented constraints).
- **Given** beta rollout, **when** a 1-week soak window completes, **then** zero data-loss reports, p95 print latency under 1 second, and bake-pipeline success rate over 99.5%.

### DO NOT CHANGE (Phase F scope)
- All preceding-phase files — Phase F is verification + observation, not implementation.

### Tasks (outline)
- F.1 — UAT script execution + checklist update.
- F.2 — Beta cohort flag rollout (per-user override via Supabase `pdfNativeExportBeta` flag).
- F.3 — Telemetry dashboard: print latency, bake-pipeline success/failure, adapter errors per type.
- F.4 — 1-week soak window. Daily review.

---

## Phase G: Cleanup + GA

### Goal
Remove the feature flag once the new bake pipeline is the default for everyone. Update documentation. Cut v3.0. Today's edit, render, and database paths remain — they are the source of truth and are not being replaced.

### Acceptance (Given/When/Then)
- **Given** the GA cut, **when** any code path is exercised, **then** no `featureFlag.js` reads remain and the bake pipeline runs unconditionally for print/export/download.
- **Given** the GA cut, **when** the codebase is reviewed, **then** today's edit pipeline (Fabric editing, Supabase persistence, SVG render, multi-device sync) is byte-identical to before — only the print/export/download path has changed.
- **Given** the GA cut, **when** `npm test` is run, **then** all tests pass.
- **Given** the v3.0 milestone, **when** all sub-phases land, **then** RECONCILIATION.md exists for every phase.

### DO NOT CHANGE (Phase G scope)
- Today's edit, render, and database paths — they remain canonical.
- `SVGAnnotationLayer.jsx`, `FabricDrawingCanvas`, `FabricEditCanvas`, `FabricEraserCanvas`, `PageAnnotationLayer.jsx` — all preserved.

### Tasks (outline)
- G.1 — Remove flag reads; bake pipeline becomes the default for print/export/download.
- G.2 — Update `CLAUDE.md` to document the bake-on-export behavior.
- G.3 — Final RECONCILIATION.md per phase.
- G.4 — Tag v3.0 release.

---

## Risks Register

| Risk | Likelihood | Impact | Mitigation Phase |
|------|------------|--------|------------------|
| Adobe's appearance-stream rendering differs subtly from our SVG renderer (visual regression in exported PDF) | High | Medium | Phase B includes visual-diff fixtures + tolerance assertions; in-app rendering is unchanged so this only affects exported files |
| Existing user data has edge cases not covered by adapters | Medium | High | Phase A.5 fixture extraction pulls 50 examples per type from production database; adapter tests run against those |
| Counter chain semantics break after Acrobat round-trip | Low | Low | Sidecar metadata + idempotent re-attach; counter chain semantics never expected outside our app |
| Bake step exceeds 1s on extreme documents | Medium | Medium | Phase D.4 perf harness; chunked-by-page baking; user sees a brief spinner during print/export |
| Variable pen width fidelity in non-Adobe readers (Apple Preview) | Medium | Low | Appearance stream regenerated to preserve the visual; if a reader ignores it, the stroke renders as uniform width (spec-correct) |

---

## Out of Scope (deferred to future milestones)

- New annotation tool types (measurement, signature flow rebuild, redaction)
- Multi-user real-time collaboration on annotations (database-as-source-of-truth keeps the door open, but live presence/cursors are a separate piece of work)
- Inbound import of native PDF annotations (e.g., a user marks up a PDF in Acrobat, then re-uploads — those marks would not appear in our app under this milestone). Outbound bake only.
- Combined-tools v2.3 callout polish (Phases 16–18 in the v2.3 roadmap) — finish those on the existing edit pipeline first, then update the callout adapter in Phase C
- Mobile / iPad annotation UX
- Annotation history / undo of arbitrary depth (current behavior preserved)

---

## Open Questions for Next Session

1. **v2.3 sequencing** — finish the v2.3 callout polish phases first, or freeze them and ship the bake pipeline now? Trade-off: polish-first means more callout logic to wire into the adapter; freeze-now means the exported callout may need follow-up polish.
2. **Beta cohort selection** — opt-in via a setting, or auto-roll to a percentage?
3. **Inbound round-trip** — when a user uploads a PDF that already contains native annotations (e.g., marked up in Adobe), do we read those marks into our database, or ignore them? Out of scope for this milestone, but worth deciding the longer-term answer.

---

## Plan Status

- [ ] Phase A — Foundations (DETAILED in this plan)
- [ ] Phase B — Type adapters (FRAMEWORK in this plan; per-adapter tasks land after A.5)
- [ ] Phase C — Custom shape adapters (OUTLINE in this plan; tasks land after B reconciliation)
- [ ] Phase D — Bake pipeline (OUTLINE; tasks land after B reconciliation)
- [ ] Phase E — Print pipeline (OUTLINE; tasks land after D reconciliation)
- [ ] Phase F — UAT + beta (OUTLINE; tasks land after E reconciliation)
- [ ] Phase G — Cleanup + GA (OUTLINE; tasks land after F reconciliation)

**Why detail-then-outline:** each phase's concrete tasks depend on what's learned from the prior phase. Front-loading speculative TDD steps for Phases C–G would produce drift the moment Phase A or B surfaces a surprise. Phase A is detailed because it's pure foundation. Phase B is framed because the per-type tasks need real production fixtures (extracted in A.5). Phases C–G outline + acceptance criteria are the contract; their detailed steps are written when their predecessor lands.

---

*Plan written 2026-04-25 using the superpowers:writing-plans skill. Revised 2026-04-25 to flip framing from "PDF as source of truth" to "database stays source of truth, bake at export." Reviewed against `.planning/research/PDF-NATIVE-ANNOTATIONS-PLAN.md`. Ready for execution — start with Task A.1.*
