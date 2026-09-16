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
 * The text gutter between an annotation's border and its glyphs, in page units.
 *
 * MUST stay equal to TEXT_PADDING in src/utils/svgAnnotationRenderers.jsx — the
 * renderer insets the glyph box by it and TextEditOverlay insets its editable by
 * the same amount, so the caret maths below depends on the two agreeing. It is
 * duplicated rather than imported because that module is JSX and this one is
 * loaded straight by the node test runner; a lockstep test keeps them equal.
 */
export const TEXT_BOX_GUTTER = 6;

/**
 * How close two boxes' widths must be, in client pixels, to count as the SAME
 * box seen at two moments. Both boxes are the same page-unit width times the
 * same zoom, so a real match differs only by float noise.
 */
const SAME_BOX_TOLERANCE_PX = 1;

/** A usable on-screen box for an element, or null when it has no area. */
const rectOf = (el) => {
  const rect = el?.getBoundingClientRect?.();
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
  };
};

const isUsableRect = (rect) => !!rect && rect.width > 0 && rect.height > 0;

const isCalloutCarrier = (host) => typeof host?.getAttribute === 'function'
  && host.getAttribute('data-callout-id') != null;

/** Page units -> client pixels for the SVG this element lives in. 1 when the
 *  element is not in an SVG (or is a plain rect stub in a test). Read off the
 *  root's own client box rather than getScreenCTM so any CSS transform on an
 *  ancestor — the live-zoom scale wrapper — is included, exactly as
 *  getBoundingClientRect includes it. */
const pageToClientScale = (host) => {
  const svg = host?.ownerSVGElement;
  const viewBoxWidth = svg?.viewBox?.baseVal?.width;
  const clientWidth = svg?.getBoundingClientRect?.().width;
  return (viewBoxWidth > 0 && clientWidth > 0) ? clientWidth / viewBoxWidth : 1;
};

/** The glyph box implied by an annotation's OUTER box: the same box inset by
 *  the text gutter on every side. Null when the box is too small to inset. */
const gutterInsetRect = (rect, host) => {
  const gutter = TEXT_BOX_GUTTER * pageToClientScale(host);
  if (!(rect.width - 2 * gutter > 0) || !(rect.height - 2 * gutter > 0)) return null;
  return {
    left: rect.left + gutter,
    top: rect.top + gutter,
    width: rect.width - 2 * gutter,
    height: rect.height - 2 * gutter,
  };
};

/**
 * The element whose on-screen box the text editor will actually cover, given
 * the carrier an edit gesture resolved to.
 *
 * WHY THIS IS NOT JUST THE CARRIER (callouts fixed 2026-09-15, text boxes the
 * same day). A callout's carrier is the whole <g data-callout-id>: arrow, knee,
 * leader lines AND the text box. A click on the first letter therefore sat at,
 * say, 0.85 of that carrier's width, and re-resolving 0.85 against the editor —
 * which covers the text box alone — dropped the caret past the last glyph.
 * A plain text box's carrier is smaller but wrong the same way: it is the
 * BORDER box, while the editor's editable is that box inset by TEXT_BOX_GUTTER
 * on each side, so a click on the first letter came back a letter to the right
 * and a click on the last letter a letter to the left.
 *
 * The box to measure against is the one the editor is laid over: the glyph box.
 * `data-callout-part="text"` and `data-annotation-text-bounds` are that box
 * exactly — both are the foreignObject the renderer insets by TEXT_PADDING,
 * which is the same geometry TextEditOverlay gives its own content box, so the
 * click re-resolves onto the same glyphs. When the text is hidden the callout's
 * border rect is the next best box, and the carrier remains the last resort —
 * buildCaretAnchor then falls back to insetting the carrier arithmetically.
 *
 * @param {Element|null} host - carrier element from the gesture
 * @returns {Element|null}
 */
export function caretAnchorHostFor(host) {
  if (!host) return null;
  if (typeof host.querySelector !== 'function') return host;
  const selectors = isCalloutCarrier(host)
    ? ['[data-callout-part="text"]', '[data-callout-part="textBox"]']
    : ['[data-annotation-text-bounds]'];
  for (const selector of selectors) {
    const candidate = host.querySelector(selector);
    if (rectOf(candidate)) return candidate;
  }
  return host;
}

/**
 * Where the caret should land, recorded so it survives the editor mount.
 *
 * A raw client point is NOT enough: opening the editor can scroll the page
 * (caret-follow, virtualization), so by the time the editor exists the same
 * client coordinates point somewhere else entirely — observed live in Text
 * Select, where the editor mounted 500px below the click. Recording the point
 * against the annotation's own on-screen box makes it scroll-proof: the editor
 * is laid over that same box, so the point re-resolves against the editor's
 * fresh rect at mount time.
 *
 * TWO boxes are recorded. `hostRect` is the box the gesture resolved to,
 * already narrowed to the glyph box wherever the DOM could answer (see
 * caretAnchorHostFor). `contentRect` is the glyph box the arithmetic implies
 * when it could NOT — the carrier inset by the text gutter — so a render with
 * no text foreignObject still puts the caret on the right letter. Whichever box
 * the mounted editor turns out to match is the one resolveCaretAnchorPoint
 * uses; a callout, whose carrier spans the arrow, never gets the arithmetic one.
 *
 * @param {{x:number, y:number, host:Element|null}} input
 * @returns {{x:number, y:number, hostRect:{left:number,top:number,width:number,height:number}|null, contentRect:{left:number,top:number,width:number,height:number}|null}|null}
 */
export function buildCaretAnchor({ x, y, host } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const textHost = caretAnchorHostFor(host);
  const hostRect = rectOf(textHost);
  const narrowed = textHost !== host;
  const contentRect = (hostRect && !narrowed && !isCalloutCarrier(host))
    ? gutterInsetRect(hostRect, host)
    : null;
  return { x, y, hostRect, contentRect };
}

/**
 * Re-resolve a caret anchor against the element that now owns the text.
 *
 * When one of the recorded boxes has the target's width it IS the box the
 * editor covers, so the point is carried over by TRANSLATION: the two boxes
 * share a top-left origin and differ only in trailing slack (the editable is as
 * tall as its text, the annotation box can be taller), and translating keeps
 * the caret on the clicked line instead of squeezing it up. Otherwise the point
 * is rescaled proportionally, the historical behaviour for an editor box whose
 * relationship to the annotation box we cannot name.
 *
 * Falls back to the raw client point when no box was captured at all.
 */
export function resolveCaretAnchorPoint(anchor, targetRect) {
  if (!anchor) return null;
  const rawPoint = { x: anchor.x, y: anchor.y };
  if (!isUsableRect(targetRect)) return rawPoint;
  for (const box of [anchor.contentRect, anchor.hostRect]) {
    if (isUsableRect(box)
      && Math.abs(box.width - targetRect.width) <= SAME_BOX_TOLERANCE_PX) {
      return {
        x: targetRect.left + (anchor.x - box.left),
        y: targetRect.top + (anchor.y - box.top),
      };
    }
  }
  const host = anchor.hostRect;
  if (!isUsableRect(host)) return rawPoint;
  return {
    x: targetRect.left + ((anchor.x - host.left) / host.width) * targetRect.width,
    y: targetRect.top + ((anchor.y - host.top) / host.height) * targetRect.height,
  };
}
