/**
 * Eraser arming is presentation-only and must never replace an authored
 * centerline with a flattened outline. Partial erase now keeps that exact
 * M/L/Q/C source and applies its bite as a separate clip mask after commit,
 * so the same untouched curve can remain visible before, during, and after
 * the gesture. Filled pressure ink is already its own authored outline and
 * likewise needs no presentation rewrite.
 */
export function projectPaperInkForPresentation(object) {
  return object;
}
