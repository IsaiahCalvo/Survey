/**
 * Keep the phone Survey sheet dim below the survey strip (template / module /
 * Reuse / Done). The backdrop is position:fixed at z-index 6400; the strip is
 * 5760, so an un-inset dim eats the first tap as "close sheet".
 *
 * The strip is committed by MobileToolProperties, often after SurveySpacesRail,
 * and it can appear or move after the backdrop mounts. A one-shot query leaves
 * `top` empty. This watcher remeasures on overlay registry notify, resize, and
 * header/strip box changes.
 */

export const SURVEY_STRIP_SELECTOR = '.mobile-pdf-properties--survey';

export function applySurveyBackdropInset(el, root = typeof document === 'undefined' ? null : document) {
  if (!el) return;
  const strip = root?.querySelector?.(SURVEY_STRIP_SELECTOR) || null;
  el.style.top = strip ? `${Math.round(strip.getBoundingClientRect().bottom)}px` : '';
}

export function watchSurveyBackdropInset(el, {
  root = typeof document === 'undefined' ? null : document,
  view = typeof window === 'undefined' ? null : window,
  subscribeOverlays = null,
} = {}) {
  if (!el) return () => {};

  const apply = () => applySurveyBackdropInset(el, root);
  apply();
  const rafId = view?.requestAnimationFrame?.(apply);

  const ResizeObserverCtor = view?.ResizeObserver;
  const resizeObserver = typeof ResizeObserverCtor === 'function'
    ? new ResizeObserverCtor(apply)
    : null;
  const header = root?.querySelector?.('.mobile-pdf-header');
  if (header) resizeObserver?.observe(header);

  let observedStrip = null;
  const observeStrip = () => {
    const strip = root?.querySelector?.(SURVEY_STRIP_SELECTOR) || null;
    if (strip === observedStrip) return;
    if (observedStrip) resizeObserver?.unobserve(observedStrip);
    observedStrip = strip;
    if (strip) resizeObserver?.observe(strip);
  };
  observeStrip();

  const unsubscribe = subscribeOverlays?.(() => {
    observeStrip();
    apply();
  });

  view?.addEventListener?.('resize', apply);
  const viewport = view?.visualViewport;
  viewport?.addEventListener?.('resize', apply);

  return () => {
    if (rafId != null) view?.cancelAnimationFrame?.(rafId);
    unsubscribe?.();
    resizeObserver?.disconnect();
    view?.removeEventListener?.('resize', apply);
    viewport?.removeEventListener?.('resize', apply);
  };
}
