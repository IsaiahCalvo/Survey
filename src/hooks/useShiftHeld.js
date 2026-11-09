import { useEffect, useState } from 'react';

/**
 * True while Shift is held (and `enabled`). Used for the curve handles on a
 * picked curved polyline (owner 2026-11-09, as in Takeoff). Pointer events
 * re-read shiftKey, so a key-up lost to another window cannot leave it stuck.
 */
export default function useShiftHeld(enabled = true) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHeld(false);
      return undefined;
    }
    const onKey = (event) => {
      if (event.key === 'Shift') setHeld(event.type === 'keydown');
    };
    const onPointer = (event) => setHeld(Boolean(event.shiftKey));
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);
  return enabled && held;
}
