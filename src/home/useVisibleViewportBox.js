import { useEffect, useState } from 'react';

/*
 * The part of the window the person can actually see, when something (the
 * on-screen keyboard) hides the rest of it.
 *
 * Polish round 6: on a 375x667 phone the Share dialog sat centred in the full
 * window, so with the keyboard up its Send button (and Cancel) were under the
 * keyboard with no way to scroll to them. iOS keeps the layout viewport and
 * shrinks only the VISUAL viewport, so a centred `position: fixed` dialog
 * never notices. A dialog's overlay can take this box (top + height) instead
 * of `inset: 0`, so it centres — and caps its height — inside what is visible.
 *
 * Returns null when nothing is hidden (the normal case), so callers keep their
 * plain full-window layout at rest.
 */
export function readVisibleViewportBox(win) {
  const vv = win?.visualViewport;
  if (!vv || !(win.innerHeight > 0)) return null;
  const height = Math.round(vv.height);
  if (!(height > 0) || height >= win.innerHeight - 1) return null;
  return { top: Math.max(0, Math.round(vv.offsetTop || 0)), height };
}

const sameBox = (a, b) => (a === b) || (!!a && !!b && a.top === b.top && a.height === b.height);

export default function useVisibleViewportBox() {
  const [box, setBox] = useState(() => (typeof window === 'undefined' ? null : readVisibleViewportBox(window)));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return undefined;
    const vv = window.visualViewport;
    const update = () => {
      const next = readVisibleViewportBox(window);
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return box;
}
