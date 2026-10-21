// Writes GIFs with gifenc (passed in, so it loads only when needed): each
// frame gets its own best 256 colours. One frame is a still picture; more make
// a moving GIF that loops.
export function gifWriter({ GIFEncoder, quantize, applyPalette }) {
  const gif = GIFEncoder();
  return {
    add(rgba, width, height, delay = 0) {
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
    },
    size: () => gif.bytesView().length,
    finish() {
      gif.finish();
      return gif.bytes();
    },
  };
}
