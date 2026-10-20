// src/components/MotionPresence.jsx
//
// Keeps a dialog (or menu) in the page for a moment after it closes so it can
// play its exit (Drawboard shell audit, Chunk A, 2026-10-13: dialogs fade out
// to 0.98 scale in 120 ms, menus fade in 80 ms; motion.css).
//
//   return (
//     <MotionPresence open={open}>
//       {open ? <div style={scrim}><div role="dialog" aria-modal="true">…</div></div> : null}
//     </MotionPresence>
//   );
//
// While `open` it renders `children` as they are. When `open` turns false it
// keeps showing the LAST open children (so the text does not change under the
// exit), marks their root element data-motion-state="closing" (+ aria-hidden
// and inert, so it takes no clicks, keys or screen-reader focus), and drops
// it after the exit time. Under reduced motion the exit time is 0: it goes at
// once, exactly as before. The root child must be a DOM element (a div /
// section), which is how every modal here is built.

import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import { exitMs } from '../utils/motion.js';

export default function MotionPresence({ open, kind = 'dialog', children }) {
  const lastRef = useRef(null);
  const [phase, setPhase] = useState(open ? 'open' : 'closed');
  if (open && children) lastRef.current = children;

  // Follow `open` in the same render (no frame where the dialog is gone and
  // the exit has not started).
  if (open && phase !== 'open') setPhase('open');
  else if (!open && phase === 'open') {
    setPhase(lastRef.current && exitMs(kind) > 0 ? 'closing' : 'closed');
  }

  useEffect(() => {
    if (phase !== 'closing') {
      if (phase === 'closed') lastRef.current = null;
      return undefined;
    }
    const timer = setTimeout(() => setPhase('closed'), exitMs(kind));
    return () => clearTimeout(timer);
  }, [phase, kind]);

  if (open) return children ?? null;
  if (phase !== 'closing' || !isValidElement(lastRef.current)) return null;
  return cloneElement(lastRef.current, {
    'data-motion-state': 'closing',
    'data-motion-kind': kind,
    'aria-hidden': 'true',
    inert: '',
  });
}
