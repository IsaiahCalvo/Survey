import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const actionBarSource = await readFile(new URL('../src/components/TextSelectionActionBar.jsx', import.meta.url), 'utf8');
const actionBarCss = await readFile(new URL('../src/components/TextSelectionActionBar.css', import.meta.url), 'utf8');
const selectionOverlaySource = await readFile(new URL('../src/components/SVGSelectionOverlay.jsx', import.meta.url), 'utf8');
const annotationLayerSource = await readFile(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const mobileChromeSource = await readFile(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
const mobileCss = await readFile(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

test('text action bar owns a full-width scroll row with keyboard focus and narrow-screen sizing', () => {
  assert.match(actionBarSource, /aria-orientation="horizontal"/);
  assert.match(actionBarSource, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(actionBarSource, /scrollIntoView\?\./);
  assert.match(actionBarCss, /\.text-selection-action-bar\s*\{[\s\S]*?width:\s*100%/);
  assert.match(actionBarCss, /\.text-selection-action-bar__toolbar\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(actionBarCss, /min-width:\s*max-content/);
  assert.match(actionBarCss, /@media \(max-width: 700px\), \(pointer: coarse\)/);
  assert.match(actionBarCss, /\.text-selection-action-bar__button\s*\{[\s\S]*?width:\s*40px[\s\S]*?height:\s*40px/);
  assert.match(actionBarCss, /:focus-visible/);
});

test('text range endpoint visuals have separate 44px pointer targets', () => {
  assert.match(selectionOverlaySource, /const textRangeHitSize = 44 \* visualInverseScale/);
  assert.match(selectionOverlaySource, /data-text-range-handle-hit-target="true"/);
  assert.match(selectionOverlaySource, /data-text-range-handle-visual=/);
  assert.match(selectionOverlaySource, /pointerEvents: horizontalResizeOnly \? 'none' : 'auto'/);
  assert.match(selectionOverlaySource, /e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?onHandleDrag/);
});

test('lasso preview has an enclosed selection edge and distinct window and crossing paint', () => {
  assert.match(annotationLayerSource, /data-lasso-selection-preview="true"/);
  assert.match(annotationLayerSource, /data-lasso-selection-halo="true"/);
  assert.match(annotationLayerSource, /strokeWidth=\{4\}/);
  assert.match(annotationLayerSource, /rgba\(72, 145, 255, 1\)/);
  assert.match(annotationLayerSource, /rgba\(30, 210, 120, 1\)/);
  assert.match(annotationLayerSource, /lassoMode === 'fence' \? '' : ' Z'/);
});

test('mobile selection menu remeasures on viewport and orientation changes without clipping rows', () => {
  assert.match(mobileChromeSource, /window\.addEventListener\('orientationchange', reposition\)/);
  assert.match(mobileChromeSource, /window\.visualViewport\?\.addEventListener\?\.\('resize', reposition\)/);
  assert.match(mobileChromeSource, /viewportLeft \+ viewportWidth - menuWidth - 8/);
  assert.match(mobileCss, /\.mobile-pdf-select-mode__menu\s*\{[\s\S]*?width:\s*min\(180px, calc\(100vw - 16px\)\)/);
  assert.match(mobileCss, /max-height:\s*min\(152px, calc\(100dvh - 16px\)\)/);
  assert.match(mobileCss, /\.mobile-pdf-select-mode__menu > button\s*\{[\s\S]*?min-height:\s*44px/);
});
