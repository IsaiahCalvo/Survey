// Nightly 'equation-tool' (Drawboard PDF Insert > Equation): type LaTeX, see
// it drawn, and drop it on the page. The equation lands as an inserted
// picture mark (utils/insertedImage.js: it draws, prints, exports and syncs
// like any picture) that also keeps its LaTeX and colour in data.equation, so
// Equation on the picked bar opens it again to change it.
import { insertedImageItem, isInsertedImage, landingSize } from './insertedImage.js';

export const EQUATION_OPEN_EVENT = 'survey:equation-open';
export const EQUATION_EDIT_EVENT = 'survey:equation-edit';
export const EQUATION_TEX_MAX = 2000;
// MathJax sizes its drawing in ex; one ex is this many CSS px at the size an
// equation lands (about 18 px text).
export const EQUATION_EX_PX = 9;
// The picture is drawn this many times sharper than it lands, so it stays
// crisp when zoomed in, but never more than this many px on its longer side.
export const EQUATION_RASTER_SCALE = 4;
export const EQUATION_RASTER_MAX_PX = 1600;

export const EQUATION_COLORS = Object.freeze([
  { id: 'black', label: 'Black', hex: '#000000' },
  { id: 'blue', label: 'Blue', hex: '#1F5FD6' },
  { id: 'red', label: 'Red', hex: '#D0021B' },
  { id: 'green', label: 'Green', hex: '#1E8E3E' },
]);
export const EQUATION_DEFAULT_COLOR = EQUATION_COLORS[0].hex;

export const cleanTex = (tex) => String(tex ?? '').replace(/\r\n?/g, '\n').slice(0, EQUATION_TEX_MAX);
export const equationColorOrDefault = (hex) => {
  const value = String(hex || '').toUpperCase();
  return EQUATION_COLORS.some((c) => c.hex === value) ? value : EQUATION_DEFAULT_COLOR;
};

export const isEquationMark = (obj) => isInsertedImage(obj) && typeof obj?.data?.equation?.tex === 'string';

/** { width, height } in CSS px of a MathJax SVG (its width / height are in ex). */
export function equationSvgSize(svg, exPx = EQUATION_EX_PX) {
  const text = String(svg || '');
  const open = text.match(/<svg\b[^>]*>/i)?.[0] || '';
  const read = (name) => {
    const m = open.match(new RegExp(`\\s${name}="([\\d.]+)ex"`, 'i'));
    return m ? Number(m[1]) * exPx : null;
  };
  const width = read('width');
  const height = read('height');
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The SVG ready to paint as a picture: px size, colour for currentColor, no vertical-align. */
export function sizedEquationSvg(svg, { width, height, color }) {
  return String(svg || '').replace(/<svg\b[^>]*>/i, (open) => open
    .replace(/\s(width|height)="[^"]*"/gi, '')
    .replace(/\sstyle="[^"]*"/i, '')
    .replace(/<svg/i, `<svg width="${width}" height="${height}" style="color:${equationColorOrDefault(color)}"`));
}

/** Pixel size to rasterise a w x h (CSS px) equation at. */
export function equationRasterSize(width, height) {
  const k = Math.min(EQUATION_RASTER_SCALE, EQUATION_RASTER_MAX_PX / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The equation as a library-like item for the placement (one save, one Undo step, picked). */
export function equationItem({ src, pixelWidth, pixelHeight, tex, color }) {
  const item = insertedImageItem({ src, pixelWidth, pixelHeight, name: 'Equation' });
  if (!item) return null;
  const object = item.payload.items[0].object;
  object.data = { ...object.data, equation: { tex: cleanTex(tex), color: equationColorOrDefault(color), px: [pixelWidth, pixelHeight] } };
  return item;
}

/** { id, tex, color } for one picked equation, else null. */
export function selectedEquationOf(obj, id) {
  if (!isEquationMark(obj)) return null;
  return { id: id ?? obj.id ?? obj.data?.id ?? null, tex: obj.data.equation.tex, color: equationColorOrDefault(obj.data.equation.color) };
}

/**
 * The picked equation redrawn: new picture and LaTeX, keeping its place and
 * how much it was resized (a longer equation grows to the right).
 */
export function applyEquationEdit(obj, { src, pixelWidth, pixelHeight, tex, color }) {
  if (!isEquationMark(obj) || typeof src !== 'string' || !(pixelWidth > 0) || !(pixelHeight > 0)) return obj;
  const [oldW, oldH] = Array.isArray(obj.data.equation.px) ? obj.data.equation.px : [0, 0];
  const before = landingSize(oldW || pixelWidth, oldH || pixelHeight);
  const after = landingSize(pixelWidth, pixelHeight);
  const k = before.width > 0 ? (Number(obj.width) || before.width) / before.width : 1;
  return {
    ...obj,
    src,
    width: Math.round(after.width * k * 100) / 100,
    height: Math.round(after.height * k * 100) / 100,
    data: { ...obj.data, equation: { tex: cleanTex(tex), color: equationColorOrDefault(color), px: [pixelWidth, pixelHeight] } },
  };
}
