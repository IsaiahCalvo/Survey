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
import { resolveTextLayerRotation, resolveTextLayerScale } from '../utils/pdfjsTextLayerViewport.js';

// Inject the glyph-positioning + selection CSS once for the whole app.
let stylesInjected = false;
export function ensureTextLayerStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-pdfjs-text-layer', 'true');
  // These rules are pdf.js's own `.textLayer` contract (pdfjs-dist 6.x,
  // web/pdf_viewer.css), re-scoped to our class name. They are NOT decorative:
  // TextLayer.render() writes inline styles that DEPEND on them —
  //   width/height: round(down, var(--total-scale-factor) * <pt>px, var(--scale-round-x))
  //   span font-size: calc(var(--text-scale-factor) * var(--font-height))
  //   span transform: rotate(--rotate) scaleX(--scale-x) scale(--min-font-size-inv)
  // pdf.js's viewer defines the custom properties on `.pdfViewer .page`; this
  // overlay lives in the app's own page host instead, so it has to define them
  // itself. KAL-239: without them the round() was invalid, the layer collapsed
  // to 0x0, `overflow` clipped every glyph span out of existence and the spans
  // stacked at the page origin at the wrong size — nothing was selectable and
  // nothing was even hit-testable. Keep this block in sync when pdf.js is
  // upgraded (diff `.textLayer` in node_modules/pdfjs-dist/web/pdf_viewer.css).
  style.textContent = `
    .pdfjsTextLayer {
      color-scheme: only light;
      position: absolute;
      text-align: initial;
      inset: 0;
      overflow: clip;
      opacity: 1;
      line-height: 1;
      letter-spacing: normal;
      word-spacing: normal;
      -webkit-text-size-adjust: none;
      text-size-adjust: none;
      forced-color-adjust: none;
      transform-origin: 0 0;
      caret-color: CanvasText;
      z-index: 0;
      --user-unit: 1;
      --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
      --scale-round-x: 1px;
      --scale-round-y: 1px;
      --min-font-size: 1;
      --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
      --min-font-size-inv: calc(1 / var(--min-font-size));
    }
    .pdfjsTextLayer :is(span, br) {
      color: transparent;
      position: absolute;
      white-space: pre;
      cursor: text;
      transform-origin: 0% 0%;
      -webkit-user-select: text;
      user-select: text;
    }
    .pdfjsTextLayer > :not(.markedContent),
    .pdfjsTextLayer .markedContent span:not(.markedContent) {
      z-index: 1;
      --font-height: 0;
      font-size: calc(var(--text-scale-factor) * var(--font-height));
      --scale-x: 1;
      --rotate: 0deg;
      transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
    }
    .pdfjsTextLayer .markedContent { display: contents; }
    .pdfjsTextLayer span[role="img"] { -webkit-user-select: none; user-select: none; cursor: default; }
    /* UX: the I-beam covers the WHOLE page in text-selection mode, not just the
       glyph boxes, so the mode reads as "you are selecting text here" even in
       the gaps between words. */
    .pdfjsTextLayer.is-interactive { pointer-events: auto; cursor: text; }
    .pdfjsTextLayer:not(.is-interactive) { pointer-events: none; }
    .pdfjsTextLayer:not(.is-interactive) :is(span, br) { -webkit-user-select: none; user-select: none; }
    .pdfjsTextLayer ::selection { background: rgba(58, 122, 254, 0.45); }
    .pdfjsTextLayer ::-moz-selection { background: rgba(58, 122, 254, 0.45); }
  `;
  document.head.appendChild(style);
}

// NOTE on `rotation`: the pdf.js engine bakes intrinsic /Rotate into the page and
// applies user rotation by rewriting the PDF bytes (it always renders at rotation 0,
// same as the canvas, link, and form layers). So the default of 0 is correct — the
// glyph viewport already inherits the page's baked orientation via `page.rotate`.
// After Pages CW the raster host is landscape (792×612). Size from the page
// host (container-aware), never pageSize * scale; add 90 when host aspect
// disagrees with the proxy viewport (stale rotate 0 / leftover portrait).
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

  // 390 / coarse surfaces: Chromium fires selectstart on the transformed glyph
  // spans but never creates a range (rangeCount stays 0). Desktop native drag
  // still wins — this only fills in when the OS selection is empty after
  // pointerup. Two-finger pinch is handled by the viewer and never lands here
  // as a 1-finger up on the interactive layer.
  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return undefined;
    let startX = 0;
    let startY = 0;
    const pickSpan = (clientX, clientY) => {
      const hit = document.elementFromPoint(clientX, clientY);
      if (!hit || !el.contains(hit)) return null;
      const span = hit.closest?.('span');
      if (!span || span.getAttribute('role') === 'img') return null;
      return span;
    };
    const onDown = (event) => {
      if (event.pointerType === 'touch' && event.isPrimary === false) return;
      startX = event.clientX;
      startY = event.clientY;
    };
    const onUp = (event) => {
      if (event.pointerType === 'touch' && event.isPrimary === false) return;
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && String(sel.toString() || '').trim()) return;
      const from = pickSpan(startX, startY);
      const to = pickSpan(event.clientX, event.clientY) || from;
      if (!from) return;
      try {
        const range = document.createRange();
        if (to && to !== from) {
          const fromFirst = from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING;
          range.setStartBefore(fromFirst ? from : to);
          range.setEndAfter(fromFirst ? to : from);
        } else {
          range.selectNodeContents(from);
        }
        sel?.removeAllRanges?.();
        sel?.addRange?.(range);
      } catch { /* inverted / detached — ignore */ }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
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
        const host = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`)
          || el.closest('.survey-pdfjs-page-div');
        const hostWidth = Number(host?.offsetWidth) || 0;
        const hostHeight = Number(host?.offsetHeight) || 0;
        const intrinsic = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
        const displayRotation = resolveTextLayerRotation(
          page.rotate,
          rotation,
          hostWidth,
          hostHeight,
          intrinsic.width,
          intrinsic.height,
        );
        const fitted = page.getViewport({ scale: 1, rotation: displayRotation });
        const effectiveScale = resolveTextLayerScale(hostWidth, fitted.width, scale);
        const viewport = page.getViewport({ scale: effectiveScale, rotation: displayRotation });
        el.innerHTML = '';
        // pdf.js positions glyphs using this CSS var; it must equal viewport.scale.
        el.style.setProperty('--scale-factor', String(viewport.scale));
        // inset:0 would lock the layer to a leftover portrait overlay parent
        // after CW. Pin top-left and use the live host box instead.
        el.style.inset = 'auto';
        el.style.top = '0';
        el.style.left = '0';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.width = `${Math.floor(hostWidth || viewport.width)}px`;
        el.style.height = `${Math.floor(hostHeight || viewport.height)}px`;
        task = new pdfjsLib.TextLayer({ textContentSource: textContent, container: el, viewport });
        await task.render();
        if (hostWidth > 8 && hostHeight > 8) {
          el.style.inset = 'auto';
          el.style.width = `${Math.floor(hostWidth)}px`;
          el.style.height = `${Math.floor(hostHeight)}px`;
        }
      } catch { /* cancelled or unsupported render — ignore */ }
    })();
    return () => { cancelled = true; try { task?.cancel?.(); } catch { /* noop */ } };
  }, [pdf, pageNumber, scale, rotation]);

  return <div ref={ref} className={`pdfjsTextLayer${interactive ? ' is-interactive' : ''}`} />;
}
