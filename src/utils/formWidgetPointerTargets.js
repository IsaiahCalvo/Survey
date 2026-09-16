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

/**
 * The live widget section under a client point, or null.
 *
 * Why a point and not an event target: the SVG annotation overlay paints ABOVE
 * this layer (markup is always on top of document content), and under every
 * Select-family tool its root is hit-testable across the whole page. A press
 * over a widget is therefore delivered to the SVG root, and `event.target`
 * never names the control. elementsFromPoint walks the real hit stack and
 * honours `pointer-events: none`, so a widget the form layer has switched off
 * (creation tools) is invisible here, exactly like isLiveFormWidgetTarget.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @returns {Element | null}
 */
export function liveFormWidgetAtPoint(clientX, clientY) {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const stack = document.elementsFromPoint(clientX, clientY) || [];
  for (const element of stack) {
    const section = element && typeof element.closest === 'function'
      ? element.closest(LIVE_FORM_WIDGET_SELECTOR)
      : null;
    if (section) return section;
  }
  return null;
}

/**
 * Hand a click back down to a widget an overlay above it swallowed.
 *
 * Intended UX (reference: Drawboard PDF): one click on a checkbox toggles it,
 * one click on a text field puts the caret in it — in Pan and in every Select
 * mode. The native click cannot do that here because it is hit-tested against
 * the SVG overlay painted over the field, so the overlay calls this instead.
 * `preventScroll` matters: focusing a field near the bottom of a zoomed page
 * would otherwise yank the page to it.
 *
 * @param {Element | null} section — a widget section from liveFormWidgetAtPoint.
 * @returns {boolean} true when a control actually took the click.
 */
export function forwardClickToFormWidget(section) {
  if (!section || typeof section.querySelector !== 'function') return false;
  const control = section.matches?.('input, textarea, select, button')
    ? section
    : section.querySelector('input, textarea, select, button, [contenteditable="true"]');
  if (!control) return false;
  try {
    if (typeof control.focus === 'function') control.focus({ preventScroll: true });
    const type = String(control.getAttribute?.('type') || '').toLowerCase();
    // Only the toggles are activated. Text fields and dropdowns must NOT be
    // .click()ed — a synthetic click on a focused text input selects nothing
    // useful, and on a <select> it does nothing at all.
    if (type === 'checkbox' || type === 'radio' || control.tagName === 'BUTTON') {
      if (typeof control.click === 'function') control.click();
    }
  } catch {
    return false;
  }
  return true;
}
