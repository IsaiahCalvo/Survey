/**
 * SnappingToggle — the View switch for snapping (owner 2026-10-22: "I don't
 * know how to turn off snapping ... users should be able to toggle it").
 *
 * One device preference (annotationPreferences.js, also in Settings >
 * Annotations) covers every snap: lining a moved / resized mark up with other
 * marks, pulling a line end onto another line's end, the touch angle assist
 * and rotation's right-angle magnet. Shift's 45° / 15° steps still apply, and
 * holding Alt mid-drag still skips snapping for that drag.
 *
 * Renders whatever button the host wants (desktop rail button or phone menu
 * row) through `render`, like PageGridToggle. `useSnappingShortcut` is the
 * Shift+S key, mounted once by AppShell.
 */
import { useEffect, useState } from 'react';
import {
  ANNOTATION_PREFERENCES_EVENT,
  ANNOTATION_SNAPPING_KEY,
  readAnnotationSnapping,
  writeAnnotationSnapping,
} from '../utils/annotationPreferences.js';
import { isSnappingToggleKey } from '../utils/keyboardShortcuts.js';
import { isTypingTarget } from '../utils/annotationFamilyRules.js';
import { showToast } from '../utils/toast.js';

export const useAnnotationSnapping = () => {
    const [on, setOn] = useState(() => readAnnotationSnapping());
    useEffect(() => {
        const refresh = (event) => {
            if (event?.type === 'storage' && event.key !== ANNOTATION_SNAPPING_KEY) return;
            setOn(readAnnotationSnapping());
        };
        window.addEventListener(ANNOTATION_PREFERENCES_EVENT, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(ANNOTATION_PREFERENCES_EVENT, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);
    return [on, () => setOn(writeAnnotationSnapping(!readAnnotationSnapping()))];
};

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

export default function SnappingToggle({ render }) {
    const [on, toggle] = useAnnotationSnapping();
    return render({ on, toggle });
}
