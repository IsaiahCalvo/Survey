import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for UL-31 Continue pin.
// Live proof is debug/scenarios/e2e-continue-pin.spec.mjs.
// Cluster-only e2e-context-menu-spaces only re-armed the overlay.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start > -1, `missing ${startNeedle}`);
  assert.ok(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return src.slice(start, end);
}

test('counter context menu is Continue pin only and calls handleContinuePin', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  const counterBlock = sliceBetween(menu, "ctx.kind === 'counter'", "ctx.kind === 'annotation'");
  assert.match(counterBlock, /item\('Continue pin', 'continuePin'/);
  assert.match(counterBlock, /handleContinuePin\(ctx\)/);
  assert.doesNotMatch(counterBlock, /item\('Delete'/);
  assert.doesNotMatch(counterBlock, /item\('Cut'/);
  assert.doesNotMatch(counterBlock, /item\('Paste'/);
  assert.match(menu, /kind: 'page' \| 'callout' \| 'counter' \| 'annotation' \| 'group'/);
  assert.match(menu, /ctx\.kind === 'counter' \? 'Counter'/);
});

test('empty page / shape / callout menus do not offer Continue pin', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  const pageBlock = menu.slice(menu.lastIndexOf('Empty canvas / page'));
  assert.match(pageBlock, /item\('Paste', 'paste'/);
  assert.doesNotMatch(pageBlock, /Continue pin/);

  const annotationBlock = sliceBetween(menu, "ctx.kind === 'annotation'", "ctx.kind === 'group'");
  assert.doesNotMatch(annotationBlock, /Continue pin/);

  const calloutBlock = sliceBetween(menu, "ctx.kind === 'callout'", "ctx.kind === 'counter'");
  assert.doesNotMatch(calloutBlock, /Continue pin/);
});

test('handleContinuePin switches the pin series then re-arms Counter', () => {
  const viewer = read('src/PDFViewer.jsx');
  const handler = sliceBetween(viewer, 'handleContinuePin: (ctx) => {', 'Unsupported Annotations Notice');
  assert.match(handler, /byIndex\?\.data\?\.seriesId \|\| byId\?\.data\?\.seriesId/);
  assert.match(
    handler,
    /page\?\.objects\?\.find\(\(object\) => object\?\.data\?\.type === 'counter'\)\?\.data\?\.seriesId/,
  );
  assert.match(handler, /if \(seriesId\) handleSwitchCounterSeries\(seriesId\)/);
  assert.match(handler, /setActiveTool\('counter'\)/);
});

test('Continue pin is overlay-gated: hit-test kind counter + overlay only while Counter is armed', () => {
  const hit = read('src/utils/annotationHitTest.js');
  assert.match(hit, /else if \(isCounter\) kind = 'counter'/);
  assert.match(hit, /el\.getAttribute\('data-counter-overlay'\) != null/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /\{activeTool === 'counter' && \(/);
  assert.match(viewer, /data-counter-overlay=\{pageNumber\}/);
  assert.match(viewer, /pointerEvents: 'auto'/);
});
