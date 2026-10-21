// A greyed-out action whose reason lives only in a hover tooltip tells a phone
// user nothing. Items that are off for a reason (e.g. "Only the owner can
// delete this") stay focusable and tappable (aria-disabled, not the disabled
// attribute); a tap shows the reason as a toast and never runs the action.

export function showDisabledReason(reason, dispatch = defaultDispatch) {
  if (!reason) return;
  dispatch({ message: String(reason), type: 'info' });
}

function defaultDispatch(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app-toast', { detail }));
}

/**
 * Activate a menu/select item: when `reason` is set, explain and stop;
 * otherwise run `action`. Returns true when the action ran.
 */
export function activateOrExplain(reason, action, dispatch) {
  if (reason) {
    showDisabledReason(reason, dispatch);
    return false;
  }
  if (typeof action === 'function') action();
  return true;
}
