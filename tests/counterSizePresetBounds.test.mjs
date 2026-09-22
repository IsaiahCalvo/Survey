import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const appShellSource = read('../src/AppShell.jsx');
const viewerSource = read('../src/PDFViewer.jsx');
const mobileSource = read('../src/mobile/MobilePdfViewerChrome.jsx');

test('every counter size control accepts presets through 76 without widening other tools', () => {
  assert.match(
    appShellSource,
    /contextTool === 'counter'\s*\? COUNTER_SIZE_MAX\s*:\s*50/,
  );
  assert.match(
    mobileSource,
    /const sizeMax = isEraser \? 100 : tool === 'counter' \? COUNTER_SIZE_MAX : 50;/,
  );
  /*
   * RULED CHANGE 2026-09-22 (the "Aa" sheet rebuilt to the pass-7 sheet
   * vocabulary). The sheet's typed size field used to spell the counter's bound
   * out again - max={tool === 'counter' ? COUNTER_SIZE_MAX : 50} - a second copy
   * of the ternary asserted one line above. The rebuilt row reads `sizeMin` and
   * `sizeMax`, the values that same ternary already produces for the strip's
   * width pill, so the two controls cannot disagree about what a legal size is
   * and there is one copy of the bound instead of two. Same contract, one source.
   */
  assert.match(mobileSource, /min=\{sizeMin\}\s*\n\s*max=\{sizeMax\}/);
  const counterAwareMaxes = viewerSource.match(
    /const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50;/g,
  ) || [];
  assert.equal(counterAwareMaxes.length, 2);
  assert.match(
    viewerSource,
    /activeTool === 'counter'[\s\S]*?COUNTER_SIZE_MIN[\s\S]*?COUNTER_SIZE_MAX/,
  );
});
