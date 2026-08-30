import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

const between = (start, end) => {
  const startIndex = appShell.indexOf(start);
  const endIndex = appShell.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing contract start: ${start}`);
  assert.notEqual(endIndex, -1, `missing contract end: ${end}`);
  return appShell.slice(startIndex, endIndex);
};

test('annotation formatting popovers share one exclusive Radix layer', () => {
  const contract = between(
    '// Formatting popovers share one exclusive layer.',
    '// Keyboard/tool-driven selection changes',
  );

  assert.match(
    contract,
    /document\.addEventListener\('mousedown', onDown, true\)/,
    'dismissal must run in capture phase before toolbar triggers stop propagation',
  );
  assert.match(
    contract,
    /document\.removeEventListener\('mousedown', onDown, true\)/,
    'capture-phase listener must be removed with the same capture option',
  );

  assert.match(appShell, /const \[openAnnotationDropdown, setOpenAnnotationDropdown\] = useState\(null\)/);
  assert.match(appShell, /const setDropdownOpen = useCallback/);
  assert.match(
    contract,
    /const insideDropdown = inside\('\[data-annotation-size-control\].*\[data-annotation-dropdown-popover\].*\[data-counter-series-context-menu\]'\)/,
    'portaled dropdown content must count as inside before capture-phase dismissal',
  );
  assert.match(contract, /if \(!insideDropdown\) \{\s*setOpenAnnotationDropdown\(null\)/);
  assert.ok((appShell.match(/<AnnotationDropdown/g) || []).length >= 7, 'annotation menus must use the shared Radix dropdown');

  assert.match(appShell, /data-annotation-color-trigger/);
  assert.match(appShell, /data-annotation-color-picker/);
});

test('annotation context changes dismiss the color panel and formatting peers', () => {
  const contract = between(
    '// Keyboard/tool-driven selection changes',
    '/*\n   * LeftRail/PDFSidebar API audit',
  );

  assert.match(contract, /bottomToolbarApi\?\.setShowAnnotationColorPicker\?\.\(false\)/);
  assert.match(contract, /setShowCounterSeriesMenu\(false\)/);
  assert.match(contract, /setShowStyleMenu\(false\)/);
  assert.match(contract, /setShowArrowheadMenu\(false\)/);
  assert.match(contract, /setShowEraserTypeMenu\(false\)/);
  assert.match(
    contract,
    /\}, \[bottomToolbarApi\?\.contextTool\]\);/,
    'selection/tool context must be the dismissal dependency',
  );
});

test('text markup swatches anchor the shared color panel below the top sub-toolbar', () => {
  assert.match(appShell, /const isTextMarkupPalette = \['text-markup', 'text-select'\]\.includes\(bottomToolbarApi\.contextTool\)/);
  assert.match(appShell, /document\.getElementById\('chrome-sub-toolbar-host'\)\?\.getBoundingClientRect\?\.\(\)/);
  assert.match(appShell, /position: isTextMarkupPalette \? 'fixed' : 'absolute'/);
  assert.match(appShell, /zIndex: isTextMarkupPalette \? 5900 : 2000/);
});

test('desktop overlap mode stays available while creating or editing text marks', () => {
  assert.match(
    appShell,
    /\{\['text-markup', 'text-select'\]\.includes\(bottomToolbarApi\.contextTool\) && bottomToolbarApi\.setTextMarkupOverlapMode/,
  );
});
