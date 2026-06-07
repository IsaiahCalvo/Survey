// ============================================================================
// FEATURE SPIKE — THROWAWAY. Selectable text overlay for one page.
// ============================================================================
// Uses pdf.js's own renderTextLayer (battle-tested glyph positioning) to lay
// transparent, selectable <span>s over the page canvas. Native OS selection +
// copy work for free — no Syncfusion. Sits in page space (viewport at committed
// `scale`) inside the page wrapper, so it CSS-scales with the live zoom like the
// canvas. Re-renders on committed scale / rotation change.
// ============================================================================
import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// paint a yellow background on every span whose text contains the query (find-in-doc)
function applySearchHighlight(container, query) {
  if (!container) return;
  const q = (query || '').trim().toLowerCase();
  container.querySelectorAll('span').forEach((span) => {
    const hit = q && (span.textContent || '').toLowerCase().includes(q);
    span.style.background = hit ? 'rgba(255,214,10,0.55)' : '';
  });
}

export default function SpikeTextLayer({ pdf, pageIndex, scale, rotation, searchQuery }) {
  const ref = useRef(null);
  const queryRef = useRef(searchQuery);
  queryRef.current = searchQuery;

  useEffect(() => {
    let cancelled = false;
    let task = null;
    (async () => {
      const el = ref.current;
      if (!el || !pdf) return;
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const textContent = await page.getTextContent();
      if (cancelled || !ref.current) return;
      const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
      el.innerHTML = '';
      // pdf.js 3.11 positions glyphs via this CSS var; must equal viewport.scale.
      el.style.setProperty('--scale-factor', String(scale));
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;
      try {
        task = pdfjsLib.renderTextLayer({ textContentSource: textContent, container: el, viewport, textDivs: [] });
        await task.promise;
        if (!cancelled) applySearchHighlight(el, queryRef.current);
      } catch { /* cancelled or unsupported — ignore */ }
    })();
    return () => { cancelled = true; try { task?.cancel?.(); } catch {} };
  }, [pdf, pageIndex, scale, rotation]);

  // re-apply highlight when the query changes (spans already rendered)
  useEffect(() => { applySearchHighlight(ref.current, searchQuery); }, [searchQuery]);

  return (
    <div
      ref={ref}
      className="spikeTextLayer"
      // NO explicit z-index: DOM order puts this above the page canvas but below the
      // annotation overlay (rendered after it), so annotation marks still capture clicks
      // and only empty areas fall through to the text layer for selection.
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'hidden', lineHeight: 1 }}
    />
  );
}
