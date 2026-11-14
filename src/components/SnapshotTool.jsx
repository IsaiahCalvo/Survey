// Snapshot tool (Nightly 'snapshot-tool', Drawboard PDF Pro push 2026-11-12,
// drawboard-trial/pdf-pro/apps-side-by-side.md A10). With the tool on, a drag
// over a page draws a box; the area (page + marks) is copied to the clipboard
// as a picture. The box stays with 8 handles: carrying a handle or the box
// copies again. A new drag replaces it; putting the tool down (Escape goes
// to Pan) clears it. A finger runs it only where fingers run tools
// (utils/pencilMode.js), so in Pencil only a finger still pans.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { composeThumbnail, releaseCanvas, renderPageToCanvas } from '../services/thumbnailRender.js';
import {
  SNAPSHOT_HANDLES,
  boxToPixels,
  dragBox,
  isBigEnough,
  renderTargetPx,
} from '../utils/snapshotArea.js';
import { showToast } from '../utils/toast.js';
import { pointerMayUseTool } from '../utils/pencilMode.js';
import './SnapshotTool.css';

const PAGE_SELECTOR = '.survey-pdfjs-page-div[data-page-number]';

function pageDivFor(wrapper, page) {
  return wrapper?.querySelector(`.survey-pdfjs-page-div[data-page-number="${page}"]`) || null;
}

function pointIn(div, event) {
  const r = div.getBoundingClientRect();
  return { x: (event.clientX - r.left) / (r.width || 1), y: (event.clientY - r.top) / (r.height || 1), r };
}

/** The picked area of the page, page + marks, as a PNG blob. */
export async function snapshotBlob({ pdfDoc, pageNumber, box, markup }) {
  const page = await pdfDoc.getPage(pageNumber);
  const view = page.getViewport({ scale: 1 });
  const base = await renderPageToCanvas(page, { target: renderTargetPx(view.width, view.height) });
  let full = null;
  try {
    full = composeThumbnail(base, markup || {});
  } finally {
    releaseCanvas(base.canvas);
  }
  const { sx, sy, sw, sh } = boxToPixels(box, full.width, full.height);
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  releaseCanvas(full);
  try {
    return await new Promise((resolve, reject) => {
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the snapshot'))), 'image/png');
    });
  } finally {
    releaseCanvas(out);
  }
}

export default function SnapshotTool({ active, wrapperRef, pdfDoc, getMarkup }) {
  const [snap, setSnap] = useState(null); // { page, box }
  const snapRef = useRef(null);
  snapRef.current = snap;
  const dragRef = useRef(null);
  const latest = useRef({ pdfDoc, getMarkup });
  latest.current = { pdfDoc, getMarkup };
  const [, setTick] = useState(0);

  useEffect(() => { if (!active) setSnap(null); }, [active]);
  useEffect(() => { setSnap(null); }, [pdfDoc]);

  const copy = useCallback((page, box) => {
    const { pdfDoc: doc, getMarkup: markupFor } = latest.current;
    if (!doc || !box) return;
    const blob = snapshotBlob({ pdfDoc: doc, pageNumber: page, box, markup: markupFor?.(page) });
    const done = () => showToast('Snapshot copied to clipboard', 'success');
    const failed = () => showToast('Could not copy the snapshot.', 'error');
    // The ClipboardItem is made now, inside the pointer release, with the
    // picture still drawing: Safari only allows a write started by the gesture.
    try {
      if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(done, failed);
        return;
      }
    } catch { /* fall through */ }
    blob.then(() => failed(), failed);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    wrapper.setAttribute('data-snapshot-tool', 'true');

    const onDown = (event) => {
      if (event.button !== 0 || !event.isPrimary || !pointerMayUseTool(event.pointerType)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !wrapper.contains(target)) return;
      const handle = target.closest('[data-snapshot-handle]')?.getAttribute('data-snapshot-handle');
      const inBox = !handle && target.closest('[data-snapshot-box]');
      const current = snapRef.current;
      let pageDiv;
      let page;
      if ((handle || inBox) && current) {
        page = current.page;
        pageDiv = pageDivFor(wrapper, page);
      } else {
        pageDiv = target.closest(PAGE_SELECTOR);
        page = Number(pageDiv?.getAttribute('data-page-number'));
      }
      if (!pageDiv || !(page > 0)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const start = pointIn(pageDiv, event);
      dragRef.current = {
        id: event.pointerId,
        page,
        pageDiv,
        start,
        mode: handle || (inBox ? 'move' : 'new'),
        from: current?.box || null,
      };
      if (!handle && !inBox) setSnap(null);
    };
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSnap({ page: drag.page, box: dragBox(drag, pointIn(drag.pageDiv, event)), live: true });
    };
    const onUp = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      dragRef.current = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      // The box from this release itself: the state the last move set may
      // not have rendered yet (a fast drag, or a click), so it is not read.
      const at = pointIn(drag.pageDiv, event);
      const box = dragBox(drag, at);
      if (!box || !isBigEnough(box, at.r.width, at.r.height)) {
        // A click: no box (a click on the box itself keeps it).
        setSnap(drag.mode === 'new' ? null : (drag.from ? { page: drag.page, box: drag.from } : null));
        return;
      }
      setSnap({ page: drag.page, box });
      copy(drag.page, box);
    };
    const onCancel = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      dragRef.current = null;
      setSnap(drag.from ? { page: drag.page, box: drag.from } : null);
    };
    // Capture on window, ahead of the page layers: while the tool is on, a
    // press on a page belongs to the snapshot box, not to a mark or a pan.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    // The page divs come and go as the view scrolls; redraw when they do.
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(() => { if (snapRef.current) setTick((t) => t + 1); })
      : null;
    observer?.observe(wrapper, { childList: true, subtree: true });
    return () => {
      wrapper.removeAttribute('data-snapshot-tool');
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      observer?.disconnect();
      dragRef.current = null;
    };
  }, [active, wrapperRef, copy]);

  if (!active || !snap) return null;
  const pageDiv = pageDivFor(wrapperRef.current, snap.page);
  if (!pageDiv) return null;
  const { box } = snap;
  return createPortal(
    <div
      className="snapshot-box"
      data-snapshot-box="true"
      data-snapshot-page={snap.page}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
    >
      {!snap.live && SNAPSHOT_HANDLES.map((handle) => (
        <span key={handle} className={`snapshot-box__handle is-${handle}`} data-snapshot-handle={handle} />
      ))}
    </div>,
    pageDiv,
  );
}
