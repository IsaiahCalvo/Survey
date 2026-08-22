import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for UL-35 toolbar Continue Count series-row.
// Live proof is debug/scenarios/e2e-continue-count-toolbar.spec.mjs.
// Distinct from UL-31 overlay Continue pin.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start > -1, `missing ${startNeedle}`);
  assert.ok(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return src.slice(start, end);
}

test('desktop Counter series menu lists Continue Count rows and switches then re-arms', () => {
  const shell = read('src/AppShell.jsx');
  const block = sliceBetween(shell, 'dataMarker="data-counter-series-menu"', 'showAnnotationColorPicker');
  assert.match(block, /\+ New Count/);
  assert.match(block, /Continue Count/);
  assert.match(block, /onSwitchCounterSeries\(series\.seriesId\)/);
  assert.match(block, /setActiveTool\?\.\('counter'\)/);
  assert.match(block, /aria-label=\{`\$\{series\.label\}, \$\{series\.count\} pins`\}/);
});

test('mobile Counter Series menu lists Continue Count and switches without overlay Continue pin', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  const block = sliceBetween(mobile, 'tool === \'counter\' && (', 'showWidth && tool === \'counter\'');
  assert.match(block, /\+ New Count/);
  assert.match(block, /Continue Count/);
  assert.match(block, /onSwitchCounterSeries\?\.\(series\.seriesId\)/);
  assert.doesNotMatch(block, /Continue pin/);
  assert.doesNotMatch(block, /setActiveTool/);
});

test('handleSwitchCounterSeries no-ops a missing id and paints the next-pin colors', () => {
  const viewer = read('src/PDFViewer.jsx');
  const handler = sliceBetween(viewer, 'const handleSwitchCounterSeries = useCallback((seriesId) => {', 'const [unsupportedAnnotationCounts');
  assert.match(handler, /find\(\(s\) => s\.seriesId === seriesId\)/);
  assert.match(handler, /if \(!series\) \{/);
  assert.match(handler, /activeCounterSeriesIdRef\.current = series\.seriesId/);
  assert.match(handler, /setFillColor\(series\.color\)/);
  assert.match(handler, /setStrokeColor\(series\.numberColor \|\| '#ffffff'\)/);
  assert.doesNotMatch(handler, /setActiveTool\('counter'\)/);
});

test('Continue Count is not the overlay Continue pin contract', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  const counterBlock = sliceBetween(menu, "ctx.kind === 'counter'", "ctx.kind === 'annotation'");
  assert.match(counterBlock, /item\('Continue pin', 'continuePin'/);
  assert.doesNotMatch(counterBlock, /Continue Count/);
  assert.doesNotMatch(counterBlock, /onSwitchCounterSeries/);
});
