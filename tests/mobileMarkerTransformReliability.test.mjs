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
const annotationLayerSource = fs.readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);
const textActionBarSource = fs.readFileSync(
  new URL('../src/components/TextSelectionActionBar.jsx', import.meta.url),
  'utf8',
);
const interactionSource = fs.readFileSync(
  new URL('../src/hooks/useSVGInteraction.js', import.meta.url),
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

test('text markup selection chrome exposes only left and right range handles', () => {
  assert.match(selectionSource, /horizontalResizeOnly/);
  assert.match(selectionSource, /data-text-range-handle/);
  assert.match(selectionSource, /\['ml', 'mr'\]/);
  assert.match(annotationLayerSource, /horizontalResizeOnly=\{selectionObj\?\.data\?\.type === 'text-markup'/);
  assert.match(interactionSource, /const handlePointerCancel = useCallback/);
  assert.equal(
    (interactionSource.match(/ds\.mode === 'text-markup-horizontal' && e\.pointerId !== ds\.pointerId/g) || []).length,
    2,
    'move and up must reject a second pointer',
  );
  assert.match(
    interactionSource,
    /ds\.pointerId != null && e\.pointerId != null && ds\.pointerId !== e\.pointerId/,
    'cancel must reject a second pointer',
  );
  assert.match(annotationLayerSource, /onPointerCancel=\{isInteractive[\s\S]{0,180}handlePointerCancel\(e\)/);
});

test('text action bar uses the locked SVG assets for every text markup action', () => {
  assert.match(textActionBarSource, /import Icon from '\.\.\/Icons'/);
  for (const iconName of ['formatHighlight', 'formatUnderline', 'formatSquiggle', 'formatStrikethrough', 'formatHyperlink', 'formatRedact']) {
    assert.match(textActionBarSource, new RegExp(iconName));
  }
  assert.doesNotMatch(textActionBarSource, /text-markup-[a-z-]+\.svg/);
  assert.doesNotMatch(textActionBarSource, /WebkitMask|mask: `url/);
  assert.match(textActionBarSource, /function ToolIcon/);
  assert.match(textActionBarSource, /size=\{24\}/);
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
