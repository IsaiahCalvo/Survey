import { useEffect, useState } from 'react';
import { getImportedRedactionOverlayMarks } from '../utils/importedRedactionOverlay.js';
import {
  APPLIED_REDACTION_FILL_COLOR,
  PENDING_REDACTION_OUTLINE_COLOR,
} from '../utils/pdfRedactionAppearance.js';

const hasCoarsePointer = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches
);

export default function PdfjsRedactionMarkLayer({ pdf, pageNumber }) {
  const [marks, setMarks] = useState([]);
  const [hoveredMarkId, setHoveredMarkId] = useState(null);
  const [previewMarkId, setPreviewMarkId] = useState(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(hasCoarsePointer);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarsePointer(coarseQuery.matches);
    update();
    coarseQuery.addEventListener?.('change', update);
    return () => coarseQuery.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!isCoarsePointer || previewMarkId === null) return undefined;
    const clearPreview = () => setPreviewMarkId(null);
    document.addEventListener('pointerdown', clearPreview);
    return () => document.removeEventListener('pointerdown', clearPreview);
  }, [isCoarsePointer, previewMarkId]);

  useEffect(() => {
    let cancelled = false;
    setHoveredMarkId(null);
    setPreviewMarkId(null);
    (async () => {
      try {
        const page = await pdf?.getPage?.(pageNumber);
        if (!page || cancelled) return;
        const annotations = await page.getAnnotations({ intent: 'display' });
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
        setMarks(getImportedRedactionOverlayMarks(annotations, viewport));
      } catch {
        if (!cancelled) setMarks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber]);

  if (marks.length === 0) return null;
  return (
    <div
      data-pdfjs-redaction-mark-layer={pageNumber}
      aria-label="Unapplied redaction marks"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 13 }}
    >
      {marks.map((mark) => {
        const isPreviewed = isCoarsePointer
          ? previewMarkId === mark.id
          : hoveredMarkId === mark.id;
        return (
          <div
            key={mark.id}
            role="img"
            aria-label="Marked for redaction. Covered text is still readable."
            title="Marked for redaction — text is still readable until applied"
            onMouseEnter={() => { if (!isCoarsePointer) setHoveredMarkId(mark.id); }}
            onMouseLeave={() => { if (!isCoarsePointer) setHoveredMarkId(null); }}
            onPointerDown={(event) => { if (isCoarsePointer) event.stopPropagation(); }}
            onClick={(event) => {
              if (!isCoarsePointer) return;
              event.stopPropagation();
              setPreviewMarkId((current) => current === mark.id ? null : mark.id);
            }}
            style={{
              position: 'absolute',
              left: `${mark.left}%`,
              top: `${mark.top}%`,
              width: `${mark.width}%`,
              height: `${mark.height}%`,
              boxSizing: 'border-box',
              border: `1px solid ${PENDING_REDACTION_OUTLINE_COLOR}`,
              backgroundColor: isPreviewed ? APPLIED_REDACTION_FILL_COLOR : 'transparent',
              pointerEvents: 'auto',
              cursor: isCoarsePointer ? 'pointer' : 'default',
            }}
          />
        );
      })}
    </div>
  );
}
