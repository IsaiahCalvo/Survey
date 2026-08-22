import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS } from '../src/utils/annotationStyleCatalog.js';

// Source contract for the 390 MOBILE_ANNOTATION_COLORS chip catalog.
// Live proof: debug/scenarios/e2e-mobile-annotation-colors.spec.mjs
// Distinct from desktop CompactColorPicker COLOR_PICKER_PRESETS.

const MOBILE_ANNOTATION_COLORS = [
  '#ff0000',
  '#4A90E2',
  '#27C07D',
  '#F4D35E',
  '#ffffff',
  '#1e293b',
  '#C7A7FF',
  '#FF8A3D',
  '#000000',
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('390 chip catalog is 9 hexes and is not the desktop CompactColorPicker list', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const MOBILE_ANNOTATION_COLORS = \[/);
  for (const color of MOBILE_ANNOTATION_COLORS) {
    assert.match(mobile, new RegExp(color.replace('#', '\\#')));
  }
  assert.match(mobile, /Set \$\{shapeSection === 'fill' \? 'Fill' : 'Stroke'\} color \$\{color\}/);
  assert.match(mobile, /Set Text color \$\{color\}/);
  assert.match(mobile, /Open \$\{shapeSection\} color picker/);
  assert.match(mobile, /'Fill and border colors'/);
  assert.equal(MOBILE_ANNOTATION_COLORS.length, 9);
  assert.equal(new Set(MOBILE_ANNOTATION_COLORS).size, 9);

  const desktopUpper = COLOR_PICKER_PRESETS.map((c) => String(c).toUpperCase());
  const mobileOnly = MOBILE_ANNOTATION_COLORS.filter((c) => !desktopUpper.includes(c.toUpperCase()));
  assert.ok(mobileOnly.includes('#4A90E2'));
  assert.ok(mobileOnly.includes('#27C07D'));
  assert.ok(mobileOnly.includes('#F4D35E'));
  assert.ok(mobileOnly.includes('#1e293b') || mobileOnly.includes('#1E293B'));
  assert.ok(mobileOnly.length >= 5, 'most 390 chips are not desktop presets');
});

test('390 chips apply through the same fill/stroke handlers as desktop Select', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /if \(shapeSection === 'fill'\) api\.handleFillColorChange\?\.\(color\)/);
  assert.match(mobile, /else api\.handleStrokeColorChange\?\.\(color\)/);
  assert.match(mobile, /setColorPicker\(shapeSection\)/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleFillColorChange = useCallback\(\(color\) => \{/);
  assert.match(viewer, /if \(activeTool !== 'select'\) return;/);
  assert.match(viewer, /patchSelectedFill\(nextFillColor\)/);
  assert.match(viewer, /setZoomGeneration/);
});

test('desktop AppShell does not mount the 390 chip aria-labels', () => {
  const shell = read('src/AppShell.jsx');
  assert.doesNotMatch(shell, /MOBILE_ANNOTATION_COLORS/);
  assert.doesNotMatch(shell, /Set Fill color \$\{/);
  assert.match(shell, /CompactColorPicker/);
});
