const PDF_LINE_FACTOR = 1.35;
// Matches pdf.js AnnotationLayer's fixed two-unit total text inset.
const PDF_WIDGET_BORDER_SIZE = 2;

const explicitLineCount = (widget) => {
  if (Array.isArray(widget?.textContent) && widget.textContent.length > 0) {
    return widget.textContent.length;
  }
  return Math.max(1, String(widget?.fieldValue || '').split('\n').length);
};

export function getPdfjsFormTextSizing(widget) {
  if (widget?.fieldType !== 'Tx' || widget?.multiLine !== true) return null;
  const rawDaFontSize = widget.defaultAppearanceData?.fontSize;
  const daFontSize = Number(rawDaFontSize);
  if (!Number.isFinite(daFontSize) || daFontSize < 0) return null;
  if (daFontSize === 0) {
    const rect = widget.rect;
    if (!Array.isArray(rect) || rect.length < 4) return null;
    const height = Math.max(0, Math.abs(Number(rect[3]) - Number(rect[1])) - PDF_WIDGET_BORDER_SIZE);
    if (!Number.isFinite(height) || height <= 0) return null;
    const contentLines = explicitLineCount(widget);
    const lineHeight = height / contentLines;
    return {
      fontSize: Math.round((lineHeight / PDF_LINE_FACTOR) * 10) / 10,
      autoSized: true,
    };
  }

  return {
    fontSize: daFontSize,
    autoSized: false,
  };
}

/**
 * Shrink a multiline widget's font until its wrapped text stops overflowing its
 * own box.
 *
 * The /DA size (or the auto-size derived from the line count) is only a
 * starting point: a long line can wrap at that size and push the last line out
 * of view, while the file's own stored appearance shows it fitting. The caller
 * supplies `measure(fontSize) -> { scrollHeight, clientHeight }`; keeping the
 * measurement injected is what lets the loop be tested without a browser AND
 * what lets the caller measure in PAGE UNITS instead of at whatever zoom the
 * field happened to mount at.
 *
 * ZOOM CONTRACT (2026-09-15, rewritten the same day — ZOOM-INVARIANT)
 * -------------------------------------------------------------------
 * The answer is a PAGE-UNIT size that DOES NOT DEPEND ON THE ZOOM AT ALL. The
 * same size, the same wrap and the same line breaks at 24% as at 447%.
 *
 * How that is possible: the caller lays the control out at its page-unit size
 * (`width: <pageW>px; height: <pageH>px; font-size: <pageUnits>px`) and maps it
 * onto the page with ONE uniform `transform: scale(--scale-factor)`. A CSS
 * transform is applied after layout, so the browser wraps the value exactly
 * once, in page units, and the zoom only rasterises the result. `measure()`
 * therefore reports page units — `scrollHeight` / `clientHeight` are layout
 * values, which transforms never touch — and the loop below is a pure function
 * of the widget's page box and its text.
 *
 * What this replaced, and why the replacement is not merely tidier:
 *   - v1 ran the loop ONCE inside a requestAnimationFrame at mount, so whichever
 *     zoom the field mounted at fixed the answer forever (the notes field in
 *     prog-07-form-fields.pdf overflowed its box by 10 CSS px at fit-page — the
 *     last line clipped — while fitting exactly at 150%).
 *   - v2 re-ran it on every scale change, which fixed the clipping but only
 *     after a frame (measured: the value overflowed for up to 1.5 s after a zoom
 *     step before the second refit landed) and still let the BROWSER choose the
 *     wrap at each scale: glyph advances at 17px and at 58px are not exact
 *     multiples, so the same line ended flush with the box at one zoom and
 *     spilled to a second line at another, and the settled page-unit size drifted
 *     ±3% across the ladder (16.5 here, 17 there).
 *   - v3 (this one) takes the zoom out of the layout instead of chasing it. There
 *     is no per-zoom refit to be late, because there is nothing per-zoom to do:
 *     `multilineFitSignature` is what the answer depends on, and the scale is not
 *     in it.
 *
 * @param {object} options
 * @param {(fontSize: number) => ({ scrollHeight: number, clientHeight: number } | null)} options.measure
 * @param {number} options.startFontSize  page-unit size to start from
 * @param {number} [options.minFontSize]  never shrink below this
 * @param {number} [options.step]         page units removed per attempt
 * @param {number} [options.maxSteps]
 * @returns {number} the page-unit font size to apply
 */
export function fitMultilineFontSize({
  measure,
  startFontSize,
  minFontSize = 6,
  step = 0.5,
  maxSteps = 24,
}) {
  let fontSize = Number(startFontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return startFontSize;
  if (typeof measure !== 'function') return fontSize;
  for (let attempt = 0; attempt < maxSteps && fontSize > minFontSize; attempt += 1) {
    let box = null;
    try { box = measure(fontSize); } catch { return fontSize; }
    if (!box || !Number.isFinite(box.scrollHeight) || !Number.isFinite(box.clientHeight)) return fontSize;
    if (box.scrollHeight <= box.clientHeight + 1) return fontSize;
    fontSize = Math.round((fontSize - step) * 10) / 10;
  }
  return Math.max(fontSize, minFontSize);
}

/**
 * Everything the fit above is allowed to depend on — the widget's PAGE box, its
 * starting page-unit size, and the text being laid out.
 *
 * The zoom is deliberately not an input. The caller keeps the last signature and
 * skips the work when it is unchanged, which means a zoom step does exactly
 * nothing to a multiline field: no re-measure, no re-wrap, no frame of overflow
 * while a refit lands. A widget whose page box really did change (a page swap, a
 * rotation, a re-render) produces a new signature and re-fits synchronously.
 *
 * Passing a scale in here would reintroduce the whole defect class, so it has
 * no parameter for one.
 */
export function multilineFitSignature({ pageWidth, pageHeight, startFontSize, value } = {}) {
  const round = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 1000) / 1000 : 0);
  return [
    round(pageWidth),
    round(pageHeight),
    round(startFontSize),
    String(value ?? ''),
  ].join('|');
}
