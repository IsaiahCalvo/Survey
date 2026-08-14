import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCounterLabelLayout,
  getCounterRenderGeometry,
  updateCounterDragPreview,
} from '../src/utils/counterGeometry.js';
import { pickNextSeriesColor } from '../src/utils/counterNumbering.js';

test('counter label layout fits one to three digits at every small supported radius', () => {
  for (const radius of [4, 5, 6, 14]) {
    let previousFontSize = Infinity;
    for (const label of ['1', '10', '100']) {
      const layout = getCounterLabelLayout(radius, label);
      assert.ok(layout.fontSize > 0, `${radius}/${label}: positive font size`);
      assert.ok(layout.fontSize <= radius * 1.05, `${radius}/${label}: no absolute font floor`);
      assert.ok(
        layout.glyphCount * layout.fontSize * 0.7 <= layout.maxWidth + 1e-12,
        `${radius}/${label}: conservative text width stays inside bubble`,
      );
      assert.ok(layout.fontSize <= previousFontSize, `${radius}/${label}: more digits never grow`);
      previousFontSize = layout.fontSize;
    }
  }
});

test('counter label layout scales with radius instead of stopping at 11', () => {
  for (const label of ['1', '10', '100']) {
    const small = getCounterLabelLayout(4, label);
    const large = getCounterLabelLayout(8, label);
    assert.equal(large.fontSize, small.fontSize * 2);
    assert.equal(large.maxWidth, small.maxWidth * 2);
  }
});

test('counter drag preview uses digit-aware font sizing without stretching glyphs', () => {
  const attrs = new Map();
  const drag = {
    bodyX: 20,
    bodyY: 30,
    radius: 4,
    angle: 225,
    color: '#ef4444',
    displayNumber: 100,
    previewPath: { setAttribute: (name, value) => attrs.set(`path:${name}`, value) },
    previewText: {
      setAttribute: (name, value) => attrs.set(`text:${name}`, value),
      set textContent(value) { attrs.set('text:content', value); },
    },
  };

  updateCounterDragPreview(drag);

  const expected = getCounterRenderGeometry(20, 30, 4, 225, 100);
  assert.equal(Number(attrs.get('text:font-size')), expected.fontSize);
  assert.equal(attrs.has('text:textLength'), false);
  assert.equal(attrs.has('text:lengthAdjust'), false);
  assert.equal(attrs.get('text:content'), '100');
  assert.equal(attrs.get('path:fill'), '#ef4444');
});

test('new counter-series hue selection treats persisted rgba like its hex color', () => {
  const fromHex = pickNextSeriesColor(['#2563eb']);
  assert.equal(pickNextSeriesColor(['rgb(37, 99, 235)']), fromHex);
  assert.equal(pickNextSeriesColor(['rgba(37, 99, 235, 0.45)']), fromHex);
});
