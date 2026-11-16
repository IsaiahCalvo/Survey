// A drag that starts inside a dialog and ends on the dimmed page behind it is
// not a click on that page. The browser sends the click to the nearest element
// that holds both ends of the drag, which is the dialog's overlay, and every
// overlay closes its dialog on a click. So selecting the text in a field and
// letting go a little outside the dialog closed it and lost what was typed
// (measured 2026-11-16 on Settings, Project settings and Manage team).
//
// One listener for every dialog, so no overlay needs its own guard: a click
// whose press began inside a dialog and which lands outside that dialog is
// dropped before any handler sees it.
export const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

export function isDragOutOfDialog(pressTarget, clickTarget) {
  const dialog = pressTarget?.closest?.(DIALOG_SELECTOR);
  if (!dialog) return false;
  return !dialog.contains(clickTarget);
}

export function installDialogDragGuard(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.addEventListener) return () => {};
  let pressTarget = null;
  const onPress = (event) => { pressTarget = event.target; };
  const onClick = (event) => {
    const from = pressTarget;
    pressTarget = null;
    // detail 0: Enter, Space or a click made in code. No drag behind it.
    if (!from || event.detail === 0) return;
    if (isDragOutOfDialog(from, event.target)) {
      event.stopPropagation();
      event.preventDefault();
    }
  };
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('click', onClick, true);
  };
}
