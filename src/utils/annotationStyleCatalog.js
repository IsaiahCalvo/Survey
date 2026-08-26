/**
 * Shared annotation style catalogs — color swatches, offered fonts/sizes,
 * hex parsing, and PDF Standard-14 font mapping.
 *
 * CompactColorPicker, AppShell, MobilePdfViewerChrome, and the pdf-lib
 * export/print writers all import from here so the Node E2E suite can
 * prove every discrete swatch/font/size without a live Electron window.
 *
 * Font families are SINGLE NAMES only (CLAUDE.md 2026-04-08 Fabric
 * cursor-drift gotcha). Never put a CSS fallback stack in FONT_FAMILIES.
 */

/** Discrete grid swatches in CompactColorPicker (first cell may become Match Fill). */
export const COLOR_PICKER_PRESETS = Object.freeze([
  'transparent',
  '#FF0000',
  '#FF0080',
  '#FF00FF',
  '#8000FF',
  '#0000FF',
  '#0080FF',
  '#00FFFF',
  '#00FF80',
  '#00FF00',
  '#80FF00',
  '#FFFF00',
  '#FF8000',
  '#FFFFFF',
  '#808080',
  '#000000',
]);

/** Offered text font families — single names only, never CSS stacks. */
export const FONT_FAMILIES = Object.freeze([
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana',
]);

/** Offered font-size dropdown presets (pt). Live values outside this list are prepended. */
export const FONT_SIZE_PRESETS = Object.freeze([
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72,
]);

export const TEXT_FORMAT_TOGGLES = Object.freeze(['bold', 'italic', 'underline', 'strike']);

/** Horizontal aligns offered in the 3×3 grid. `justify` is accepted on commit but not offered. */
export const TEXT_ALIGN_HORIZONTAL = Object.freeze(['left', 'center', 'right']);

export const TEXT_ALIGN_HORIZONTAL_ACCEPTED = Object.freeze(['left', 'center', 'right', 'justify']);

export const TEXT_ALIGN_VERTICAL = Object.freeze(['top', 'middle', 'bottom']);

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/**
 * Normalize a hex-field value to `#RRGGBB` (uppercase).
 * Accepts `#rgb`, `rgb`, `#rrggbb`, `rrggbb`. Returns null for invalid input
 * (named colors, rgba(), stacks, wrong length, non-hex digits).
 */
export function normalizeHexColor(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'transparent') return null;
  const six = HEX6.exec(trimmed);
  if (six) return `#${six[1].toUpperCase()}`;
  const three = HEX3.exec(trimmed);
  if (three) {
    const [r, g, b] = three[1];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function isValidHexColor(raw) {
  return normalizeHexColor(raw) !== null;
}

/** Discrete color swatches only (excludes the transparent cell). */
export function colorPickerSolidPresets() {
  return COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
}

/**
 * Convert `#RRGGBB` to HSV. Returns null for non-hex input.
 * Same contract CompactColorPicker uses to aim the spectrum at the live color.
 */
export function hexToHsv(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const n = parseInt(normalized.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

/**
 * First-name-only fontFamily. Rejects CSS fallback stacks (comma) by taking
 * the first token and stripping quotes. Empty → fallback.
 */
export function sanitizeOfferedFontFamily(raw, fallback = 'Arial') {
  if (raw == null) return fallback;
  const first = String(raw).split(',')[0];
  if (!first) return fallback;
  const stripped = first.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!stripped) return fallback;
  const offered = FONT_FAMILIES.find((name) => name.toLowerCase() === stripped.toLowerCase());
  return offered || stripped;
}

export function isSingleNameFontFamily(raw) {
  return typeof raw === 'string'
    && raw.length > 0
    && !raw.includes(',')
    && !/sans-serif|serif|monospace|system-ui|ui-sans|ui-serif|ui-monospace|-apple-system|BlinkMacSystemFont/i.test(raw);
}

/**
 * Map an offered (or imported) family onto a PDF Standard-14 family group.
 * Georgia → Times, Verdana/Arial → Helvetica — Standard-14 has no Georgia/Verdana/Arial.
 */
export function pdfStandardFontGroup(fontFamily) {
  const name = sanitizeOfferedFontFamily(fontFamily, 'Helvetica').toLowerCase();
  if (name === 'times new roman' || name === 'times' || name === 'georgia' || name.startsWith('times')) {
    return 'times';
  }
  if (name === 'courier new' || name === 'courier' || name.startsWith('courier')) {
    return 'courier';
  }
  return 'helvetica';
}

/**
 * PDF /DA font resource name for FreeText export.
 * Helvetica regular stays `Helv` (Acrobat-common short name, existing contract).
 */
export function pdfDefaultAppearanceFontName(fontFamily, { bold = false, italic = false } = {}) {
  const group = pdfStandardFontGroup(fontFamily);
  if (group === 'times') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (group === 'courier') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helv';
}

export function clampFontSize(n, fallback = 16) {
  return Math.max(6, Math.min(200, Math.round(Number(n) || fallback)));
}

export function sanitizeTextAlign(value) {
  return TEXT_ALIGN_HORIZONTAL_ACCEPTED.includes(value) ? value : 'left';
}

export function sanitizeVerticalAlign(value) {
  return TEXT_ALIGN_VERTICAL.includes(value) ? value : 'top';
}

/**
 * Extra screen-space Y to shift the flattened text block so middle/bottom
 * match renderText. Top (or unknown) stays 0.
 */
export function flattenedTextBlockOffset(boxHeight, contentHeight, verticalAlign) {
  const free = Math.max(0, (Number(boxHeight) || 0) - (Number(contentHeight) || 0));
  const align = sanitizeVerticalAlign(verticalAlign);
  if (align === 'bottom') return free;
  if (align === 'middle') return free / 2;
  return 0;
}

/**
 * Extra screen-space X to shift a flattened line so center/right match
 * renderText. Left, justify (accepted but not offered), and unknown stay 0.
 */
export function flattenedTextInlineOffset(boxWidth, lineWidth, textAlign) {
  const free = Math.max(0, (Number(boxWidth) || 0) - (Number(lineWidth) || 0));
  const align = sanitizeTextAlign(textAlign);
  if (align === 'right') return free;
  if (align === 'center') return free / 2;
  return 0;
}

/**
 * PDF FreeText /Q quadding (spec 12.7.4.3): 0 left, 1 center, 2 right.
 * Justify has no /Q value — export it as left like flatten.
 */
export function pdfFreeTextQuadding(textAlign) {
  const align = sanitizeTextAlign(textAlign);
  if (align === 'center') return 1;
  if (align === 'right') return 2;
  return 0;
}

/**
 * Live callout boxes store Fill as style.fillColor + style.fillOpacity
 * (toolbar / defaultCalloutStyle). A few import leftovers still carry
 * style.backgroundColor. Export/flatten used the leftover key and then
 * defaulted flatten to #ffffff — so a transparent on-screen box printed
 * white and a user-picked fill never reached FreeText /C.
 */
export function resolveCalloutBoxFill(style = {}) {
  const live = style?.fillColor;
  const leftover = style?.backgroundColor;
  const raw = (live && live !== 'transparent') ? live : (leftover || live || null);
  if (raw == null || raw === '' || raw === 'transparent') {
    return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  }
  const hex = normalizeHexColor(raw);
  if (!hex) return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  const opacity = Number.isFinite(Number(style?.fillOpacity))
    ? Math.max(0, Math.min(1, Number(style.fillOpacity)))
    : 1;
  if (opacity <= 0) return { hex, opacity: 0, visible: false, paint: 'transparent' };
  if (opacity >= 1) return { hex, opacity: 1, visible: true, paint: hex };
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { hex, opacity, visible: true, paint: `rgba(${r}, ${g}, ${b}, ${opacity})` };
}

/**
 * Live callout Stroke/Opacity is style.borderColor + style.borderOpacity
 * (toolbar Color Border + Opacity). lineColor is an import leftover.
 * Export Line pieces omitted /CA and flatten stroked hex at opacity 1, so a
 * user-picked Opacity printed and exported opaque. /C stays the stroke hex.
 */
export function resolveCalloutBorder(style = {}) {
  const live = style?.borderColor;
  const leftover = style?.lineColor;
  const raw = (live && live !== 'transparent') ? live : (leftover || live || null);
  if (raw == null || raw === '' || raw === 'transparent') {
    return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  }
  const hex = normalizeHexColor(raw);
  if (!hex) return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  const opacity = Number.isFinite(Number(style?.borderOpacity))
    ? Math.max(0, Math.min(1, Number(style.borderOpacity)))
    : 1;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (opacity <= 0) return { hex, opacity: 0, visible: false, paint: `rgba(${r}, ${g}, ${b}, 0)` };
  if (opacity >= 1) return { hex, opacity: 1, visible: true, paint: hex };
  return { hex, opacity, visible: true, paint: `rgba(${r}, ${g}, ${b}, ${opacity})` };
}

const rgbaPaint = (r, g, b, opacity) => {
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  if (opacity <= 0) return { hex, opacity: 0, visible: false, paint: 'transparent' };
  if (opacity >= 1) return { hex, opacity: 1, visible: true, paint: hex };
  return { hex, opacity, visible: true, paint: `rgba(${r}, ${g}, ${b}, ${opacity})` };
};

/**
 * Live textbox Fill is style.backgroundColor (toolbar patchSelectedFill).
 * `fill` is the glyph / fontColor — never treat it as a leftover box fill.
 * New text commits an empty background until Color Fill patches it. Export
 * /C is RGB-only — faded rgba must ride ExtGState /ca on /AP (flatten
 * already used paint.opacity). Opacity-0 / empty omit /C.
 */
export function resolveTextboxBoxFill(obj = {}) {
  const raw = obj?.backgroundColor;
  if (raw == null || raw === '' || raw === 'transparent') {
    return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  }
  if (typeof raw === 'string') {
    const rgba = raw.match(/^rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
    if (rgba) {
      const r = Math.round(Math.max(0, Math.min(255, Number(rgba[1]))));
      const g = Math.round(Math.max(0, Math.min(255, Number(rgba[2]))));
      const b = Math.round(Math.max(0, Math.min(255, Number(rgba[3]))));
      const opacity = rgba[4] != null && Number.isFinite(Number(rgba[4]))
        ? Math.max(0, Math.min(1, Number(rgba[4])))
        : 1;
      return rgbaPaint(r, g, b, opacity);
    }
  }
  const hex = normalizeHexColor(raw);
  if (!hex) return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  return { hex, opacity: 1, visible: true, paint: hex };
}

const resolvePaintColor = (raw) => {
  if (raw == null || raw === '' || raw === 'transparent' || raw === 'none') {
    return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  }
  if (typeof raw === 'string') {
    const rgba = raw.match(/^rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
    if (rgba) {
      const r = Math.round(Math.max(0, Math.min(255, Number(rgba[1]))));
      const g = Math.round(Math.max(0, Math.min(255, Number(rgba[2]))));
      const b = Math.round(Math.max(0, Math.min(255, Number(rgba[3]))));
      const opacity = rgba[4] != null && Number.isFinite(Number(rgba[4]))
        ? Math.max(0, Math.min(1, Number(rgba[4])))
        : 1;
      return rgbaPaint(r, g, b, opacity);
    }
  }
  const hex = normalizeHexColor(raw);
  if (!hex) return { hex: null, opacity: 0, visible: false, paint: 'transparent' };
  return { hex, opacity: 1, visible: true, paint: hex };
};

/**
 * Live textbox Border/Width/Style is style.stroke + style.strokeWidth +
 * style.strokeDashArray (toolbar patchSelectedStroke /
 * handleStrokeWidthChange / handleLineBorderStyleChange). First-create
 * stamps next-draw Color Border + Width + Opacity + Style
 * (composeAnnotationColor of strokeColor + strokeOpacity, same as
 * selected-patch; dash from lineBorderStyle). Color Border + Width +
 * Opacity + Style also patch those keys after select. Export /Border was
 * hard-coded [0,0,0] and flatten never painted the stroke, so a
 * user-picked box never printed. Glyph `fill` is the font color — never
 * a leftover border.
 */
/**
 * Live rectangle/ellipse Fill is obj.fill (toolbar composeAnnotationColor
 * of fillColor + fillOpacity). Export Square/Circle wrote /IC from the hex
 * only and a single /CA cannot represent fill vs stroke, so a faded fill
 * printed and exported opaque. /C stays the stroke hex.
 */
export function resolveShapeFill(obj = {}) {
  return resolvePaintColor(obj?.fill);
}

/**
 * Live Counter Number color is data.numberColor (toolbar composeColorForPatch
 * of strokeColor + strokeOpacity on the Number tab). Flatten already honors
 * parsePdfDrawColor opacity. Export Circle /AP painted the label hex-only
 * (and Fill /ca reset before the number), so a faded Number reached Acrobat
 * opaque. Independent of pin-body /ca.
 */
export function resolveCounterNumberColor(obj = {}) {
  return resolvePaintColor(obj?.data?.numberColor || obj?.numberColor || '#ffffff');
}

/**
 * Live rectangle/ellipse Border is obj.stroke + obj.strokeWidth (toolbar
 * composeAnnotationColor of strokeColor + strokeOpacity). Export omitted
 * stroke /CA and flatten already has borderOpacity — keep them independent.
 */
export function resolveShapeStroke(obj = {}) {
  const width = Number(obj?.strokeWidth);
  const paint = resolvePaintColor(obj?.stroke);
  const dash = Array.isArray(obj?.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.map((value) => Number(value) || 0)
    : null;
  if (!Number.isFinite(width) || width <= 0 || !paint.visible) {
    return {
      hex: paint.hex,
      opacity: paint.visible ? paint.opacity : 0,
      visible: false,
      paint: 'transparent',
      width: Number.isFinite(width) ? Math.max(0, width) : 0,
      dash: null,
    };
  }
  return { ...paint, width, dash };
}

export function resolveTextboxBoxStroke(obj = {}) {
  const width = Number(obj?.strokeWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return {
      hex: null,
      opacity: 0,
      visible: false,
      paint: 'transparent',
      width: 0,
      dash: null,
    };
  }
  const paint = resolvePaintColor(obj?.stroke);
  const dash = Array.isArray(obj?.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.map((value) => Number(value) || 0)
    : null;
  if (!paint.visible) {
    return {
      hex: null,
      opacity: 0,
      visible: false,
      paint: 'transparent',
      width,
      dash: null,
    };
  }
  return { ...paint, width, dash };
}

const clampUnit = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * On-screen families that have no Standard-14 glyph set. They stay offered
 * (CSS paints them) and export/print through `pdfStandardFontGroup`.
 */
export const FONT_FAMILY_PDF_SUBSTITUTES = Object.freeze({
  Georgia: 'Times-Roman',
  Verdana: 'Helvetica',
  Arial: 'Helvetica',
});

export function pdfSafeFontFamilyNote(fontFamily) {
  const group = pdfStandardFontGroup(fontFamily);
  const da = pdfDefaultAppearanceFontName(fontFamily);
  return { group, daName: da, substitute: FONT_FAMILY_PDF_SUBSTITUTES[fontFamily] || null };
}

/** Inverse of hexToHsv — same formula CompactColorPicker uses for the spectrum. */
export function hsvToHex(h, s, v) {
  const hue = clampUnit(Number(h) || 0, 0, 360);
  const sat = clampUnit(Number(s) || 0, 0, 100);
  const val = clampUnit(Number(v) || 0, 0, 100);
  const f = (n, k = (n + hue / 60) % 6) => val / 100 - (val / 100) * sat / 100 * Math.max(Math.min(k, 4 - k, 1), 0);
  const toHex = (c) => (`0${Math.round(f(c) * 255).toString(16)}`).slice(-2);
  return `#${toHex(5)}${toHex(3)}${toHex(1)}`.toUpperCase();
}

export const SPECTRUM_SV_KEYS = Object.freeze([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);

export const SPECTRUM_HUE_KEYS = Object.freeze([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);

/** Discrete SV keyboard steps. Returns null for unused keys. */
export function applySpectrumKey(key, saturation, value) {
  let nextS = saturation;
  let nextV = value;
  switch (key) {
    case 'ArrowLeft': nextS = clampUnit(saturation - 1, 0, 100); break;
    case 'ArrowRight': nextS = clampUnit(saturation + 1, 0, 100); break;
    case 'ArrowUp': nextV = clampUnit(value + 1, 0, 100); break;
    case 'ArrowDown': nextV = clampUnit(value - 1, 0, 100); break;
    case 'PageUp': nextV = clampUnit(value + 10, 0, 100); break;
    case 'PageDown': nextV = clampUnit(value - 10, 0, 100); break;
    case 'Home': nextS = 0; break;
    case 'End': nextS = 100; break;
    default: return null;
  }
  return { saturation: nextS, value: nextV };
}

/** Discrete hue keyboard steps. Returns null for unused keys. */
export function applyHueKey(key, hue) {
  let nextHue = hue;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown': nextHue = clampUnit(hue - 1, 0, 360); break;
    case 'ArrowRight':
    case 'ArrowUp': nextHue = clampUnit(hue + 1, 0, 360); break;
    case 'PageDown': nextHue = clampUnit(hue - 10, 0, 360); break;
    case 'PageUp': nextHue = clampUnit(hue + 10, 0, 360); break;
    case 'Home': nextHue = 0; break;
    case 'End': nextHue = 360; break;
    default: return null;
  }
  return nextHue;
}

export function clampOpacityPercent(raw, minOpacity = 0) {
  const min = clampUnit(Number(minOpacity) || 0, 0, 1) * 100;
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return clampUnit(Math.round(n), min, 100);
}

/**
 * Pure picker apply — transparent / Match Fill / hex + minOpacity.
 * `rememberedOpacityPct` is the slider value kept while transparentMode is on.
 */
export function applyColorPickerSelection({
  input,
  currentHex = '#000000',
  rememberedOpacityPct = 100,
  minOpacity = 0,
  matchFillColor = null,
  matchFillOpacity = 1,
} = {}) {
  if (input === 'transparent') {
    return {
      kind: 'transparent',
      hex: currentHex,
      opacity: 0,
      transparentMode: true,
      rememberedOpacityPct: clampOpacityPercent(rememberedOpacityPct, 0),
    };
  }
  if (input === '__match__') {
    const hex = normalizeHexColor(matchFillColor) || '#FFFFFF';
    const opacity = clampUnit(
      typeof matchFillOpacity === 'number' ? matchFillOpacity : 1,
      0,
      1,
    );
    return {
      kind: 'match',
      hex,
      opacity,
      transparentMode: false,
      rememberedOpacityPct: clampOpacityPercent(opacity * 100, minOpacity),
    };
  }
  const hex = normalizeHexColor(input);
  if (!hex) {
    return {
      kind: 'invalid',
      hex: currentHex,
      opacity: clampOpacityPercent(rememberedOpacityPct, minOpacity) / 100,
      transparentMode: false,
      rememberedOpacityPct: clampOpacityPercent(rememberedOpacityPct, minOpacity),
    };
  }
  const opacity = clampOpacityPercent(rememberedOpacityPct, minOpacity) / 100;
  return {
    kind: 'hex',
    hex,
    opacity,
    transparentMode: false,
    rememberedOpacityPct: clampOpacityPercent(rememberedOpacityPct, minOpacity),
  };
}

/**
 * Word-wrap + explicit newlines for print flatten decorations.
 * `measure(text)` returns width in the same units as maxWidth.
 */
export function wrapFlattenedTextLines(text, { measure, maxWidth }) {
  const cap = Math.max(1, Number(maxWidth) || 1);
  const measureWidth = typeof measure === 'function' ? measure : () => cap;
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.length === 0 ? [''] : paragraph.split(/(\s+)/).filter((part) => part.length > 0);
    let current = '';
    for (const word of words) {
      const next = current + word;
      let width = cap;
      try { width = measureWidth(next); } catch { width = cap; }
      if (current && width > cap) {
        lines.push(current);
        current = word.trimStart();
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}
