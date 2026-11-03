// Counter Survey Marker geometry helpers — render geometry + drag-preview cleanup. Lifted verbatim from PDFViewer; all capture-free.

const COUNTER_LABEL_MAX_WIDTH_RATIO = 1.55;
const COUNTER_LABEL_BASE_FONT_RATIO = 1.05;
// System UI bold digits are typically about 0.56-0.64em wide. Using 0.7em
// keeps the layout conservative across platform fallbacks while Canvas/PDF
// renderers apply an exact max-width guard as a second line of defense.
const COUNTER_LABEL_DIGIT_ADVANCE_EM = 0.7;

/**
 * Return a zoom-independent page-space layout for a counter label.
 *
 * The old absolute 11px floor outgrew counters below radius 6. This layout is
 * proportional to the bubble and also caps multi-digit labels to the inner
 * 77.5% of its diameter. It intentionally supports labels beyond three digits
 * even though current counter UI is limited to plain numeric series.
 */
export function getCounterLabelLayout(radius, label) {
    const numericRadius = Number(radius);
    const safeRadius = Math.max(0.01, Number.isFinite(numericRadius) ? Math.abs(numericRadius) : 14);
    const text = String(label ?? '');
    const glyphCount = Math.max(1, Array.from(text).length);
    const maxWidth = safeRadius * COUNTER_LABEL_MAX_WIDTH_RATIO;
    const baseFontSize = safeRadius * COUNTER_LABEL_BASE_FONT_RATIO;
    const widthLimitedFontSize = maxWidth / (glyphCount * COUNTER_LABEL_DIGIT_ADVANCE_EM);
    const widthLimited = widthLimitedFontSize < baseFontSize;
    return {
      fontSize: Math.min(baseFontSize, widthLimitedFontSize),
      maxWidth,
      glyphCount,
      widthLimited,
    };
  }

export function getCounterRenderGeometry(bodyX, bodyY, radius, pointerAngleDeg, displayNumber = 1) {
    const angleRad = (pointerAngleDeg * Math.PI) / 180;
    const tipExtension = radius * 0.5;
    const tipDistance = radius + tipExtension;
    const tipX = bodyX + Math.cos(angleRad) * tipDistance;
    const tipY = bodyY + Math.sin(angleRad) * tipDistance;
    const tangentHalfAngle = Math.acos(radius / tipDistance);
    const t1Angle = angleRad + tangentHalfAngle;
    const t2Angle = angleRad - tangentHalfAngle;
    const t1x = bodyX + Math.cos(t1Angle) * radius;
    const t1y = bodyY + Math.sin(t1Angle) * radius;
    const t2x = bodyX + Math.cos(t2Angle) * radius;
    const t2y = bodyY + Math.sin(t2Angle) * radius;
    const labelLayout = getCounterLabelLayout(radius, displayNumber);
    return {
      pathD: `M ${tipX},${tipY} L ${t1x},${t1y} A ${radius},${radius} 0 1 1 ${t2x},${t2y} Z`,
      fontSize: labelLayout.fontSize,
      center: { x: bodyX, y: bodyY },
      radius,
      tip: { x: tipX, y: tipY },
      tangent1: { x: t1x, y: t1y },
      tangent2: { x: t2x, y: t2y },
    };
  }

export function removeCounterDragPreview(drag) {
    if (drag?.previewSvg?.parentNode) {
      drag.previewSvg.parentNode.removeChild(drag.previewSvg);
    }
  }

export function updateCounterDragPreview(drag) {
    if (!drag?.previewPath || !drag?.previewText) return;
    const geometry = getCounterRenderGeometry(
      drag.bodyX,
      drag.bodyY,
      drag.radius,
      drag.angle,
      drag.displayNumber ?? 1,
    );
    drag.previewPath.setAttribute('d', geometry.pathD);
    drag.previewPath.setAttribute('fill', drag.color || '#ef4444');
    drag.previewText.setAttribute('x', String(drag.bodyX));
    drag.previewText.setAttribute('y', String(drag.bodyY));
    drag.previewText.setAttribute('font-size', String(geometry.fontSize));
    // Font size is already conservatively capped. Avoid textLength here: SVG
    // expands shorter glyph runs to that exact width instead of acting as a
    // max-width constraint, which made previews disagree with Canvas/PDF.
    drag.previewText.removeAttribute?.('textLength');
    drag.previewText.removeAttribute?.('lengthAdjust');
    drag.previewText.textContent = String(drag.displayNumber ?? 1);
  }

export function createCounterDragPreview(overlayEl, drag) {
    if (!overlayEl || !drag) return;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${drag.pageWidth} ${drag.pageHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('stroke', 'none');
    const text = document.createElementNS(svgNs, 'text');
    text.setAttribute('fill', drag.numberColor || '#ffffff');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', '-apple-system, system-ui, sans-serif');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.style.fontVariantNumeric = 'tabular-nums';
    text.style.userSelect = 'none';
    text.style.pointerEvents = 'none';

    svg.appendChild(path);
    svg.appendChild(text);
    overlayEl.appendChild(svg);
    drag.previewSvg = svg;
    drag.previewPath = path;
    drag.previewText = text;
    updateCounterDragPreview(drag);
  }

/**
 * Where a counter pin sits after a box-mode resize, and which way it points.
 *
 * The resize box of a counter is turned so its nub points to the box's top
 * (box angle = pointerAngle + 90): 2r wide, 2.5r tall, the bubble in the
 * lower 2r. Dragging a grabber past the opposite side flips the box. Across
 * the box's width the pin is symmetric, so it just passes through; across its
 * height the pin turns over, so its nub points the other way. The number is
 * drawn upright either way.
 *
 * @param {object} p
 * @param {number} p.centerX       the new box centre, page units
 * @param {number} p.centerY
 * @param {number} p.radius        the new bubble radius
 * @param {number} p.boxAngleDeg   the box's turn (pointerAngle + 90)
 * @param {number} p.pointerAngle  the pin's pointer angle at drag start
 * @param {boolean} p.flipY        true when the box flipped across its height
 * @returns {{ left: number, top: number, pointerAngle: number }}
 */
export function placeCounterInResizeBox({ centerX, centerY, radius, boxAngleDeg, pointerAngle, flipY }) {
  const r = Math.abs(Number(radius) || 0);
  const rad = ((Number(boxAngleDeg) || 0) * Math.PI) / 180;
  // The bubble's centre sits 0.25r below the box centre (local frame), or
  // above it once the pin has turned over.
  const localY = (flipY ? -1 : 1) * r * 0.25;
  const bodyX = centerX - localY * Math.sin(rad);
  const bodyY = centerY + localY * Math.cos(rad);
  const startAngle = pointerAngle != null && Number.isFinite(Number(pointerAngle)) ? Number(pointerAngle) : 225;
  const nextAngle = flipY ? startAngle + 180 : startAngle;
  return {
    left: bodyX - r,
    top: bodyY - r,
    pointerAngle: ((nextAngle % 360) + 360) % 360,
  };
}
