/**
 * smartFillClouds.js — cloud marks on the page as Smart fill shapes (owner
 * 2026-10-26: "fill any type of cloud"). A revision cloud is not always part
 * of the drawing: a reviewer's Bluebeam cloud comes in as a markup, and Survey
 * draws its own. Those clouds are marks (data.pdfCloudIntensity), not drawing
 * paths, so smartFillVector.js never sees them. This turns each closed cloud
 * mark into the same shape record, in page units, so a tap inside one fills
 * its outline.
 */
import { resolveAnnotationCloudSpec } from '../utils/pdfAnnotationAppearance.js';
import { polyWorldPoints } from '../utils/drawSnap.js';
import { getAnnotationBBox } from '../utils/svgBoundingBox.js';

const ELLIPSE_STEPS = 48;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

function rotateAbout([x, y], cx, cy, deg) {
  if (!deg) return [x, y];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

/** World outline (page units) of one closed cloud mark, or null. */
export function cloudMarkRing(obj) {
  const spec = resolveAnnotationCloudSpec(obj);
  if (!spec || obj?.visible === false) return null;
  const type = String(obj.type || '').toLowerCase();
  if (type === 'polygon') {
    const pts = polyWorldPoints(obj);
    return pts.length >= 3 ? pts.map((p) => [p.x, p.y]) : null;
  }
  if (type !== 'rect' && type !== 'ellipse' && type !== 'circle') return null;
  const b = getAnnotationBBox(obj);
  if (!(b.width > 0 && b.height > 0)) return null;
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const angle = Number(b.angle) || 0;
  if (type === 'rect') {
    return [[b.left, b.top], [b.left + b.width, b.top], [b.left + b.width, b.top + b.height], [b.left, b.top + b.height]]
      .map((p) => rotateAbout(p, cx, cy, angle));
  }
  const ring = [];
  for (let i = 0; i < ELLIPSE_STEPS; i += 1) {
    const t = (i / ELLIPSE_STEPS) * Math.PI * 2;
    ring.push(rotateAbout([cx + (b.width / 2) * Math.cos(t), cy + (b.height / 2) * Math.sin(t)], cx, cy, angle));
  }
  return ring;
}

/** Shape records ({ ring, minX..maxY, width, height, area, cloud, mark }) for a page's cloud marks. */
export function cloudMarkShapes(objects) {
  if (!Array.isArray(objects)) return [];
  const out = [];
  for (const obj of objects) {
    const ring = cloudMarkRing(obj);
    if (!ring || !ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) continue;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const area = ringArea(ring);
    if (!(area > 0)) continue;
    out.push({ ring, minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, area, curved: true, cloud: true, mark: true });
  }
  return out;
}
