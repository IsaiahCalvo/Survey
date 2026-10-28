import { useEffect, useState } from 'react';
import { MOTION_MS, prefersReducedMotion } from '../utils/motion.js';
import './Expander.css';

/**
 * A section that folds open in place (owner 2026-10-28, from the 21st.dev
 * "activity dropdown" he picked): the space under its header grows to fit
 * what is inside (--motion-collapse), and the rows inside rise in one after
 * another. Folding shut runs the same way back, then the content leaves the
 * page. Folded content is inert, so Tab never lands in it.
 *
 * Rows that should rise in one after another carry data-expander-row and a
 * --expander-row index (style={{ '--expander-row': index }}).
 */
export default function Expander({ open, className = '', children }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // One frame folded first, so the growing open is seen.
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const wait = prefersReducedMotion() ? 0 : MOTION_MS.collapse;
    const timer = setTimeout(() => setMounted(false), wait);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return (
    <div className={`expander${className ? ` ${className}` : ''}`} data-open={shown ? '' : undefined} inert={shown ? undefined : ''}>
      <div className="expander__inner">{children}</div>
    </div>
  );
}
