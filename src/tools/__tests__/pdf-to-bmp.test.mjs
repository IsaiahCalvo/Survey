import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBmp } from '../imageWriters.js';

test('BMP: 24-bit, bottom-up rows padded to 4 bytes, colours as BGR', () => {
  // 3x2: top row red, green, blue; bottom row white, black, grey.
  const rgba = Uint8Array.of(
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255,
  );
  const bmp = encodeBmp({ width: 3, height: 2, data: rgba, dpi: 150 });
  const v = new DataView(bmp.buffer);
  assert.equal(String.fromCharCode(bmp[0], bmp[1]), 'BM');
  assert.equal(v.getUint32(2, true), bmp.length);
  assert.equal(v.getUint32(10, true), 54);
  assert.equal(v.getInt32(18, true), 3);
  assert.equal(v.getInt32(22, true), 2);
  assert.equal(v.getUint16(28, true), 24);
  assert.equal(v.getInt32(38, true), 5906); // 150 DPI in pixels a metre
  const row = 12; // 9 bytes rounded up to 12
  assert.equal(bmp.length, 54 + row * 2);
  // First stored row is the bottom one.
  assert.deepEqual([...bmp.subarray(54, 63)], [255, 255, 255, 0, 0, 0, 128, 128, 128]);
  assert.deepEqual([...bmp.subarray(54 + row, 63 + row)], [0, 0, 255, 0, 255, 0, 255, 0, 0]);
});
