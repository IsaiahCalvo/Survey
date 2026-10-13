/**
 * areaToolGlyphs.js — the two Spaces "Areas" drawing tool icons, in ONE place.
 *
 * Owner 2026-10-02 (provisional, pending his pick): Rectangle area = Hugeicons
 * "Select 01" (MIT), Freehand area = the same plus with a dashed free-form
 * outline ("F1"). They used to borrow the Shapes rectangle and the Draw pen.
 *
 * To swap a glyph: change its `paths` (24-unit grid, drawn as round-capped
 * 1.5 strokes) and re-measure. Icons.jsx (`areaRect`, `areaFreehand`) and the
 * tool-group morph (utils/iconMorph.js) both read from here; nothing else
 * holds a copy.
 *
 * Optical balance (2026-10-02, measured like the Select trio, b562405): the
 * Hugeicons drawings run edge to edge of the grid - ink 21.5 x 21.5 (R1) and
 * 21.3 x 20.5 (F1) where their neighbours (Shapes rectangle, Select cursor,
 * pen) sit in the house 19.5-20 envelope - and F1 sat 0.5 high. Both are
 * scaled 0.93 about the centre (pen's own scale), F1 is re-centred, and the
 * group stroke is 1.61 so it still resolves to the house 1.5. F1's dashes
 * take the Lasso Select's rhythm (3 on, 2.1 off; it was 2.6 / 3, which read
 * as a faint halo): measured ink 71 vs R1's 74 square units (was 65 vs 79),
 * both boxes 20 units, centred on (12, 12).
 */
export const AREA_TOOL_STROKE_WIDTH = 1.61; // x 0.93 = the house 1.5

export const AREA_TOOL_GLYPHS = Object.freeze({
  areaRect: Object.freeze({
    name: 'Hugeicons Select 01 (MIT)',
    transform: 'translate(12 12) scale(0.93) translate(-12 -12)',
    paths: Object.freeze([
      Object.freeze({ d: 'M5 2V8M2 5H8' }),
      Object.freeze({ d: 'M12 5H15M12 22H15M18 5H18.5C20.433 5 22 6.567 22 8.5V9M22 18V18.5C22 20.433 20.433 22 18.5 22H18M9 22H8.5C6.567 22 5 20.433 5 18.5L5 18M22 12V15M5 12L5 15' }),
    ]),
  }),
  areaFreehand: Object.freeze({
    name: 'Freehand area F1: plus + dashed blob',
    transform: 'translate(12 12) scale(0.93) translate(-11.9 -11.5)',
    paths: Object.freeze([
      Object.freeze({ d: 'M5 2V8M2 5H8' }),
      Object.freeze({ d: 'M11 4.5c4.5-1.4 9.4 0 10.5 3.6s-.4 7.6-3 10.1-7 3.6-10.3 2.2S3.6 15.8 5 12', dasharray: '3 2.1' }),
    ]),
  }),
});
