import assert from 'node:assert/strict';
import test from 'node:test';

import { getPdfjsFormTextSizing } from '../src/components/pdfjsFormTextSizing.js';

test('multiline widget keeps a non-zero DA font size and fits its own line boxes', () => {
  const sizing = getPdfjsFormTextSizing({
    fieldType: 'Tx',
    multiLine: true,
    rect: [319.5, 499.5, 550.5, 574.5],
    fieldValue: 'First line\nSecond line\nThird line',
    borderStyle: { width: 1 },
    defaultAppearanceData: { fontSize: 17 },
  });

  assert.equal(sizing.fontSize, 17);
  assert.equal(sizing.autoSized, false);
  assert.equal('lineHeight' in sizing, false, 'the textarea keeps its own line height');
});

test('multiline widget auto-sizes only when DA font size is zero', () => {
  const sizing = getPdfjsFormTextSizing({
    fieldType: 'Tx',
    multiLine: true,
    rect: [0, 0, 200, 56],
    fieldValue: 'First\nSecond',
    borderStyle: { width: 1 },
    defaultAppearanceData: { fontSize: 0 },
  });

  assert.equal(sizing.fontSize, 20);
  assert.equal(sizing.autoSized, true);
});

test('missing or invalid DA font size does not trigger auto-size', () => {
  const base = {
    fieldType: 'Tx',
    multiLine: true,
    rect: [0, 0, 200, 56],
    fieldValue: 'First\nSecond',
  };

  assert.equal(getPdfjsFormTextSizing(base), null);
  assert.equal(getPdfjsFormTextSizing({
    ...base,
    defaultAppearanceData: { fontSize: -1 },
  }), null);
});
