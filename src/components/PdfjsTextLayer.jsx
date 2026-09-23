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
import {
  captureNativeSelectionSnapshot,
  getCaretBoundaryFromClientPoint,
  repairCollapsedTextDragSelection,
} from '../utils/nativeTextDragSelection';
import { readPdfjsTextContent } from '../utils/pdfjsTextContent';

// Inject the glyph-positioning + selection CSS once for the whole app.
// Exported for the text-search measurement layer (sidebar/SearchTextPanel.jsx),
// which renders its own off-screen pdf.js TextLayer and needs the same
// contract, or every measured match box comes out at the wrong place and size.
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
    .pdfjsTextLayer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
    .pdfjsTextLayer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
    .pdfjsTextLayer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
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
    /* Keep one-finger pan and native text selection, while allowing the page
       host to receive the browser's two-finger pinch gesture. */
    .pdfjsTextLayer.is-interactive { pointer-events: auto; cursor: text; z-index: 40; -webkit-user-select: text !important; user-select: text !important; touch-action: pan-x pan-y pinch-zoom; }
    .pdfjsTextLayer.is-interactive :is(span, br) { -webkit-user-select: text !important; user-select: text !important; -webkit-touch-callout: default !important; }
    .pdfjsTextLayer:not(.is-interactive) { pointer-events: none; }
    .pdfjsTextLayer:not(.is-interactive) :is(span, br) { -webkit-user-select: none; user-select: none; }
    .pdfjsTextLayer ::selection { background: rgba(58, 122, 254, 0.45); }
    .pdfjsTextLayer ::-moz-selection { background: rgba(58, 122, 254, 0.45); }
  `;
  document.head.appendChild(style);
}

// TextLayer sets data-main-rotation from this viewport. The CSS above applies
// pdf.js's matching root transform so intrinsic /Rotate pages align with the canvas.
export default function PdfjsTextLayer({ pdf, pageNumber, scale, rotation = 0, interactive = false, onTextAvailability }) {
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
    const el = ref.current;
    if (!interactive || !el || typeof document === 'undefined') return undefined;
    let drag = null;
    let repairTimer = 0;
    const clearDrag = () => { drag = null; };
    const completeDrag = (completedDrag, clientX, clientY) => {
      if (Math.hypot(clientX - completedDrag.x, clientY - completedDrag.y) < 2) return;
      window.clearTimeout(repairTimer);
      repairTimer = window.setTimeout(() => {
        repairCollapsedTextDragSelection({
          documentRef: document,
          windowRef: window,
          selectionSnapshot: completedDrag.selectionSnapshot,
          startBoundary: completedDrag.boundary,
          endClientPoint: { x: clientX, y: clientY },
        });
      }, 0);
    };
    const onPointerDown = (event) => {
      if (event.isPrimary === false || event.button !== 0 || event.pointerType === 'touch') return;
      const boundary = getCaretBoundaryFromClientPoint(document, event.clientX, event.clientY, el);
      if (!boundary || !el.contains(boundary.node)) return;
      drag = {
        pointerId: event.pointerId,
        boundary,
        selectionSnapshot: captureNativeSelectionSnapshot(window.getSelection?.()),
        x: event.clientX,
        y: event.clientY,
      };
    };
    const onPointerUp = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const completedDrag = drag;
      clearDrag();
      completeDrag(completedDrag, event.clientX, event.clientY);
    };
    const onTouchStart = (event) => {
      if (event.touches.length !== 1) { clearDrag(); return; }
      const touch = event.touches[0];
      const boundary = getCaretBoundaryFromClientPoint(document, touch.clientX, touch.clientY, el);
      if (!boundary || !el.contains(boundary.node)) return;
      drag = {
        touchId: touch.identifier,
        boundary,
        selectionSnapshot: captureNativeSelectionSnapshot(window.getSelection?.()),
        x: touch.clientX,
        y: touch.clientY,
      };
    };
    const onTouchEnd = (event) => {
      if (!drag || drag.touchId == null) return;
      const touch = Array.from(event.changedTouches || [])
        .find((candidate) => candidate.identifier === drag.touchId);
      if (!touch) return;
      const completedDrag = drag;
      clearDrag();
      completeDrag(completedDrag, touch.clientX, touch.clientY);
    };
    el.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    // UX: Escape must cancel native drag repair too, or mouseup recreates
    // the range after the shared select-family handler cancelled it.
    const cancelSelectionGesture = (event) => {
      if (!drag) return;
      event.detail.cancelled = true;
      clearDrag();
      window.clearTimeout(repairTimer);
    };
    window.addEventListener('survey-cancel-selection-gesture', cancelSelectionGesture);
    document.addEventListener('pointercancel', clearDrag, true);
    document.addEventListener('touchstart', onTouchStart, true);
    document.addEventListener('touchend', onTouchEnd, true);
    document.addEventListener('touchcancel', clearDrag, true);
    return () => {
      window.clearTimeout(repairTimer);
      el.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('survey-cancel-selection-gesture', cancelSelectionGesture);
      document.removeEventListener('pointercancel', clearDrag, true);
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', clearDrag, true);
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
        // WebKit's ReadableStream lacks async iteration on some supported iOS
        // builds. pdf.js getTextContent() uses `for await`, so read the same
        // public stream through its widely supported reader API instead.
        const textContent = await readPdfjsTextContent(page);
        onTextAvailability?.(pageNumber, textContent);
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
  }, [pdf, pageNumber, scale, rotation, onTextAvailability]);

  return <div ref={ref} className={`pdfjsTextLayer${interactive ? ' is-interactive' : ''}`} />;
}
