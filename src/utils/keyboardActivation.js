/**
 * keyboardActivation.js — Enter / Space for clickable elements that are not
 * <button>s.
 *
 * KAL-66: rows, sort headers, select boxes and menu items across the hub and
 * the viewer were plain <div>/<span onClick>. A mouse could use them; the
 * keyboard could not even reach them. Turning each into a real <button> would
 * bring the browser's button look (font, border, padding, text-align) and the
 * app-wide button states with it, so these keep their element and gain what a
 * button gives a keyboard user instead:
 *
 *   - a role, so assistive tech says what it is (button, checkbox, radio,
 *     menuitem),
 *   - tabIndex 0, so Tab reaches it,
 *   - Enter and Space run the same handler a click runs.
 *
 * `data-keyboard-control` marks them so src/styles/states.css can leave them
 * out of the generic [role='button'] press and hover fills: each of these
 * elements already paints its own hover and selected look, and the owner's
 * rule for this pass is "nothing may look different".
 *
 * Keys pressed inside a nested field or button (a rename input in a row, the
 * row's own select box) belong to that child, so only a key aimed at the
 * element itself activates it.
 */

export const isActivationKey = (event) => (
  event?.key === 'Enter' || event?.key === ' ' || event?.key === 'Spacebar'
);

// What Enter does on a real <button>: fire the element's own click, so the
// keyboard runs exactly the onClick a mouse runs, with nothing duplicated.
const clickElement = (event) => event.currentTarget?.click?.();

/**
 * onKeyDown handler that runs `handler(event)` on Enter or Space aimed at the
 * element itself (no handler: the element's own click). Space is prevented so
 * it does not also scroll the list.
 */
export function activateOnKey(handler = clickElement, { enterOnly = false } = {}) {
  const run = handler || clickElement;
  return (event) => {
    if (enterOnly ? event?.key !== 'Enter' : !isActivationKey(event)) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    run(event);
  };
}

/**
 * Props that make a clickable element keyboard-operable.
 *
 *   <div onClick={open} {...keyboardControlProps(open)}>
 *   <span onClick={toggle} {...keyboardControlProps(toggle, { role: 'checkbox', checked })}>
 *   <div onClick={...long inline handler} {...keyboardControlProps(null, { role: 'menuitem' })}>
 *
 * A null handler makes Enter / Space click the element, which runs its own
 * onClick.
 *
 * `checked` sets aria-checked (checkbox / radio / menuitemcheckbox).
 * `disabled` keeps the element out of the Tab order and marks it aria-disabled
 * (which also gives a role="button" / "menuitem" the shared disabled ink).
 * `enterOnly` is for rows that stay on screen beside the PDF (the bookmark
 * list): there Space belongs to the viewer (hold Space to pan), as on the
 * Pages panel cards, so only Enter activates.
 */
export function keyboardControlProps(handler, { role = 'button', checked, disabled = false, enterOnly = false } = {}) {
  const props = {
    role,
    tabIndex: disabled ? -1 : 0,
    onKeyDown: disabled ? undefined : activateOnKey(handler, { enterOnly }),
    'data-keyboard-control': '',
  };
  if (checked !== undefined) props['aria-checked'] = Boolean(checked);
  if (disabled) props['aria-disabled'] = 'true';
  return props;
}
