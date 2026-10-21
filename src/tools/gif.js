// Every frame of a moving GIF, as the viewer sees it: each frame is drawn
// over the last one and then cleared or restored as the GIF says. omggif
// (MIT) does the decoding. Pure JS, so it runs in Node tests too.
import { GifReader } from 'omggif';
import { ToolError } from './errors.js';

const MAX_FRAMES = 500;

// Yields { width, height, rgba } per frame. onFrame(i, total) reports progress.
export function* decodeGifFrames(bytes, onFrame) {
  let reader;
  try {
    reader = new GifReader(bytes);
  } catch {
    // omggif reads the whole file first, so a cut-off GIF fails here; the
    // browser can often still show its first frame.
    throw new ToolError('This GIF could not be read frame by frame. It may be damaged. Try "First frame".');
  }
  const { width, height } = reader;
  const total = reader.numFrames();
  if (total > MAX_FRAMES) throw new ToolError(`This GIF has ${total} frames, more than the ${MAX_FRAMES} this tool can take. Use "First frame" instead.`);
  const screen = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < total; i += 1) {
    onFrame?.(i, total);
    const info = reader.frameInfo(i);
    const before = info.disposal === 3 ? screen.slice() : null;
    try {
      reader.decodeAndBlitFrameRGBA(i, screen);
    } catch {
      // Bad picture data partway: keep the frames before it.
      if (!i) throw new ToolError('This GIF could not be read. It may be damaged.');
      return;
    }
    yield { width, height, rgba: screen.slice() };
    if (info.disposal === 2) {
      for (let y = info.y; y < Math.min(height, info.y + info.height); y += 1) {
        screen.fill(0, (y * width + info.x) * 4, (y * width + Math.min(width, info.x + info.width)) * 4);
      }
    } else if (before) screen.set(before);
  }
}
