// Selectable text overlay for one pdf.js page.
// ----------------------------------------------------------------------------
// Lays pdf.js's own renderTextLayer transparent <span>s over the page so native
// OS select + copy work — battle-tested glyph positioning, no Pdfjs. Sits
// inside the per-page overlay div, so it rides the glued-zoom transform on the
// app overlay root during a gesture and re-renders at the committed scale on
// settle. There is NO div-level zoom transform here — positioning is driven by
// the pdf.js viewport at the committed `scale` plus the `--scale-factor` var.
//
// Interactivity is gated by the caller (text-select tool only) so the layer
// never intercepts pointer events meant for the drawing canvas, form widgets,
// links, or pan — it is pointer-events:none unless explicitly interactive.
// ----------------------------------------------------------------------------
import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Inject the glyph-positioning + selection CSS once for the whole app.
let stylesInjected = false;
function ensureTextLayerStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-pdfjs-text-layer', 'true');
  style.textContent = `
    .pdfjsTextLayer { position: absolute; left: 0; top: 0; overflow: hidden; line-height: 1; color: transparent; }
    .pdfjsTextLayer > span { position: absolute; white-space: pre; transform-origin: 0% 0%; }
    .pdfjsTextLayer.is-interactive { user-select: text; -webkit-user-select: text; pointer-events: auto; }
    .pdfjsTextLayer.is-interactive > span { cursor: text; }
    .pdfjsTextLayer:not(.is-interactive) { user-select: none; -webkit-user-select: none; pointer-events: none; }
    .pdfjsTextLayer ::selection { background: rgba(58, 122, 254, 0.45); }
    .pdfjsTextLayer ::-moz-selection { background: rgba(58, 122, 254, 0.45); }
  `;
  document.head.appendChild(style);
}

// NOTE on `rotation`: the pdf.js engine bakes intrinsic /Rotate into the page and
// applies user rotation by rewriting the PDF bytes (it always renders at rotation 0,
// same as the canvas, link, and form layers). So the default of 0 is correct — the
// glyph viewport already inherits the page's baked orientation via `page.rotate`.
export default function PdfjsTextLayer({ pdf, pageNumber, scale, rotation = 0, interactive = false }) {
  const ref = useRef(null);
  const wasInteractiveRef = useRef(interactive);

  useEffect(() => { ensureTextLayerStyles(); }, []);

  // Leaving text-select mode: drop any lingering OS selection so a persisted highlight
  // can't swallow the first click of the next tool. Only fires on the true→false edge,
  // never on mount, so it can't clobber a selection being made elsewhere.
  useEffect(() => {
    if (wasInteractiveRef.current && !interactive) {
      try { window.getSelection?.()?.removeAllRanges?.(); } catch { /* noop */ }
    }
    wasInteractiveRef.current = interactive;
  }, [interactive]);

  useEffect(() => {
    let cancelled = false;
    let task = null;
    (async () => {
      const el = ref.current;
      if (!el || !pdf) return;
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !ref.current) return;
        const textContent = await page.getTextContent();
        if (cancelled || !ref.current) return;
        const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
        el.innerHTML = '';
        // pdf.js positions glyphs using this CSS var; it must equal viewport.scale.
        el.style.setProperty('--scale-factor', String(scale));
        el.style.width = `${Math.floor(viewport.width)}px`;
        el.style.height = `${Math.floor(viewport.height)}px`;
        task = new pdfjsLib.TextLayer({ textContentSource: textContent, container: el, viewport });
        await task.render();
      } catch { /* cancelled or unsupported render — ignore */ }
    })();
    return () => { cancelled = true; try { task?.cancel?.(); } catch { /* noop */ } };
  }, [pdf, pageNumber, scale, rotation]);

  return <div ref={ref} className={`pdfjsTextLayer${interactive ? ' is-interactive' : ''}`} />;
}
