// The real drawn border a mark's hover halo and selection chrome follow
// (owner Test 45, 2026-10-06: "When I hover a cloud, the blue hover does not
// outline the cloud ... Rectangles get this right ... Copy how rectangles do
// it" and "I prefer the way rectangles show resize handles with clouds: the
// handles sit on the outside").
//
// A clouded RECTANGLE already does it right: its halo is the scalloped cloud
// glow (buildCloudGlowPaint) and its selection frame / eight grabbers sit on
// the padded outer hull of the humps (cloudSelectionChrome). A clouded text
// box and a clouded callout box are DRAWN as that very rectangle cloud
// (utils/textCloudBorder.js stand-ins), but their halo was a plain box rect
// inside the humps and their grabbers sat on the inner box. These helpers
// hand them the rectangle's own geometry - the same stand-in the renderer
// paints - so all three share one halo and one handle layout.

import { resolveAnnotationCloudSpec } from './pdfAnnotationAppearance.js';
import { cloudSelectionChrome, resolveCloudAnnotationGeometry } from './cloudAnnotationGeometry.js';
import { calloutBoxCloudStandIn, textboxCloudStandIn } from './textCloudBorder.js';

const num = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const cloudGeometryOf = (shape) => (shape && resolveAnnotationCloudSpec(shape)
  ? resolveCloudAnnotationGeometry(shape)
  : null);

/**
 * The shape whose cloud a page mark's border IS: the mark itself for a cloud
 * shape (rect / ellipse / polygon / polyline), the rectangle stand-in for a
 * clouded text box, else null (the border is not a cloud).
 */
export function markBorderCloudShape(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (String(obj.type || '').toLowerCase() === 'textbox') return textboxCloudStandIn(obj);
  return resolveAnnotationCloudSpec(obj) ? obj : null;
}

/** The cloud geometry of a page mark's drawn border (page frame), or null. */
export function markBorderCloudGeometry(obj) {
  return cloudGeometryOf(markBorderCloudShape(obj));
}

/**
 * Selection chrome (dashed frame + eight grabber anchors on the outer hump
 * edge) for a page mark whose border is a cloud - a cloud shape or a clouded
 * text box - exactly as a clouded rectangle gets it. Null otherwise.
 */
export function markBorderCloudChrome(obj) {
  const shape = markBorderCloudShape(obj);
  return shape ? cloudSelectionChrome(shape) : null;
}

/**
 * The callout text box as renderCallout draws it, in page units: the stored
 * box plus the descender buffer, with the box border width it paints.
 */
export function calloutVisibleBox(callout, pageWidth, pageHeight) {
  const W = num(pageWidth, 1);
  const H = num(pageHeight, 1);
  const x = num(callout?.textBoxPosition?.x) * W;
  const y = num(callout?.textBoxPosition?.y) * H;
  const width = Math.max(18, num(callout?.textBoxWidth, 0.1) * W);
  const storedHeight = Math.max(18, num(callout?.textBoxHeight, 0.05) * H);
  const fontSize = num(callout?.style?.fontSize, 12) || 12;
  const lineThickness = Math.max(1, num(callout?.style?.lineThickness, 2) || 2);
  return {
    x,
    y,
    width,
    height: storedHeight + fontSize * 0.35,
    borderWidth: Math.max(1, lineThickness * 0.7),
  };
}

/** Cloud geometry of a clouded callout's box (the one renderCallout paints), or null. */
export function calloutBoxCloudGeometry(callout, box) {
  if (!box) return null;
  return cloudGeometryOf(calloutBoxCloudStandIn(callout, box, { strokeWidth: box.borderWidth }));
}

/**
 * Where a callout box's eight resize grabbers sit, rectangle-style:
 *  - clouded box: on the padded outer hull of the humps, with that dashed
 *    frame (a clouded rectangle's chrome);
 *  - plain box: on the box's own drawn border (corners + edge midpoints), no
 *    frame - a plain rectangle's border-flush chrome.
 * Returns { bbox, anchors, frame|null }, all in page units.
 */
export function calloutBoxHandleLayout(callout, box) {
  if (!box) return null;
  const bbox = { left: box.x, top: box.y, width: box.width, height: box.height, angle: 0 };
  const standIn = calloutBoxCloudStandIn(callout, box, { strokeWidth: box.borderWidth });
  const chrome = standIn ? cloudSelectionChrome(standIn) : null;
  if (chrome) return { bbox, anchors: chrome.anchors, frame: chrome.frame };
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  return {
    bbox,
    anchors: {
      tl: { x: box.x, y: box.y },
      mt: { x: midX, y: box.y },
      tr: { x: right, y: box.y },
      mr: { x: right, y: midY },
      br: { x: right, y: bottom },
      mb: { x: midX, y: bottom },
      bl: { x: box.x, y: bottom },
      ml: { x: box.x, y: midY },
    },
    frame: null,
  };
}

/**
 * Resize a callout's text box from one of its eight grabbers (normalised
 * page coordinates). A corner moves both edges it touches; an edge grabber
 * moves only its own edge. The opposite edge stays put and the box flips
 * through it (text never mirrors), never shrinking under the minimum.
 * @returns {{ textBoxPosition:{x,y}, textBoxWidth:number, textBoxHeight:number }}
 */
export function resizeCalloutBox({ position, width, height }, handle, dx, dy, minW, minH) {
  const left = num(position?.x);
  const top = num(position?.y);
  const right = left + num(width);
  const bottom = top + num(height);
  const id = String(handle || 'br');
  const movesLeft = id === 'tl' || id === 'bl' || id === 'ml';
  const movesRight = id === 'tr' || id === 'br' || id === 'mr';
  const movesTop = id === 'tl' || id === 'tr' || id === 'mt';
  const movesBottom = id === 'bl' || id === 'br' || id === 'mb';
  let nextLeft = left;
  let nextRight = right;
  if (movesLeft || movesRight) {
    const anchor = movesLeft ? right : left;
    const moving = (movesLeft ? left : right) + num(dx);
    const span = Math.max(minW, Math.abs(moving - anchor));
    nextLeft = moving >= anchor ? anchor : anchor - span;
    nextRight = nextLeft + span;
  }
  let nextTop = top;
  let nextBottom = bottom;
  if (movesTop || movesBottom) {
    const anchor = movesTop ? bottom : top;
    const moving = (movesTop ? top : bottom) + num(dy);
    const span = Math.max(minH, Math.abs(moving - anchor));
    nextTop = moving >= anchor ? anchor : anchor - span;
    nextBottom = nextTop + span;
  }
  return {
    textBoxPosition: { x: nextLeft, y: nextTop },
    textBoxWidth: nextRight - nextLeft,
    textBoxHeight: nextBottom - nextTop,
  };
}
