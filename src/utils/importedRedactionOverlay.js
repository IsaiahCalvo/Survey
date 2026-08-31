export function getImportedRedactionOverlayMarks(annotations, viewport) {
  const pageWidth = Number(viewport?.width) || 0;
  const pageHeight = Number(viewport?.height) || 0;
  if (!(pageWidth > 0) || !(pageHeight > 0)) return [];

  return (Array.isArray(annotations) ? annotations : []).flatMap((annotation, index) => {
    if (annotation?.subtype !== 'Redact' || !Array.isArray(annotation.rect) || annotation.rect.length !== 4) {
      return [];
    }
    const start = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
    const end = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
    const left = Math.min(start[0], end[0]);
    const top = Math.min(start[1], end[1]);
    const width = Math.abs(end[0] - start[0]);
    const height = Math.abs(end[1] - start[1]);
    if (width < 1 || height < 1) return [];
    return [{
      id: annotation.id || annotation.name || `redact-${index}`,
      left: (left / pageWidth) * 100,
      top: (top / pageHeight) * 100,
      width: (width / pageWidth) * 100,
      height: (height / pageHeight) * 100,
    }];
  });
}
