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
