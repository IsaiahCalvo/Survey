/* Nightly 'comment-pins': one page's pins, drawn as a plain HTML layer over
   the page so each pin stays 26 px at every zoom (its spot is a percentage of
   the page box, its size is fixed). With the Pin tool on, a click or tap on
   the page drops a new pin there (its square bottom-left corner on the
   point) and opens the composer. A click on a pin opens its card; an editor
   can drag a pin to move it (Drawboard can't). Rules: utils/pagePins.js. */
import { useCallback, useRef } from 'react';
import { PinKindGlyph } from './PinGlyphs.jsx';
import { getPagePinsState, setPagePinsState, usePagePins } from '../../services/pagePinsStore.js';
import {
  PIN_FACE,
  PIN_SIZE,
  PIN_TOOL_ID,
  isPinShown,
  pagePointFromClient,
  pinCode,
  pinPlacement,
  pinStatusColor,
  PIN_KIND_LABELS,
  PIN_STATUS_LABELS,
  PIN_INK,
  PIN_BODY,
  PIN_NO_AUTHOR,
} from '../../utils/pagePins.js';
import { personLabel } from '../../services/markComments.js';
import { presenceInitials } from '../presenceIdentity.js';
import { USER_INITIALS_INK, userColorFill } from '../../utils/userColors.js';

export const PIN_MOVE_EVENT = 'survey:page-pin-move';
const DRAG_SLOP = 4;

export function PinFace({ kind, status, authorId, people, size = PIN_FACE }) {
  if (kind === 'issue' || kind === 'task') {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: pinStatusColor(kind, status),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: PIN_INK,
          flexShrink: 0,
        }}
      >
        <PinKindGlyph kind={kind} size={Math.round(size * 0.7)} color={PIN_INK} />
      </span>
    );
  }
  const person = (people || []).find((p) => p.id === authorId);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: authorId ? userColorFill(authorId) : PIN_NO_AUTHOR,
        color: USER_INITIALS_INK,
        fontSize: Math.round(size * 0.55),
        fontWeight: 600,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        letterSpacing: 0,
      }}
    >
      {authorId ? presenceInitials(personLabel(person)) : '?'}
    </span>
  );
}

function pinLabel(pin) {
  if (pin.kind === 'comment') return 'Comment pin';
  return `${pinCode(pin) || PIN_KIND_LABELS[pin.kind]}, ${PIN_STATUS_LABELS[pin.status] || ''}`.trim();
}

function Pin({ pin, anchor, people, open, faded, pageWidth, pageHeight, canMove, onPress }) {
  const place = pinPlacement(pin, pageWidth, pageHeight);
  return (
    <button
      type="button"
      // Pan leaves a pin to its own press (click opens, drag moves).
      data-pan-interactive="true"
      data-page-pin-anchor={anchor}
      data-page-pin-id={pin.id || undefined}
      data-pin-kind={pin.kind}
      data-pin-status={pin.status || undefined}
      aria-label={pinLabel(pin)}
      aria-expanded={open}
      onPointerDown={onPress}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: place.left,
        top: place.top,
        width: PIN_SIZE,
        height: PIN_SIZE,
        transform: 'translateY(-100%)',
        boxSizing: 'border-box',
        padding: 3,
        margin: 0,
        border: 'none',
        borderRadius: '13px 13px 13px 0',
        background: PIN_BODY,
        boxShadow: open ? '0 0 0 2px #87ABF8, 0 1px 3px rgba(0, 0, 0, 0.35)' : '0 1px 3px rgba(0, 0, 0, 0.35)',
        opacity: faded ? 0.5 : 1,
        cursor: canMove ? 'grab' : 'pointer',
        pointerEvents: 'auto',
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: open ? 2 : 1,
      }}
    >
      <PinFace kind={pin.kind} status={pin.status} authorId={pin.authorId} people={people} />
    </button>
  );
}

export default function PagePinsLayer({ documentId, pageNumber, pageWidth, pageHeight, activeTool, readOnly = false }) {
  // Only the document in front owns the store (other tabs stay empty).
  const enabled = usePagePins((s) => s.enabled && Boolean(documentId) && s.documentId === documentId);
  const pins = usePagePins((s) => s.pins);
  const people = usePagePins((s) => s.people);
  const filter = usePagePins((s) => s.filter);
  const openId = usePagePins((s) => s.openId);
  const draft = usePagePins((s) => s.draft);
  const moving = usePagePins((s) => s.moving);
  const userId = usePagePins((s) => s.userId);
  const canWrite = usePagePins((s) => s.canWrite) && !readOnly;
  const layerRef = useRef(null);
  const placeRef = useRef(null);

  const armed = enabled && canWrite && activeTool === PIN_TOOL_ID;

  const pointAt = useCallback((clientX, clientY) => {
    const rect = layerRef.current?.getBoundingClientRect();
    return pagePointFromClient(rect, clientX, clientY, pageWidth, pageHeight);
  }, [pageWidth, pageHeight]);

  // Placing: a press that lifts where it went down (a touch that scrolls the
  // page is cancelled by the browser and drops nothing).
  const onLayerPointerDown = useCallback((e) => {
    if (!armed || e.button > 0 || e.target !== layerRef.current) return;
    e.stopPropagation();
    placeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }, [armed]);
  const onLayerPointerUp = useCallback((e) => {
    const start = placeRef.current;
    placeRef.current = null;
    if (!armed || !start || start.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
    e.stopPropagation();
    const point = pointAt(e.clientX, e.clientY);
    if (!point) return;
    const { kind } = getPagePinsState();
    setPagePinsState({ draft: { pageNumber, x: point.x, y: point.y, kind }, openId: null });
  }, [armed, pageNumber, pointAt]);

  // A pin: a click opens its card; an editor's drag moves it on this page.
  const pressPin = useCallback((pin) => (e) => {
    if (e.button > 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const mayMove = canWrite && Boolean(pin.id);
    try { el.setPointerCapture?.(e.pointerId); } catch { /* fine */ }
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId || !mayMove) return;
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_SLOP) return;
      dragging = true;
      const point = pointAt(ev.clientX, ev.clientY);
      if (point) setPagePinsState({ moving: { id: pin.id, pageNumber, x: point.x, y: point.y } });
    };
    const finish = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      if (dragging) {
        const to = getPagePinsState().moving;
        if (ev.type === 'pointerup' && to) {
          window.dispatchEvent(new CustomEvent(PIN_MOVE_EVENT, { detail: { id: pin.id, pageNumber, x: to.x, y: to.y } }));
        } else {
          setPagePinsState({ moving: null });
        }
        return;
      }
      if (ev.type !== 'pointerup') return;
      if (!pin.id) return; // the draft pin: the composer is already open
      const now = getPagePinsState();
      setPagePinsState({ openId: now.openId === pin.id ? null : pin.id, draft: null });
    };
    // On window: the viewer's own pan may take the pointer while it moves.
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }, [canWrite, pageNumber, pointAt]);

  if (!enabled) return null;
  const pagePins = pins
    .filter((p) => p.pageNumber === pageNumber && isPinShown(p, filter, { openId }))
    .map((p) => (moving?.id === p.id ? { ...p, x: moving.x, y: moving.y } : p));
  const draftHere = draft && draft.pageNumber === pageNumber ? draft : null;
  if (!pagePins.length && !draftHere && !armed) return null;

  return (
    <div
      ref={layerRef}
      data-page-pins-layer={pageNumber}
      data-pin-tool-armed={armed ? 'true' : 'false'}
      data-pan-interactive={armed ? 'true' : undefined}
      onPointerDown={onLayerPointerDown}
      onPointerUp={onLayerPointerUp}
      onPointerCancel={() => { placeRef.current = null; }}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: armed ? 'auto' : 'none',
        cursor: armed ? 'crosshair' : undefined,
        // Let a finger still scroll and pinch the page while the tool is on.
        touchAction: armed ? 'pan-x pan-y pinch-zoom' : undefined,
        zIndex: 110,
      }}
    >
      {pagePins.map((pin) => (
        <Pin
          key={pin.id}
          pin={pin}
          anchor={pin.id}
          people={people}
          open={openId === pin.id}
          faded={Boolean(draft)}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          canMove={canWrite}
          onPress={pressPin(pin)}
        />
      ))}
      {draftHere && (
        <Pin
          pin={{ id: null, kind: draftHere.kind, status: draftHere.kind === 'comment' ? null : 'draft', x: draftHere.x, y: draftHere.y, authorId: userId }}
          anchor="draft"
          people={people}
          open
          faded={false}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          canMove={false}
          onPress={pressPin({ id: null })}
        />
      )}
    </div>
  );
}
