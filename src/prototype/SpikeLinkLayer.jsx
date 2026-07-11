// ============================================================================
// FEATURE SPIKE — THROWAWAY. Clickable link overlay for one page.
// ============================================================================
// Reads the page's own link annotations (pdf.js page.getAnnotations()) and lays
// transparent clickable boxes over them — external URLs open out, internal links
// jump to their page. No Pdfjs. Authored in page space (scale 1) then scaled
// by the committed `scale`, so it rides the live zoom like every other layer.
// Sits ON TOP so links win the click; empty areas fall through to text/annotations.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { resolvePdfOutlinePageNumber } from '../utils/bookmarkOutline';

export default function SpikeLinkLayer({ pdf, pageIndex, scale, rotation }) {
  const [links, setLinks] = useState([]);
  const pdfRef = useRef(pdf);
  pdfRef.current = pdf;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdf) return;
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const annots = await page.getAnnotations();
      if (cancelled) return;
      const vp = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
      const out = [];
      for (const a of annots) {
        if (a.subtype !== 'Link') continue;
        if (!a.url && a.dest == null) continue;
        const first = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
        const second = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
        const x = Math.min(first[0], second[0]);
        const y = Math.min(first[1], second[1]);
        const w = Math.abs(second[0] - first[0]);
        const h = Math.abs(second[1] - first[1]);
        if (w < 1 || h < 1) continue;
        out.push({ x, y, w, h, url: a.url || null, dest: a.dest != null ? a.dest : null });
      }
      if (!cancelled) setLinks(out);
    })();
    return () => { cancelled = true; };
  }, [pdf, pageIndex, rotation]);

  const onLink = async (l, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (l.url) {
      try { window.open(l.url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
      return;
    }
    const pageNumber = await resolvePdfOutlinePageNumber(pdfRef.current, l.dest);
    if (pageNumber) window.__spikePdfjs?.goToPage?.(pageNumber);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {links.map((l, i) => (
        <a
          key={i}
          href={l.url || '#'}
          onClick={(e) => onLink(l, e)}
          title={l.url || `Go to page`}
          style={{
            position: 'absolute', left: l.x * scale, top: l.y * scale, width: l.w * scale, height: l.h * scale,
            pointerEvents: 'auto', cursor: 'pointer', display: 'block',
            background: 'transparent', // invisible like Acrobat — the link text underneath shows through
          }}
        />
      ))}
    </div>
  );
}
