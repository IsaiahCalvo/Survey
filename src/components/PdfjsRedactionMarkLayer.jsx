import { useEffect, useState } from 'react';
import { getImportedRedactionOverlayMarks } from '../utils/importedRedactionOverlay.js';

export default function PdfjsRedactionMarkLayer({ pdf, pageNumber, excludedAnnotationIds = [] }) {
  const [marks, setMarks] = useState([]);
  const excludedIdsKey = excludedAnnotationIds.map(String).sort().join('\u0000');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf?.getPage?.(pageNumber);
        if (!page || cancelled) return;
        const annotations = await page.getAnnotations({ intent: 'display' });
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
        const excludedIds = new Set(excludedIdsKey ? excludedIdsKey.split('\u0000') : []);
        setMarks(getImportedRedactionOverlayMarks(
          annotations.filter((annotation) => !excludedIds.has(String(annotation?.id || annotation?.name || ''))),
          viewport,
        ));
      } catch {
        if (!cancelled) setMarks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber, excludedIdsKey]);

  if (marks.length === 0) return null;
  return (
    <div
      data-pdfjs-redaction-mark-layer={pageNumber}
      aria-label="Unapplied redaction marks"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 13 }}
    >
      {marks.map((mark) => (
        <div
          key={mark.id}
          role="img"
          aria-label="Marked for redaction. Covered text is still readable."
          title="Marked for redaction — text is still readable until applied"
          style={{
            position: 'absolute',
            left: `${mark.left}%`,
            top: `${mark.top}%`,
            width: `${mark.width}%`,
            height: `${mark.height}%`,
            boxSizing: 'border-box',
            border: '2px solid #111',
            background: 'repeating-linear-gradient(135deg, transparent 0, transparent 6px, rgba(0, 0, 0, 0.42) 6px, rgba(0, 0, 0, 0.42) 7px)',
          }}
        >
          <span style={{
            position: 'absolute',
            left: -2,
            bottom: '100%',
            padding: '1px 4px',
            border: '1px solid #111',
            background: 'rgba(255, 255, 255, 0.94)',
            color: '#111',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
          }}>
            MARKED FOR REDACTION
          </span>
        </div>
      ))}
    </div>
  );
}
