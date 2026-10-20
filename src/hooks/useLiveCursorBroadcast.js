import { pagePresentationFrame } from '../utils/pagePresentation.js';
// src/hooks/useLiveCursorBroadcast.js
//
// KAL-399: tell the other people in this document where this screen points
// (annotationLiveCursors.js has the message, the rate and the receiver).
//
// Only while someone else is on the document (the people list's presence,
// hasOtherPeoplePresent): alone, nothing is sent and no page is measured.
// When someone joins, the current point goes out at once; when the last one
// leaves, it stops.
//
// Mouse (desktop): the pointer is sent while it is over a page, throttled to
// ~10 messages a second, and "gone" when it leaves the pages, leaves the
// window or the tab is hidden. Scrolling or zooming under a still mouse moves
// the point on the page, so that is sent too.
//
// Finger or pencil (phone, tablet): sent ONLY while it touches the page, and
// it stays LIVE_CURSOR_TOUCH_LINGER_MS after the lift so a tap reads as "look
// here", then it goes. A finger has no hover, and a phone held in the hand is
// "reading", not "pointing": sending the last touch forever would park a
// stale arrow on everyone else's screen. Two fingers (a pinch) freeze it.
//
// Measuring: the page boxes are read from the RemoteCursorLayer elements
// (page number + page size in PDF units) only when a message may go out, so
// this costs a few getBoundingClientRect calls per message, not per event.
import { useEffect, useRef } from 'react';
import {
  LIVE_CURSOR_TOUCH_LINGER_MS,
  clientPointToPagePoint,
  createLiveCursorSender,
  hasOtherPeoplePresent,
} from '../services/annotationLiveCursors.js';

const VIEWER_SELECTOR = '.survey-pdfjs-viewer, .survey-pdfjs-page-div';

function pagesOnScreen(documentId) {
  const out = [];
  let layers = [];
  try {
    layers = document.querySelectorAll(`[data-live-cursor-layer="true"][data-document-id="${CSS.escape(documentId)}"]`);
  } catch {
    return out;
  }
  for (const el of layers) {
    const page = Number(el.getAttribute('data-page'));
    const width = Number(el.getAttribute('data-page-width'));
    const height = Number(el.getAttribute('data-page-height'));
    if (!Number.isInteger(page) || !(width > 0) || !(height > 0)) continue;
    const r = pagePresentationFrame(el);
    if (!(r.width > 0) || !(r.height > 0)) continue;
    out.push({ page, rect: r, size: { width, height } });
  }
  return out;
}

export function useLiveCursorBroadcast({ documentId, enabled = true, userId = null, name = null, presence = null } = {}) {
  const identityRef = useRef({ userId, name });
  identityRef.current = { userId, name };
  const othersPresent = hasOtherPeoplePresent(presence, userId);
  const othersRef = useRef(othersPresent);
  othersRef.current = othersPresent;
  const senderRef = useRef(null);

  // Someone joined: send where the pointer is now (if it is on a page), so
  // they see it within one interval, not at the next mouse move. The last one
  // left: the poke finds nobody and forgets the last point sent, so the next
  // join sends it again even if the pointer never moved.
  useEffect(() => {
    senderRef.current?.poke();
  }, [othersPresent]);

  useEffect(() => {
    if (!enabled || !documentId || typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    // Where the pointer is (screen px) and whether it should show at all.
    const pointer = { x: NaN, y: NaN, overViewer: false, live: false, touch: false };
    const activeTouches = new Set();
    let lingerTimer = null;

    const sender = createLiveCursorSender({
      documentId,
      identity: () => identityRef.current,
      isWanted: () => othersRef.current,
      resolve: () => {
        if (!pointer.live || !pointer.overViewer) return null;
        if (document.visibilityState === 'hidden') return null;
        return clientPointToPagePoint(pointer.x, pointer.y, pagesOnScreen(documentId));
      },
    });

    senderRef.current = sender;

    const clearLinger = () => {
      if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = null; }
    };
    const isTouchLike = (event) => event.pointerType === 'touch' || event.pointerType === 'pen';
    const record = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.overViewer = Boolean(event.target?.closest?.(VIEWER_SELECTOR));
    };

    const onPointerMove = (event) => {
      if (isTouchLike(event)) {
        // No hover for a finger; a pinch (2+ fingers) freezes the point.
        if (!activeTouches.has(event.pointerId) || activeTouches.size !== 1) return;
        record(event);
        sender.poke();
        return;
      }
      clearLinger();
      pointer.touch = false;
      pointer.live = true;
      record(event);
      sender.poke();
    };
    const onPointerDown = (event) => {
      if (!isTouchLike(event)) { onPointerMove(event); return; }
      activeTouches.add(event.pointerId);
      clearLinger();
      if (activeTouches.size !== 1) return;
      pointer.touch = true;
      pointer.live = true;
      record(event);
      sender.poke();
    };
    const onPointerEnd = (event) => {
      if (!isTouchLike(event)) return;
      activeTouches.delete(event.pointerId);
      if (activeTouches.size > 0 || !pointer.touch) return;
      clearLinger();
      lingerTimer = setTimeout(() => {
        lingerTimer = null;
        pointer.live = false;
        sender.poke();
      }, LIVE_CURSOR_TOUCH_LINGER_MS);
    };
    // The mouse left the window.
    const onPointerOut = (event) => {
      if (event.relatedTarget || isTouchLike(event)) return;
      pointer.live = false;
      sender.poke();
    };
    // The page moved under a still mouse (scroll, wheel zoom).
    const onScroll = () => {
      if (pointer.live && !pointer.touch) sender.poke();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sender.flushNow();
    };
    // The window is closing or navigating away (React cleanup may not run):
    // say "gone" now so the others do not wait for the idle fade.
    const onPageHide = () => {
      pointer.live = false;
      sender.flushNow();
    };

    const opts = { capture: true, passive: true };
    document.addEventListener('pointermove', onPointerMove, opts);
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('pointerup', onPointerEnd, opts);
    document.addEventListener('pointercancel', onPointerEnd, opts);
    document.addEventListener('pointerout', onPointerOut, opts);
    document.addEventListener('scroll', onScroll, opts);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearLinger();
      document.removeEventListener('pointermove', onPointerMove, opts);
      document.removeEventListener('pointerdown', onPointerDown, opts);
      document.removeEventListener('pointerup', onPointerEnd, opts);
      document.removeEventListener('pointercancel', onPointerEnd, opts);
      document.removeEventListener('pointerout', onPointerOut, opts);
      document.removeEventListener('scroll', onScroll, opts);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (senderRef.current === sender) senderRef.current = null;
      sender.dispose();
    };
  }, [documentId, enabled]);
}

export default useLiveCursorBroadcast;
