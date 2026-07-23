import { PNG } from 'pngjs';

function colorDelta(dataA, dataB, offset) {
  return Math.max(
    Math.abs(dataA[offset] - dataB[offset]),
    Math.abs(dataA[offset + 1] - dataB[offset + 1]),
    Math.abs(dataA[offset + 2] - dataB[offset + 2]),
    Math.abs(dataA[offset + 3] - dataB[offset + 3]),
  );
}

export function asymmetricNoRepaint(beforePng, previewPng, committedPng, {
  changedThreshold = 24,
  restoredThreshold = 12,
} = {}) {
  const before = PNG.sync.read(beforePng);
  const preview = PNG.sync.read(previewPng);
  const committed = PNG.sync.read(committedPng);
  if (
    before.width !== preview.width
    || before.height !== preview.height
    || before.width !== committed.width
    || before.height !== committed.height
  ) {
    throw new Error('Pixel oracle images must have identical dimensions');
  }

  const { width, height } = before;
  const erased = new Uint8Array(width * height);
  let erasedPixels = 0;
  for (let index = 0; index < erased.length; index += 1) {
    const offset = index * 4;
    if (colorDelta(before.data, preview.data, offset) > changedThreshold) {
      erased[index] = 1;
      erasedPixels += 1;
    }
  }

  let interiorErasedPixels = 0;
  let regeneratedInteriorPixels = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!erased[index]) continue;
      let interior = true;
      for (let dy = -1; dy <= 1 && interior; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!erased[(y + dy) * width + x + dx]) {
            interior = false;
            break;
          }
        }
      }
      if (!interior) continue;
      interiorErasedPixels += 1;
      const offset = index * 4;
      const returnedToBefore = colorDelta(
        before.data,
        committed.data,
        offset,
      ) <= restoredThreshold;
      const differsFromPreview = colorDelta(
        preview.data,
        committed.data,
        offset,
      ) > changedThreshold;
      if (returnedToBefore && differsFromPreview) regeneratedInteriorPixels += 1;
    }
  }

  return {
    erasedPixels,
    interiorErasedPixels,
    regeneratedInteriorPixels,
    regeneratedRate: interiorErasedPixels > 0
      ? regeneratedInteriorPixels / interiorErasedPixels
      : 0,
  };
}
