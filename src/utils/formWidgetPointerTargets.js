/**
 * Live form-widget pointer targets — the single definition of "this pointer
 * landed on a PDF form control, so the viewer must keep its hands off it".
 *
 * Intended UX (owner; reference behaviour Drawboard PDF): a checkbox, radio,
 * text field or dropdown that the PDF itself carries is live in Pan and in
 * every Select-family mode. One click toggles or focuses it. It never selects
 * an annotation, never shows selection chrome, never changes the armed tool,
 * and never starts a pan drag.
 *
 * Every gesture owner that would otherwise claim the pointer over the page
 * (pan-drag start, mobile touch capture, pan quick-click selection, pan hover
 * glow) asks this module first, so there is exactly one answer to "is this a
 * form control?" instead of four drifting copies.
 *
 * The `[data-interactive="true"]` gate matters: PdfjsFormLayer turns its
 * sections `pointer-events: none` under creation tools, and a dead widget must
 * NOT shield the page from a pen stroke or a shape drag.
 */

export const LIVE_FORM_WIDGET_SELECTOR = '.pdfjsFormLayer[data-interactive="true"] section';

/**
 * @param {EventTarget | null | undefined} target — an event target; text nodes
 *   are resolved to their parent element first (touch targets can be text).
 * @returns {boolean} true when the target sits inside a live widget box.
 */
export function isLiveFormWidgetTarget(target) {
  const element = target && target.nodeType === 3 ? target.parentElement : target;
  return Boolean(element && typeof element.closest === 'function'
    && element.closest(LIVE_FORM_WIDGET_SELECTOR));
}
