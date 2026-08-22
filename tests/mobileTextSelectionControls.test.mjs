import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url),
  'utf8',
);

test('mobile Select family keeps the stable three-mode contract', () => {
  assert.match(source, /id: 'select', label: 'Select'/);
  assert.match(source, /id: 'lasso-select', label: 'Lasso Select'[\s\S]{0,80}disabled: true/);
  assert.match(source, /id: 'text-select', label: 'Text Select'/);
});

test('mobile Select reuses its last mode and opens the family on touch hold', () => {
  assert.match(source, /lastSelectModeRef\.current = activeTool/);
  assert.match(source, /selectTool\(lastSelectModeRef\.current\)/);
  assert.match(source, /event\.pointerType !== 'touch'/);
  assert.match(source, /setOpenCategory\('select'\)[\s\S]{0,80}450/);
});
