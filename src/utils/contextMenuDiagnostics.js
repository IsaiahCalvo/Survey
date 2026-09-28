/**
 * Right-click / context-menu dispatcher (+ diagnostic).
 *
 * Routes native contextmenu events to the correct PAL's handleContextMenu via
 * a per-page registry (contextMenuBridge). Works for both pan tool (SVG layer
 * is pointerEvents:none so click falls through to Pdfjs) and select tool
 * (SVG layer catches the click). Page number is discovered by walking the
 * event path / elementsFromPoint for either our own `[data-pal-root="N"]` /
 * `[data-diag-svg-wrapper="N"]` attrs, or Pdfjs's `pageDiv_N` id suffix.
 *
 * Diagnostic logging is opt-in so normal right-clicks do not flood the console.
 * Enable with `window.__CTX_DIAG_CONSOLE = true` before reproducing.
 */

import { lookup as lookupPalHandler, listRegistered } from './contextMenuBridge.js';
import { resolveAnnotationAt } from './annotationHitTest.js';
import { selectionUsesPdfTextLayer } from './pdfNativeTextInteraction.js';

// 2026-04-25 — Build stamp so save-logs reveal which version of this
// dispatcher is actually live. If HMR mis-replaces the listener, the
// stamp in the install log will still match the stale build's value.
const CTX_DIAG_BUILD = 'page-gated-v2-2026-04-25';

function diag(line) {
  const consoleEnabled =
    typeof window !== 'undefined' && window.__CTX_DIAG_CONSOLE === true;
  if (consoleEnabled) {
    try { console.debug(line); } catch { /* ignore */ }
  }
  try {
    if (typeof window !== 'undefined') {
      window.__rightClickDiag = window.__rightClickDiag || [];
      window.__rightClickDiag.push({ t: Date.now(), line });
      if (window.__rightClickDiag.length > 1000) window.__rightClickDiag.shift();
    }
  } catch { /* ignore */ }
}

(function installContextMenuDiag() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // 2026-04-25 — HMR-safe install. If a previous version of this module
  // is already bound, remove its listeners before binding the new ones.
  // Without this, Vite hot-reloads silently keep the OLD dispatcher
  // logic active, so any code change here appears not to take effect
  // until the user does a full page reload.
  if (window.__contextMenuDiagTeardown) {
    try { window.__contextMenuDiagTeardown(); } catch { /* ignore */ }
  }
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
      diag(`[CTXDIAG ${phase} ${CTX_DIAG_BUILD}] ${JSON.stringify(payload)}`);

      // At capture phase also dump elementsFromPoint so we see every layer
      // under the cursor (stacking order from topmost to bottommost). This
      // tells us which layer the native hit-test actually selects at the
      // click coordinate.
      if ((phase === 'capture' || phase === 'win-capture') && typeof document.elementsFromPoint === 'function') {
        const stack = document.elementsFromPoint(e.clientX, e.clientY)
          .slice(0, 15)
          .map((el, i) => `${i}:${shortTag(el)}`);
        diag(`[CTXDIAG ${phase} stack-at-point] ${JSON.stringify(stack)}`);

        // 2026-04-25 — Also dump the bounding-rect of every PAL root +
        // SVG wrapper currently in the DOM, so we can SEE whether one
        // of them extends past the visible page edge into the gray
        // padding (which would explain why right-clicks "to the right
        // of the canvas" still resolve to a pageNumber and open the
        // empty-page Paste menu).
        const wrappers = document.querySelectorAll('[data-pal-root], [data-diag-svg-wrapper]');
        const rects = [];
        for (const w of wrappers) {
          const r = w.getBoundingClientRect();
          const hit = e.clientX >= r.left && e.clientX <= r.right
            && e.clientY >= r.top && e.clientY <= r.bottom;
          rects.push({
            tag: shortTag(w),
            left: Math.round(r.left), top: Math.round(r.top),
            right: Math.round(r.right), bottom: Math.round(r.bottom),
            width: Math.round(r.width), height: Math.round(r.height),
            hit
          });
        }
        diag(`[CTXDIAG ${phase} wrapper-rects @cursor=(${Math.round(e.clientX)},${Math.round(e.clientY)})] ${JSON.stringify(rects)}`);
      }
    } catch (err) {
      diag(`[CTXDIAG] log failed: ${err?.message || err}`);
    }
  };

  const captureListener = (e) => {
    // 2026-04-25 — Unconditional ENTRY log so we ALWAYS know the
    // dispatcher fired, even if logEvent or downstream code throws.
    diag(`[CTXDIAG enter ${CTX_DIAG_BUILD}] type=${e.type} button=${e.button} clientX=${e.clientX} clientY=${e.clientY} target=${shortTag(e.target)}`);
    logEvent('capture', e);

    // PDF text owns its native copy menu while a real range is selected.
    // Do not replace it with the annotation/page menu.
    if (selectionUsesPdfTextLayer(window.getSelection?.())) {
      diag('[CTXDIAG] native — selected PDF text');
      return;
    }

    // The counter-series toolbar owns its own compact action menu. Because
    // this dispatcher resolves annotations beneath floating UI, a right-click
    // on a series row can otherwise also open the underlying pin menu.
    if (e.target && typeof e.target.closest === 'function'
        && e.target.closest('[data-counter-series-menu], [data-counter-series-context-menu]')) {
      diag('[CTXDIAG] suppressed — inside counter series menu');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Region Editor owns its own right-click menu. This dispatcher runs in
    // capture phase, so without this guard it opens the page-level disabled
    // Paste menu before RegionSelectionTool can show Copy/Cut/Paste/Merge.
    if (e.target && typeof e.target.closest === 'function'
        && e.target.closest('[data-region-selection-ui="true"]')) {
      diag('[CTXDIAG] suppressed — inside region selection tool');
      return;
    }

    // UX: w53 (2026-09-28, owner: "annotations are annotations") — a Survey
    // Marker gets the normal annotation right-click menu (Cut, Copy, Paste,
    // Duplicate, Delete, Bring / Send). Right-clicking a marker that is part
    // of a bigger selection opens the selection's (group) menu, exactly like
    // right-clicking inside any multi-selection's frame. (Until w53 a
    // right-click on a marker was swallowed: no menu at all.)
    const markerNode = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('[data-survey-marker-id]')
      : null;
    if (markerNode) {
      const surveyMarkerId = markerNode.getAttribute('data-survey-marker-id');
      const wrapper = markerNode.closest('[data-diag-svg-wrapper]');
      const markerPage = wrapper ? Number(wrapper.getAttribute('data-diag-svg-wrapper')) : null;
      const svgLayer = markerNode.closest('[data-svg-annotation-layer]');
      const groupBox = svgLayer?.querySelector?.('[data-group-selection-bbox="true"]') || null;
      const groupMarkerIds = (groupBox?.getAttribute('data-group-selection-marker-ids') || '')
        .split(',').filter(Boolean);
      const handler = typeof window.__onAnnotationContextMenu === 'function'
        ? window.__onAnnotationContextMenu
        : null;
      diag(`[CTXDIAG] survey marker ${surveyMarkerId} page=${markerPage} inGroup=${groupMarkerIds.includes(surveyMarkerId)}`);
      e.preventDefault();
      e.stopPropagation();
      if (!handler || markerPage == null || !surveyMarkerId) return;
      if (groupMarkerIds.includes(surveyMarkerId)) {
        const groupIndices = (groupBox.getAttribute('data-group-selection-indices') || '')
          .split(',').filter((s) => s !== '').map(Number).filter(Number.isFinite);
        handler({ pageNumber: markerPage, annotationIndex: null, calloutId: null, kind: 'group', groupIndices, groupMarkerIds, event: e });
      } else {
        handler({ pageNumber: markerPage, annotationIndex: null, calloutId: null, kind: 'surveyMarker', surveyMarkerId, event: e });
      }
      return;
    }

    const { pageNumber, annotationIndex, calloutId, kind, groupIndices } = resolveAnnotationAt(e);
    // w53: Survey Markers in a right-clicked selection frame.
    const groupMarkerIds = kind === 'group' && pageNumber != null
      ? (document.querySelector(`[data-svg-annotation-layer="${pageNumber}"] [data-group-selection-bbox="true"]`)
        ?.getAttribute('data-group-selection-marker-ids') || '').split(',').filter(Boolean)
      : [];
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

    diag(`[CTXDIAG dispatch ${CTX_DIAG_BUILD}] page=${pageNumber} annoIdx=${annotationIndex} calloutId=${calloutId} kind=${kind} groupIndices=${groupIndices ? groupIndices.length : 0} handler=${!!handler} source=${pageNumber == null ? 'off-page-suppressed' : (globalHandler ? 'app' : (palHandler ? 'pal' : 'none'))} registered=${JSON.stringify(listRegistered())}`);

    if (handler) {
      e.preventDefault();
      e.stopPropagation();
      try {
        handler({ pageNumber, annotationIndex, calloutId, kind, groupIndices, groupMarkerIds, event: e });
      } catch (err) {
        diag(`[CTXDIAG dispatch] handler threw: ${err?.message || err}`);
      }
    }
  };
  // 2026-04-25 — TWO capture-phase listeners (window AND document) so
  // we catch the event even if some library installs a stopImmediate
  // capture handler on document. The window-level handler runs FIRST
  // in capture order. Both are read-only logging — neither prevents
  // default unless the page-gate logic decides to fire the menu.
  const winCaptureListener = (e) => {
    diag(`[CTXDIAG win-enter ${CTX_DIAG_BUILD}] type=${e.type} button=${e.button} clientX=${e.clientX} clientY=${e.clientY} target=${shortTag(e.target)} defaultPrevented=${e.defaultPrevented}`);
    logEvent('win-capture', e);
  };
  const bubbleListener = (e) => logEvent('bubble-final', e);
  const mousedownListener = (e) => {
    if (e.button !== 2) return;
    diag(`[CTXDIAG mousedown-right-raw] clientX=${e.clientX} clientY=${e.clientY} target=${shortTag(e.target)}`);
    logEvent('mousedown-right', e);
  };
  // 2026-04-25 — Also intercept the menu-state setter from the React
  // side. Whenever the annotation context menu actually opens, log a
  // stack trace so we can see WHICH code path opened it. This catches
  // the case where some other module is calling setAnnotationContextMenu
  // outside our dispatcher.
  const menuOpenWatcher = (snapshot) => {
    try {
      const stack = (new Error('CTXDIAG menu-open trace')).stack;
      diag(`[CTXDIAG menu-open watcher] ${JSON.stringify(snapshot)} stack=${stack ? stack.split('\n').slice(1, 6).join(' | ') : 'no-stack'}`);
    } catch { /* ignore */ }
  };
  window.__ctxDiagMenuOpenWatcher = menuOpenWatcher;

  window.addEventListener('contextmenu', winCaptureListener, true);
  document.addEventListener('contextmenu', captureListener, true);
  document.addEventListener('contextmenu', bubbleListener, false);
  window.addEventListener('mousedown', mousedownListener, true);

  window.__contextMenuDiagTeardown = () => {
    window.removeEventListener('contextmenu', winCaptureListener, true);
    document.removeEventListener('contextmenu', captureListener, true);
    document.removeEventListener('contextmenu', bubbleListener, false);
    window.removeEventListener('mousedown', mousedownListener, true);
    delete window.__ctxDiagMenuOpenWatcher;
    window.__contextMenuDiagInstalled = false;
  };

  diag(`[CTXDIAG ${CTX_DIAG_BUILD}] installed — window+document capture dispatcher + bubble + right-button mousedown listeners + menu-open watcher`);
})();

// Vite HMR hook — when this module reloads, run the teardown so the next
// install replaces the listeners cleanly.
if (typeof import.meta !== 'undefined' && import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof window !== 'undefined' && window.__contextMenuDiagTeardown) {
      try { window.__contextMenuDiagTeardown(); } catch { /* ignore */ }
    }
  });
}
