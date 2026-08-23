import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for T-01 leftover: live Textbox rubber-band then
// auto-edit mount. Live proof: debug/scenarios/e2e-textbox-live-create.spec.mjs
// Distinct from T-01 auto-edit type/commit, selected resize/`mtr`,
// T-02 callout preview, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('live textbox preview + 10px gate + overlay keep-track stay wired', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /data-text-overlay=\{pageNumber\}/);
  assert.match(viewer, /data-text-preview/);
  assert.match(viewer, /border: '2px dashed rgba\(59, 130, 246, 0\.5\)'/);
  assert.match(viewer, /backgroundColor: 'rgba\(59, 130, 246, 0\.05\)'/);
  assert.match(viewer, /if \(dx > 10 \|\| dy > 10\)/);
  assert.match(viewer, /el\.style\.display = 'block'/);
  assert.match(viewer, /el\.style\.display = 'none'/);
  assert.match(viewer, /isNewText: true/);
  assert.match(viewer, /textBoxWidth: isDrag \? dx \/ effectiveScale : undefined/);
  assert.match(viewer, /const isDrag = dx > 10 \|\| dy > 10/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);
  assert.match(viewer, /const effectiveScale = rect\.width \/ resolvedPageSize\.width/);
  assert.doesNotMatch(viewer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /DEFAULT_FONT_FAMILY = 'Helvetica'/);
  assert.doesNotMatch(overlay, /file\.id\s*=/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers preview / commit / 10px gate / tool-switch / zoom keep-track / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-textbox-live-create.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop textbox live create intended \+ break \+ edge/);
  assert.match(spec, /390 textbox live create intended \+ break \+ edge/);
  assert.match(spec, /empty page live text preview 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /live textbox preview must paint before pointerup/);
  assert.match(spec, /Text live drag must not commit yet/);
  assert.match(spec, /Text live drag must not mount auto-edit yet/);
  assert.match(spec, /Text preview is not the Rect\/Ellipse g path/);
  assert.match(spec, /Text preview is not the Line\/Arrow path/);
  assert.match(spec, /Text preview is not the Callout path/);
  assert.match(spec, /rubber-band is dashed \(not Style \[6,4\]\)/);
  assert.match(spec, /Text pointerup must drop the rubber-band/);
  assert.match(spec, /pointerup mounts T-01 auto-edit/);
  assert.match(spec, /create stamps a single-name fontFamily/);
  assert.match(spec, /sub-10px drag must not paint the rubber-band/);
  assert.match(spec, /tool-switch mid-drag must drop the rubber-band/);
  assert.match(spec, /tool-switch mid-drag must invent 0/);
  assert.match(spec, /zoom mid-drag starts uncommitted/);
  assert.match(spec, /zoom mid-drag must not flush a drag-out textbox/);
  assert.match(spec, /zoom keep-track \+ pointerup must not double-commit/);
  assert.match(spec, /390 Text live drag must not commit yet/);
  assert.match(spec, /390 rubber-band is dashed/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('live create is not auto-edit catalog / resize / rotate / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-textbox-live-create.spec.mjs');
  assert.match(spec, /T-01 leftover: live Textbox rubber-band then auto-edit mount/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /data-rotation-handle="mtr"|Match fill/);
  assert.doesNotMatch(spec, /dragResizeHandle|getByRole\('button', \{ name: 'Dashed'/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /The quick brown fox jumps over the lazy dog again/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'Bold'/);
  assert.doesNotMatch(spec, /pickDesktopStyle|Cloud bump size/);

  const viewer = read('src/PDFViewer.jsx');
  assert.doesNotMatch(viewer, /file\.id\s*=/);
  assert.match(viewer, /zoomGeneration/);
});
