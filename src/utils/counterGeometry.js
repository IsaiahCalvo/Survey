// Counter Survey Marker geometry helpers — render geometry + drag-preview cleanup. Lifted verbatim from PDFViewer; all capture-free.

export function getCounterRenderGeometry(bodyX, bodyY, radius, pointerAngleDeg) {
    const angleRad = (pointerAngleDeg * Math.PI) / 180;
    const tipExtension = Math.max(5, radius * 0.5);
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
    return {
      pathD: `M ${tipX},${tipY} L ${t1x},${t1y} A ${radius},${radius} 0 1 1 ${t2x},${t2y} Z`,
      fontSize: Math.max(11, radius * 1.05),
    };
  }

export function removeCounterDragPreview(drag) {
    if (drag?.previewSvg?.parentNode) {
      drag.previewSvg.parentNode.removeChild(drag.previewSvg);
    }
  }

export function updateCounterDragPreview(drag) {
    if (!drag?.previewPath || !drag?.previewText) return;
    const geometry = getCounterRenderGeometry(drag.bodyX, drag.bodyY, drag.radius, drag.angle);
    drag.previewPath.setAttribute('d', geometry.pathD);
    drag.previewPath.setAttribute('fill', drag.color || '#ef4444');
    drag.previewText.setAttribute('x', String(drag.bodyX));
    drag.previewText.setAttribute('y', String(drag.bodyY));
    drag.previewText.setAttribute('font-size', String(geometry.fontSize));
    drag.previewText.textContent = String(drag.displayNumber ?? 1);
  }
