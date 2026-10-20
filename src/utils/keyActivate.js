/**
 * keyActivate.js — make a clickable non-button element work from the keyboard
 * (KAL-66).
 *
 * A real <button> is always the first choice. Where the markup has to stay a
 * <span>/<div> (a grid header cell that must keep the row's layout, a row that
 * is also a drag source), spread `clickableProps(handler)` on it: it becomes a
 * Tab stop, says it is a button, and Enter or Space runs the same handler a
 * click runs — exactly what a <button> would do.
 */
export const onActivateKey = (handler) => (event) => {
  // Only the element itself — a key aimed at a control inside it is that
  // control's business.
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  handler(event);
};

export const clickableProps = (handler, { role = 'button' } = {}) => ({
  role,
  tabIndex: 0,
  onClick: handler,
  onKeyDown: onActivateKey(handler),
});

/**
 * The select-mode tick boxes (Documents, Projects, Templates, Manage team)
 * are drawn spans. Spread `checkboxProps(checked, toggle, label)` on one and
 * it is a real checkbox to a keyboard and a screen reader: a Tab stop that
 * says "checked / not checked" and toggles on Space (or Enter). The click
 * path is left to the caller — some boxes toggle from their own onClick,
 * others from the row they sit in — so a click never toggles twice.
 */
export const checkboxProps = (checked, onToggle, label) => ({
  role: 'checkbox',
  'aria-checked': Boolean(checked),
  'aria-label': label,
  tabIndex: 0,
  onKeyDown: onActivateKey(onToggle),
});
