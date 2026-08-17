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

test('annotation formatting popovers share one capture-phase dismissal layer', () => {
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

  const peers = [
    [
      "[data-annotation-color-trigger], [data-annotation-color-picker]",
      'bottomToolbarApi?.setShowAnnotationColorPicker?.(false)',
    ],
    [
      '[data-counter-series-menu], [data-counter-series-context-menu]',
      'setShowCounterSeriesMenu(false)',
    ],
    ['[data-style-menu]', 'setShowStyleMenu(false)'],
    ['[data-arrowhead-menu]', 'setShowArrowheadMenu(false)'],
    ['[data-eraser-type-menu]', 'setShowEraserTypeMenu(false)'],
    ['[data-font-color-picker]', 'setShowFontColorPicker(false)'],
    ['[data-font-family-menu]', 'setShowFontFamilyMenu(false)'],
    ['[data-font-size-menu]', 'setShowFontSizeMenu(false)'],
    ['[data-align-grid]', 'setShowAlignGrid(false)'],
  ];

  for (const [selector, closeAction] of peers) {
    assert.ok(
      contract.includes(`if (!inside('${selector}'))`),
      `${selector} must keep only its own popover open`,
    );
    assert.ok(
      contract.includes(closeAction),
      `${selector} must participate in mutual dismissal`,
    );
  }

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
