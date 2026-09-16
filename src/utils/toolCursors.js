/**
 * toolCursors.js — the cursor that tells you which tool is in your hand.
 *
 * Intended UX: with a drawing tool armed, the pointer over the page is a
 * crosshair with a small badge of that tool clipped to its lower right. You can
 * look at the page — not up at the toolbar — and know what you are about to
 * draw. Before this, every drawing tool in Survey showed the same bare
 * `crosshair`, so the armed tool was invisible once your eyes left the toolbar.
 *
 * Reference behavior matched: Drawboard PDF, which uses a 42px crosshair with an
 * 18px mini tool icon (measured 2026-09-16). Same geometry here: a 42x42 image,
 * hotspot dead centre of the crosshair, an 18-ish badge in the corner.
 *
 * The badge does NOT take the stroke colour. Owner ruling 2026-09-16: the tool
 * glyph beside the cursor must not change colour with the stroke colour. It is
 * drawn in the crosshair's own ink on a white chip, so one fixed pair of colours
 * reads on a white page, a dark page and a photo alike — a tinted glyph would
 * vanish the moment someone picked white or pale yellow, and the whole point is
 * that you can see which tool you are holding. (Same reasoning as the standing
 * rule against backdrop-dependent colour transforms on annotations: never bet on
 * what is behind you.) The colour of the next mark is the colour control's job.
 *
 * Three more rules this file keeps, and why:
 *   - Pan is NOT in here. The grab hand is a system cursor everyone already
 *     reads, and a crosshair would lie about what the drag does.
 *   - Select gets a crosshair with a marquee badge — it drags out a box like
 *     the shape tools do, so it earns the same treatment.
 *   - Text gets a badge too, but only while the tool is armed over the page.
 *     Once a text editor is open the editor's own I-beam wins, because there
 *     the pointer is placing a caret, not starting a new box.
 *
 * Everything is a plain string, so this runs in a test with no DOM, and the
 * result is cached — the browser re-parses a data-URL cursor on every
 * assignment, and a drag can reassign it many times a second.
 */

/** The image is 42x42; the crosshair is centred here and this is the hotspot. */
export const CURSOR_SIZE = 42;
export const CURSOR_HOTSPOT = 13;

/** Where the tool badge sits — clear of the crosshair arms, no overlap. */
const BADGE = { x: 22, y: 22, size: 19, inset: 2.5 };

/**
 * The one ink every part of the cursor is drawn in, and the halo behind it.
 * Fixed on purpose — see the colour ruling in the header.
 */
const CROSSHAIR_INK = '#161a22';
const CROSSHAIR_HALO = '#ffffff';

/**
 * Tool glyphs, authored in a 24x24 box and scaled into the badge.
 *
 * Stroke-only on purpose: a filled glyph at 14px reads as a blob, and a stroke
 * keeps the tool's silhouette — the thing the user actually recognises — at
 * any size. `dash` is only used by Select, whose marquee IS a dashed box.
 */
export const TOOL_CURSOR_GLYPHS = {
  pen: 'M5.5 18.5 L8.5 17.5 L19 7 L17 5 L6.5 15.5 Z M5.5 18.5 L4 20',
  highlighter: 'M6 15 L14 5 L19 9 L11 19 L6 19 Z M4 21.5 H20',
  rect: 'M4 6 H20 V18 H4 Z',
  ellipse: 'M20 12 A8 6 0 1 1 4 12 A8 6 0 1 1 20 12 Z',
  polygon: 'M12 3.5 L20.5 9.5 L17.2 19.5 H6.8 L3.5 9.5 Z',
  polyline: 'M3.5 17.5 L9 8.5 L14 14.5 L20.5 5.5',
  line: 'M4.5 19.5 L19.5 4.5',
  arrow: 'M4.5 19.5 L19.5 4.5 M19.5 4.5 L12.5 5.8 M19.5 4.5 L18.2 11.5',
  callout: 'M3.5 4.5 H20.5 V14.5 H12 L7.5 19.5 V14.5 H3.5 Z',
  text: 'M5 7 V4.5 H19 V7 M12 4.5 V19.5 M9 19.5 H15',
  // UX: Select's badge is its marquee — the dashed box it drags out.
  select: 'M4 5 H20 V19 H4 Z',
};

/** Only Select's badge is dashed; see the glyph comment above. */
const DASHED_GLYPHS = new Set(['select']);

/**
 * Tools that own a page cursor. Three are absent by design:
 *   pan     — the system grab hand already says "drag to move the page".
 *   eraser  — it paints its own live size ring and sets `cursor: none`, which
 *             tells you more than a badge could.
 *   counter — its page overlay is parked mid-debug and carries a standing
 *             "do not touch" note, so it keeps the plain crosshair it has
 *             always had. A badge here would only appear for the instant after
 *             a tool switch and then vanish, which is worse than none.
 */
export const CURSOR_TOOL_IDS = Object.keys(TOOL_CURSOR_GLYPHS);

export function hasToolCursor(toolId) {
  return Object.prototype.hasOwnProperty.call(TOOL_CURSOR_GLYPHS, toolId);
}

/**
 * Build the 42x42 SVG for one tool.
 *
 * Paint order matters: halo strokes go down first so the ink sits on top of
 * its own outline, and the badge chip is painted last so it covers anything it
 * happens to reach. Nothing here is interpolated from user input — the only
 * variable is which glyph path comes out of the table above — so no colour
 * string can reach the markup.
 */
export function buildToolCursorSvg(toolId) {
  const glyph = TOOL_CURSOR_GLYPHS[toolId];
  if (!glyph) return null;
  const scale = (BADGE.size - BADGE.inset * 2) / 24;
  const gx = BADGE.x + BADGE.inset;
  const gy = BADGE.y + BADGE.inset;
  const dash = DASHED_GLYPHS.has(toolId) ? ' stroke-dasharray="4 3"' : '';
  const c = CURSOR_HOTSPOT;
  // Arms stop 3.5px short of centre: the gap is what makes a crosshair aimable.
  const arms = [
    `M0.75 ${c} H${c - 3.5}`,
    `M${c + 3.5} ${c} H${c * 2 - 0.75}`,
    `M${c} 0.75 V${c - 3.5}`,
    `M${c} ${c + 3.5} V${c * 2 - 0.75}`,
  ].join(' ');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}">`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${arms}" stroke="${CROSSHAIR_HALO}" stroke-width="3.2" opacity="0.9"/>`,
    `<path d="${arms}" stroke="${CROSSHAIR_INK}" stroke-width="1.4"/>`,
    `</g>`,
    // The chip: white, outlined and drawn in the crosshair's own ink, so the
    // badge reads the same over a white page, a dark page and a photo.
    `<rect x="${BADGE.x}" y="${BADGE.y}" width="${BADGE.size}" height="${BADGE.size}" rx="5" fill="#ffffff" stroke="${CROSSHAIR_INK}" stroke-width="1.6"/>`,
    `<g transform="translate(${gx} ${gy}) scale(${scale.toFixed(4)})" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${glyph}" stroke="#ffffff" stroke-width="5"${dash}/>`,
    `<path d="${glyph}" stroke="${CROSSHAIR_INK}" stroke-width="2.6"${dash}/>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

/**
 * Cache keyed by tool. Nothing else varies, so one entry per tool is the whole
 * cache — and every assignment of a fresh data URL is a fresh SVG parse, which
 * a drag would otherwise pay for dozens of times a second.
 */
const cursorCache = new Map();

/**
 * The full CSS `cursor` value for a tool, e.g.
 *   url("data:image/svg+xml,...") 13 13, crosshair
 *
 * The trailing `crosshair` is a real fallback, not decoration: if a platform
 * refuses the image (some do above 32px, and Electron's own zoom factor can
 * push it there) the user still gets a crosshair rather than an arrow.
 * Returns null for tools that should keep their system cursor.
 */
export function toolCursorCss(toolId) {
  if (!hasToolCursor(toolId)) return null;
  const cached = cursorCache.get(toolId);
  if (cached) return cached;
  const svg = buildToolCursorSvg(toolId);
  if (!svg) return null;
  const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${CURSOR_HOTSPOT} ${CURSOR_HOTSPOT}, crosshair`;
  cursorCache.set(toolId, value);
  return value;
}

/** Test seam: lets a test prove the cache is doing its job. */
export function __cursorCacheSize() {
  return cursorCache.size;
}

export default toolCursorCss;
