import { useEffect, useRef } from 'react';

export const MOBILE_EDGE_SWIPE_START_PX = 24;
export const MOBILE_EDGE_SWIPE_CLAIM_PX = 12;

export function mobileEdgeSwipeCommitDistance(viewportWidth) {
  return Math.min(96, Math.max(64, viewportWidth * 0.18));
}

export function isMobileEdgeSwipeClaim({ startX, startY, x, y }) {
  const dx = x - startX;
  const dy = Math.abs(y - startY);
  return startX >= 0
    && startX <= MOBILE_EDGE_SWIPE_START_PX
    && dx >= MOBILE_EDGE_SWIPE_CLAIM_PX
    && dx > dy * 1.25;
}

export function isMobileEdgeSwipeBack({ startX, startY, x, y, viewportWidth }) {
  const dx = x - startX;
  const dy = Math.abs(y - startY);
  return startX >= 0
    && startX <= MOBILE_EDGE_SWIPE_START_PX
    && dx >= mobileEdgeSwipeCommitDistance(viewportWidth)
    && dx > dy * 1.25;
}

/**
 * Native-style mobile back gesture for in-app drill-down screens. The swipe
 * must begin at the left edge and travel mostly horizontally, so list scroll,
 * reorder, and ordinary content gestures remain untouched.
 */
export default function useMobileEdgeSwipeBack({ enabled, onBack }) {
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(max-width: 720px)').matches) return undefined;

    let gesture = null;
    const reset = () => { gesture = null; };
    const pointFrom = (touch) => ({ x: touch.clientX, y: touch.clientY });

    const onTouchStart = (event) => {
      if (event.touches.length !== 1) { reset(); return; }
      const point = pointFrom(event.touches[0]);
      if (point.x > MOBILE_EDGE_SWIPE_START_PX) { reset(); return; }
      gesture = {
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
        claimed: false,
      };
    };

    const onTouchMove = (event) => {
      if (!gesture || event.touches.length !== 1) return;
      const point = pointFrom(event.touches[0]);
      gesture.x = point.x;
      gesture.y = point.y;
      const dx = point.x - gesture.startX;
      const dy = Math.abs(point.y - gesture.startY);
      if (!gesture.claimed && (dx < -6 || (dy >= 12 && dy > Math.max(dx, 0) * 1.1))) {
        reset();
        return;
      }
      if (!gesture.claimed && isMobileEdgeSwipeClaim(gesture)) gesture.claimed = true;
      if (gesture.claimed && event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event) => {
      if (!gesture) return;
      const touch = event.changedTouches[0];
      if (touch) {
        const point = pointFrom(touch);
        gesture.x = point.x;
        gesture.y = point.y;
      }
      const shouldGoBack = gesture.claimed && isMobileEdgeSwipeBack({
        ...gesture,
        viewportWidth: window.innerWidth,
      });
      reset();
      if (!shouldGoBack) return;
      if (event.cancelable) event.preventDefault();
      onBackRef.current?.();
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    document.addEventListener('touchcancel', reset, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', reset, true);
    };
  }, [enabled]);
}
