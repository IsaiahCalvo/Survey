import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for V-03 Select text (⇧V) intended + break + edge.
// Live proof: debug/scenarios/e2e-select-text.spec.mjs
// Distinct from V-02 annotation select, V-08 Search, P-04 tool-key smoke,
// leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Shift+V arms text-select; layer mounts only then; SVG falls through; form widgets inert; INPUT blocks', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /'Shift\+V' switches the Select tool into text-selection mode/);
  assert.match(viewer, /setActiveTool\('text-select'\)/);
  assert.match(viewer, /if \(isFormField\) \{\s*return; \/\/ Don't trigger tool switch if focused on input/);
  assert.match(viewer, /activeTool === 'text-select' && \(/);
  assert.match(viewer, /<PdfjsTextLayer/);
  assert.match(viewer, /interactive=\{activeTool === 'pan' \|\| activeTool === 'select'\}/);
  assert.match(viewer, /Do not trigger if user is focused on an input field, textbox, or callout|Don't trigger if user is focused on an input field/);

  const layer = read('src/components/PdfjsTextLayer.jsx');
  assert.match(layer, /pdfjsTextLayer\$\{interactive \? ' is-interactive' : ''\}/);
  assert.match(layer, /window\.getSelection\?\.\(\)\?\.removeAllRanges\?\.\(\)/);
  assert.match(layer, /\.pdfjsTextLayer\.is-interactive \{ pointer-events: auto; cursor: text; \}/);
  assert.match(layer, /\.pdfjsTextLayer:not\(\.is-interactive\) \{ pointer-events: none; \}/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /pointerEvents: \(isInteractive && activeTool !== 'text-select'\) \? 'auto' : 'none'/);
  assert.match(svg, /Marquee[\s\S]{0,80}intentionally off in this mode/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /keys: \['Shift', 'V'\]/);
  assert.match(overlay, /description: 'Select text on the page'/);
  assert.match(overlay, /keys: \['V'\]/);
  assert.match(overlay, /description: 'Select annotations'/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /tool: 'text-select', text: 'Select text', hint: '⇧V'/);
  assert.match(shell, /tool: 'select', text: 'Select annotations', hint: 'V'/);
  assert.match(shell, /aria-label="Selection mode"/);
  assert.match(shell, /aria-label=\{label\}/);
  assert.match(shell, /data-select-mode-menu="true"/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /label="Select"/);
  assert.doesNotMatch(mobile, /Select text|text-select|Selection mode/);

  const form = read('src/components/PdfjsFormLayer.jsx');
  assert.match(form, /data-interactive=\{interactive \? 'true' : 'false'\}/);
  assert.match(form, /\.pdfjsFormLayer\[data-interactive="false"\] section \{ pointer-events: none; \}/);

  const viewerContainer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewerContainer, /\.pdfjsTextLayer\.is-interactive/);
  assert.match(viewerContainer, /survey-pdfjs-mobile-surface \.pdfjsTextLayer\.is-interactive/);
  assert.match(viewerContainer, /user-select: text !important/);
  assert.match(viewerContainer, /data-text-select=\{interactionMode === 'TextSelection' \? 'true' : 'false'\}/);
  assert.match(viewerContainer, /:has\(\.pdfjsTextLayer\.is-interactive\)/);
  assert.match(viewerContainer, /Two-finger pinch must still start when the first contact is a glyph/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers ⇧V / menu / glyph drag / form INPUT / no-layer / 390', () => {
  const spec = read('debug/scenarios/e2e-select-text.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /testPdf=kal441-form-fields\.pdf/);
  assert.match(spec, /overlay lists Select text/);
  assert.match(spec, /overlay lists Shift\+V/);
  assert.match(spec, /Select annotations must not mount an interactive text layer/);
  assert.match(spec, /text-select must mount an interactive glyph layer/);
  assert.match(spec, /SVG root must fall through in text-select/);
  assert.match(spec, /Selection mode/);
  assert.match(spec, /drag must select PDF glyphs/);
  assert.match(spec, /leaving text-select must clear the OS selection/);
  assert.match(spec, /form INPUT Shift\+V must not arm text-select/);
  assert.match(spec, /text-select must make form widgets inert/);
  assert.match(spec, /V must restore form-widget interactivity/);
  assert.match(spec, /Pen-armed Shift\+V must invent 0/);
  assert.match(spec, /390 has no desktop Selection mode caret/);
  assert.match(spec, /390 rail omits Select text/);
  assert.match(spec, /390 drag must select PDF glyphs/);
  assert.match(spec, /390 must select via pointer, not Range/);
  assert.match(spec, /locator-triple-click/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /form fixture viewBox stays page-owned/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('this slice is V-03 glyph select, not V-02 / V-08 / leftover-18', () => {
  const spec = read('debug/scenarios/e2e-select-text.spec.mjs');
  assert.match(spec, /V-03 Select text/);
  assert.match(spec, /Distinct from V-02 annotation select \/ marquee, V-08 Search/);
  assert.doesNotMatch(spec, /__selectedAnnotationIds/);
  assert.doesNotMatch(spec, /Search text in PDF/);

  const v02 = read('debug/scenarios/e2e-select-all-multi-select.spec.mjs');
  assert.match(v02, /V-02 select-all \/ multi-select/);
  assert.doesNotMatch(v02, /pdfjsTextLayer\.is-interactive/);

  const search = read('debug/scenarios/e2e-search-previous.spec.mjs');
  assert.match(search, /Search Previous remainder/);
  assert.doesNotMatch(search, /setActiveTool\('text-select'\)/);
});
