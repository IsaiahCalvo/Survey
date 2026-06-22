/**
 * 2026-04-25 — Pan-tool cursor scoping.
 *
 * Pdfjs's survey-pdfjs-page-container element spans the full viewer
 * width, and Pdfjs sets the pan-tool cursor (grab/grabbing) on
 * that container. The result is that the hand cursor appears not
 * only over the actual rendered page, but also over the gray
 * padding to the left and right of the page. Visually that makes
 * the gray gutters look like draggable canvas, when really they're
 * empty space.
 *
 * This module installs a mousemove listener on the page-container
 * (once it exists in the DOM) that:
 *   - lets Pdfjs's own cursor apply when the cursor is over
 *     a Pdfjs `_pageDiv_N` element (the actual page surface);
 *   - forces cursor: default on the container when the cursor is
 *     anywhere else (the gray gutters).
 *
 * The override is applied via inline style so it wins against
 * Pdfjs's CSS without needing !important, and it auto-clears
 * when the cursor returns to a page so we never block the natural
 * cursor changes in other tool modes (select, eraser, etc.).
 */

(function installCursorScoping() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__cursorScopingInstalled) return;
  window.__cursorScopingInstalled = true;

  // 2026-04-29: silenced by default — fired on every mouse move and flooded
  // the diagnostic log. Re-enable for cursor-scoping debug work by setting
  // window.__DIAG_CURSOR_SCOPE = true in DevTools.
  const log = (line) => {
    if (typeof window !== 'undefined' && window.__DIAG_CURSOR_SCOPE) {
      try { console.log(`[CursorScope] ${line}`); } catch { /* ignore */ }
    }
  };

  const isOnPage = (e) => {
    const target = e?.target;
    if (!target || typeof target.closest !== 'function') return false;
    // 2026-04-25 — Pdfjs's annotation-canvas / text-layer
    // children inside each pageDiv are CSS-stretched to the full
    // viewer width, so checking only `closest('[id*="_pageDiv_"]')`
    // returns true even when the cursor is in the gray gutter to
    // the right of the visible page. Verify the cursor coordinate
    // actually lies inside the pageDiv's own bounding rect — that
    // rect IS the visible page area in continuous mode.
    const pageDiv = target.closest('[id*="_pageDiv_"]');
    if (!pageDiv) return false;
    const r = pageDiv.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    return e.clientX >= r.left && e.clientX <= r.right
      && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  // Throttle the per-frame log spam: only log when the on-page state
  // actually transitions, plus occasional samples so we can confirm
  // the handler is alive.
  const lastStateRef = { onPage: null, sampleCount: 0 };

  const handleMouseMove = (container, e) => {
    const onPage = isOnPage(e);
    const transitioned = lastStateRef.onPage !== onPage;
    lastStateRef.onPage = onPage;
    if (transitioned || (lastStateRef.sampleCount++ % 60 === 0)) {
      try {
        const targetTag = e.target?.tagName ? `<${e.target.tagName.toLowerCase()}${e.target.id ? '#' + e.target.id : ''}>` : '?';
        const computed = e.target ? getComputedStyle(e.target).cursor : '?';
        log(`mousemove cursor=(${e.clientX},${e.clientY}) onPage=${onPage} target=${targetTag} computedCursor=${computed} transitioned=${transitioned}`);
      } catch { /* ignore */ }
    }
    if (onPage) {
      // Let Pdfjs's CSS cursor apply (pan grab in pan mode,
      // crosshair in select mode, etc.). Remove our class so the
      // descendant cursors aren't forced.
      container.classList.remove('__cursor-off-page');
    } else {
      // 2026-04-25 — Force the regular pointer in the gray gutters.
      // Toggle a CSS class so the matching stylesheet rule (with
      // !important and a `*` selector) beats Pdfjs's per-element
      // cursor rules across every descendant.
      container.classList.add('__cursor-off-page');
    }
  };

  const bind = (container) => {
    if (container.__cursorScopingBound) return;
    container.__cursorScopingBound = true;
    container.addEventListener('mousemove', (e) => handleMouseMove(container, e), true);
    container.addEventListener('mouseleave', () => {
      container.classList.remove('__cursor-off-page');
    }, true);
    log(`bound mousemove on container ${container.id || '(no id)'}`);
  };

  const tryBindAll = () => {
    const containers = document.querySelectorAll('.survey-pdfjs-page-container');
    for (const c of containers) bind(c);
  };

  // The viewer mounts asynchronously (Pdfjs lazy-creates the DOM
  // after the PDF loads). Watch for the container to appear via
  // MutationObserver so we bind whenever a new viewer instance shows
  // up, including tab switches and reopen flows.
  const observer = new MutationObserver(() => {
    tryBindAll();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Also try once immediately in case the container is already in the DOM.
  tryBindAll();

  log('installed');
})();
