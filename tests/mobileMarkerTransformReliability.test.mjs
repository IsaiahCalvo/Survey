import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const containerSource = fs.readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);
const selectionSource = fs.readFileSync(
  new URL('../src/components/SVGSelectionOverlay.jsx', import.meta.url),
  'utf8',
);
const lifecycleSource = fs.readFileSync(
  new URL('../agent-cli/mobile-annotations/lifecycle.mjs', import.meta.url),
  'utf8',
);
const surveyRegionSource = fs.readFileSync(
  new URL('../agent-cli/mobile-annotations/survey-region.mjs', import.meta.url),
  'utf8',
);

test('annotation watchdog does not remount a healthy SVG layer when all raw objects are filtered', () => {
  assert.match(
    viewerSource,
    /const svgRoot = wrapper\?\.querySelector\?[\s\S]{0,900}const mismatch = [^;]*!svgRoot/,
  );
  assert.doesNotMatch(viewerSource, /groupCount === 0/);
});

test('mobile long-press menu never arms from resize or rotation handles', () => {
  assert.match(
    containerSource,
    /event\.target\?\.closest\?\.\('\[data-resize-handle\], \[data-rotation-handle\]'\)[\s\S]{0,100}clear\(\);[\s\S]{0,60}return;/,
  );
});

test('SVG transform chrome suppresses native touch callouts and context menus', () => {
  assert.match(selectionSource, /touchAction: 'none'/);
  assert.match(selectionSource, /WebkitTouchCallout: 'none'/);
  assert.match(selectionSource, /onContextMenu=\{\(event\) => \{[\s\S]{0,120}event\.preventDefault\(\)/);
});

test('mobile delete long-press targets exposed annotation body instead of transform handles', () => {
  assert.match(
    lifecycleSource,
    /async function mobileMenuPoint/,
  );
  assert.match(
    lifecycleSource,
    /elementFromPoint\(x, y\)[\s\S]{0,200}\[data-resize-handle\], \[data-rotation-handle\]/,
  );
  assert.match(
    lifecycleSource,
    /const deletePoint = await mobileMenuPoint\(target, toolId/,
  );
});

test('Survey Marker lifecycle waits for the visible Undo history commit under load', () => {
  assert.match(
    surveyRegionSource,
    /Persistence and the React history button are separate commit signals[\s\S]{0,600}!button\.disabled[\s\S]{0,300}Undo stayed disabled after Survey Marker move history commit/,
  );
});
