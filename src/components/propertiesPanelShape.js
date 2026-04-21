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
