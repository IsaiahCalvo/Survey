/*
 * Nightly 'eraser-look': Drawboard PDF's eraser look (checked live 2026-11-10,
 * see /mnt/project-files/drawboard-trial/deep/eraser-look.md).
 *
 * - Cursor: a small cross with an eraser beside it, the same for Full and
 *   Partial, and no reach ring.
 * - Trail: a capsule band along the drag, a 2 px grey edge round a white
 *   middle, both at 50%, smoothed, gone on release.
 * - Hit: every mark the drag will take whole is lit at once with its own
 *   outline in orange-red #E6563D at 40%, 3 pt wider than its stroke. Nothing
 *   leaves the page until the button comes up. Ink a Partial drag cuts shows
 *   nothing until release.
 *
 * Survey's eraser has a size, so the trail is as wide as the eraser really
 * reaches (Drawboard's is a fixed 20 px, which is also its reach).
 */

export const ERASER_TRAIL_EDGE = '#313131';
export const ERASER_TRAIL_OPACITY = 0.5;
export const ERASER_TRAIL_EDGE_PX = 2;
export const ERASER_HALO_COLOUR = '#E6563D';
export const ERASER_HALO_OPACITY = 0.4;
export const ERASER_HALO_EXTRA = 3;
export const ERASER_HALO_FILLED = 4;

const CURSOR_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">',
  '<g stroke-linecap="round">',
  '<path d="M3 26H15M9 20V32" stroke="white" stroke-width="3"/>',
  '<path d="M3 26H15M9 20V32" stroke="black" stroke-width="1"/>',
  '</g>',
  '<g transform="rotate(-40 28 13)" stroke="#3E4554" stroke-width="1.5" stroke-linejoin="round">',
  '<rect x="18.5" y="8" width="19" height="10" rx="2" fill="white"/>',
  '<path d="M25 8V18" fill="none"/>',
  '</g>',
  '</svg>',
].join('');

/** The CSS cursor: 42 x 42, hot spot on the cross (9, 26), crosshair fallback. */
export const ERASER_LOOK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 9 26, crosshair`;

const fmt = (n) => (Math.round(n * 100) / 100).toString();

/**
 * A smoothed path through the drag's points (quadratic curves through the
 * midpoints, so a few sharp turns come out soft, as Drawboard's do).
 */
export function smoothTrailPath(points) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (!pts.length) return '';
  if (pts.length === 1) return `M${fmt(pts[0].x)} ${fmt(pts[0].y)}L${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  if (pts.length === 2) return `M${fmt(pts[0].x)} ${fmt(pts[0].y)}L${fmt(pts[1].x)} ${fmt(pts[1].y)}`;
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${fmt(pts[i].x)} ${fmt(pts[i].y)} ${fmt(mx)} ${fmt(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${fmt(last.x)} ${fmt(last.y)}`;
}

/** Trail widths in page units: the band, and its white middle (2 screen px in from each edge). */
export function trailWidths(pageRadius, displayScale) {
  const outer = Math.max(0, 2 * (Number(pageRadius) || 0));
  const scale = Math.max(0.01, Number(displayScale) || 1);
  return { outer, inner: Math.max(0, outer - (2 * ERASER_TRAIL_EDGE_PX) / scale) };
}

/** The halo's stroke width for a mark stroked at `strokeWidth` (a fill-only mark gets 4). */
export function haloStrokeWidth(strokeWidth, stroked) {
  const width = Number(strokeWidth);
  if (!stroked || !Number.isFinite(width) || width <= 0) return ERASER_HALO_FILLED;
  return width + ERASER_HALO_EXTRA;
}

const SHAPE_TAGS = new Set(['path', 'rect', 'ellipse', 'circle', 'line', 'polyline', 'polygon']);
const BOX_TAGS = new Set(['image', 'foreignobject']);
const DROP_TAGS = new Set(['text', 'tspan', 'textpath', 'title', 'desc', 'mask', 'clippath', 'filter', 'lineargradient', 'radialgradient', 'pattern', 'marker', 'style', 'script']);
const STRIP_ATTRS = ['filter', 'mask', 'clip-path', 'marker-start', 'marker-mid', 'marker-end', 'opacity', 'stroke-dasharray', 'class', 'style', 'id'];

// A paint that shows. Hit targets are painted at alpha 0.001 so the browser
// still hits them; anything under 5% counts as not drawn.
export const paintVisible = (paint, opacity) => {
  const value = String(paint || '').trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent') return false;
  const rgba = value.match(/^rgba\(([^)]*)\)$/);
  if (rgba) {
    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 4 && Number.parseFloat(parts[3]) < 0.05) return false;
  }
  const o = Number.parseFloat(opacity);
  return !(Number.isFinite(o) && o < 0.05);
};

/**
 * Builds the halo for one mark element: a copy of its outline in #E6563D at
 * 40%, 3 pt wider than its stroke, in the overlay's own coordinates. Returns
 * null when the element draws nothing visible. `overlay` is the SVG the halo
 * goes into; `source` is the mark's element in the real layer.
 */
export function buildEraserHalo(source, overlay, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!source || !overlay || !doc || typeof window === 'undefined') return null;
  const NS = 'http://www.w3.org/2000/svg';
  const parentCtm = source.parentNode?.getScreenCTM?.();
  const overlayCtm = overlay.getScreenCTM?.();
  if (!parentCtm || !overlayCtm) return null;
  const m = overlayCtm.inverse().multiply(parentCtm);
  const clone = source.cloneNode(true);
  const originals = [source, ...source.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  let drawn = 0;
  const removals = [];
  for (let i = 0; i < copies.length; i += 1) {
    const copy = copies[i];
    const original = originals[i];
    const tag = String(copy.tagName || '').toLowerCase();
    const style = original ? window.getComputedStyle(original) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) {
      removals.push(copy);
      continue;
    }
    if (DROP_TAGS.has(tag)) { removals.push(copy); continue; }
    STRIP_ATTRS.forEach((name) => copy.removeAttribute(name));
    if (BOX_TAGS.has(tag)) {
      const rect = doc.createElementNS(NS, 'rect');
      ['x', 'y', 'width', 'height', 'transform'].forEach((name) => {
        const value = original.getAttribute(name);
        if (value != null) rect.setAttribute(name, value);
      });
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', ERASER_HALO_COLOUR);
      rect.setAttribute('stroke-opacity', String(ERASER_HALO_OPACITY));
      rect.setAttribute('stroke-width', String(ERASER_HALO_FILLED));
      copy.replaceWith(rect);
      drawn += 1;
      continue;
    }
    if (!SHAPE_TAGS.has(tag)) continue;
    const stroked = style ? paintVisible(style.stroke, style.strokeOpacity) && parseFloat(style.strokeWidth) > 0 : true;
    const filled = style ? paintVisible(style.fill, style.fillOpacity) : false;
    if (!stroked && !filled) { removals.push(copy); continue; }
    copy.setAttribute('fill', 'none');
    copy.setAttribute('stroke', ERASER_HALO_COLOUR);
    copy.setAttribute('stroke-opacity', String(ERASER_HALO_OPACITY));
    copy.setAttribute('stroke-width', String(haloStrokeWidth(style ? parseFloat(style.strokeWidth) : 1, stroked)));
    copy.setAttribute('stroke-linecap', 'butt');
    copy.setAttribute('stroke-linejoin', 'round');
    drawn += 1;
  }
  removals.forEach((node) => node.remove());
  if (!drawn) return null;
  clone.removeAttribute('data-annotation-index');
  clone.removeAttribute('data-annotation-id');
  const holder = doc.createElementNS(NS, 'g');
  holder.setAttribute('transform', `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(fmt).join(' ')})`);
  holder.setAttribute('data-eraser-halo', 'true');
  holder.appendChild(clone);
  return holder;
}

/** The outermost of a set of matched elements (drop any that sit inside another). */
export function outermostElements(elements) {
  const list = [...(elements || [])];
  return list.filter((el) => !list.some((other) => other !== el && other.contains?.(el)));
}
