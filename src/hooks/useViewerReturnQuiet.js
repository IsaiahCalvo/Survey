/**
 * useViewerReturnQuiet - a document shown again stays exactly as it was left.
 *
 * Owner note 2026-10-26 (item 38, "switching between tabs needs to be smooth
 * as well"): the viewer stays mounted under Home and is hidden with
 * display: none. A browser restarts every CSS animation of an element that
 * comes back from display: none, so going Home and back to a document played
 * the Survey panel's slide-in, the Survey bar's drop and the left panel's
 * slide again, and the page moved 5 px (it measured the Survey bar mid-drop).
 *
 * A tab switch is the same return (owner 2026-10-27): the other tab's viewer
 * and its own rails (TabChromeSlot) come back from display: none, so the mark
 * is also set when `showing` (the front tab) changes.
 *
 * For a moment after the viewer shows again, :root carries
 * data-viewer-returning and styles/motion.css runs those entry animations at
 * 0s: they land on their end state in the first frame. The mark goes once
 * they would have ended anyway, so taking it off never replays them.
 */
import { useLayoutEffect, useRef } from 'react';

export const VIEWER_RETURN_QUIET_MS = 400;

export default function useViewerReturnQuiet(visible, showing = null, ms = VIEWER_RETURN_QUIET_MS) {
  const lastRef = useRef({ visible: Boolean(visible), showing });
  useLayoutEffect(() => {
    const last = lastRef.current;
    lastRef.current = { visible: Boolean(visible), showing };
    // Shown again (Home and back), or another tab brought to the front: both
    // bring a viewer and its rails back from display: none.
    const returned = visible && (!last.visible || last.showing !== showing);
    if (!returned || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.dataset.viewerReturning = 'true';
    const timer = window.setTimeout(() => { delete root.dataset.viewerReturning; }, ms);
    return () => {
      window.clearTimeout(timer);
      delete root.dataset.viewerReturning;
    };
  }, [visible, showing, ms]);
}
