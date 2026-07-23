import test from 'node:test';
import assert from 'node:assert/strict';

import { PNG } from 'pngjs';
import { asymmetricNoRepaint } from '../debug/scenarios/eraserPixelOracle.mjs';

function image(fill = 255) {
  const png = new PNG({ width: 20, height: 20 });
  png.data.fill(fill);
  for (let offset = 3; offset < png.data.length; offset += 4) {
    png.data[offset] = 255;
  }
  return png;
}

function setPixel(png, x, y, value) {
  const offset = (y * png.width + x) * 4;
  png.data[offset] = value;
  png.data[offset + 1] = value;
  png.data[offset + 2] = value;
  png.data[offset + 3] = 255;
}

function bytes(png) {
  return PNG.sync.write(png);
}

test('asymmetric pixel oracle rejects a thin regenerated streak', () => {
  const before = image();
  const preview = image();
  const cleanCommit = image();
  const streakCommit = image();

  for (let y = 2; y <= 17; y += 1) {
    for (let x = 6; x <= 13; x += 1) {
      setPixel(before, x, y, 0);
    }
    for (let x = 9; x <= 10; x += 1) {
      setPixel(preview, x, y, 255);
      setPixel(cleanCommit, x, y, 255);
      setPixel(streakCommit, x, y, 255);
    }
    setPixel(streakCommit, 9, y, 0);
  }

  const clean = asymmetricNoRepaint(bytes(before), bytes(preview), bytes(cleanCommit));
  const streak = asymmetricNoRepaint(bytes(before), bytes(preview), bytes(streakCommit));
  assert.ok(clean.interiorErasedPixels > 0);
  assert.equal(clean.regeneratedInteriorPixels, 0);
  assert.ok(
    streak.regeneratedInteriorPixels > 0,
    'one-pixel regenerated center streak must fail the no-repaint oracle',
  );
});
