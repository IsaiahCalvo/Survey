import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for V-01 leftover: named toolbar Pan.
// Live proof: debug/scenarios/e2e-named-toolbar-pan.spec.mjs
// Distinct from Spacebar temporary pan, named-Pan overflow sample,
// UL-06 Zoom %, V-04 Fit width, W4-02 pinch, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell + mobile named Pan switches the tool via setActiveTool/selectTool', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /id: 'pan', label: 'Pan'/);
  assert.match(shell, /aria-label=\{label\}/);
  assert.match(shell, /bottomToolbarApi\.setActiveTool\(isSelect && isTextSelect \? 'text-select' : t\.id\)/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /label="Pan"/);
  assert.match(mobile, /selectTool\('pan'\)/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /interactionMode=\{activeTool === 'pan' \? 'Pan' : 'TextSelection'\}/);
  assert.match(viewer, /pan-mode quick-click → select annotation \+ auto-switch to Select tool/);
  assert.match(viewer, /const QUICK_CLICK_PX = 4/);
  assert.match(viewer, /if \(activeTool !== 'pan'\) return/);
  assert.match(viewer, /setActiveTool\('select'\)/);
  assert.match(viewer, /setPendingSvgSelection\(\{/);

  const container = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(container, /const armed = spacePanRef\.current \|\| interactionModeRef\.current === 'Pan'/);
  assert.match(container, /a\[href\], \.linkAnnotation, \[data-element-id="link"\]/);
  assert.doesNotMatch(container, /setActiveTool\('pan'\)/);
  assert.doesNotMatch(container, /file\.id\s*=/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /\bPan\b|Spacebar|Hold Space|temporary pan/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('named Pan presentation stays container-scroll; SVG viewBox owns zoom', () => {
  const container = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(container, /el\.scrollLeft -= delta\.x/);
  assert.match(container, /el\.scrollTop -= delta\.y/);
  assert.match(container, /\[data-space-pan='armed'\], \[data-space-pan='armed'\] \* \{ cursor: grab !important; \}/);
  assert.match(container, /if \(!armed \|\| event\.button !== 0 \|\| event\.pointerType === 'touch'\) return/);
  assert.match(container, /isEditableTarget\(event\.target\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /Pan-mode quick-click: App\.jsx drives selection via pendingSelection/);
});

test('live spec covers sticky named Pan / quick-click / link / Fit page / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-named-toolbar-pan.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop named toolbar Pan intended \+ break \+ edge/);
  assert.match(spec, /390 named toolbar Pan intended \+ break \+ edge/);
  assert.match(spec, /toolbar Pan must be btn-active/);
  assert.match(spec, /named Pan must arm data-space-pan via interactionMode/);
  assert.match(spec, /empty Pan click invents 0/);
  assert.match(spec, /pan quick-click must switch to Select/);
  assert.match(spec, /pan quick-click must select the rect/);
  assert.match(spec, /named Pan must not steal the fixture link/);
  assert.match(spec, /named Pan drag must move overflow scroll/);
  assert.match(spec, /mouseup must keep named Pan sticky/);
  assert.match(spec, /sticky named Pan must pan a second drag/);
  assert.match(spec, /named Pan must not move rect left/);
  assert.match(spec, /Fit-page Pan drag invents 0/);
  assert.match(spec, /Pen must draw after leaving named Pan/);
  assert.match(spec, /overlay omits named Pan/);
  assert.match(spec, /390 named Pan drag must move overflow scroll/);
  assert.match(spec, /390 pan quick-click must select the rect/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /holdSpace|keyboard\.down\('Space'\)/);
});
