/* Nightly 'area-redact' (Drawboard PDF Review > Redaction): drag a box over
 * any part of a page (words, a drawing, a photo) and it is blacked out, the
 * same way Redact text blacks out selected words. Letting go opens the same
 * "Apply redactions" card, which makes the redacted copy (the content under
 * the box is removed, not just covered).
 *   - Pen or mouse drags; a finger only where fingers run tools
 *     (utils/pencilMode.js), so a finger still pans.
 *   - The box stops at the page edge; Escape drops a drag in progress.
 * The box becomes a 'redact' text-markup mark with one quad, so the
 * confirmation, the burn-in and the export are the text redaction's own. */
import { useEffect, useRef, useState } from 'react';
import { pointerMayUseTool } from '../utils/pencilMode.js';
import { pageElementAt } from '../markLibrary/markLibraryPlacement.js';
import './AreaRedactHost.css';

export const AREA_REDACT_TOOL_ID = 'area-redact';
const CONTROL = 'button, input, textarea, select, a[href], [role="menu"], [role="dialog"], [role="toolbar"], [contenteditable="true"]';
const MIN_PX = 4;

/** The page box (page units) for a client-space box over `page`, or null. */
export function clientBoxToPage(page, a, b) {
  const svg = page?.querySelector?.('svg[data-svg-annotation-layer]');
  const ctm = svg?.getScreenCTM?.();
  const vb = svg?.getAttribute?.('viewBox')?.split(/\s+/).map(Number);
  if (!ctm || !vb || vb.length !== 4) return null;
  const inv = ctm.inverse();
  const map = (x, y) => ({ x: inv.a * x + inv.c * y + inv.e, y: inv.b * x + inv.d * y + inv.f });
  const corners = [map(a.x, a.y), map(b.x, a.y), map(a.x, b.y), map(b.x, b.y)];
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const xs = corners.map((p) => clamp(p.x, vb[2]));
  const ys = corners.map((p) => clamp(p.y, vb[3]));
  const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  return box.right - box.left > 0.5 && box.bottom - box.top > 0.5 ? box : null;
}

/** A box's four corners as a text-markup quad (x1,y1 top-left ... x4,y4 bottom-right). */
export const boxQuad = ({ left, top, right, bottom }) => ({
  x1: left, y1: top, x2: right, y2: top, x3: left, y3: bottom, x4: right, y4: bottom,
});

export default function AreaRedactHost({ armed = false, hostRef, onRedact }) {
  const [drag, setDrag] = useState(null); // { x0, y0, x1, y1, clip }
  const onRedactRef = useRef(onRedact);
  onRedactRef.current = onRedact;

  useEffect(() => {
    if (!armed) { setDrag(null); return undefined; }
    const host = hostRef?.current;
    if (!host) return undefined;
    host.setAttribute('data-area-redact-tool', 'true');
    let live = null; // { pointerId, page, rect, x0, y0, x1, y1 }
    const fit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const show = () => setDrag(live ? { x0: live.x0, y0: live.y0, x1: live.x1, y1: live.y1 } : null);
    const onDown = (event) => {
      if (live || event.button !== 0 || !event.isPrimary || !pointerMayUseTool(event.pointerType)) return;
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      if (target?.closest?.(CONTROL)) return;
      const page = pageElementAt(host, event.clientX, event.clientY);
      if (!page) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = page.getBoundingClientRect();
      live = { pointerId: event.pointerId, page, rect, x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
      show();
    };
    const onMove = (event) => {
      if (!live || event.pointerId !== live.pointerId) return;
      event.preventDefault();
      live.x1 = fit(event.clientX, live.rect.left, live.rect.right);
      live.y1 = fit(event.clientY, live.rect.top, live.rect.bottom);
      show();
    };
    const onUp = (event) => {
      if (!live || event.pointerId !== live.pointerId) return;
      const done = live;
      live = null;
      show();
      if (Math.abs(done.x1 - done.x0) < MIN_PX || Math.abs(done.y1 - done.y0) < MIN_PX) return;
      const box = clientBoxToPage(done.page, { x: done.x0, y: done.y0 }, { x: done.x1, y: done.y1 });
      const pageNumber = Number(done.page.getAttribute('data-page-number'));
      if (box && Number.isFinite(pageNumber)) onRedactRef.current?.({ pageNumber, box });
    };
    const onCancel = (event) => { if (live && event.pointerId === live.pointerId) { live = null; show(); } };
    const onKey = (event) => { if (event.key === 'Escape' && live) { live = null; show(); event.stopPropagation(); } };
    host.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      host.removeAttribute('data-area-redact-tool');
      setDrag(null);
    };
  }, [armed, hostRef]);

  if (!drag) return null;
  const left = Math.min(drag.x0, drag.x1);
  const top = Math.min(drag.y0, drag.y1);
  return (
    <div
      data-area-redact-preview=""
      aria-hidden="true"
      style={{
        position: 'fixed',
        left,
        top,
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
        background: 'rgba(0, 0, 0, 0.55)',
        outline: '1.5px dashed rgba(220, 38, 38, 0.95)',
        pointerEvents: 'none',
        zIndex: 900,
      }}
    />
  );
}
