// Eraser Size must persist per-tool the same way Width / Cloud Bump do.
// Live toolbar writes Size as session eraserSize (1–100). Eraser prefs
// used to omit eraserSize, so Type restored after remount while first
// swipe used default diameter 20 until Size was touched.
// Distinct from leftover-18, D-04 every-preset catalog, remapped Size
// after page CW, and Cloud Bump persist (c02dc616).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  eraserDiameterToPageRadius,
  eraserDiameterToScreenRadius,
} from '../src/utils/eraserSizing.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Eraser default includes Size 20; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /eraser: \{ strokeWidth: 10, eraserSize: 20 \}/,
    'Eraser defaults must stamp Size 20 so remount cannot drop a persisted diameter',
  );
  assert.match(
    db,
    /pen: \{ strokeColor: '#ff0000', strokeWidth: 3, strokeOpacity: 100 \}/,
    'Pen Width stays a separate store — do not write eraserSize onto Pen',
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted Size does not drop',
  );
});

test('tool switch restores Size; Size change persists per tool', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /if \(toolPrefs\.eraserSize !== undefined\) \{\s*\n\s*const nextEraserSize = Math\.max\(1, Math\.min\(100, Number\(toolPrefs\.eraserSize\) \|\| 20\)\);/,
    'switching tools / remount must restore that tool\'s Size, not session default 20',
  );
  assert.match(
    viewer,
    /updateToolPreference\('eraser', \{ eraserSize: next \}\)/,
    'Size field must persist per-tool so a later remount can restore it',
  );
  assert.match(
    viewer,
    /updateToolPreference\('eraser', \{ eraserSize: clamped \}\)/,
    'Size blur must persist the clamped diameter',
  );
});

test('first swipe still uses live Size; default compose is 20', () => {
  const fabric = read('src/components/FabricEraserCanvas.jsx');
  assert.match(
    fabric,
    /eraserDiameterToPageRadius\(eraserSizeRef\.current\)/,
    'first swipe must still read the live Size after the persisted default is applied',
  );
  assert.match(
    fabric,
    /const diameter = Math\.max\(1, Number\(eraserSizeRef\.current\) \|\| 20\) \* displayScale/,
    'cursor diameter default remains 20 when Size has not been set',
  );
  assert.equal(eraserDiameterToPageRadius(20), 10);
  assert.equal(eraserDiameterToPageRadius(40), 20);
  assert.equal(eraserDiameterToScreenRadius(40, 1.5), 30);
});

test('Pen Width store stays isolated; Size is not a Width alias', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(
    shell,
    /activeTool === 'eraser' \? bottomToolbarApi\.eraserSizeInputValue : bottomToolbarApi\.strokeWidthInputValue/,
    'Size field reads eraserSize, not strokeWidth',
  );
  const viewer = read('src/PDFViewer.jsx');
  assert.doesNotMatch(
    viewer,
    /updateToolPreference\(activeTool, \{ eraserSize:/,
    'Size must not write onto the sibling tool the way a leaked Width would',
  );
  assert.match(
    viewer,
    /eraserDiameterToScreenRadius\(eraserSize, scale\)/,
    'cursor still uses container-aware scale, never pageSize * scale',
  );
});
