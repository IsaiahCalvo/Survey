import test from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_DEPTH_MAX, normalizeMeasureDepth, wrapMeasureLabelLine } from '../src/utils/measure/measureScale.js';

test('long measure labels wrap at spaces, and long words split', () => {
  const lines = wrapMeasureLabelLine('North wall of the main mechanical room behind the second stair core');
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.length <= 32));
  assert.equal(lines.join(' '), 'North wall of the main mechanical room behind the second stair core');
  assert.deepEqual(wrapMeasureLabelLine('x'.repeat(70)).map((l) => l.length), [32, 32, 6]);
  assert.deepEqual(wrapMeasureLabelLine('Short'), ['Short']);
});

test('depth past the cap is refused', () => {
  assert.equal(normalizeMeasureDepth(1e300), null);
  assert.equal(normalizeMeasureDepth(MEASURE_DEPTH_MAX), MEASURE_DEPTH_MAX);
  assert.equal(normalizeMeasureDepth('2.5'), 2.5);
  assert.equal(normalizeMeasureDepth(0), null);
});

test('an emoji is never cut in half by the wrap', () => {
  const lines = wrapMeasureLabelLine(`${'a'.repeat(31)}🧱${'b'.repeat(40)}`);
  assert.ok(lines.every((l) => !/[\uD800-\uDBFF]$/.test(l) && !/^[\uDC00-\uDFFF]/.test(l)));
  assert.equal(lines.join(''), `${'a'.repeat(31)}🧱${'b'.repeat(40)}`);
});

test('a caption near the page edge is kept on the page', async () => {
  const { layoutMeasureLabel } = await import('../src/utils/measure/measureScale.js');
  const label = { kind: 'area', lines: ['x'.repeat(32), 'y'.repeat(32), '12 ft'], x: 590, y: 5, angle: 0 };
  const box = layoutMeasureLabel(label, 1, { width: 612, height: 792 });
  assert.ok(box.cx + box.width / 2 <= 612 + 1e-6);
  assert.ok(box.cy - box.height / 2 >= -1e-6);
  const free = layoutMeasureLabel(label, 1);
  assert.equal(free.cx, 590);
});

test('emoji built from several code points stay whole in the wrap', () => {
  for (const emoji of ['🇺🇸', '👍🏽', '👨‍👩‍👧', '1️⃣']) {
    const text = `${'a'.repeat(31)}${emoji}${'b'.repeat(40)}`;
    const lines = wrapMeasureLabelLine(text);
    assert.ok(lines[0].endsWith(emoji), `${emoji} split: ${JSON.stringify(lines)}`);
    assert.equal(lines.join(''), text);
  }
  const many = wrapMeasureLabelLine('👩‍💻'.repeat(40));
  assert.ok(many.every((l) => l.startsWith('👩‍💻') && l.endsWith('👩‍💻')));
});

test('a caption wider than the page sits in its middle, not off one edge', async () => {
  const { layoutMeasureLabel } = await import('../src/utils/measure/measureScale.js');
  const label = { kind: 'length', lines: ['x'.repeat(32), 'y'.repeat(32), '3 ft'], fontPx: 18, x: 300, y: 200, angle: 8 };
  const box = layoutMeasureLabel(label, 1, { width: 326, height: 420 });
  assert.ok(box.width > 326 * 0.9);
  assert.equal(box.cx, 163);
});
