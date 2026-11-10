/**
 * DarkPagesToggle - the View switch for dark pages (Nightly, flag
 * 'dark-pages'). Renders whatever button the host wants (desktop rail button
 * or phone menu row) through `render`, like PageGridToggle, and keeps
 * <html data-dark-pages> in step. With the flag off it renders nothing and
 * the pages stay as they are.
 */
import { useEffect, useState } from 'react';
import '../styles/darkPages.css';
import { isFeatureOn } from '../featureFlags.js';
import { applyDarkPages, loadDarkPages, setDarkPages, DARK_PAGES_EVENT } from '../utils/darkPages';

export const useDarkPages = (enabled = true) => {
    const [on, setOn] = useState(() => loadDarkPages());
    useEffect(() => {
        applyDarkPages(enabled && on);
        const onEvent = (e) => setOn(Boolean(e.detail));
        window.addEventListener(DARK_PAGES_EVENT, onEvent);
        return () => window.removeEventListener(DARK_PAGES_EVENT, onEvent);
    }, [enabled, on]);
    return [on, () => setOn(setDarkPages(!on))];
};

export const DarkPagesGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
);

function DarkPagesSwitch({ render }) {
    const [on, toggle] = useDarkPages(true);
    return render({ on, toggle });
}

export default function DarkPagesToggle({ render }) {
    const [enabled] = useState(() => isFeatureOn('dark-pages'));
    if (!enabled) return null;
    return <DarkPagesSwitch render={render} />;
}
