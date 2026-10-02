/**
 * areaDrawCursor.js — the desktop cursor while drawing a Spaces area.
 *
 * Owner 2026-10-02: the floating "+" next to the crosshair looked like a
 * second crosshair, and it trailed the pointer. It was a DOM element moved on
 * every pointermove; even moved synchronously it is painted with the page,
 * one frame or more behind the system cursor, so on a fast sweep it lags.
 *
 * Now the crosshair and the sign are ONE custom CSS cursor image, drawn by the
 * system with the pointer itself, so the sign can never lag: a thin crosshair
 * (hotspot at its centre) and a small round badge 12px right / 12px down of
 * it - "+" in blue for Add, "−" in red for Subtract.
 *
 * Colours: a data-URI cursor cannot read CSS custom properties, so the hexes
 * are written here. Red is --danger (src/styles/tokens.css). The app has no
 * blue token; the blue is the one the area being drawn is outlined in
 * (RegionSelectionTool, #4A90E2), so the badge matches the shape it adds.
 */
export const AREA_CURSOR_HOTSPOT = 10;
export const AREA_CURSOR_BADGE_OFFSET = 12;
export const AREA_CURSOR_ADD_COLOR = '#4A90E2';
export const AREA_CURSOR_SUBTRACT_COLOR = '#d95a56'; // --danger

const buildSvg = (mode) => {
  const h = AREA_CURSOR_HOTSPOT;
  const b = h + AREA_CURSOR_BADGE_OFFSET; // badge centre
  const color = mode === 'subtract' ? AREA_CURSOR_SUBTRACT_COLOR : AREA_CURSOR_ADD_COLOR;
  const cross = `M${h} 1V${h - 2}M${h} ${h + 2}V${2 * h - 1}M1 ${h}H${h - 2}M${h + 2} ${h}H${2 * h - 1}`;
  const sign = mode === 'subtract'
    ? `M${b - 3} ${b}H${b + 3}`
    : `M${b - 3} ${b}H${b + 3}M${b} ${b - 3}V${b + 3}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`
    // crosshair: dark line on a white halo, so it reads on a white page and on ink
    + `<path d="${cross}" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="${cross}" stroke="#15171c" stroke-width="1" stroke-linecap="round"/>`
    // badge: white disc, coloured ring and sign
    + `<circle cx="${b}" cy="${b}" r="6.5" fill="#ffffff" stroke="${color}" stroke-width="1.25"/>`
    + `<path d="${sign}" stroke="${color}" stroke-width="1.75" stroke-linecap="round"/>`
    + `</svg>`;
};

const cache = new Map();

/** CSS `cursor` value for drawing an area in `mode` ('add' | 'subtract'). */
export function areaDrawCursor(mode = 'add') {
  const key = mode === 'subtract' ? 'subtract' : 'add';
  if (!cache.has(key)) {
    const url = `data:image/svg+xml,${encodeURIComponent(buildSvg(key))}`;
    cache.set(key, `url("${url}") ${AREA_CURSOR_HOTSPOT} ${AREA_CURSOR_HOTSPOT}, crosshair`);
  }
  return cache.get(key);
}
