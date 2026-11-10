/**
 * SnappingToggle — the View switch for snapping (owner 2026-10-22: "I don't
 * know how to turn off snapping ... users should be able to toggle it").
 *
 * One device preference (annotationPreferences.js, also in Settings >
 * Annotations) covers every snap: lining a moved / resized mark up with other
 * marks, pulling a line end onto another line's end, the touch angle assist
 * and rotation's right-angle magnet. Shift's snap-angle steps still apply, and
 * holding Alt mid-drag still skips snapping for that drag.
 *
 * Nightly 'snap-content' adds a second switch, Drawing (SnappingMenu below):
 * the PDF's own line ends, midpoints and lines, its own device preference.
 *
 * Renders whatever button the host wants (desktop rail button or phone menu
 * row) through `render`, like PageGridToggle. `useSnappingShortcut` is the
 * Shift+S key, mounted once by AppShell.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AnchoredPopover from './AnchoredPopover';
import {
  ANNOTATION_PREFERENCES_EVENT,
  ANNOTATION_SNAPPING_KEY,
  SNAP_CONTENT_KEY,
  readAnnotationSnapping,
  readSnapContent,
  writeAnnotationSnapping,
  writeSnapContent,
} from '../utils/annotationPreferences.js';
// The Snapping menu's card and switches share the page grid card's look.
import './PageGridSettings.css';
import { isSnappingToggleKey } from '../utils/keyboardShortcuts.js';
import { isTypingTarget } from '../utils/typingTarget.js';
import { showToast } from '../utils/toast.js';

const useSnapPreference = (key, read, write) => {
    const [on, setOn] = useState(() => read());
    useEffect(() => {
        const refresh = (event) => {
            if (event?.type === 'storage' && event.key !== key) return;
            setOn(read());
        };
        window.addEventListener(ANNOTATION_PREFERENCES_EVENT, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(ANNOTATION_PREFERENCES_EVENT, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, [key, read]);
    return [on, () => setOn(write(!read()))];
};

export const useAnnotationSnapping = () => useSnapPreference(ANNOTATION_SNAPPING_KEY, readAnnotationSnapping, writeAnnotationSnapping);

/** Snap to the PDF's own drawing (Nightly 'snap-content'): the menu's "Drawing" switch. */
export const useSnapContent = () => useSnapPreference(SNAP_CONTENT_KEY, readSnapContent, writeSnapContent);

/** The tooltip / label for the switch in its current state. */
export const snappingLabel = (on) => (on
    ? 'Snapping on (Shift+S). Hold Alt while dragging to skip it'
    : 'Snapping off (Shift+S)');

/** Shift+S anywhere in the viewer flips snapping, with a short note. */
export function useSnappingShortcut(enabled = true) {
    useEffect(() => {
        if (!enabled) return undefined;
        const onKeyDown = (event) => {
            if (!isSnappingToggleKey(event)) return;
            if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
            event.preventDefault();
            const on = writeAnnotationSnapping(!readAnnotationSnapping());
            showToast(on ? 'Snapping on' : 'Snapping off', 'info', { duration: 1600 });
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled]);
}

export const SnappingGlyph = ({ size = 14, off = false }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M5 3h5v9a2 2 0 0 0 4 0V3h5v9a7 7 0 0 1-14 0V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M5 7h5M14 7h5" stroke="currentColor" strokeWidth="1.5" />
        {off && <path d="M3 21 21 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
);

/** The Drawing switch alone (phone menu row), like SnappingToggle. */
export function SnapContentToggle({ render }) {
    const [on, toggle] = useSnapContent();
    return render({ on, toggle });
}

export default function SnappingToggle({ render }) {
    const [on, toggle] = useAnnotationSnapping();
    return render({ on, toggle });
}

/**
 * Nightly 'snap-content' (Drawboard's "Snap to content" beside "Snap to
 * annotations"): the rail's magnet opens a small card with two switches,
 * Marks (the one snapping switch above: other marks' ends, alignment guides,
 * rotation's magnet) and Drawing (the PDF's own line ends, midpoints and
 * lines). Both remembered on this device. `renderButton({ open, ref, onClick, on })`,
 * `on` being true while either switch is on.
 */
export function SnappingMenu({ renderButton }) {
    const [marks, toggleMarks] = useAnnotationSnapping();
    const [drawing, toggleDrawing] = useSnapContent();
    const [open, setOpen] = useState(false);
    const buttonRef = useRef(null);
    const cardRef = useRef(null);
    const getAnchor = useCallback(() => buttonRef.current, []);
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return;
            setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);
    return (
        <>
            {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v), on: marks || drawing })}
            {open && (
                <AnchoredPopover getAnchor={getAnchor} gap={6}>
                    <div
                        ref={cardRef}
                        role="dialog"
                        aria-label="Snapping"
                        data-snapping-menu="true"
                        className="page-grid-settings__card"
                        style={{ position: 'absolute', top: '100%', left: '50%', marginTop: 6, transform: 'translate(-50%, 0)', width: 220 }}
                    >
                        <div className="page-grid-settings">
                            <button type="button" role="switch" aria-checked={marks} data-snapping-marks="true" className="page-grid-settings__switch" onClick={toggleMarks}>
                                <span>Marks</span>
                                <span className="page-grid-settings__knob" aria-hidden="true" />
                            </button>
                            <button type="button" role="switch" aria-checked={drawing} data-snapping-drawing="true" className="page-grid-settings__switch" onClick={toggleDrawing}>
                                <span>Drawing</span>
                                <span className="page-grid-settings__knob" aria-hidden="true" />
                            </button>
                            <p className="page-grid-settings__hint">Drawing snaps to the PDF's own line ends, midpoints and lines. Hold Alt to skip snapping; Shift+S turns Marks on or off.</p>
                        </div>
                    </div>
                </AnchoredPopover>
            )}
        </>
    );
}
