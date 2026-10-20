/**
 * useSheetFocus.js — keyboard and VoiceOver focus for a phone bottom sheet
 * that covers the page (KAL-66 / KAL-460).
 *
 * `const ref = useSheetFocus(open, close, sheetProps.ref)` — spread the sheet's
 * props first, then put `ref={ref}` after them, and give the sheet
 * `tabIndex={-1}`.
 *
 * A sheet with a dimmed backdrop is modal: while it is up, nothing behind it
 * can be used. Before, focus stayed on the page behind it, so a hardware
 * keyboard (iPad, a Bluetooth keyboard) or VoiceOver started outside the sheet
 * and Tab walked off it onto the hidden page. Now, through the shared trap
 * (src/hooks/useFocusTrap.js):
 *
 *   1. Opening moves focus into the sheet — to its first button, never to a
 *      text field (that would throw the keyboard up before anyone asked to
 *      type), else to the sheet itself.
 *   2. Tab / Shift-Tab stay inside the sheet.
 *   3. Escape closes it with its normal slide-down (`close` is the sheet's
 *      requestClose), and only the topmost sheet or dialog answers.
 *   4. Closing returns focus to whatever had it before (the button that
 *      opened it, when that button took focus).
 *
 * Touch users see nothing new: a finger tap never draws the focus ring.
 *
 * `sheetRef` is the sheet motion hook's callback ref (useMobileSheetMotion's
 * sheetProps.ref); the returned ref feeds both, and stays the same function
 * across renders so the motion hook's listeners are not re-attached.
 */
import { useCallback, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

export function useSheetFocus(open, close, sheetRef = null) {
  const trapRef = useRef(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const onEscape = useCallback(() => { closeRef.current?.(); }, []);
  useFocusTrap(trapRef, Boolean(open), { onEscape, avoidTextFields: true });
  return useCallback((el) => {
    trapRef.current = el;
    if (typeof sheetRef === 'function') sheetRef(el);
    else if (sheetRef && typeof sheetRef === 'object') sheetRef.current = el;
  }, [sheetRef]);
}

export default useSheetFocus;
