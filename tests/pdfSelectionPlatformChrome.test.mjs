import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const actionBarSource = await readFile(new URL('../src/components/TextSelectionActionBar.jsx', import.meta.url), 'utf8');
const actionBarCss = await readFile(new URL('../src/components/TextSelectionActionBar.css', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const textLayerSource = await readFile(new URL('../src/components/PdfjsTextLayer.jsx', import.meta.url), 'utf8');
const viewerContainerSource = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
const selectionOverlaySource = await readFile(new URL('../src/components/SVGSelectionOverlay.jsx', import.meta.url), 'utf8');
const annotationLayerSource = await readFile(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const interactionSource = await readFile(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
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

// Desktop height, focus containment and glyph size are measured live in round-6-audit.spec.mjs.

test('every selection mode can hit annotations while Text Select leaves blank page pixels to PDF text', () => {
  assert.match(annotationLayerSource, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select'\)/);
  assert.match(annotationLayerSource, /activeTool !== 'text-select' \|\| textSelectManipulationArmed \|\| interactionState !== 'idle'/);
  assert.match(viewerSource, /textSelectionLayerInteractive=\{activeTool === 'text-select' && textSelectManipulationPageNumber == null\}/);
  assert.match(viewerSource, /const svgInteractive = activeTool === 'select' \|\| activeTool === 'text-select'/);
  assert.match(viewerSource, /if \(!\['select', 'text-select'\]\.includes\(activeTool\)\) return undefined/);
  assert.match(viewerSource, /if \(activeTool !== 'text-select'\) return undefined;[\s\S]*?const QUICK_CLICK_PX = 4;[\s\S]*?const hit = resolveAnnotationAt\(event\);[\s\S]*?setPendingSvgSelection/);
});

test('text copying uses native desktop and mobile controls instead of an app Copy action', () => {
  assert.doesNotMatch(actionBarSource, /aria-label="Copy"|onAction\('copy'\)/);
  assert.doesNotMatch(viewerSource, /copySelectedPdfText|handleTextSelectionAction\('copy'\)|navigator\.clipboard\.writeText\(selection\.text\)/);
  assert.match(textLayerSource, /-webkit-touch-callout:\s*default\s*!important/);
  assert.match(viewerContainerSource, /interactionModeRef\.current === 'TextSelection'[\s\S]{0,140}\.pdfjsTextLayer/);
  assert.match(viewerContainerSource, /const stopNativeSelection = \(event\) => \{[\s\S]{0,100}if \(isNativeInteractionTarget\(event\.target\)\) return;/);
});

test('text range endpoint visuals have separate 44px pointer targets', () => {
  assert.match(selectionOverlaySource, /const textRangeHitSize = 44 \* visualInverseScale/);
  assert.match(selectionOverlaySource, /data-text-range-handle-hit-target="true"/);
  assert.match(selectionOverlaySource, /data-text-range-handle-visual=/);
  assert.match(selectionOverlaySource, /pointerEvents: horizontalResizeOnly \? 'none' : 'auto'/);
  assert.match(selectionOverlaySource, /e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?onHandleDrag/);
});

test('lasso preview matches rectangle paint and has no floating gesture hint', () => {
  assert.match(annotationLayerSource, /data-lasso-selection-preview="true"/);
  assert.doesNotMatch(annotationLayerSource, /data-lasso-selection-halo="true"/);
  assert.doesNotMatch(annotationLayerSource, /data-lasso-gesture-hint="true"/);
  assert.match(annotationLayerSource, /rgba\(0, 100, 255, 0\.15\)/);
  assert.match(annotationLayerSource, /rgba\(0, 200, 100, 0\.15\)/);
  assert.match(annotationLayerSource, /rgba\(0, 100, 255, 0\.8\)/);
  assert.match(annotationLayerSource, /rgba\(0, 200, 100, 0\.8\)/);
  assert.match(annotationLayerSource, /lassoMode === 'fence' \? '' : ' Z'/);
});

test('rectangle selection supports Space mode changes plus Shift add and Alt subtract', () => {
  assert.match(annotationLayerSource, /data-marquee-selection-preview="true"/);
  assert.match(annotationLayerSource, /data-marquee-mode=\{marqueeDirection\}/);
  assert.match(interactionSource, /marqueeStateRef\.current[\s\S]*?cycleMarqueeDirection\(getMarqueeDirection\(current\)\)/);
  assert.match(interactionSource, /shiftHeld:\s*!!e\.shiftKey/);
  assert.match(interactionSource, /altHeld:\s*!!e\.altKey/);
  assert.match(interactionSource, /if \(mq\.altHeld\)/);
  assert.match(interactionSource, /else if \(mq\.shiftHeld\)/);
});

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-22, board 7 owner ruling). This test
 * guarded the phone selection-mode FLYOUT - its repositioning listeners and its
 * 180x152 panel. The owner removed that menu outright ("NO pop-up"), so what it
 * guarded no longer exists. It now guards the replacement: the chip opens no
 * menu at all, and the three modes are reachable from the strip's toggle.
 */
test('the phone Select chip opens no selection-mode menu', () => {
  assert.doesNotMatch(mobileChromeSource, /mobile-select-mode-menu/);
  assert.doesNotMatch(mobileChromeSource, /aria-haspopup="menu"[\s\S]{0,200}Selection mode/);
  assert.doesNotMatch(mobileCss, /mobile-pdf-select-mode__/);
  assert.match(mobileChromeSource, /ariaLabel="Selection mode"[\s\S]{0,400}label: 'Box'/);
});
