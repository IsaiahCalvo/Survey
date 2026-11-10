// Scrolling a big, heavily marked set (2026-11-09, 36-sheet set with 5,400
// marks): guards for the fixes that cut the stalls while scrolling. Measured
// with scripts/perf/scroll-frames.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('a page change while scrolling rides the scroll debounce instead of re-rendering the app shell', () => {
  const viewer = read('src/PDFViewer.jsx');
  const at = viewer.indexOf('const debouncedHandleScroll = () => {');
  assert.ok(at > 0);
  const effect = viewer.slice(at, viewer.indexOf('}, [areViewStatesEqual, normalizeViewState, onViewStateChange,', at));
  assert.match(effect, /viewStateScrolledAtRef\.current = performance\.now\(\);/);
  assert.match(effect, /if \(performance\.now\(\) - viewStateScrolledAtRef\.current < 300\) debounceEmit\(\);\s*else emitViewState\(\);/);
});

test('the viewer scrollbars measure the scroll size only when the content size inputs change', () => {
  const source = read('src/components/PdfjsViewerContainer.jsx');
  const start = source.indexOf('function ViewportScrollbars(');
  const body = source.slice(start, source.indexOf('const requestFrame = useCallback', start));
  assert.match(body, /contentHeight: scroller\.scrollHeight,[\s\S]*\}, \[contentKey, disabled, scrollerRef\]\);/);
  assert.match(source, /contentKey=\{`\$\{layout\.contentW\}\|\$\{layout\.contentHeight\}\|\$\{layout\.padTop\}\|\$\{renderedLiveZoom\}\|\$\{liveTranslateX\}\|\$\{liveTranslateY\}\|\$\{numPages\}`\}/);
});

test('a page drawing waits for its marks layer, with a fallback for a layer that never mounts', () => {
  const css = read('src/styles/pageReveal.css');
  assert.match(css, /\.survey-pdfjs-page-div:not\(\[data-marks-layer\]\) > :not\(\[data-pdfjs-page-overlay-host\]\) \{\s*opacity: 0;/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /pageDiv\.setAttribute\('data-marks-layer', 'true'\);/);
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /pageDiv\.setAttribute\('data-marks-layer', 'late'\);\s*\}, MARKS_LAYER_WAIT_MS\);/);
});

test('the text layer of a page lays out only while the viewer is still', () => {
  const source = read('src/components/PdfjsTextLayer.jsx');
  assert.match(source, /textContentInSlices\(textContent, \{ waitForStill: \(\) => whenViewerStill\(scroller\) \}\)/);
});

test('a page text read waits while the viewer moves (it shares the worker with page drawing)', () => {
  const source = read('src/components/PdfjsTextLayer.jsx');
  const at = source.indexOf('await whenViewerStill(scroller);');
  assert.ok(at > 0 && at < source.indexOf('const textContent = await readPdfjsTextContent(page);'), 'waits before reading the text');
});
