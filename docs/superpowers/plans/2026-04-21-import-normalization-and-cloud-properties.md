# Import Normalization + Cloud Properties Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Each Chunk can be executed and committed independently.

**Goal:** Normalize every imported PDF annotation (Ink, FreeText callouts, Line, Arrow) into the app's native Fabric.js object model so imports behave identically to internally-drawn annotations; fix the cloud rectangle Properties-panel crash and add three independent cloud controls to the panel — stroke color, stroke width, and bump intensity — for both rectangle and polygon clouds; add a curve-export path that writes a tessellated `/PolyLine` with hidden private-data control points so our app can round-trip curves losslessly.

**Cloud controls decision (2026-04-21):** Stroke thickness and bump intensity are **independent** controls. Research across Bluebeam Revu, Adobe Acrobat, PSPDFKit/Apryse, Foxit, and the ISO 32000-1 PDF spec (`/BE /I` intensity is explicitly orthogonal to `/W` border width) all treat them as orthogonal. AIA/architectural drafting convention expects bump size to match drawing scale, not line weight. Do NOT couple them.

**Architecture:** Industry-standard "normalize on import, rebuild on export." Imported annotations are converted to the same shape objects the app would produce if the user drew them (no `strokeUniform: true` mismatch, no imported-vs-native branching in edit code paths). The `isPdfImported` flag survives as metadata only — it never gates behavior. Curves export as polylines with dense tessellation plus a namespaced private dict that our importer prefers over the polyline on re-open.

**Tech Stack:** React 18, Fabric.js 5.5.2, pdf-lib 1.17.1, pdfjs-dist 3.11.174, Node built-in test runner (`node --test`), Playwright (debug scenarios only).

**Test runner commands:**
- Full suite: `npm test`
- Single file: `node --test tests/pdfAnnotationImporter.test.mjs`
- Single test by name: `node --test --test-name-pattern="callout import normalizes to native" tests/pdfAnnotationImporter.test.mjs`

**Reference PDF for manual verification:** `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf` (mixed Adobe + Drawboard save — contains cloud rects, pen strokes, callouts, lines).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/utils/pdfAnnotationImporter.js` | Convert PDF annotations into native Fabric objects — must produce objects indistinguishable from internally-drawn ones | Modify — normalization changes in per-type converters |
| `src/utils/nativeShapeFactory.js` | NEW — single source of truth for native object property defaults (stroke, fill, strokeUniform, etc.) per shape type; consumed by both importer and drawing components | Create |
| `src/components/FabricDrawingCanvas.jsx` | Internal pen-stroke creation | Modify only if default-drift is found; ideally delegate to nativeShapeFactory |
| `src/components/AnnotationPropertiesPanel.jsx` | Properties dialog — rectangle branch must tolerate cloud metadata and expose cloud controls | Modify |
| `src/utils/svgAnnotationRenderers.jsx` | SVG renderer; drop any `isPdfImported` branches once normalization is in place | Modify |
| `src/utils/geometryEraser.js` | Boolean eraser — centerline split fallback (Chunk 6, contingent) | Modify if Chunk 6 activates |
| `src/utils/pdfAnnotationsPdfLib.js` | Existing PDF save path using pdf-lib low-level API (`savePDFWithAnnotationsPdfLib`, `createLineAnnotation`, etc.). Add private-data curve-metadata emitter to the Line path for curved lines/arrows. | Modify |
| `src/utils/curveCodec.js` | NEW — serialize/deserialize curve control points to a namespaced private dict; provide pure tessellation helper | Create |
| `src/utils/pdfAnnotationImporter.js` | Importer (PDF.js → Fabric) — already listed above for normalization; additionally must decode the `SurveyBetaSafe` private dict when present on an incoming PolyLine and rebuild the native curved line state | Modify |
| `tests/pdfAnnotationImporter.test.mjs` | Existing; extend with normalization invariants | Modify |
| `tests/pdfAnnotationNormalization.test.mjs` | NEW — per-type invariants: imported object field-equality with native-drawn equivalents | Create |
| `tests/curveRoundTrip.test.mjs` | NEW — curve export → re-import fidelity | Create |
| `tests/propertiesPanelCloud.test.mjs` | NEW — panel resolver does not crash on cloud rect/polygon; stroke width affects hump params | Create |

---

## Cross-Chunk Invariants (never violate)

1. `isPdfImported: true` must never gate behavior at edit time — it is metadata only. All renderer/eraser/properties-panel code paths must take the same path for imported and native objects.
2. Single-name font rule (2026-04-08 gotcha in `CLAUDE.md`): Fabric Textbox `fontFamily` must always be a single-name standard PDF font (e.g. `"Helvetica"`), never a CSS fallback stack.
3. Container-aware sizing rule (2026-03-22 gotcha in `CLAUDE.md`): canvas sizing must use `containerEl.offsetWidth / pageSize.width`, not `pageSize.width * scale`.
4. `zoomGeneration` signal contract (CRITICAL — DO NOT BREAK in `CLAUDE.md`): never remove or rename.
5. DO NOT CHANGE list from project `CLAUDE.md`: never modify `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/SVGAnnotationLayer.jsx` (except where explicitly scoped in a task below), or `package.json`/`vite.config.js` without explicit user approval.

---

## Chunk 1: Properties-Panel Crash Fix + Unified Border-Style Picker

**Scope (expanded 2026-04-21 mid-execution):** Fix the crash on right-click → Properties for THREE shape types that currently crash: imported cloud rectangles, imported polygons (with or without cloud border), and imported polylines. Add a unified "border style" picker with three options: **solid**, **dashed**, **cloud**. Cloud shows an additional bump-size stepper (intensity 1–4) that only appears when cloud is selected. Stroke color and stroke width are always visible. All four controls are independent.

**Border-style picker behavior:**
- **Closed shapes (rectangle, polygon):** picker shows all three options — solid, dashed, cloud.
- **Open shapes (polyline, line):** picker shows two options — solid, dashed. Cloud is not applicable per ISO 32000-1 `/BE` (cloudy border is defined only for closed shapes).
- Switching to solid clears any dash array and cloud metadata.
- Switching to dashed sets a Fabric `strokeDashArray` default of `[6, 4]` and clears cloud metadata.
- Switching to cloud clears any dash array and sets `data.pdfCloudIntensity = 2` if not already set.

**Decision (2026-04-21):** Stroke width, bump intensity, and border style are all orthogonal. Do not couple them. Rationale: Bluebeam Revu, Adobe Acrobat, PSPDFKit/Apryse, Foxit, ISO 32000-1 `/BE` spec, and AIA/architectural drafting convention all treat them as independent. Other patterns (dot-dash, dotted, double) are deferred — easy to add later since the picker is extensible.

**Decision (2026-04-21):** New polygon/polyline DRAWING tools are out of scope for this chunk. Only the properties-panel path is affected here. Drawing tools are tracked as a future project.

**Why this chunk is first:** Three user-reported crashes are resolved in one pass, and the properties panel gains a feature that applies to both internally-drawn and imported shapes. Fully independent of the normalization work in later chunks.

### Task 1.1: Extract shape resolver with unified border-style classification

**Files:**
- Create: `tests/propertiesPanelShape.test.mjs` (supersedes the earlier `propertiesPanelCloud.test.mjs` name — broader scope, broader file name)
- Create: `src/components/propertiesPanelShape.js` — NEW plain-JS helper module holding the pure resolver (must be plain `.js`, not `.jsx`, so `node --test` can import it directly without a JSX loader hook — see 2026-04-21 session-moments INSIGHT)
- Modify: `src/components/AnnotationPropertiesPanel.jsx` — ADD ONE IMPORT LINE for the helper. Do NOT modify the existing `targetKind` useMemo in this task; the resolver is purely additive here and will be consumed in Task 1.2.

**Return shape:** `{ kind, strokeColor, strokeWidth, borderStyle, cloudIntensity? }` where:
- `kind` = `'rect' | 'polygon' | 'polyline' | 'line' | 'ellipse' | 'triangle' | 'path' | 'text' | 'unknown'`
- `borderStyle` = `'solid' | 'dashed' | 'cloud'` — derived from annotation metadata (see classifier rules below)
- `cloudIntensity` present only when `borderStyle === 'cloud'`

**Classifier rules:**
- `data.pdfCloudIntensity != null` on a rect or polygon → `borderStyle: 'cloud'`, `cloudIntensity: <int>`.
- Non-cloud shape with `strokeDashArray` that is a non-empty array → `borderStyle: 'dashed'`.
- Otherwise → `borderStyle: 'solid'`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/propertiesPanelShape.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePropertiesPanelShape } from '../src/components/propertiesPanelShape.js';

test('plain rect resolves to kind=rect, borderStyle=solid', () => {
  const r = resolvePropertiesPanelShape({ type: 'rect', stroke: '#000', strokeWidth: 1, data: {} });
  assert.equal(r.kind, 'rect');
  assert.equal(r.borderStyle, 'solid');
  assert.equal(r.cloudIntensity, undefined);
});

test('plain polygon resolves to kind=polygon, borderStyle=solid (no crash on missing cloud metadata)', () => {
  const p = resolvePropertiesPanelShape({
    type: 'polygon', stroke: '#000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    data: {}
  });
  assert.equal(p.kind, 'polygon');
  assert.equal(p.borderStyle, 'solid');
});

test('plain polyline resolves to kind=polyline, borderStyle=solid (no crash on missing cloud metadata)', () => {
  const pl = resolvePropertiesPanelShape({
    type: 'polyline', stroke: '#000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    data: {}
  });
  assert.equal(pl.kind, 'polyline');
  assert.equal(pl.borderStyle, 'solid');
});

test('cloud rectangle resolves to kind=rect, borderStyle=cloud, cloudIntensity preserved', () => {
  const cr = resolvePropertiesPanelShape({
    type: 'rect', stroke: '#ff0000', strokeWidth: 2,
    data: { pdfCloudIntensity: 2 }
  });
  assert.equal(cr.kind, 'rect');
  assert.equal(cr.borderStyle, 'cloud');
  assert.equal(cr.cloudIntensity, 2);
});

test('cloud polygon resolves to kind=polygon, borderStyle=cloud', () => {
  const cp = resolvePropertiesPanelShape({
    type: 'polygon', stroke: '#000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    data: { pdfCloudIntensity: 3 }
  });
  assert.equal(cp.kind, 'polygon');
  assert.equal(cp.borderStyle, 'cloud');
  assert.equal(cp.cloudIntensity, 3);
});

test('dashed rect (strokeDashArray non-empty) resolves to borderStyle=dashed', () => {
  const dr = resolvePropertiesPanelShape({
    type: 'rect', stroke: '#000', strokeWidth: 1,
    strokeDashArray: [6, 4],
    data: {}
  });
  assert.equal(dr.kind, 'rect');
  assert.equal(dr.borderStyle, 'dashed');
});

test('line resolves to kind=line, borderStyle=solid when no dash array', () => {
  const ln = resolvePropertiesPanelShape({ type: 'line', stroke: '#000', strokeWidth: 1, data: {} });
  assert.equal(ln.kind, 'line');
  assert.equal(ln.borderStyle, 'solid');
});

test('null/undefined annotation returns kind=unknown', () => {
  assert.equal(resolvePropertiesPanelShape(null).kind, 'unknown');
  assert.equal(resolvePropertiesPanelShape(undefined).kind, 'unknown');
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `node --test tests/propertiesPanelShape.test.mjs`
Expected: FAIL — `resolvePropertiesPanelShape` is not exported.

- [ ] **Step 3: Create the pure helper module**

Create `src/components/propertiesPanelShape.js` (NEW plain-JS file). Contents:

```javascript
/**
 * Pure shape resolver for the properties panel.
 * Returns { kind, strokeColor, strokeWidth, borderStyle, cloudIntensity? }
 * where `kind` is the RAW annotation.type (not normalized). The React
 * component continues to compute its own normalized `targetKind` for
 * render branching — this helper only contributes borderStyle + cloud
 * intensity detection, which Task 1.2 will consume alongside targetKind.
 *
 * Lives in a plain .js file so node --test can import it without a
 * JSX loader — the panel itself (.jsx) re-imports from here.
 */
export function resolvePropertiesPanelShape(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    return { kind: 'unknown' };
  }
  const data = annotation.data || {};
  const strokeColor = annotation.stroke ?? '#000000';
  const strokeWidth = annotation.strokeWidth ?? 1;
  const type = annotation.type;

  // Border style derivation — the three supported options:
  //   cloud   : data.pdfCloudIntensity is present (imported from /BE /S /C or set via the panel)
  //   dashed  : strokeDashArray is a non-empty array (imported from /BS /D or set via the panel)
  //   solid   : neither of the above
  // See ISO 32000-1 §12.5.4 for /BE (border effect) and /BS (border style) semantics.
  let borderStyle = 'solid';
  let cloudIntensity;
  if ((type === 'rect' || type === 'polygon') && data.pdfCloudIntensity != null) {
    borderStyle = 'cloud';
    cloudIntensity = data.pdfCloudIntensity;
  } else if (Array.isArray(annotation.strokeDashArray) && annotation.strokeDashArray.length > 0) {
    borderStyle = 'dashed';
  }

  // `kind` here is the RAW annotation.type — callers that need normalized
  // type (e.g. circle→ellipse, textbox/text/i-text→text, arrow detection)
  // must continue to use the panel component's existing targetKind useMemo.
  const kind = typeof type === 'string' ? type : 'unknown';

  return cloudIntensity != null
    ? { kind, strokeColor, strokeWidth, borderStyle, cloudIntensity }
    : { kind, strokeColor, strokeWidth, borderStyle };
}
```

Then add one import line near the top of `src/components/AnnotationPropertiesPanel.jsx`:

```javascript
import { resolvePropertiesPanelShape } from './propertiesPanelShape';
```

Do NOT modify the existing `targetKind` useMemo. Do NOT otherwise modify the panel in this task — the panel will consume the resolver's `borderStyle` output in Task 1.2 as a separate render input, alongside the existing normalized `targetKind`.

Update the test file `tests/propertiesPanelShape.test.mjs` import path from `'../src/components/AnnotationPropertiesPanel.jsx'` (what Step 1 showed) to `'../src/components/propertiesPanelShape.js'`. All 8 test assertions stay the same.

- [ ] **Step 4: Run test to confirm it passes**

Run: `node --test tests/propertiesPanelShape.test.mjs`
Expected: PASS — all eight tests green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: no NEW failures. (The two pre-existing failures in `pdfAnnotationImporter.test.mjs` around imported line/callout metadata predate this task and are tracked to be fixed in Chunks 2–4.)

- [ ] **Step 6: Commit**

```bash
git add tests/propertiesPanelShape.test.mjs src/components/propertiesPanelShape.js src/components/AnnotationPropertiesPanel.jsx
git commit -m "refactor: extract propertiesPanelShape resolver as pure .js helper (unified borderStyle)"
```

### Task 1.2: Render the cloud controls branch in the panel body

**Files:**
- Modify: `src/components/AnnotationPropertiesPanel.jsx` — add `renderCloudBody()` branch

- [ ] **Step 1: Write the failing test**

Append to `tests/propertiesPanelCloud.test.mjs`:

```javascript
import { renderTestable } from '../src/components/AnnotationPropertiesPanel.jsx';

test('renderTestable returns a cloud-specific body description for cloud rects', () => {
  const body = renderTestable({
    type: 'rect',
    stroke: '#ff0000',
    strokeWidth: 2,
    data: { pdfCloudIntensity: 2 }
  });
  assert.ok(body.sections.some(s => s.id === 'stroke-color'), 'has stroke-color section');
  assert.ok(body.sections.some(s => s.id === 'stroke-width'), 'has stroke-width section');
  assert.equal(body.kind, 'cloud-rect');
});
```

Run: `node --test tests/propertiesPanelCloud.test.mjs` — expect FAIL (`renderTestable` not exported).

- [ ] **Step 2: Add a test-only `renderTestable` export that returns the body structure symbolically**

```javascript
// src/components/AnnotationPropertiesPanel.jsx
export function renderTestable(annotation) {
  const resolved = resolvePropertiesPanelShape(annotation);
  if (resolved.kind === 'cloud-rect' || resolved.kind === 'cloud-polygon') {
    return {
      kind: resolved.kind,
      sections: [
        { id: 'stroke-color', value: resolved.strokeColor },
        { id: 'stroke-width', value: resolved.strokeWidth }
      ]
    };
  }
  return { kind: resolved.kind, sections: [] };
}
```

- [ ] **Step 3: Render the real JSX branch**

Inside the existing renderBody switch (near line 335 where rect handling lives), add an early branch:

```jsx
if (resolved.kind === 'cloud-rect' || resolved.kind === 'cloud-polygon') {
  return (
    <>
      {renderStrokeColorRow(resolved.strokeColor, handleStrokeColorChange)}
      {renderStepperRow({
        label: 'Width',
        value: resolved.strokeWidth,
        onDelta: handleStrokeWidthDelta,
        min: 1,
        max: 40
      })}
    </>
  );
}
```

Make sure `handleStrokeColorChange` already exists and calls `onUpdate({ stroke: nextColor })`. If it doesn't, add it — match the existing rect branch pattern verbatim.

- [ ] **Step 4: Run tests**

Run: `node --test tests/propertiesPanelCloud.test.mjs`
Expected: PASS all four tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/AnnotationPropertiesPanel.jsx tests/propertiesPanelCloud.test.mjs
git commit -m "feat: render stroke color + width controls for cloud rect and polygon in properties panel"
```

### Task 1.3: Add independent bump-intensity stepper to the cloud panel

**Scope:** Add a third control to the cloud-rect / cloud-polygon properties panel — a stepper labeled "Bump Size" bound to `data.pdfCloudIntensity`. **Independent of stroke width.** Reuses the existing `buildCloudPathCommands(points, intensity)` signature — do NOT extend it with a `strokeWidth` option.

**UX intent:** Matches Bluebeam Revu's "Style" (Loose / Medium / Tight), Foxit's "Cloudy Border" intensity, PSPDFKit's `cloudyBorderIntensity`, and the ISO 32000-1 `/BE /I` field. Range 1–4, integer. Default 2.

**Files:**
- Modify: `src/components/AnnotationPropertiesPanel.jsx` — extend `renderTestable` + add the JSX stepper + a `handleCloudIntensityDelta` handler
- Modify: `src/utils/svgAnnotationRenderers.jsx` — ensure the two `buildCloudPathCommands(...)` call sites pick up `obj.data.pdfCloudIntensity` on every re-render (already the case; this is a regression guard step)

- [ ] **Step 1: Write the failing test**

Append to `tests/propertiesPanelCloud.test.mjs`:

```javascript
test('renderTestable includes a bump-size section for cloud rects with the current intensity', () => {
  const body = renderTestable({
    type: 'rect',
    stroke: '#ff0000',
    strokeWidth: 2,
    data: { pdfCloudIntensity: 2 }
  });
  const bump = body.sections.find(s => s.id === 'bump-size');
  assert.ok(bump, 'bump-size section is present');
  assert.equal(bump.value, 2);
  // Bump section exists alongside stroke-color and stroke-width — all three are independent
  assert.equal(body.sections.length, 3);
});

test('renderTestable includes a bump-size section for cloud polygons', () => {
  const body = renderTestable({
    type: 'polygon',
    stroke: '#000',
    strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    data: { pdfCloudIntensity: 3 }
  });
  const bump = body.sections.find(s => s.id === 'bump-size');
  assert.equal(bump.value, 3);
});
```

Run: `node --test tests/propertiesPanelCloud.test.mjs` — expect FAIL (section missing).

- [ ] **Step 2: Extend `renderTestable` to include bump-size**

```javascript
// src/components/AnnotationPropertiesPanel.jsx
export function renderTestable(annotation) {
  const resolved = resolvePropertiesPanelShape(annotation);
  if (resolved.kind === 'cloud-rect' || resolved.kind === 'cloud-polygon') {
    return {
      kind: resolved.kind,
      sections: [
        { id: 'stroke-color', value: resolved.strokeColor },
        { id: 'stroke-width', value: resolved.strokeWidth },
        { id: 'bump-size', value: resolved.cloudIntensity }
      ]
    };
  }
  return { kind: resolved.kind, sections: [] };
}
```

- [ ] **Step 3: Add the real JSX stepper + handler**

In `src/components/AnnotationPropertiesPanel.jsx`, inside the existing cloud-rect / cloud-polygon render branch from Task 1.2, add a third stepper row. Ensure `handleCloudIntensityDelta` writes the new value into `data.pdfCloudIntensity`:

```jsx
if (resolved.kind === 'cloud-rect' || resolved.kind === 'cloud-polygon') {
  return (
    <>
      {renderStrokeColorRow(resolved.strokeColor, handleStrokeColorChange)}
      {renderStepperRow({
        label: 'Width',
        value: resolved.strokeWidth,
        onDelta: handleStrokeWidthDelta,
        min: 1,
        max: 40
      })}
      {/* UX intent: bump size is independent of stroke width — matches Bluebeam/Acrobat/Foxit convention;
          range 1–4 matches ISO 32000-1 /BE /I. */}
      {renderStepperRow({
        label: 'Bump Size',
        value: resolved.cloudIntensity ?? 2,
        onDelta: handleCloudIntensityDelta,
        min: 1,
        max: 4
      })}
    </>
  );
}
```

Handler implementation:

```javascript
const handleCloudIntensityDelta = (delta) => {
  const current = annotation?.data?.pdfCloudIntensity ?? 2;
  const next = Math.max(1, Math.min(4, current + delta));
  onUpdate({ data: { ...(annotation.data ?? {}), pdfCloudIntensity: next } });
};
```

Match the existing stepper-row pattern in the rect branch verbatim for visual consistency.

- [ ] **Step 4: Regression guard for renderer call sites**

In `src/utils/svgAnnotationRenderers.jsx`, find the two `buildCloudPathCommands(` call sites (one in `renderRect` cloud branch, one in `renderPolygon`). Confirm each call reads `obj.data.pdfCloudIntensity` as the intensity argument. Do NOT introduce a `strokeWidth` options argument. If the current call sites pass anything other than `obj.data.pdfCloudIntensity`, fix them so an intensity change in the panel causes an immediate re-render of the path commands.

- [ ] **Step 5: Run tests**

Run: `node --test tests/propertiesPanelCloud.test.mjs` — expect PASS (all cloud tests).
Run: `npm test` — expect green.

- [ ] **Step 6: Commit**

```bash
git add src/components/AnnotationPropertiesPanel.jsx src/utils/svgAnnotationRenderers.jsx tests/propertiesPanelCloud.test.mjs
git commit -m "feat: bump-intensity stepper in cloud properties panel — independent of stroke width"
```

### Task 1.4: Manual browser verification

- [ ] **Step 1: Start dev server**

```bash
cd /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2
npm run dev
```

- [ ] **Step 2: Load the reference PDF**

Open the app, load `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`. Navigate to page 1 (the page with the cloud rectangle).

- [ ] **Step 3: Verify the crash is gone**

Right-click the cloud rectangle → click Properties. The panel should open without the app crashing. Confirm stroke color swatch is visible. Confirm width stepper is visible.

- [ ] **Step 4: Verify the two controls are independent**

In the Width stepper, press `+` to raise stroke width to 10. Confirm the line visibly thickens — but the number and size of humps stays the same. Press `-` back to 1. Then in the Bump Size stepper, press `+` to raise to 4. Confirm the humps get bigger/fewer — but the line thickness stays the same. Press `-` back to 2. This confirms the two controls do not influence each other (Bluebeam/Acrobat/Foxit convention).

- [ ] **Step 5: Verify polygon clouds behave the same**

If the reference PDF has a cloud polygon, repeat steps 3-4 on it. If not, use a Drawboard or Bluebeam-saved PDF with a polygon cloud.

- [ ] **Step 6: Commit (no code change, marker commit)**

```bash
git commit --allow-empty -m "verify: cloud properties panel manual test passed on reference PDF"
```

---

## Chunk 2: Ink Normalization (Imported Pen Stroke → Native Pen Stroke)

**Scope:** Make imported Ink annotations indistinguishable from internally-drawn pen strokes at edit time. This fixes the pen-gap-at-zoom bug and the eraser-thickens-imported-strokes bug simultaneously, because both were rooted in the imported/native property mismatch.

**Root cause evidence from research agent (documented in previous session):**
- Imported Ink sets `strokeUniform: true` → SVG renderer applies `vectorEffect="non-scaling-stroke"` at all zooms.
- Internal pen strokes leave `strokeUniform` undefined → no `vectorEffect` applied.
- At 200% zoom, the mismatch produces a visible hairline-split on imports only.

### Task 2.1: Establish the invariant as an executable test

**Files:**
- Create: `tests/pdfAnnotationNormalization.test.mjs`
- Create: `src/utils/nativeShapeFactory.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pdfAnnotationNormalization.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { convertInkToFabricPath } from '../src/utils/pdfAnnotationImporter.js';
import { makeInternalPenPathSpec } from '../src/utils/nativeShapeFactory.js';

const inkAnnotation = {
  subtype: 'Ink',
  inkList: [[10, 10, 20, 20, 30, 15]],
  color: [0, 0, 0],
  borderWidth: 2,
  rect: [0, 0, 100, 100]
};

const viewport = {
  height: 100,
  convertToViewportPoint: (x, y) => [x, 100 - y]
};

test('imported Ink has the same core Fabric properties as an internal pen stroke', () => {
  const imported = convertInkToFabricPath(inkAnnotation, viewport, { scale: 1 });
  const internal = makeInternalPenPathSpec({
    stroke: imported.stroke,
    strokeWidth: imported.strokeWidth
  });

  const sharedKeys = ['type', 'fill', 'strokeUniform', 'strokeLineCap', 'strokeLineJoin'];
  for (const key of sharedKeys) {
    assert.equal(
      imported[key],
      internal[key],
      `mismatch on ${key}: imported=${JSON.stringify(imported[key])}, internal=${JSON.stringify(internal[key])}`
    );
  }
});

test('imported Ink preserves isPdfImported flag as metadata-only', () => {
  const imported = convertInkToFabricPath(inkAnnotation, viewport, { scale: 1 });
  assert.equal(imported.isPdfImported, true);
  assert.equal(imported.pdfAnnotationType, 'Ink');
});
```

Run: `node --test tests/pdfAnnotationNormalization.test.mjs` — FAIL (module not found).

- [ ] **Step 2: Create `nativeShapeFactory.js`**

```javascript
// src/utils/nativeShapeFactory.js
// Single source of truth for native Fabric object defaults per shape type.
// Any import converter and any drawing component must produce objects
// that match these specs field-for-field (excluding provenance fields).

export function makeInternalPenPathSpec({ stroke = '#000000', strokeWidth = 1 } = {}) {
  return {
    type: 'path',
    stroke,
    strokeWidth,
    fill: null,
    // UX intent: pen strokes scale naturally with zoom — never non-scaling
    strokeUniform: undefined,
    strokeLineCap: 'round',
    strokeLineJoin: 'round'
  };
}
```

- [ ] **Step 3: Update `convertInkToFabricPath`**

In `src/utils/pdfAnnotationImporter.js`, find `convertInkToFabricPath` (around line 1452-1568). Apply these changes:

- Remove `strokeUniform: true` (change to omit or explicitly `undefined`).
- Ensure `fill: null`.
- Ensure `strokeLineCap: 'round'` and `strokeLineJoin: 'round'`.
- Keep `isPdfImported: true`, `pdfAnnotationId`, `pdfAnnotationType: 'Ink'` — these are metadata only and survive for export provenance.

- [ ] **Step 4: Run tests**

Run: `node --test tests/pdfAnnotationNormalization.test.mjs`
Expected: PASS both.

Run: `npm test`
Expected: existing suite still green. If any existing test depended on `strokeUniform: true` for imports, that test was asserting the bug — update it to match the new normalized behavior and document why in the commit.

- [ ] **Step 5: Commit**

```bash
git add tests/pdfAnnotationNormalization.test.mjs src/utils/nativeShapeFactory.js src/utils/pdfAnnotationImporter.js
git commit -m "refactor: normalize imported Ink to match internal pen stroke object shape"
```

### Task 2.2: Drop imported-vs-native branching in the SVG renderer

**Files:**
- Modify: `src/utils/svgAnnotationRenderers.jsx` — remove any `isPdfImported` conditional in ink/path render branches

- [ ] **Step 1: Audit**

```bash
grep -n "isPdfImported\|pdfAnnotationType" src/utils/svgAnnotationRenderers.jsx
```

Record every hit. For each one, assess: is it gating behavior, or is it emitting a provenance attribute (which is fine)? Behavior gates must be removed.

- [ ] **Step 2: Write a regression test**

Append to `tests/pdfAnnotationNormalization.test.mjs`:

```javascript
import { renderPathToSvgAttrs } from '../src/utils/svgAnnotationRenderers.jsx';

test('renderPathToSvgAttrs produces identical attrs for imported and internal paths with same inputs', () => {
  const base = {
    type: 'path',
    path: [['M', 0, 0], ['L', 10, 10]],
    stroke: '#000',
    strokeWidth: 2,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round'
  };
  const imported = { ...base, isPdfImported: true, pdfAnnotationType: 'Ink' };
  const internal = { ...base };

  const a = renderPathToSvgAttrs(imported);
  const b = renderPathToSvgAttrs(internal);

  const behaviorKeys = ['stroke', 'strokeWidth', 'fill', 'vectorEffect', 'strokeLinecap', 'strokeLinejoin', 'opacity'];
  for (const key of behaviorKeys) {
    assert.equal(a[key], b[key], `attr drift on ${key}`);
  }
});
```

Run: FAIL (function not exported yet).

- [ ] **Step 3: Extract `renderPathToSvgAttrs` as a pure function**

In `src/utils/svgAnnotationRenderers.jsx`, find `renderPath` (lines ~118-158). Extract attribute generation into a pure function:

```javascript
export function renderPathToSvgAttrs(obj) {
  return {
    stroke: obj.stroke ?? '#000',
    strokeWidth: obj.strokeWidth ?? 1,
    fill: obj.fill ?? 'none',
    strokeLinecap: obj.strokeLineCap ?? 'round',
    strokeLinejoin: obj.strokeLineJoin ?? 'round',
    vectorEffect: obj.strokeUniform ? 'non-scaling-stroke' : undefined,
    opacity: obj.opacity ?? 1
  };
}
```

Replace the JSX emission with `const attrs = renderPathToSvgAttrs(obj)` and spread `attrs` into `<path>`.

Search for any `if (obj.isPdfImported)` or `if (obj.pdfAnnotationType === 'Ink')` gating visual behavior — delete those branches. Provenance-only attributes (e.g. `data-pdf-imported`) are fine to keep.

- [ ] **Step 4: Run tests**

Run: `node --test tests/pdfAnnotationNormalization.test.mjs`
Expected: PASS all three.

Run: `npm test` — expected green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/svgAnnotationRenderers.jsx tests/pdfAnnotationNormalization.test.mjs
git commit -m "refactor: SVG renderer no longer branches on import provenance for pen/path visual attrs"
```

### Task 2.3: Manual verification — pen stroke gap at 200% zoom

- [ ] **Step 1: Start dev server (if not running)**

```bash
npm run dev
```

- [ ] **Step 2: Reproduce the bug-before-fix baseline (if possible)**

If you still have a pre-fix branch or can `git stash`, open the reference PDF, zoom to 200% on page 2 (pen-stroke page), and visually confirm the gap exists. Then return to the post-fix branch.

- [ ] **Step 3: Verify the fix on the post-normalization branch**

Open `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`. Navigate to the red pen scribble on page 2. Zoom to 200%. Confirm the stroke is now a solid line — no center gap, no hairline split.

- [ ] **Step 4: Draw a fresh internal pen stroke on the same page for A/B parity**

Select the pen tool, draw a test scribble next to the imported one. Zoom to 200%. Confirm both look visually identical in stroke rendering.

- [ ] **Step 5: Commit (marker)**

```bash
git commit --allow-empty -m "verify: imported pen stroke no longer shows zoom gap after Ink normalization"
```

### Task 2.4: Manual verification — eraser on imported ink vs internal ink

- [ ] **Step 1: With both strokes still on the page, test the eraser**

Select the eraser tool. Erase the middle of the imported stroke. Observe the remaining ends — do they visually thicken, or do they read as a clean continuation of the original stroke?

- [ ] **Step 2: Repeat on the internal stroke**

Erase the middle of the internal stroke. Compare: do imported and internal behave identically now?

- [ ] **Step 3: Decide on Chunk 6**

- If both are visually clean: Chunk 6 (universal centerline split) is not needed. Mark it skipped in this plan.
- If both visibly thicken equally: the eraser thickening is universal. Chunk 6 kicks in.
- If imported still thickens more than internal: normalization is incomplete — re-audit field drift before proceeding.

Document the outcome with a brief note in the commit body.

- [ ] **Step 4: Commit (marker)**

```bash
git commit --allow-empty -m "verify: eraser parity test between imported and internal ink — result: <fill in>"
```

---

## Chunk 3: Callout (FreeText) Normalization

**Scope:** Imported FreeText callouts must produce native Fabric objects identical to internally-created callouts. Honors single-name-font rule from `CLAUDE.md` (2026-04-08 gotcha).

### Task 3.1: Audit and spec the native callout shape

**Files:**
- Modify: `src/utils/nativeShapeFactory.js` — add `makeInternalCalloutSpec`
- Create: test section in `tests/pdfAnnotationNormalization.test.mjs`

- [ ] **Step 1: Locate the internal callout creation site**

```bash
grep -rn "new Textbox\|new Fabric.Textbox\|createCallout\|makeCallout" src/components src/utils
```

Record the exact properties set when an internal callout is created. Note fontFamily, fontSize, fill, stroke, strokeWidth, textAlign, padding, originX/originY.

- [ ] **Step 2: Add native spec**

```javascript
// src/utils/nativeShapeFactory.js (append)
export function makeInternalCalloutSpec({
  stroke = '#000000',
  strokeWidth = 1,
  fill = 'transparent',
  fontFamily = 'Helvetica',  // UX intent: single-name font only (2026-04-08 gotcha)
  fontSize = 14,
  text = ''
} = {}) {
  return {
    type: 'textbox',
    stroke,
    strokeWidth,
    fill,
    fontFamily,
    fontSize,
    text,
    textAlign: 'left',
    splitByGrapheme: false,
    editable: true,
    originX: 'left',
    originY: 'top'
  };
}
```

- [ ] **Step 3: Write the failing invariant test**

Append to `tests/pdfAnnotationNormalization.test.mjs`:

```javascript
import { convertFreeTextToFabricTextbox } from '../src/utils/pdfAnnotationImporter.js';
import { makeInternalCalloutSpec } from '../src/utils/nativeShapeFactory.js';

test('imported FreeText callout matches native callout shape', () => {
  const freeText = {
    subtype: 'FreeText',
    rect: [10, 10, 50, 40],
    contents: 'Hello',
    color: [0, 0, 0],
    defaultStyle: { fontFamily: 'Helvetica', fontSize: 14, color: '#000000' }
  };
  const viewport = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };

  const imported = convertFreeTextToFabricTextbox(freeText, viewport, { scale: 1 });
  const internal = makeInternalCalloutSpec({
    fontFamily: imported.fontFamily,
    fontSize: imported.fontSize,
    text: imported.text
  });

  const keys = ['type', 'textAlign', 'splitByGrapheme', 'editable', 'originX', 'originY'];
  for (const k of keys) {
    assert.equal(imported[k], internal[k], `drift on ${k}`);
  }

  // Hard rule: fontFamily must be a single name, never a fallback stack
  assert.ok(!String(imported.fontFamily).includes(','), 'fontFamily must not contain comma');
});
```

Run: expect FAIL.

- [ ] **Step 4: Fix the importer to match**

In `src/utils/pdfAnnotationImporter.js`, find `convertFreeTextToFabricTextbox`. Normalize field-by-field against `makeInternalCalloutSpec`. If fontFamily from the PDF's DA string contains a comma or CSS fallback stack, replace with the first single-name font in the list (e.g. strip at the first comma).

- [ ] **Step 5: Run tests**

Run: `node --test tests/pdfAnnotationNormalization.test.mjs`
Expected: all tests green, including prior Ink ones.

- [ ] **Step 6: Commit**

```bash
git add src/utils/nativeShapeFactory.js src/utils/pdfAnnotationImporter.js tests/pdfAnnotationNormalization.test.mjs
git commit -m "refactor: normalize imported FreeText callouts to native callout shape; enforce single-name font"
```

### Task 3.2: Manual verification — edit imported callout

- [ ] **Step 1: Open the reference PDF**

Navigate to a page containing a callout. Double-click the callout to enter edit mode.

- [ ] **Step 2: Verify editor opens cleanly**

The text editor should open with the text visible and the caret positioned correctly. No cursor drift as characters are typed. Font picker (if present) shows only single-name fonts.

- [ ] **Step 3: Confirm font-picker behavior (if feature exists)**

Change font via the picker. Confirm no cursor drift appears (2026-04-08 gotcha regression guard).

- [ ] **Step 4: Commit (marker)**

```bash
git commit --allow-empty -m "verify: imported callout edits cleanly, no cursor drift, single-name font honored"
```

---

## Chunk 4: Line / Arrow Normalization (Enables Curve-on-Import)

**Scope:** Imported Line and Arrow annotations produce native line/arrow objects that accept the native midpoint curve handle. Import-time they are straight (PDF `/Line` holds only two endpoints), but the user can curve them after import, and the curve persists in app state.

### Task 4.1: Invariant test — imported line matches native line

**Files:**
- Modify: `src/utils/nativeShapeFactory.js` — add `makeInternalLineSpec`
- Extend: `tests/pdfAnnotationNormalization.test.mjs`

- [ ] **Step 1: Locate internal line/arrow creation**

```bash
grep -rn "createLine\|createArrow\|new fabric.Line\|new fabric.Path.*arrow" src/components src/utils
```

Record exact property set.

- [ ] **Step 2: Add native spec**

```javascript
// src/utils/nativeShapeFactory.js (append)
export function makeInternalLineSpec({
  stroke = '#000000',
  strokeWidth = 1,
  x1 = 0, y1 = 0, x2 = 100, y2 = 0,
  arrowHead = false,
  midpointCurveOffset = null  // null = straight; {dx, dy} = offset of curve control from midpoint
} = {}) {
  return {
    type: 'line',  // or whatever the app's internal type identifier is
    stroke,
    strokeWidth,
    fill: null,
    x1, y1, x2, y2,
    arrowHead,
    midpointCurveOffset,
    strokeLineCap: 'round',
    strokeLineJoin: 'round'
  };
}
```

If the app's internal representation uses a `path` with a specific command pattern instead of a `line` type, mirror that instead. The goal is literal field parity.

- [ ] **Step 3: Write the failing test**

```javascript
import { convertLineToFabricLine } from '../src/utils/pdfAnnotationImporter.js';
import { makeInternalLineSpec } from '../src/utils/nativeShapeFactory.js';

test('imported Line matches native line shape and has null midpointCurveOffset', () => {
  const line = {
    subtype: 'Line',
    vertices: [10, 10, 50, 50],
    color: [0, 0, 0],
    borderWidth: 2
  };
  const viewport = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const imported = convertLineToFabricLine(line, viewport, { scale: 1 });
  const internal = makeInternalLineSpec({
    stroke: imported.stroke, strokeWidth: imported.strokeWidth,
    x1: imported.x1, y1: imported.y1, x2: imported.x2, y2: imported.y2
  });
  assert.equal(imported.type, internal.type);
  assert.equal(imported.midpointCurveOffset, null);
  assert.equal(imported.fill, null);
});

test('imported Arrow has arrowHead: true', () => {
  const arrow = {
    subtype: 'Line',
    vertices: [0, 0, 50, 0],
    color: [0, 0, 0],
    borderWidth: 2,
    lineEndings: ['None', 'OpenArrow']
  };
  const viewport = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const imported = convertLineToFabricLine(arrow, viewport, { scale: 1 });
  assert.equal(imported.arrowHead, true);
});
```

Expect FAIL.

- [ ] **Step 4: Fix the importer**

In `src/utils/pdfAnnotationImporter.js`, find `convertLineToFabricLine` (or per-subtype converter). Align fields with `makeInternalLineSpec`. Set `midpointCurveOffset: null` always (PDF `/Line` is straight). Set `arrowHead` based on `/LE` line-ending dict.

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test` — full suite expected green.

- [ ] **Step 6: Commit**

```bash
git add src/utils/nativeShapeFactory.js src/utils/pdfAnnotationImporter.js tests/pdfAnnotationNormalization.test.mjs
git commit -m "refactor: normalize imported Line and Arrow to native shape; null curve offset on import"
```

### Task 4.2: Manual verification — curve an imported line

- [ ] **Step 1: Open the reference PDF; select an imported straight line**

Click it. Verify the midpoint handle appears (if the app's UI exposes one post-select).

- [ ] **Step 2: Drag the midpoint to form a curve**

Confirm the line bends smoothly. No console error.

- [ ] **Step 3: Undo + redo**

Cmd+Z then Cmd+Shift+Z. Confirm the curve state round-trips cleanly.

- [ ] **Step 4: Commit (marker)**

```bash
git commit --allow-empty -m "verify: imported line accepts native midpoint curve"
```

---

## Chunk 5: Curve Export with Hidden Metadata

**Scope:** When a line or arrow has a non-null midpoint curve offset and the user exports the PDF, write a PDF `/PolyLine` with densely tessellated Bezier samples (so other apps see the correct shape) AND embed a namespaced private dict containing the original control points so our app reconstructs the exact curve on re-open.

**Research reference:** `TestLogs/curved-line-export-research.md` (produced 2026-04-21). Pattern follows Bluebeam / Apryse / PSPDFKit.

### Task 5.1: Design and test the curve codec

**Files:**
- Create: `src/utils/curveCodec.js`
- Create: `tests/curveCodec.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/curveCodec.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCurveToPrivateDict, decodeCurveFromPrivateDict, tessellateCurveSamples } from '../src/utils/curveCodec.js';

const CURVE = {
  x1: 0, y1: 0, x2: 100, y2: 0,
  midpointCurveOffset: { dx: 0, dy: -30 }
};

test('encode produces a namespaced dict with version and control points', () => {
  const dict = encodeCurveToPrivateDict(CURVE);
  assert.equal(dict.ns, 'SurveyBetaSafe');
  assert.equal(dict.type, 'curve');
  assert.equal(dict.version, 1);
  assert.deepEqual(dict.endpoints, [[0, 0], [100, 0]]);
  assert.deepEqual(dict.midpointOffset, [0, -30]);
});

test('decode recovers the original curve shape from the dict', () => {
  const dict = encodeCurveToPrivateDict(CURVE);
  const recovered = decodeCurveFromPrivateDict(dict);
  assert.equal(recovered.x1, 0);
  assert.equal(recovered.midpointCurveOffset.dy, -30);
});

test('decode returns null for an unknown namespace or version', () => {
  assert.equal(decodeCurveFromPrivateDict({ ns: 'OtherVendor' }), null);
  assert.equal(decodeCurveFromPrivateDict({ ns: 'SurveyBetaSafe', version: 999 }), null);
});

test('tessellation produces >=16 samples for a bent curve', () => {
  const samples = tessellateCurveSamples(CURVE, { minSamples: 16 });
  assert.ok(samples.length >= 16);
  assert.deepEqual(samples[0], [0, 0]);
  assert.deepEqual(samples[samples.length - 1], [100, 0]);
});

test('tessellation for a straight line yields exactly 2 samples', () => {
  const straight = { ...CURVE, midpointCurveOffset: null };
  const samples = tessellateCurveSamples(straight);
  assert.equal(samples.length, 2);
});
```

Run: `node --test tests/curveCodec.test.mjs` — FAIL.

- [ ] **Step 2: Implement the codec**

```javascript
// src/utils/curveCodec.js
const NS = 'SurveyBetaSafe';
const TYPE = 'curve';
const CURRENT_VERSION = 1;

export function encodeCurveToPrivateDict(curve) {
  return {
    ns: NS,
    type: TYPE,
    version: CURRENT_VERSION,
    endpoints: [[curve.x1, curve.y1], [curve.x2, curve.y2]],
    midpointOffset: curve.midpointCurveOffset
      ? [curve.midpointCurveOffset.dx, curve.midpointCurveOffset.dy]
      : null
  };
}

export function decodeCurveFromPrivateDict(dict) {
  if (!dict || dict.ns !== NS || dict.type !== TYPE) return null;
  if (dict.version !== CURRENT_VERSION) return null;
  const [[x1, y1], [x2, y2]] = dict.endpoints;
  const off = dict.midpointOffset;
  return {
    x1, y1, x2, y2,
    midpointCurveOffset: off ? { dx: off[0], dy: off[1] } : null
  };
}

export function tessellateCurveSamples(curve, { minSamples = 16 } = {}) {
  if (!curve.midpointCurveOffset) {
    return [[curve.x1, curve.y1], [curve.x2, curve.y2]];
  }
  // Quadratic Bezier: midpoint offset defines the control point
  const mx = (curve.x1 + curve.x2) / 2 + curve.midpointCurveOffset.dx;
  const my = (curve.y1 + curve.y2) / 2 + curve.midpointCurveOffset.dy;
  const samples = [];
  for (let i = 0; i < minSamples; i++) {
    const t = i / (minSamples - 1);
    const x = (1 - t) * (1 - t) * curve.x1 + 2 * (1 - t) * t * mx + t * t * curve.x2;
    const y = (1 - t) * (1 - t) * curve.y1 + 2 * (1 - t) * t * my + t * t * curve.y2;
    samples.push([x, y]);
  }
  return samples;
}
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
node --test tests/curveCodec.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/curveCodec.js tests/curveCodec.test.mjs
git commit -m "feat: curve codec — encode/decode control points, tessellate to polyline samples"
```

### Task 5.2: Wire codec into the real export path (pdfAnnotationsPdfLib.js)

**Files:**
- Modify: `src/utils/pdfAnnotationsPdfLib.js` — the real PDF save path. Exports `savePDFWithAnnotationsPdfLib` (line ~394), uses private per-type creators (`createInkAnnotation`, `createLineAnnotation` at line ~310, etc.) that build pdf-lib dictionaries via `pdfDoc.context.obj({ ... })` and register them onto the page's Annots array.

**Background on the real file (verified 2026-04-21):**
- `createLineAnnotation(pdfDoc, page, fabricObj, pageHeight)` currently emits a plain `/Line` subtype with `L: [x1, pageHeight-y1, x2, pageHeight-y2]`, `C: [r,g,b]`, `Border: [0,0,strokeWidth]`, and optional `LE` for arrowheads.
- The dispatcher in `savePDFWithAnnotationsPdfLib` switches on Fabric object type; `case 'line':` routes to `createLineAnnotation`.
- Known pre-existing side-issue (NOT in scope here): objects with `isPdfImported: true` are skipped at save (see the `if (obj.isPdfImported) return;` guard around line 436). This is a duplicate-avoidance heuristic. After Chunk 2 normalization lands, this skip is still correct for unmodified imports (they're already in the PDF's Annots array) but wrong for edited imports. Flagged here as a known gap; fix is out-of-scope for this plan. Document in the post-plan CLAUDE.md update.

**Strategy:** Extract a pure function `buildLineAnnotationDictSpec(fabricObj, pageHeight)` from `createLineAnnotation` that returns a plain JS object describing the annotation dict (Subtype, Vertices/L, C, Border, BS, LE, SurveyBetaSafe). Unit-test that. Then have `createLineAnnotation` consume the spec and register it via `pdfDoc.context.obj(...)` as before.

- [ ] **Step 1: Write the failing round-trip test**

```javascript
// tests/curveRoundTrip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineAnnotationDictSpec,
  parseLineAnnotationDictSpec
} from '../src/utils/pdfAnnotationsPdfLib.js';

const curved = {
  type: 'line',
  x1: 0, y1: 0, x2: 100, y2: 0,
  stroke: '#000000', strokeWidth: 2,
  midpointCurveOffset: { dx: 0, dy: -30 }
};

const PAGE_HEIGHT = 800;

test('curved line export spec is a /PolyLine with tessellated vertices and SurveyBetaSafe dict', () => {
  const spec = buildLineAnnotationDictSpec(curved, PAGE_HEIGHT);
  assert.equal(spec.Subtype, 'PolyLine');
  assert.ok(Array.isArray(spec.Vertices));
  assert.ok(spec.Vertices.length >= 32, 'at least 16 samples × 2 coords');
  assert.ok(spec.SurveyBetaSafe, 'private dict present for lossless re-open');
});

test('straight line export spec is a plain /Line (no tessellation, no private dict)', () => {
  const straight = { ...curved, midpointCurveOffset: null };
  const spec = buildLineAnnotationDictSpec(straight, PAGE_HEIGHT);
  assert.equal(spec.Subtype, 'Line');
  assert.ok(Array.isArray(spec.L));
  assert.equal(spec.L.length, 4);
  assert.equal(spec.SurveyBetaSafe, undefined);
});

test('round-trip: our own curved PolyLine spec parses back into the exact source curve', () => {
  const spec = buildLineAnnotationDictSpec(curved, PAGE_HEIGHT);
  const reImported = parseLineAnnotationDictSpec(spec, PAGE_HEIGHT);
  assert.equal(reImported.type, 'line');
  assert.equal(reImported.midpointCurveOffset.dy, -30);
  assert.equal(reImported.x1, 0);
  assert.equal(reImported.x2, 100);
});

test('third-party PolyLine spec without private dict parses as polyline (not promoted to curve)', () => {
  const foreign = { Subtype: 'PolyLine', Vertices: [0, 0, 50, -30, 100, 0] };
  const reImported = parseLineAnnotationDictSpec(foreign, PAGE_HEIGHT);
  assert.equal(reImported.type, 'polyline');
});
```

Expect FAIL (neither `buildLineAnnotationDictSpec` nor `parseLineAnnotationDictSpec` exist yet).

- [ ] **Step 2: Add the pure spec builder and parser to `pdfAnnotationsPdfLib.js`**

Near the top of the file, import the codec:

```javascript
import {
  encodeCurveToPrivateDict,
  decodeCurveFromPrivateDict,
  tessellateCurveSamples
} from './curveCodec.js';
```

Add two new exports alongside the existing (currently non-exported) per-type creators:

```javascript
// PDF-coordinate helper: flip Y. Matches the math inside createLineAnnotation.
const toPdfPoint = (x, y, pageHeight) => [x, pageHeight - y];

/**
 * Pure function: given a Fabric-ish line object + page height, return a plain
 * JS spec describing the PDF annotation dict. Does not touch pdf-lib.
 * Consumed by createLineAnnotation (for the real save) and by unit tests.
 */
export function buildLineAnnotationDictSpec(fabricObj, pageHeight) {
  const [hx, hy] = hexToRgbNormalized(fabricObj.stroke || '#000000');
  const strokeWidth = fabricObj.strokeWidth ?? 1;

  if (fabricObj.midpointCurveOffset) {
    // Tessellate curve in canvas space, then flip Y for every sample
    const samples = tessellateCurveSamples(fabricObj);
    const pdfVertices = samples.flatMap(([x, y]) => toPdfPoint(x, y, pageHeight));
    // Rect = bounding box of all samples, in PDF coords
    const xs = pdfVertices.filter((_, i) => i % 2 === 0);
    const ys = pdfVertices.filter((_, i) => i % 2 === 1);
    return {
      Type: 'Annot',
      Subtype: 'PolyLine',
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      Vertices: pdfVertices,
      C: [hx, hy, /* b */ 0],  // replace with real blue channel from hexToRgbNormalized
      Border: [0, 0, strokeWidth],
      LE: fabricObj.lineEnding1 || fabricObj.lineEnding2
        ? [fabricObj.lineEnding1 || 'None', fabricObj.lineEnding2 || 'None']
        : undefined,
      SurveyBetaSafe: encodeCurveToPrivateDict(fabricObj)
    };
  }

  // Straight line path — mirror the existing createLineAnnotation behavior
  const [x1p, y1p] = toPdfPoint(fabricObj.x1 ?? 0, fabricObj.y1 ?? 0, pageHeight);
  const [x2p, y2p] = toPdfPoint(fabricObj.x2 ?? 0, fabricObj.y2 ?? 0, pageHeight);
  return {
    Type: 'Annot',
    Subtype: 'Line',
    Rect: [Math.min(x1p, x2p), Math.min(y1p, y2p), Math.max(x1p, x2p), Math.max(y1p, y2p)],
    L: [x1p, y1p, x2p, y2p],
    C: /* real RGB */ [0, 0, 0],
    Border: [0, 0, strokeWidth],
    LE: fabricObj.lineEnding1 || fabricObj.lineEnding2
      ? [fabricObj.lineEnding1 || 'None', fabricObj.lineEnding2 || 'None']
      : undefined
  };
}

/**
 * Pure function: reverse direction — given a parsed annotation dict spec + page
 * height, return a Fabric-ish line object. Used by tests AND by the importer
 * when it decodes our private dict (see Task 5.3).
 */
export function parseLineAnnotationDictSpec(spec, pageHeight) {
  if (spec.Subtype === 'PolyLine') {
    // Prefer our private dict if present and version-compatible
    if (spec.SurveyBetaSafe) {
      const recovered = decodeCurveFromPrivateDict(spec.SurveyBetaSafe);
      if (recovered) return { type: 'line', ...recovered };
    }
    return { type: 'polyline', vertices: spec.Vertices };
  }
  if (spec.Subtype === 'Line') {
    const [x1p, y1p, x2p, y2p] = spec.L;
    return {
      type: 'line',
      x1: x1p, y1: pageHeight - y1p,
      x2: x2p, y2: pageHeight - y2p,
      midpointCurveOffset: null
    };
  }
  return null;
}
```

NOTE on RGB: the existing file uses a pdf-lib `rgb()` helper via `hexToRGB`. For the pure spec helper, introduce a plain-JS `hexToRgbNormalized` that returns `[r, g, b]` numbers in 0–1 (no pdf-lib dependency in the spec builder so it remains unit-testable without a PDFDocument). `createLineAnnotation` consumes the spec and wraps `C` with pdf-lib's `rgb(...)` as needed.

- [ ] **Step 3: Have `createLineAnnotation` delegate to the spec builder**

Inside `createLineAnnotation(pdfDoc, page, fabricObj, pageHeight)`:

```javascript
const spec = buildLineAnnotationDictSpec(fabricObj, pageHeight);
// Translate plain spec → pdf-lib dict (wrap C with rgb(), SurveyBetaSafe with pdfDoc.context.obj, etc.)
const dict = {
  ...spec,
  C: rgb(spec.C[0], spec.C[1], spec.C[2]),
  Contents: PDFString.of(''),
  P: page.ref,
};
if (spec.SurveyBetaSafe) {
  dict.SurveyBetaSafe = pdfDoc.context.obj(spec.SurveyBetaSafe);
}
if (spec.LE) {
  dict.LE = [PDFName.of(spec.LE[0]), PDFName.of(spec.LE[1])];
}
return pdfDoc.context.register(pdfDoc.context.obj(dict));
```

Keep the existing `try / catch` guard.

- [ ] **Step 4: Run tests**

```bash
node --test tests/curveRoundTrip.test.mjs
npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfAnnotationsPdfLib.js tests/curveRoundTrip.test.mjs
git commit -m "feat: curved lines export as /PolyLine with SurveyBetaSafe private dict (pdfAnnotationsPdfLib)"
```

### Task 5.3: Wire the private-dict decoder into the real importer

**Scope:** Now that we emit the private dict, make the importer read it. When `pdfAnnotationImporter.js` encounters a PDF.js annotation with `subtype === 'PolyLine'` AND a `SurveyBetaSafe` custom-data entry, feed the entry through `decodeCurveFromPrivateDict` and produce a native curved-line Fabric object instead of a polyline. Falls back to a plain polyline for third-party-saved PolyLines.

**Files:**
- Modify: `src/utils/pdfAnnotationImporter.js` — add or extend the PolyLine converter branch

- [ ] **Step 1: Write the failing test**

Append to `tests/curveRoundTrip.test.mjs`:

```javascript
import { convertPolyLineToFabricLineOrPolyline } from '../src/utils/pdfAnnotationImporter.js';

test('importer promotes PolyLine with SurveyBetaSafe private dict back to a native curved line', () => {
  const polyLineAnnot = {
    subtype: 'PolyLine',
    vertices: [0, 0, 50, -30, 100, 0],  // tessellated samples
    customData: {
      SurveyBetaSafe: {
        ns: 'SurveyBetaSafe',
        type: 'curve',
        version: 1,
        endpoints: [[0, 0], [100, 0]],
        midpointOffset: [0, -30]
      }
    },
    color: [0, 0, 0],
    borderWidth: 2
  };
  const viewport = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const imported = convertPolyLineToFabricLineOrPolyline(polyLineAnnot, viewport, { scale: 1 });
  assert.equal(imported.type, 'line');
  assert.equal(imported.midpointCurveOffset.dy, -30);
});

test('importer leaves third-party PolyLine as a polyline (no promotion)', () => {
  const foreign = {
    subtype: 'PolyLine',
    vertices: [0, 0, 50, -30, 100, 0],
    customData: {},
    color: [0, 0, 0],
    borderWidth: 1
  };
  const viewport = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const imported = convertPolyLineToFabricLineOrPolyline(foreign, viewport, { scale: 1 });
  assert.equal(imported.type, 'polyline');
});
```

Expect FAIL (converter not exported yet).

- [ ] **Step 2: Implement the converter**

In `src/utils/pdfAnnotationImporter.js`, import the codec:

```javascript
import { decodeCurveFromPrivateDict } from './curveCodec.js';
```

Add (or extend) a PolyLine converter:

```javascript
export function convertPolyLineToFabricLineOrPolyline(annot, viewport, { scale = 1 } = {}) {
  const privateDict = annot.customData?.SurveyBetaSafe;
  if (privateDict) {
    const recovered = decodeCurveFromPrivateDict(privateDict);
    if (recovered) {
      // Map PDF → viewport coords, same helpers as convertLineToFabricLine
      // ...use the existing color/borderWidth mapping for stroke + strokeWidth
      return {
        type: 'line',
        ...recovered,
        stroke: colorArrayToHex(annot.color),
        strokeWidth: (annot.borderWidth ?? 1) * scale,
        isPdfImported: true,
        pdfAnnotationType: 'PolyLine'
      };
    }
  }
  // Third-party polyline fallback — keep as polyline; do not promote
  return {
    type: 'polyline',
    points: pairVertices(annot.vertices, viewport),
    stroke: colorArrayToHex(annot.color),
    strokeWidth: (annot.borderWidth ?? 1) * scale,
    fill: null,
    isPdfImported: true,
    pdfAnnotationType: 'PolyLine'
  };
}
```

Register this converter in whatever central dispatcher the importer already uses (parallel to `convertLineToFabricLine`, `convertInkToFabricPath`, etc.).

- [ ] **Step 3: Run tests**

```bash
node --test tests/curveRoundTrip.test.mjs
npm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/utils/pdfAnnotationImporter.js tests/curveRoundTrip.test.mjs
git commit -m "feat: importer decodes SurveyBetaSafe private dict on PolyLine to rebuild native curves"
```

### Task 5.4: Manual round-trip verification

- [ ] **Step 1: Create, curve, save**

Open the app. Draw a line. Drag its midpoint to curve it. Save the PDF as a new file, e.g. `/tmp/curve-roundtrip-test.pdf`.

- [ ] **Step 2: Re-open the saved file in our app**

File → Open `/tmp/curve-roundtrip-test.pdf`. The curve should reappear exactly — same endpoints, same midpoint offset. Click the line — the midpoint handle should still let you flex the curve.

- [ ] **Step 3: Open the saved file in another PDF viewer**

Open `/tmp/curve-roundtrip-test.pdf` in Preview (Mac) or Acrobat. The curve should be visible as a polyline that visually matches the original curve shape. Editable in the other viewer is not required; visually correct is.

- [ ] **Step 4: Commit (marker)**

```bash
git commit --allow-empty -m "verify: curve round-trip — our-app lossless, other-app visually correct"
```

---

## Chunk 6 (contingent on Task 2.4 outcome): Universal Eraser Centerline Split

**Scope:** If Task 2.4's A/B test shows internal pen strokes also visibly thicken after eraser use, implement a centerline-split strategy in `geometryEraser.js` that preserves the stroked-line rendering for all path objects — not just imports.

**If Task 2.4 shows no internal thickening: skip this entire chunk and commit a note stating the fix is not needed.**

### Task 6.1: Centerline split implementation

**Files:**
- Modify: `src/utils/geometryEraser.js`
- Create: `tests/geometryEraserCenterline.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/geometryEraserCenterline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { eraseCenterlineSplit } from '../src/utils/geometryEraser.js';

test('centerline split on a straight stroke yields two stroked sub-paths', () => {
  const stroke = {
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    stroke: '#000', strokeWidth: 4, fill: null
  };
  const eraserCircle = { cx: 50, cy: 0, r: 10 };

  const result = eraseCenterlineSplit(stroke, eraserCircle);

  assert.equal(result.length, 2);
  for (const piece of result) {
    assert.equal(piece.stroke, '#000');
    assert.equal(piece.strokeWidth, 4);
    assert.equal(piece.fill, null);
    assert.equal(piece.type, 'path');
  }
});

test('centerline split on a stroke fully covered by eraser returns empty array', () => {
  const short = {
    type: 'path', path: [['M', 45, 0], ['L', 55, 0]],
    stroke: '#000', strokeWidth: 4, fill: null
  };
  const bigEraser = { cx: 50, cy: 0, r: 20 };
  assert.equal(eraseCenterlineSplit(short, bigEraser).length, 0);
});
```

Expect FAIL.

- [ ] **Step 2: Implement centerline split**

Add to `src/utils/geometryEraser.js`:

```javascript
export function eraseCenterlineSplit(pathObj, eraserCircle) {
  const segments = flattenPathToSegments(pathObj.path);
  const pieces = [];
  let current = [];

  for (const [p1, p2] of segments) {
    const intersections = segmentCircleIntersections(p1, p2, eraserCircle);
    if (intersections.length === 0) {
      if (!pointInCircle(p1, eraserCircle)) current.push(p1);
      if (!pointInCircle(p2, eraserCircle)) current.push(p2);
      continue;
    }
    // Split at intersection(s), flush `current` as a piece if it has >=2 points
    for (const hit of intersections) {
      current.push(hit);
      if (current.length >= 2) pieces.push(makeStrokePiece(current, pathObj));
      current = [hit];
    }
    if (!pointInCircle(p2, eraserCircle)) current.push(p2);
  }
  if (current.length >= 2) pieces.push(makeStrokePiece(current, pathObj));
  return pieces;
}

function makeStrokePiece(points, source) {
  return {
    type: 'path',
    path: [['M', points[0][0], points[0][1]],
           ...points.slice(1).map(([x, y]) => ['L', x, y])],
    stroke: source.stroke,
    strokeWidth: source.strokeWidth,
    fill: null,
    strokeLineCap: source.strokeLineCap ?? 'round',
    strokeLineJoin: source.strokeLineJoin ?? 'round'
  };
}
```

Add helpers `flattenPathToSegments`, `segmentCircleIntersections`, `pointInCircle` (most already exist — reuse).

- [ ] **Step 3: Wire into the eraser UI**

In `src/components/FabricEraserCanvas.jsx`, find the current `booleanErasePath` invocation (around line 194). Swap the call to prefer the centerline split when the target is a stroked path (i.e. `obj.fill == null && obj.strokeWidth > 0`):

```javascript
if (obj.type === 'path' && obj.fill == null && obj.strokeWidth > 0) {
  const pieces = eraseCenterlineSplit(obj, eraserCircle);
  replaceObjectWithPieces(obj, pieces);
} else {
  booleanErasePath(obj, eraserPath, currentEraserSize);
}
```

Implement `replaceObjectWithPieces` to remove the original Fabric object and add each piece as a new Fabric path with the same metadata (including `isPdfImported` if present, so provenance survives).

- [ ] **Step 4: Run tests**

```bash
node --test tests/geometryEraserCenterline.test.mjs
npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/geometryEraser.js src/components/FabricEraserCanvas.jsx tests/geometryEraserCenterline.test.mjs
git commit -m "feat: eraser centerline-split preserves stroked rendering for all stroked paths"
```

### Task 6.2: Manual verification

- [ ] **Step 1: Erase an internal pen stroke**

Draw an internal pen stroke. Erase the middle. Remaining ends should look visually clean — same stroke width as the original, no miter-joint thickening.

- [ ] **Step 2: Erase an imported pen stroke**

Repeat on an imported Ink stroke. Visually identical behavior.

- [ ] **Step 3: Erase a filled polygon (to confirm fallback works)**

Draw or import a filled rectangle. Erase part of it. Confirm the boolean-polygon path still runs (the non-stroked fallback path).

- [ ] **Step 4: Commit (marker)**

```bash
git commit --allow-empty -m "verify: eraser centerline split — stroked paths preserved, filled shapes still boolean-clip"
```

---

## Final Integration Pass

### Task 7.1: Run the entire test suite end-to-end

- [ ] **Step 1: Clean run**

```bash
cd /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2
npm test 2>&1 | tee /tmp/full-test-run.log
```

Expected: all green. If any fail, fix before proceeding.

- [ ] **Step 2: Manual smoke test of the reference PDF end-to-end**

Open `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`. Walk through: cloud rect properties, cloud polygon properties (if present), pen stroke zoom gap, callout edit, line curve + save + re-open round-trip. All should pass.

- [ ] **Step 3: Write a summary commit**

```bash
git commit --allow-empty -m "docs: import-normalization + cloud-properties plan complete; full suite green + manual smoke passed"
```

### Task 7.2: Update project CLAUDE.md with new gotchas

- [ ] **Step 1: Edit `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/CLAUDE.md`**

Append to the Gotchas & Lessons Learned section:

```markdown
- **2026-04-21 — Imported annotations must be normalized to native shapes at import time:** The importer used to produce Fabric objects with divergent properties (e.g. `strokeUniform: true` on imported Ink, no such setting on internal pen strokes). At 200% zoom this produced a visible hairline split on imports. Fix: `src/utils/nativeShapeFactory.js` is the single source of truth for native object defaults; every importer path converges on those defaults. The `isPdfImported` flag survives only as metadata for export provenance — it NEVER gates edit-time behavior.

- **2026-04-21 — Curve export uses `/PolyLine` with a private metadata dict for lossless round-trip:** Our curved lines/arrows (non-null `midpointCurveOffset`) export as tessellated `/PolyLine` plus a namespaced `SurveyBetaSafe` dict holding control points. On re-import we prefer the private dict when present and version-compatible; otherwise we fall back to polyline. Pattern matches Bluebeam / Apryse / PSPDFKit. Never strip the private dict on save — it's how we survive our own round-trip. Implementation lives in `src/utils/curveCodec.js` and the spec builder / parser pair in `src/utils/pdfAnnotationsPdfLib.js` (exported as `buildLineAnnotationDictSpec` / `parseLineAnnotationDictSpec`).

- **2026-04-21 — Cloud stroke thickness and bump intensity are independent:** Do NOT couple them in code, UI, or UX copy. Bluebeam Revu, Adobe Acrobat, PSPDFKit/Apryse, Foxit, and the ISO 32000-1 PDF spec (`/BE /I` is explicitly orthogonal to `/W`) all treat them as separate. AIA/architectural drafting convention expects bump size to match drawing scale, not pen weight. The properties panel exposes three separate controls for clouds: stroke color, stroke width, and bump size (intensity 1–4). `buildCloudPathCommands(points, intensity)` takes intensity ONLY — never stroke width.

- **2026-04-21 — Pre-existing side-issue flagged, not fixed: imported objects are skipped during save:** `src/utils/pdfAnnotationsPdfLib.js` around the `savePDFWithAnnotationsPdfLib` dispatcher contains `if (obj.isPdfImported) return;` to avoid duplicating annotations already in the original PDF's Annots array. After the Chunk 2–4 normalization lands, this skip remains correct for unmodified imports but is wrong for imports the user has edited. Fixing that requires tracking a per-object dirty state and removing the original from the Annots array when a dirty import is re-emitted. Out of scope for the 2026-04-21 plan; track as a follow-up.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record 2026-04-21 gotchas — import normalization and curve private-dict export"
```

---

## Out-of-Scope / Explicit Non-Goals

- Export of curved arrows is covered by the same path as curved lines (arrowHead flag travels with the object; the exporter adds `/LE` when `arrowHead: true`). No separate arrow chunk needed.
- Third-party PDF tools editing the curve after our export is NOT a goal; the visual-only polyline is enough for them. If a third-party tool resaves the file and strips our private dict, the curve degrades to a polyline on next re-open. Acceptable per research.
- Callout composite shapes (callouts with attached leader lines that have their own curves) are NOT addressed here. If the user has such assets, treat as a follow-up.
- Stamp-subtype import (rasterized overlays) is out of scope. Untouched.

---

## Success Criteria

1. Right-clicking a cloud rectangle or cloud polygon → Properties no longer crashes; three independent controls are visible and functional (stroke color, stroke width, bump size). Changing stroke width only affects line thickness. Changing bump size only affects hump density. The two never interact.
2. Imported pen strokes at 200% zoom show a solid stroke — no center gap.
3. Eraser on an imported stroke produces a visual result indistinguishable from eraser on an internal stroke (either both clean, or both boolean — but parity).
4. Imported callouts open in the editor cleanly; no cursor drift; fonts remain single-name.
5. Imported straight lines/arrows accept the native midpoint curve handle after import.
6. A curved line saved from our app and re-opened in our app reconstructs the exact original curve. Re-opened in Preview/Acrobat, the curve appears as a polyline with the correct visual shape.
7. `npm test` — full suite green at every commit.
