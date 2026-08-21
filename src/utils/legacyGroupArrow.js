/**
 * Legacy Fabric group-arrows (line + triangle children) still exist in
 * saved docs and can still be created via the canvas renderer toggle.
 * Helpers stay in .js so Node tests can lock the transform/detect contract
 * without loading svgAnnotationRenderers.jsx.
 */

export function isLegacyGroupArrow(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const type = String(obj.type || '').toLowerCase();
  if (type !== 'group') return false;
  if (obj.name === 'arrow' || obj.tool === 'arrow' || obj.data?.type === 'arrow') {
    return true;
  }
  const children = Array.isArray(obj.objects) ? obj.objects : [];
  return children.some((child) => (
    child?.name === 'arrowHead'
    || String(child?.type || '').toLowerCase() === 'triangle'
  ));
}

/**
 * SVG transform that applies the group's angle / scale around the shaft
 * midpoint. Identity (angle 0, scale 1/1) returns undefined so unrotated
 * arrows stay byte-identical to the previous renderer.
 */
export function buildLegacyArrowGroupTransform(obj, x1, y1, x2, y2) {
  const angle = Number(obj?.angle) || 0;
  const scaleX = obj?.scaleX == null ? 1 : Number(obj.scaleX);
  const scaleY = obj?.scaleY == null ? 1 : Number(obj.scaleY);
  if (
    !Number.isFinite(angle)
    || !Number.isFinite(scaleX)
    || !Number.isFinite(scaleY)
  ) return undefined;
  if (angle === 0 && scaleX === 1 && scaleY === 1) return undefined;
  const cx = (Number(x1) + Number(x2)) / 2;
  const cy = (Number(y1) + Number(y2)) / 2;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return undefined;
  const parts = [`translate(${cx} ${cy})`];
  if (angle !== 0) parts.push(`rotate(${angle})`);
  if (scaleX !== 1 || scaleY !== 1) parts.push(`scale(${scaleX} ${scaleY})`);
  parts.push(`translate(${-cx} ${-cy})`);
  return parts.join(' ');
}
