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
 * For a moment after the viewer shows again, :root carries
 * data-viewer-returning and styles/motion.css runs those entry animations at
 * 0s: they land on their end state in the first frame. The mark goes once
 * they would have ended anyway, so taking it off never replays them.
 */
import { useLayoutEffect, useRef } from 'react';

export const VIEWER_RETURN_QUIET_MS = 400;

export default function useViewerReturnQuiet(visible, ms = VIEWER_RETURN_QUIET_MS) {
  const wasVisibleRef = useRef(Boolean(visible));
  useLayoutEffect(() => {
    const was = wasVisibleRef.current;
    wasVisibleRef.current = Boolean(visible);
    if (!visible || was || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.dataset.viewerReturning = 'true';
    const timer = window.setTimeout(() => { delete root.dataset.viewerReturning; }, ms);
    return () => {
      window.clearTimeout(timer);
      delete root.dataset.viewerReturning;
    };
  }, [visible, ms]);
}
