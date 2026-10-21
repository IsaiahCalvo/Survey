/**
 * PageGridToggle — the View switch for the page grid overlay (Drawboard gap
 * #10). Renders whatever button the host wants (desktop rail button or phone
 * menu row) through `render`, and keeps <html data-page-grid> in step.
 */
import { useEffect, useState } from 'react';
import '../styles/pageGrid.css';
import { applyPageGrid, loadPageGrid, setPageGrid, PAGE_GRID_EVENT } from '../utils/pageGrid';

export const usePageGrid = () => {
    const [on, setOn] = useState(() => loadPageGrid());
    useEffect(() => {
        applyPageGrid(on);
        const onEvent = (e) => setOn(Boolean(e.detail));
        window.addEventListener(PAGE_GRID_EVENT, onEvent);
        return () => window.removeEventListener(PAGE_GRID_EVENT, onEvent);
    }, [on]);
    return [on, () => setOn(setPageGrid(!on))];
};

export const PageGridGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

export default function PageGridToggle({ render }) {
    const [on, toggle] = usePageGrid();
    return render({ on, toggle });
}
