import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for V-01 leftover: Spacebar temporary pan.
// Live proof: debug/scenarios/e2e-spacebar-pan.spec.mjs
// Distinct from named-Pan overflow sample, UL-06 Zoom %, V-04 Fit width,
// W4-02 pinch, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('PdfjsViewerContainer Space always overrides the armed tool without setActiveTool', () => {
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /pan: Space always overrides the active tool/);
  assert.match(viewer, /const isSpaceKey = \(event\) => event\?\.code === 'Space'/);
  assert.match(viewer, /isEditableTarget\(event\.target\) \|\| isEditableTarget\(document\.activeElement\)/);
  assert.match(viewer, /spacePanRef\.current = true/);
  assert.match(viewer, /el\.dataset\.spacePan = dragging \? 'dragging' : \(armed \? 'armed' : 'off'\)/);
  assert.match(viewer, /document\.documentElement\.dataset\.surveyPdfjsPanActive/);
  assert.match(viewer, /window\.addEventListener\('keydown', activateSpacePan, true\)/);
  assert.match(viewer, /window\.addEventListener\('keyup', releaseSpacePan, true\)/);
  assert.match(viewer, /const armed = spacePanRef\.current \|\| interactionModeRef\.current === 'Pan'/);
  assert.match(viewer, /if \(!armed \|\| event\.button !== 0 \|\| event\.pointerType === 'touch'\) return/);
  assert.match(viewer, /isEditableTarget\(event\.target\)/);
  assert.match(viewer, /a\[href\], \.linkAnnotation, \[data-element-id="link"\]/);
  assert.doesNotMatch(viewer, /setActiveTool\('pan'\)/);
  assert.doesNotMatch(viewer, /file\.id\s*=/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /Spacebar|Hold Space|temporary pan/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /id: 'pan', label: 'Pan'/);
  assert.match(shell, /aria-label=\{label\}/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /label="Pan"/);
  assert.match(mobile, /selectTool\('pan'\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('Space pan presentation + INPUT guard stay container-scroll, not annotation move', () => {
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /el\.scrollLeft -= delta\.x/);
  assert.match(viewer, /el\.scrollTop -= delta\.y/);
  assert.match(viewer, /\[data-space-pan='armed'\], \[data-space-pan='armed'\] \* \{ cursor: grab !important; \}/);
  assert.match(viewer, /html\[data-survey-pdfjs-pan-active='true'\] \[data-eraser-cursor\]/);
  assert.match(viewer, /tagName === 'input'/);
  assert.match(viewer, /tagName === 'textarea'/);
  assert.match(viewer, /target\?\.isContentEditable === true/);
  assert.match(viewer, /className=\{\`\$\{className\}\$\{isMobileSurface \? ' survey-pdfjs-mobile-surface' : ''\}\`\}/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
});

test('live spec covers Space arm / INPUT steal / Pen restore / toolbar contrast / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-spacebar-pan.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Spacebar pan intended \+ break \+ edge/);
  assert.match(spec, /390 Spacebar pan intended \+ break \+ edge/);
  assert.match(spec, /Space must arm data-space-pan/);
  assert.match(spec, /Space must not switch toolbar Pan/);
  assert.match(spec, /Space\+drag must move overflow scroll/);
  assert.match(spec, /keyup Space must set data-space-pan=off/);
  assert.match(spec, /Pen must still draw after Space release/);
  assert.match(spec, /Search INPUT Space must type a space/);
  assert.match(spec, /Search INPUT Space must not arm pan/);
  assert.match(spec, /zoom INPUT Space must not arm pan/);
  assert.match(spec, /Space click invents 0/);
  assert.match(spec, /Space pan must not move rect left/);
  assert.match(spec, /toolbar Pan must be active/);
  assert.match(spec, /390 Space must arm data-space-pan/);
  assert.match(spec, /390 Space\+drag must move overflow scroll/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
