import { useCallback, useEffect, useRef } from 'react';

export const MOBILE_EDGE_SWIPE_START_PX = 24;
export const MOBILE_EDGE_SWIPE_CLAIM_PX = 12;
export const MOBILE_EDGE_SWIPE_MAX_SETTLE_MS = 540;
export const MOBILE_EDGE_SWIPE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

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

export function mobileEdgeSwipeProgress(distance, viewportWidth) {
  if (!Number.isFinite(distance) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  return Math.min(1, Math.max(0, distance / viewportWidth));
}

export function mobileEdgeSwipeSettleDuration({ distance, viewportWidth, velocityX = 0, complete }) {
  const remaining = complete
    ? Math.max(0, viewportWidth - distance)
    : Math.max(0, distance);
  if (remaining <= 1) return 0;
  const speed = Math.max(Math.abs(velocityX), 0.45);
  return Math.min(MOBILE_EDGE_SWIPE_MAX_SETTLE_MS, Math.max(120, Math.round(remaining / speed)));
}

export function shouldCompleteMobileEdgeSwipe({ distance, velocityX = 0, viewportWidth }) {
  return velocityX > 0.35 || distance >= mobileEdgeSwipeCommitDistance(viewportWidth);
}

/**
 * Native-style mobile back gesture for in-app drill-down screens. The swipe
 * must begin at the left edge and travel mostly horizontally, so list scroll,
 * reorder, and ordinary content gestures remain untouched.
 */
export default function useMobileEdgeSwipeBack({ enabled, onBack, surfaceRef }) {
  const onBackRef = useRef(onBack);
  const destinationSnapshotRef = useRef(null);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const captureBackDestination = useCallback(() => {
    const surface = surfaceRef?.current;
    if (!surface) return;
    destinationSnapshotRef.current = surface.cloneNode(true);
  }, [surfaceRef]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(max-width: 720px)').matches) return undefined;

    let gesture = null;
    let frame = 0;
    let settleTimer = 0;
    let surfaceSnapshot = null;
    let underlay = null;
    const surface = surfaceRef?.current || null;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const restoreSurface = () => {
      if (!surface || !surfaceSnapshot) return;
      surface.classList.remove('mobile-edge-swipe-surface', 'mobile-edge-swipe-active', 'mobile-edge-swipe-settling');
      delete surface.dataset.mobileSwipePhase;
      surface.style.transform = surfaceSnapshot.transform;
      surface.style.transition = surfaceSnapshot.transition;
      surface.style.willChange = surfaceSnapshot.willChange;
      surface.style.removeProperty('--mobile-edge-swipe-x');
      underlay?.remove();
      underlay = null;
      surfaceSnapshot = null;
    };
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      gesture = null;
    };
    const beginSurfaceGesture = () => {
      if (!surface || surfaceSnapshot) return;
      surfaceSnapshot = {
        transform: surface.style.transform,
        transition: surface.style.transition,
        willChange: surface.style.willChange,
      };
      if (destinationSnapshotRef.current && surface.parentNode) {
        underlay = destinationSnapshotRef.current.cloneNode(true);
        underlay.classList.add('mobile-edge-swipe-underlay');
        underlay.dataset.mobileSwipeUnderlay = 'true';
        underlay.setAttribute('aria-hidden', 'true');
        underlay.setAttribute('inert', '');
        surface.parentNode.insertBefore(underlay, surface);
      }
      surface.classList.add('mobile-edge-swipe-surface', 'mobile-edge-swipe-active');
      surface.dataset.mobileSwipePhase = 'dragging';
      surface.style.transition = 'none';
      surface.style.willChange = 'transform';
    };
    const renderDistance = (distance) => {
      if (!surface) return;
      const bounded = mobileEdgeSwipeProgress(distance, window.innerWidth) * window.innerWidth;
      surface.style.setProperty('--mobile-edge-swipe-x', `${bounded}px`);
      surface.style.transform = 'translate3d(var(--mobile-edge-swipe-x), 0, 0)';
      if (underlay) {
        const progress = mobileEdgeSwipeProgress(bounded, window.innerWidth);
        underlay.style.transform = `translate3d(${Math.round((progress - 1) * window.innerWidth * 0.12)}px, 0, 0)`;
        underlay.style.opacity = String(0.82 + progress * 0.18);
      }
    };
    const scheduleDistance = (distance) => {
      if (!surface) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderDistance(distance);
      });
    };
    const settle = ({ complete, distance, velocityX = 0 }) => {
      if (!surfaceSnapshot || !surface) {
        reset();
        if (complete) onBackRef.current?.();
        return;
      }
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const duration = prefersReducedMotion ? 0 : mobileEdgeSwipeSettleDuration({
        distance,
        viewportWidth: window.innerWidth,
        velocityX,
        complete,
      });
      surface.classList.remove('mobile-edge-swipe-active');
      surface.classList.add('mobile-edge-swipe-settling');
      surface.dataset.mobileSwipePhase = complete ? 'completing' : 'cancelling';
      surface.style.transition = `transform ${duration}ms ${MOBILE_EDGE_SWIPE_EASING}`;
      renderDistance(complete ? window.innerWidth : 0);
      gesture = null;
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        if (complete) {
          onBackRef.current?.();
          requestAnimationFrame(restoreSurface);
        } else {
          restoreSurface();
        }
      }, duration + 34);
    };
    const pointFrom = (touch) => ({ x: touch.clientX, y: touch.clientY });

    const onTouchStart = (event) => {
      if (surfaceSnapshot) return;
      if (event.touches.length !== 1) { reset(); return; }
      const point = pointFrom(event.touches[0]);
      if (point.x > MOBILE_EDGE_SWIPE_START_PX) { reset(); return; }
      gesture = {
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
        claimed: false,
        lastX: point.x,
        lastTime: event.timeStamp,
        velocityX: 0,
      };
    };

    const onTouchMove = (event) => {
      if (!gesture || event.touches.length !== 1) return;
      const point = pointFrom(event.touches[0]);
      const now = event.timeStamp;
      const elapsed = Math.max(1, now - gesture.lastTime);
      gesture.velocityX = (point.x - gesture.lastX) / elapsed;
      gesture.lastX = point.x;
      gesture.lastTime = now;
      gesture.x = point.x;
      gesture.y = point.y;
      const dx = point.x - gesture.startX;
      const dy = Math.abs(point.y - gesture.startY);
      if (!gesture.claimed && (dx < -6 || (dy >= 12 && dy > Math.max(dx, 0) * 1.1))) {
        reset();
        return;
      }
      if (!gesture.claimed && isMobileEdgeSwipeClaim(gesture)) {
        gesture.claimed = true;
        beginSurfaceGesture();
      }
      if (gesture.claimed) {
        scheduleDistance(dx);
        if (event.cancelable) event.preventDefault();
      }
    };

    const onTouchEnd = (event) => {
      if (!gesture) return;
      const touch = event.changedTouches[0];
      if (touch) {
        const point = pointFrom(touch);
        gesture.x = point.x;
        gesture.y = point.y;
      }
      const distance = Math.max(0, gesture.x - gesture.startX);
      const shouldGoBack = gesture.claimed && shouldCompleteMobileEdgeSwipe({
        distance,
        velocityX: gesture.velocityX,
        viewportWidth: window.innerWidth,
      });
      if (!gesture.claimed) {
        reset();
        return;
      }
      if (event.cancelable) event.preventDefault();
      settle({ complete: shouldGoBack, distance, velocityX: gesture.velocityX });
    };

    const onTouchCancel = () => {
      if (gesture?.claimed) {
        settle({
          complete: false,
          distance: Math.max(0, gesture.x - gesture.startX),
          velocityX: gesture.velocityX,
        });
      } else {
        reset();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    document.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    return () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      reset();
      restoreSurface();
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchCancel, true);
    };
  }, [enabled, surfaceRef]);

  return captureBackDestination;
}
