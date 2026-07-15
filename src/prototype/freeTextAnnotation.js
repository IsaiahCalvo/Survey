import { PDFArray, PDFDict, PDFName } from 'pdf-lib';
import { rectCommands } from './textAnnotation.js';

const numberValue = (value) => (value && typeof value.asNumber === 'function' ? value.asNumber() : null);
const asArray = (value) => (value instanceof PDFArray ? value : null);
const asDict = (value) => (value instanceof PDFDict ? value : null);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function lookup(dict, key, context) {
  const value = dict?.lookup?.(PDFName.of(key));
  if (!value) return null;
  try { return context?.lookup?.(value) || value; } catch { return value; }
}

function decodePdfText(value, context) {
  const resolved = (() => {
    try { return context?.lookup?.(value) || value; } catch { return value; }
  })();
  if (!resolved) return '';
  if (typeof resolved.decodeText === 'function') {
    try { return resolved.decodeText(); } catch { /* use fallback */ }
  }
  if (typeof resolved.asString === 'function') {
    try { return resolved.asString(); } catch { /* use fallback */ }
  }
  return '';
}

function decodeRichText(value, context) {
  return decodePdfText(value, context)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function arrayNumbers(value) {
  const array = asArray(value);
  if (!array) return [];
  const numbers = [];
  for (let index = 0; index < array.size(); index += 1) {
    const current = numberValue(array.lookup(index));
    if (current == null) return [];
    numbers.push(current);
  }
  return numbers;
}

function colorFromArray(value) {
  const values = arrayNumbers(value);
  if (values.length === 1) return [values[0], values[0], values[0]].map(clamp01);
  if (values.length >= 3) return values.slice(0, 3).map(clamp01);
  return null;
}

function rgbCss(rgb, opacity = 1) {
  if (!rgb) return null;
  const [r, g, b] = rgb.map((value) => Math.round(clamp01(value) * 255));
  const alpha = Math.max(0, Math.min(1, Number(opacity) || 0));
  return alpha >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

function cmykToRgb(c, m, y, k) {
  return [
    1 - Math.min(1, clamp01(c) + clamp01(k)),
    1 - Math.min(1, clamp01(m) + clamp01(k)),
    1 - Math.min(1, clamp01(y) + clamp01(k)),
  ];
}

function decodePdfName(value) {
  return String(value || '').replace(/^\//, '').replace(/#([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function singleFontFamily(value) {
  const name = decodePdfName(value).split(',')[0].replace(/["']/g, '').trim();
  if (!name) return 'Helvetica';
  if (/^(helv|helvetica)/i.test(name)) return 'Helvetica';
  if (/^(arial)/i.test(name)) return 'Arial';
  if (/^(times)/i.test(name)) return 'Times New Roman';
  if (/^(cour|courier)/i.test(name)) return 'Courier New';
  return name;
}

export function parseFreeTextAppearance(value) {
  const source = String(value || '');
  const fontMatch = source.match(/\/([^\s]+)\s+([-+]?\d*\.?\d+)\s+Tf\b/i);
  const rgbMatch = source.match(/([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+rg\b/i);
  const grayMatch = source.match(/([-+]?\d*\.?\d+)\s+g\b/i);
  const cmykMatch = source.match(/([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+k\b/i);
  let color = null;
  if (rgbMatch) color = rgbMatch.slice(1, 4).map(Number);
  else if (grayMatch) color = [Number(grayMatch[1]), Number(grayMatch[1]), Number(grayMatch[1])];
  else if (cmykMatch) color = cmykToRgb(...cmykMatch.slice(1, 5).map(Number));
  return {
    fontFamily: singleFontFamily(fontMatch?.[1]),
    fontSize: fontMatch ? Math.max(4, Number(fontMatch[2]) || 12) : 12,
    color: color ? rgbCss(color) : null,
  };
}

function parseDefaultStyle(value) {
  const source = String(value || '');
  const color = source.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim() || null;
  const size = Number(source.match(/font-size\s*:\s*([-+]?\d*\.?\d+)/i)?.[1]);
  const family = source.match(/font-family\s*:\s*([^;]+)/i)?.[1]
    || source.match(/font\s*:[^;]*?\b(?:\d*\.?\d+)(?:pt|px)\s+([^;]+)/i)?.[1]
    || null;
  const align = source.match(/text-align\s*:\s*(left|center|right)/i)?.[1]?.toLowerCase() || null;
  return {
    color,
    fontSize: Number.isFinite(size) && size > 0 ? size : null,
    fontFamily: family ? singleFontFamily(family) : null,
    textAlign: align,
  };
}

function borderWidth(annotation, context) {
  const borderStyle = asDict(lookup(annotation, 'BS', context));
  const styled = numberValue(borderStyle?.lookup?.(PDFName.of('W')));
  if (styled != null) return Math.max(0, styled);
  const border = arrayNumbers(lookup(annotation, 'Border', context));
  return Math.max(0, Number(border[2]) || 0);
}

export function extractFreeTextAnnotation(annotation, viewport, context, index = 0) {
  const rect = arrayNumbers(lookup(annotation, 'Rect', context));
  if (rect.length < 4 || !viewport?.convertToViewportPoint) return null;
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const bounds = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.max(1, Math.abs(x2 - x1)),
    h: Math.max(1, Math.abs(y2 - y1)),
  };
  const contents = decodePdfText(lookup(annotation, 'Contents', context), context)
    || decodeRichText(lookup(annotation, 'RC', context), context);
  const appearance = parseFreeTextAppearance(decodePdfText(lookup(annotation, 'DA', context), context));
  const defaultStyle = parseDefaultStyle(decodePdfText(lookup(annotation, 'DS', context), context));
  const opacityValue = numberValue(lookup(annotation, 'CA', context));
  const opacity = opacityValue == null ? 1 : clamp01(opacityValue);
  const annotationColor = colorFromArray(lookup(annotation, 'C', context));
  const interiorColor = colorFromArray(lookup(annotation, 'IC', context));
  const width = borderWidth(annotation, context);
  const name = decodePdfText(lookup(annotation, 'NM', context), context);
  const alignment = numberValue(lookup(annotation, 'Q', context));
  const rotation = numberValue(lookup(annotation, 'Rotate', context));
  const textColor = defaultStyle.color || appearance.color || rgbCss(annotationColor) || '#111827';

  return {
    id: name ? `FreeText-${name}` : `FreeText${index}`,
    type: 'textbox',
    source: 'pdf',
    pdfAnnotationType: 'FreeText',
    sourcePdfId: name || null,
    text: contents,
    cmds: rectCommands(bounds),
    bounds,
    textColor,
    backgroundColor: interiorColor ? rgbCss(interiorColor) : 'transparent',
    borderColor: width > 0 ? rgbCss(annotationColor || [0, 0, 0]) : null,
    borderWidth: width,
    fontSize: defaultStyle.fontSize || appearance.fontSize,
    fontFamily: defaultStyle.fontFamily || appearance.fontFamily,
    lineHeight: 1.2,
    textAlign: defaultStyle.textAlign || (alignment === 1 ? 'center' : alignment === 2 ? 'right' : 'left'),
    padding: 4,
    opacity,
    angle: Number.isFinite(rotation) ? rotation : 0,
    atomicErase: true,
    eraseByBounds: true,
  };
}
