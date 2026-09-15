/**
 * doubleTapEditEntry — pointer-level double-click / double-tap recognition for
 * "open the inline editor on this annotation".
 *
 * WHY THIS EXISTS RATHER THAN A NATIVE dblclick LISTENER
 * -----------------------------------------------------
 * Under the Pan tool the SVG annotation layer is pointer-events:none (blank
 * page pixels must stay grabbable), and PdfjsViewerContainer preventDefault()s
 * pointerdown, which per the Pointer Events spec suppresses the compatibility
 * mouse events — so no native click/dblclick pair is ever produced for a pan
 * gesture. The same is true of a touch double-tap on mobile in every mode.
 * Recognising the pair from window-capture pointerup events is the one route
 * that covers mouse, pen and touch identically and cannot regress pan-drag:
 * it only ever looks at gestures that already failed the drag threshold.
 *
 * Reference behaviour (Drawboard PDF, verified on web + Mac app 2026-09-15):
 * a double-click on a text box opens inline editing with the CURRENT tool
 * still armed — Pan stays Pan, Select stays Select — and the double-click
 * never starts a pan drag.
 */

/** Matches the OS default double-click interval closely enough for both
 *  trackpad and touch without catching two deliberate separate clicks. */
export const DOUBLE_TAP_MAX_DELAY_MS = 350;
/** Mouse/pen: tight. Precedent — QUICK_CLICK_PX = 4 in the pan quick-click. */
export const DOUBLE_TAP_MOUSE_SLOP_PX = 6;
/** Touch: looser, fingers wander between taps. */
export const DOUBLE_TAP_TOUCH_SLOP_PX = 12;

/**
 * Stable identity for the thing a tap landed on, so two taps only pair when
 * they hit the SAME annotation or callout. Returns null for page / group /
 * counter-overlay hits, which resets any pending pair.
 */
export function editEntryKeyForHit(hit) {
  if (!hit) return null;
  if (hit.kind === 'callout' && hit.calloutId) return `callout:${hit.calloutId}`;
  if (hit.kind === 'annotation'
    && hit.pageNumber != null
    && typeof hit.annotationIndex === 'number') {
    return `annotation:${hit.pageNumber}:${hit.annotationIndex}`;
  }
  return null;
}

const isCoarsePointer = (pointerType) => pointerType === 'touch';

/**
 * Whether this recognised pair should be routed by us, or left to the SVG
 * layer's own native onDoubleClick.
 *
 * Plain Rectangle/Lasso Select with a mouse already gets a real dblclick on the
 * armed hit target — handling it here too would dispatch the editor twice.
 * Pan and Text Select never do (inert SVG root), and no pointer type other
 * than mouse can be relied on to synthesise dblclick at all.
 */
export function shouldHandleDoubleTapEntry({ firstTapTool, pointerType } = {}) {
  if (firstTapTool === 'pan' || firstTapTool === 'text-select') return true;
  return pointerType !== 'mouse';
}

/**
 * @param {{maxDelayMs?: number, mouseSlopPx?: number, touchSlopPx?: number}} [options]
 * @returns {{register: Function, reset: Function, peek: Function}}
 */
export function createDoubleTapTracker(options = {}) {
  const maxDelayMs = options.maxDelayMs ?? DOUBLE_TAP_MAX_DELAY_MS;
  const mouseSlopPx = options.mouseSlopPx ?? DOUBLE_TAP_MOUSE_SLOP_PX;
  const touchSlopPx = options.touchSlopPx ?? DOUBLE_TAP_TOUCH_SLOP_PX;
  let previous = null;

  return {
    reset() { previous = null; },
    peek() { return previous; },
    /**
     * A double-click is ONE gesture at ONE position, so the pair is matched on
     * position and time, and the target is whatever the FIRST tap resolved.
     *
     * Deliberately NOT "both taps resolved the same annotation": in Pan the hit
     * test walks SVG geometry by hand (the layer is pointer-events:none) while
     * in Select it reads the real hit targets, and where annotations overlap the
     * two disagree — observed live on mobile, where tap 1 resolved the text box
     * and tap 2 the imported stamp under it, so the pair never formed. The first
     * tap is also the honest one: it happens before the tool switch and before
     * anything on the page has moved.
     *
     * @param {{key: string|null, target?: any, x: number, y: number, t: number, pointerType?: string, tool?: string}} tap
     * @returns {{isDoubleTap: boolean, firstTapTool: string|null, target: any}}
     */
    register(tap) {
      const key = tap?.key || null;
      const slopPx = isCoarsePointer(tap?.pointerType) ? touchSlopPx : mouseSlopPx;
      const elapsed = (tap?.t ?? 0) - (previous?.t ?? 0);
      if (previous
        && previous.key
        && key // both taps must have landed on SOMETHING routable; a tap on
               // empty page still breaks the pair
        && elapsed >= 0
        && elapsed <= maxDelayMs
        && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= slopPx) {
        const { tool: firstTapTool = null, target = null } = previous;
        // Clear so a third tap opens a fresh pair rather than chaining into
        // a second editor entry.
        previous = null;
        return { isDoubleTap: true, firstTapTool, target };
      }
      // A tap on empty page (or an un-routable target) is remembered with a null
      // key, so it breaks any pending pair — otherwise tap-annotation, tap-away,
      // tap-annotation would read as a double-click.
      previous = {
        key,
        target: tap?.target ?? null,
        x: tap?.x,
        y: tap?.y,
        t: tap?.t,
        pointerType: tap?.pointerType ?? null,
        tool: tap?.tool ?? null,
      };
      return { isDoubleTap: false, firstTapTool: null, target: null };
    },
  };
}

/**
 * Where the caret should land, recorded so it survives the editor mount.
 *
 * A raw client point is NOT enough: opening the editor can scroll the page
 * (caret-follow, virtualization), so by the time the editor exists the same
 * client coordinates point somewhere else entirely — observed live in Text
 * Select, where the editor mounted 500px below the click. Recording the point
 * as a FRACTION of the annotation's own on-screen box makes it scroll-proof:
 * the editor is laid over that same box, so the fraction re-resolves against
 * the editor's fresh rect at mount time.
 *
 * @param {{x:number, y:number, host:Element|null}} input
 * @returns {{x:number, y:number, hostRect:{left:number,top:number,width:number,height:number}|null}|null}
 */
export function buildCaretAnchor({ x, y, host } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rect = host?.getBoundingClientRect?.();
  const hostRect = rect && rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null;
  return { x, y, hostRect };
}

/**
 * Re-resolve a caret anchor against the element that now owns the text.
 * Falls back to the raw client point when no host box was captured.
 */
export function resolveCaretAnchorPoint(anchor, targetRect) {
  if (!anchor) return null;
  const host = anchor.hostRect;
  if (!host || !targetRect || !(targetRect.width > 0) || !(targetRect.height > 0)) {
    return { x: anchor.x, y: anchor.y };
  }
  return {
    x: targetRect.left + ((anchor.x - host.left) / host.width) * targetRect.width,
    y: targetRect.top + ((anchor.y - host.top) / host.height) * targetRect.height,
  };
}
