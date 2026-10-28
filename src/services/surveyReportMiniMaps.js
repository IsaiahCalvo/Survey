// Plan crops for the survey report (Nightly, inside 'survey-report'; Drawboard
// Projects audit item 5): a small piece of the drawing around each item with
// an issue, its box outlined and a pin on it, so a reader sees where it is
// without opening the plan. The crop is the PDF page itself, embedded by
// pdf-lib with a clip box (vector, sharp at any zoom), never a screenshot.
//
// Survey marker bounds are in the page's pdf.js viewport at scale 1: origin
// top-left, y down, after the page's /Rotate. pdf-lib works in the page's own
// PDF space (origin bottom-left, before /Rotate). These helpers convert one
// to the other the way pdf.js's PageViewport does.

/** pdf.js PageViewport transform at scale 1 for a page's view box and rotation. */
export function viewportTransform(view, rotation = 0) {
  const [x0, y0, x1, y1] = view;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let r = rotation % 360;
  if (r < 0) r += 360;
  let a; let b; let c; let d;
  if (r === 90) { a = 0; b = 1; c = 1; d = 0; }
  else if (r === 180) { a = -1; b = 0; c = 0; d = 1; }
  else if (r === 270) { a = 0; b = -1; c = -1; d = 0; }
  else { a = 1; b = 0; c = 0; d = -1; }
  let ox; let oy; let width; let height;
  if (a === 0) {
    ox = Math.abs(cy - y0); oy = Math.abs(cx - x0);
    width = Math.abs(y1 - y0); height = Math.abs(x1 - x0);
  } else {
    ox = Math.abs(cx - x0); oy = Math.abs(cy - y0);
    width = Math.abs(x1 - x0); height = Math.abs(y1 - y0);
  }
  return { m: [a, b, c, d, ox - a * cx - c * cy, oy - b * cx - d * cy], width, height, rotation: r };
}

/** A viewport point back to PDF space. */
export function viewportToPdfPoint(t, vx, vy) {
  const [a, b, c, d, e, f] = t.m;
  const det = a * d - b * c;
  return [(d * (vx - e) - c * (vy - f)) / det, (-b * (vx - e) + a * (vy - f)) / det];
}

/** A viewport rect { x, y, width, height } as a PDF-space box { left, bottom, right, top }. */
export function viewportRectToPdfBox(t, rect) {
  const pts = [
    viewportToPdfPoint(t, rect.x, rect.y),
    viewportToPdfPoint(t, rect.x + rect.width, rect.y),
    viewportToPdfPoint(t, rect.x, rect.y + rect.height),
    viewportToPdfPoint(t, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}

/**
 * The piece of the page (viewport space) to show for a marker: its box with
 * room around it (at least `minSide` points, so a tiny marker still shows its
 * surroundings), widened to the card's shape and kept on the page.
 */
export function cropAround(bounds, pageWidth, pageHeight, aspect, { pad = 2.5, minSide = 220 } = {}) {
  const cxm = bounds.x + bounds.width / 2;
  const cym = bounds.y + bounds.height / 2;
  let w = Math.max(bounds.width * pad, minSide);
  let h = Math.max(bounds.height * pad, minSide / aspect);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  // Never bigger than the page; keep the shape.
  const fit = Math.min(1, pageWidth / w, pageHeight / h);
  w *= fit; h *= fit;
  const x = Math.min(Math.max(cxm - w / 2, 0), Math.max(0, pageWidth - w));
  const y = Math.min(Math.max(cym - h / 2, 0), Math.max(0, pageHeight - h));
  return { x, y, width: w, height: h };
}

/**
 * Draw the crop of `sourcePage` (a pdf-lib page of the original plan) for a
 * marker into the card box (PDF space of the report page, origin bottom-left).
 * Returns false when the marker has no place on the plan.
 */
export async function drawMiniMap({ doc, page, sourcePage, bounds, box, rgb, degrees, ink, pin }) {
  if (!sourcePage || !bounds || !(bounds.width >= 0) || !(bounds.height >= 0)) return false;
  // A blank page with no content stream cannot be embedded, and pdf-lib only
  // finds out at doc.save(), which would sink the whole report.
  if (!sourcePage.node?.Contents?.()) return false;
  const crop = sourcePage.getCropBox();
  const rotation = sourcePage.getRotation()?.angle || 0;
  const t = viewportTransform([crop.x, crop.y, crop.x + crop.width, crop.y + crop.height], rotation);
  const view = cropAround(bounds, t.width, t.height, box.width / box.height);
  const clip = viewportRectToPdfBox(t, view);
  const embedded = await doc.embedPage(sourcePage, clip);
  // Embed now, so any other failure lands in this card's try, not in save().
  await embedded.embed();
  const s = Math.min(box.width / view.width, box.height / view.height);
  const sw = (clip.right - clip.left) * s;
  const sh = (clip.top - clip.bottom) * s;
  // Shown upright the way the viewer shows the page (its /Rotate is clockwise).
  const dw = view.width * s;
  const dh = view.height * s;
  const left = box.x + (box.width - dw) / 2;
  const bottom = box.y + (box.height - dh) / 2;
  const at = {
    0: { x: left, y: bottom, rotate: 0 },
    90: { x: left, y: bottom + sw, rotate: -90 },
    180: { x: left + sw, y: bottom + sh, rotate: 180 },
    270: { x: left + sh, y: bottom, rotate: 90 },
  }[t.rotation];
  page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(1, 1, 1) });
  page.drawPage(embedded, { x: at.x, y: at.y, width: sw, height: sh, rotate: degrees(at.rotate) });
  // The marker's box and a pin on its middle.
  const mx = left + (bounds.x - view.x) * s;
  const myTop = bottom + dh - (bounds.y - view.y) * s;
  const mw = Math.max(bounds.width * s, 2);
  const mh = Math.max(bounds.height * s, 2);
  page.drawRectangle({ x: mx, y: myTop - mh, width: mw, height: mh, borderColor: pin, borderWidth: 1.5 });
  const px = mx + mw / 2;
  const py = myTop - mh / 2;
  page.drawCircle({ x: px, y: py, size: 6, color: pin, borderColor: rgb(1, 1, 1), borderWidth: 1.5 });
  page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: ink, borderWidth: 0.75 });
  return true;
}
