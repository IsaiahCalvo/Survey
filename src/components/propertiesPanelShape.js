/**
 * Pure shape resolver for the properties panel.
 * Returns { kind, strokeColor, strokeWidth, borderStyle, cloudIntensity? }
 * where `kind` is the RAW annotation.type (not normalized). The React
 * component continues to compute its own normalized `targetKind` for
 * render branching — this helper only contributes borderStyle + cloud
 * intensity detection, which Task 1.2 will consume alongside targetKind.
 *
 * Lives in a plain .js file so node --test can import it without a
 * JSX loader — the panel itself (.jsx) re-imports from here.
 */
export function resolvePropertiesPanelShape(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    return { kind: 'unknown' };
  }
  const data = annotation.data || {};
  const strokeColor = annotation.stroke ?? '#000000';
  const strokeWidth = annotation.strokeWidth ?? 1;
  const type = annotation.type;

  // Border style derivation — the three supported options:
  //   cloud   : data.pdfCloudIntensity is present (imported from /BE /S /C or set via the panel)
  //   dashed  : strokeDashArray is a non-empty array (imported from /BS /D or set via the panel)
  //   solid   : neither of the above
  // See ISO 32000-1 §12.5.4 for /BE (border effect) and /BS (border style) semantics.
  let borderStyle = 'solid';
  let cloudIntensity;
  if ((type === 'rect' || type === 'polygon') && data.pdfCloudIntensity != null) {
    borderStyle = 'cloud';
    cloudIntensity = data.pdfCloudIntensity;
  } else if (Array.isArray(annotation.strokeDashArray) && annotation.strokeDashArray.length > 0) {
    borderStyle = 'dashed';
  }

  const kind = typeof type === 'string' ? type : 'unknown';

  return cloudIntensity != null
    ? { kind, strokeColor, strokeWidth, borderStyle, cloudIntensity }
    : { kind, strokeColor, strokeWidth, borderStyle };
}

/**
 * Given a current annotation and a next border-style choice, return the
 * partial patch to merge onto the annotation via onUpdate.
 * Handles the three transitions:
 *   → solid: clear strokeDashArray, clear data.pdfCloudIntensity
 *   → dashed: set strokeDashArray=[6,4], clear data.pdfCloudIntensity
 *   → cloud: clear strokeDashArray, set data.pdfCloudIntensity (default 2)
 * Callers downstream pass the result directly to onUpdate().
 *
 * IMPORTANT: the downstream applyAnnotationPatch in App.jsx shallow-merges
 * `data`, so omitting pdfCloudIntensity does NOT clear it — the merged
 * result would keep whatever was previously set. We emit the key EXPLICITLY
 * with `null` when clearing so the merge overwrites the old value. Both the
 * resolver above and the cloud-render branch in svgAnnotationRenderers
 * treat `null`/`undefined` equivalently (they gate on `!= null` / isFinite).
 */
export function computeBorderStylePatch(annotation, nextStyle) {
  const prevData = (annotation && annotation.data) || {};

  if (nextStyle === 'solid') {
    return { strokeDashArray: null, data: { pdfCloudIntensity: null } };
  }
  if (nextStyle === 'dashed') {
    return { strokeDashArray: [6, 4], data: { pdfCloudIntensity: null } };
  }
  if (nextStyle === 'cloud') {
    return {
      strokeDashArray: null,
      data: { pdfCloudIntensity: prevData.pdfCloudIntensity ?? 2 },
    };
  }
  return {};
}
