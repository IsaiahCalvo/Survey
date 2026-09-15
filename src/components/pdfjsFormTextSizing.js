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
 * ZOOM CONTRACT (2026-09-15): the answer is always a PAGE-UNIT size — the caller
 * applies it as `calc(Npx * var(--total-scale-factor))` — and it is re-derived
 * from the same starting size on every zoom, so it is a function of the current
 * scale alone and never of which zooms the reader passed through. The previous
 * loop ran ONCE inside a requestAnimationFrame at mount, so whichever zoom the
 * field mounted at fixed the answer forever: the notes field in
 * prog-07-form-fields.pdf overflowed its box by 10 CSS px at fit-page (the last
 * line clipped) while fitting exactly at 150%. A single size cannot serve every
 * zoom, because the browser re-wraps the value at each scale and glyph advances
 * at 17px and at 58px are not exact multiples — the same line ends flush with
 * the box at one zoom and spills to a second line at another.
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
