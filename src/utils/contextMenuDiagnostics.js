/**
 * Right-click / context-menu dispatcher (+ diagnostic).
 *
 * Routes native contextmenu events to the correct PAL's handleContextMenu via
 * a per-page registry (contextMenuBridge). Works for both pan tool (SVG layer
 * is pointerEvents:none so click falls through to Syncfusion) and select tool
 * (SVG layer catches the click). Page number is discovered by walking the
 * event path / elementsFromPoint for either our own `[data-pal-root="N"]` /
 * `[data-diag-svg-wrapper="N"]` attrs, or Syncfusion's `pageDiv_N` id suffix.
 *
 * Also retains the original capture/bubble/mousedown logging so we can
 * continue to debug coverage gaps. Logs go to window.__consoleLogBuffer.
 */

import { lookup as lookupPalHandler, listRegistered } from './contextMenuBridge.js';
import { resolveAnnotationAt } from './annotationHitTest.js';

(function installContextMenuDiag() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__contextMenuDiagInstalled) return;
  window.__contextMenuDiagInstalled = true;

  const shortTag = (el) => {
    if (!el || !el.tagName) return String(el);
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const data = [];
    if (el.getAttribute) {
      const attrs = ['data-pal-root', 'data-diag-svg-wrapper', 'data-annotation-index', 'data-callout-id', 'data-counter-overlay'];
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v != null) data.push(`${a}="${v}"`);
      }
    }
    return `<${el.tagName.toLowerCase()}${id}${cls}${data.length ? ' ' + data.join(' ') : ''}>`;
  };

  const summarizePath = (path) => {
    if (!Array.isArray(path)) return '(no path)';
    return path.slice(0, 8).map(shortTag).join(' → ');
  };

  const logEvent = (phase, e) => {
    try {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const payload = {
        phase,
        type: e.type,
        button: e.button,
        which: e.which,
        buttons: e.buttons,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        clientX: e.clientX,
        clientY: e.clientY,
        defaultPrevented: e.defaultPrevented,
        target: shortTag(e.target),
        currentTarget: shortTag(e.currentTarget),
        pathDepth: path.length,
        pathSummary: summarizePath(path),
      };
      console.log(`[CTXDIAG ${phase}] ${JSON.stringify(payload)}`);

      // At capture phase also dump elementsFromPoint so we see every layer
      // under the cursor (stacking order from topmost to bottommost). This
      // tells us which layer the native hit-test actually selects at the
      // click coordinate.
      if (phase === 'capture' && typeof document.elementsFromPoint === 'function') {
        const stack = document.elementsFromPoint(e.clientX, e.clientY)
          .slice(0, 10)
          .map((el, i) => `${i}:${shortTag(el)}`);
        console.log(`[CTXDIAG capture stack-at-point] ${JSON.stringify(stack)}`);
      }
    } catch (err) {
      console.warn('[CTXDIAG] log failed', err?.message || err);
    }
  };

  document.addEventListener('contextmenu', (e) => {
    logEvent('capture', e);

    // UX 2026-04-21: the properties panel is a tool surface — right-click
    // on it should never fall through to the canvas's paste menu OR the
    // annotation context menu for whatever happens to be behind it. The
    // event target is checked here (in the document-level capture phase)
    // because the pan-mode fallback in resolveAnnotationAt uses pure
    // bounding-rect tests inside the page wrapper, which would otherwise
    // find a shape underneath the panel regardless of visual stacking.
    // Fully swallow the event: no annotation menu, no native menu.
    if (e.target && typeof e.target.closest === 'function'
        && e.target.closest('[data-annotation-properties-panel]')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const { pageNumber, annotationIndex, calloutId, kind, groupIndices } = resolveAnnotationAt(e);
    const globalHandler = typeof window.__onAnnotationContextMenu === 'function'
      ? window.__onAnnotationContextMenu
      : null;
    const palHandler = pageNumber != null ? lookupPalHandler(pageNumber) : null;
    // 2026-04-25 — Only show the annotation/page right-click menu when the
    // cursor is actually over a PDF page. Right-clicks on the toolbar,
    // sidebar, panels, or any non-page chrome should fall through to the
    // browser's native menu. Previously the global handler fired on every
    // right-click, opening the empty-page "Paste" menu over chrome that
    // had nothing to paste into — confusing UX. Anchoring on
    // `pageNumber != null` keeps the menu scoped to the page surface.
    const handler = pageNumber != null ? (globalHandler || palHandler) : null;

    console.log(`[CTXDIAG dispatch] page=${pageNumber} annoIdx=${annotationIndex} calloutId=${calloutId} kind=${kind} groupIndices=${groupIndices ? groupIndices.length : 0} handler=${!!handler} source=${pageNumber == null ? 'off-page' : (globalHandler ? 'app' : (palHandler ? 'pal' : 'none'))} registered=${JSON.stringify(listRegistered())}`);

    if (handler) {
      e.preventDefault();
      e.stopPropagation();
      try {
        handler({ pageNumber, annotationIndex, calloutId, kind, groupIndices, event: e });
      } catch (err) {
        console.warn('[CTXDIAG dispatch] handler threw', err?.message || err);
      }
    }
  }, true);

  document.addEventListener('contextmenu', (e) => logEvent('bubble-final', e), false);

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    logEvent('mousedown-right', e);
  }, true);

  console.log('[CTXDIAG] installed — document-level capture dispatcher + bubble + right-button mousedown listeners');
})();
