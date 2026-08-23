import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appShell = read('../src/AppShell.jsx');
const colorPicker = read('../src/components/CompactColorPicker.jsx');

test('both desktop CompactColorPicker mounts passthrough Width / Style / Font siblings', () => {
  const constStart = appShell.indexOf('const COLOR_PICKER_SIBLING_PASSTHROUGH');
  assert.notEqual(constStart, -1, 'shared sibling passthrough constant');
  const constEnd = appShell.indexOf('].join(', constStart);
  const list = appShell.slice(constStart, constEnd);
  for (const selector of [
    '.annotation-dropdown__trigger',
    '[data-font-family-menu]',
    '[data-font-size-menu]',
    '[data-annotation-size-control]',
    '[data-style-menu]',
    '[data-arrowhead-menu]',
    '[data-eraser-type-menu]',
    '[data-align-grid]',
  ]) {
    assert.match(list, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const mounts = appShell.match(/passthroughSelector=\{COLOR_PICKER_SIBLING_PASSTHROUGH\}/g) || [];
  assert.equal(mounts.length, 2, 'font-color + annotation-color pickers share the list');
  assert.doesNotMatch(appShell, /passthroughSelector="\.annotation-dropdown__trigger, \[data-font-family-menu\]/);
  assert.match(colorPicker, /click Width or Font twice after typing a hex value/);
});
