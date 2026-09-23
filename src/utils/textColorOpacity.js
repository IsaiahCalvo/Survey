/**
 * Text colour WITH opacity, stored as one colour string.
 *
 * UX 2026-09-23 (owner: "text color opacity must exist everywhere text color
 * can be picked"). A text box keeps its text colour in `fill` and a callout in
 * `style.fontColor`; both have always been a plain `#rrggbb`. Opacity rides in
 * the same string: a fully opaque colour stays `#rrggbb`, exactly as before, so
 * every existing mark is unchanged, and a see-through one becomes
 * `rgba(r, g, b, a)`. Every place that draws text (the SVG layer, the canvas
 * painter, the live editor, Fabric) already takes a CSS colour string, so the
 * opacity shows wherever the colour does, with no second property to keep in
 * step. Reference: Figma / Acrobat keep one colour-with-alpha per text run.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const hexPair = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');

/**
 * Split a text colour into the picker's two values.
 * @returns {{ hex: string, opacity: number }} hex is #rrggbb, opacity is 0..1
 */
export function splitTextColor(color, fallbackHex = '#1e293b') {
  const source = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(source)) return { hex: source, opacity: 1 };
  if (/^#[0-9a-f]{3}$/i.test(source)) {
    return { hex: `#${source.slice(1).split('').map((c) => c + c).join('')}`, opacity: 1 };
  }
  const match = source.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i);
  if (match) {
    const alpha = match[4] == null ? 1 : clamp01(Number(match[4]));
    return { hex: `#${hexPair(match[1])}${hexPair(match[2])}${hexPair(match[3])}`, opacity: alpha };
  }
  return { hex: fallbackHex, opacity: 1 };
}

/**
 * Join the picker's two values back into the one stored string. Fully opaque
 * stays a plain hex so an untouched slider never changes what is saved.
 */
export function composeTextColor(hex, opacity = 1) {
  const { hex: cleanHex } = splitTextColor(hex, '#000000');
  const alpha = Math.round(clamp01(Number.isFinite(Number(opacity)) ? Number(opacity) : 1) * 100) / 100;
  if (alpha >= 1) return cleanHex;
  const n = parseInt(cleanHex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** True for a colour string the text editor may store: #rrggbb or rgb()/rgba(). */
export function isTextColorValue(color) {
  const source = String(color || '').trim();
  return /^#[0-9a-f]{6}$/i.test(source)
    || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/i.test(source);
}
