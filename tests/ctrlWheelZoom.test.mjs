import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getWheelZoomScale } from '../src/utils/pdfZoomMath.js';
import { TOOLBAR_ZOOM_STEP_FACTOR } from '../src/viewerShared.js';

// Ctrl+wheel is a distinct V-04 path: PdfjsViewerContainer onWheel
// (ctrl/meta + getWheelZoomScale + SETTLE_MS) + zoomGeneration source:'wheel'.
// Fit page / Fit width / Fit height / Ctrl++/− / UL-06 / W4-02 pinch
// already have dedicated intended+break+edge. Wave2 only sampled
// "Fit width → ctrl-wheel → Fit page".
// Live proof: debug/scenarios/e2e-ctrl-wheel-zoom.spec.mjs
// Distinct from leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('one wheel notch is ~1.1 and is not the Ctrl+= 1.25 keyboard step', () => {
  assert.equal(TOOLBAR_ZOOM_STEP_FACTOR, 1.25);
  const fromOne = getWheelZoomScale(1, { deltaY: -100, minimumScale: 0.01, maximumScale: 40 });
  assert.ok(Math.abs(fromOne - 1.1) < 1e-9, `expected 1.1, got ${fromOne}`);
  assert.notEqual(fromOne, TOOLBAR_ZOOM_STEP_FACTOR);
  const reversed = getWheelZoomScale(fromOne, { deltaY: 100, minimumScale: 0.01, maximumScale: 40 });
  assert.ok(Math.abs(reversed - 1) < 1e-9, `expected reversible notch, got ${reversed}`);
  assert.equal(getWheelZoomScale(40, { deltaY: -100, maximumScale: 40 }), 40);
  assert.equal(getWheelZoomScale(0.01, { deltaY: 100, minimumScale: 0.01 }), 0.01);
});

test('engine owns Ctrl+wheel; overlay path is dead; zoomGeneration watches wheel', () => {
  const pdfjs = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(pdfjs, /const onWheel = \(e\) => \{/);
  assert.match(pdfjs, /if \(!\(e\.ctrlKey \|\| e\.metaKey\)\) return;/);
  assert.match(pdfjs, /source: 'wheel'/);
  assert.match(pdfjs, /getWheelZoomScale\(committed \* liveZoomRef\.current/);
  assert.match(pdfjs, /const SETTLE_MS = 110/);
  assert.match(pdfjs, /setTimeout\(commitGesture, SETTLE_MS\)/);
  assert.match(pdfjs, /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  assert.match(pdfjs, /const MAX_SCALE = 40/);
  assert.match(pdfjs, /const MOBILE_MAX_SCALE = 8/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /if \(true\) return false;/);
  assert.match(viewer, /payload\?\.source === 'pinch' \|\| payload\?\.source === 'wheel'/);
  assert.match(viewer, /if \(phase === 'gesture-start'\) setZoomGeneration\(\(prev\) => prev \+ 1\)/);
  assert.doesNotMatch(viewer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /description: 'Zoom in'/);
  assert.doesNotMatch(overlay, /wheel|pinch|trackpad/i);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers intended + bare wheel + INPUT steal + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-ctrl-wheel-zoom.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Ctrl\+wheel zoom intended \+ break \+ edge/);
  assert.match(spec, /390 Ctrl\+wheel zoom intended \+ break \+ edge/);
  assert.match(spec, /Ctrl\+wheel in must raise zoom/);
  assert.match(spec, /one notch must stay below the Ctrl\+= 250 step/);
  assert.match(spec, /Ctrl\+wheel out must reverse the notch/);
  assert.match(spec, /Ctrl\+wheel must leave Fit page/);
  assert.match(spec, /bare wheel must not zoom/);
  assert.match(spec, /zoom INPUT Ctrl\+wheel must not steal/);
  assert.match(spec, /4000% Ctrl\+wheel in must clamp/);
  assert.match(spec, /page-1 rect must survive Ctrl\+wheel/);
  assert.match(spec, /Pen-armed Ctrl\+wheel must still zoom/);
  assert.match(spec, /zoomGeneration wheel must flush the in-flight ink/);
  assert.match(spec, /Ctrl\+wheel must not change page/);
  assert.match(spec, /390 Ctrl\+wheel in must grow the page/);
  assert.match(spec, /390 bare wheel must not zoom/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
