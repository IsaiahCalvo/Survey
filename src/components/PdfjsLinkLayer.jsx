import { useEffect, useRef, useState } from 'react';
import { resolvePdfOutlinePageNumber } from '../utils/bookmarkOutline';

/**
 * PdfjsLinkLayer — clickable hyperlink overlay for one page under the owned
 * pdf.js engine (Phase 37 cutover). Promoted from the prototype SpikeLinkLayer.
 *
 * Reads the page's own Link annotations (pdf.js getAnnotations) and lays
 * transparent clickable boxes over them: external URLs open in the OS browser
 * (Electron openExternal, with a window.open fallback), internal links jump to
 * their destination page via the app's own navigation.
 *
 * Positions are stored as page-fraction PERCENTAGES so the layer scales with
 * its host on zoom with zero JS zoom coordination — the same "let the host own
 * scaling" philosophy as SearchHighlightLayer's viewBox and the form layer's
 * --scale-factor. Rotation: the engine renders at user-rotation 0 and lets
 * pdf.js bake the intrinsic /Rotate, so we read the viewport at the page's
 * intrinsic rotation only (matching PdfjsViewerContainer exactly).
 *
 * `interactive` should be true only in viewing/selection modes (pan/select) so
 * link boxes never steal clicks from an active drawing/markup tool.
 */
export default function PdfjsLinkLayer({
  pdf,
  pageNumber,
  interactive = true,
  onInternalNavigate,
  excludedAnnotationIds = [],
}) {
  const [links, setLinks] = useState([]);
  const pdfRef = useRef(pdf);
  pdfRef.current = pdf;
  const excludedIdsKey = excludedAnnotationIds.map(String).sort().join('\u0000');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdf || !pageNumber) return;
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const annots = await page.getAnnotations({ intent: 'display' });
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
        const pageWidth = viewport.width || 1;
        const pageHeight = viewport.height || 1;
        const out = [];
        const excludedIds = new Set(excludedIdsKey ? excludedIdsKey.split('\u0000') : []);
        for (const a of annots) {
          if (a.subtype !== 'Link') continue;
          if (excludedIds.has(String(a.id || a.name || ''))) continue;
          if (!a.url && a.dest == null) continue;
          // pdf.js 5 removed PageViewport.convertToViewportRectangle. Convert
          // both corners with the supported point API and normalize below.
          const start = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
          const end = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
          const r = [start[0], start[1], end[0], end[1]];
          const x = Math.min(r[0], r[2]);
          const y = Math.min(r[1], r[3]);
          const w = Math.abs(r[2] - r[0]);
          const h = Math.abs(r[3] - r[1]);
          if (w < 1 || h < 1) continue;
          out.push({
            left: (x / pageWidth) * 100,
            top: (y / pageHeight) * 100,
            width: (w / pageWidth) * 100,
            height: (h / pageHeight) * 100,
            url: a.url || null,
            dest: a.dest != null ? a.dest : null,
          });
        }
        if (!cancelled) setLinks(out);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber, excludedIdsKey]);

  const handleLink = async (link, event) => {
    event.preventDefault();
    event.stopPropagation();
    if (link.url) {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (api && typeof api.openExternal === 'function') {
        api.openExternal(link.url).catch(() => {
          try { window.open(link.url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
        });
      } else {
        try { window.open(link.url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
      }
      return;
    }
    try {
      const targetPage = await resolvePdfOutlinePageNumber(pdfRef.current, link.dest);
      if (targetPage) onInternalNavigate?.(targetPage);
    } catch { /* ignore */ }
  };

  if (links.length === 0) return null;

  return (
    <div
      data-pdfjs-link-layer={pageNumber}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11 }}
    >
      {links.map((link, i) => (
        <a
          key={i}
          href={link.url || '#'}
          onClick={(event) => handleLink(link, event)}
          title={link.url || 'Go to page'}
          style={{
            position: 'absolute',
            left: `${link.left}%`,
            top: `${link.top}%`,
            width: `${link.width}%`,
            height: `${link.height}%`,
            pointerEvents: interactive ? 'auto' : 'none',
            cursor: 'pointer',
            display: 'block',
            background: 'transparent',
          }}
        />
      ))}
    </div>
  );
}
