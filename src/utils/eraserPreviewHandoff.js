const revision = (value) => String(value ?? '');

/**
 * Chooses a bitmap baseline without flashing an older worker render between
 * rapid eraser gestures.
 */
export function selectEraserPreviewBaseline({
  expectedRevision,
  sourceRevision,
  previewRevision,
  previewVisible,
} = {}) {
  const expected = revision(expectedRevision);
  const source = revision(sourceRevision);
  const preview = revision(previewRevision);

  if (previewVisible && expected && preview === expected) return 'preview';
  if (!expected || source === expected) return 'source';
  return previewVisible ? 'preview' : 'source';
}
