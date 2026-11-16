/**
 * Nightly 'thin-lines' (Drawboard Projects: "Enhance thin PDF lines"): the
 * rail's line-weight button opens a card with Off / Thin / Medium / Thick.
 * The pick darkens and widens faint PDF lines on screen only, and is saved
 * on this device: src/utils/thinLines.js. Under it, "Ignore line weight"
 * draws every PDF line one pixel wide (src/utils/pdfLineWeight.js).
 */
import { useEffect, useRef, useState } from 'react';
import RailFlyout from './RailFlyout.jsx';
import Icon from '../Icons';
import '../styles/thinLines.css';
import './PageGridSettings.css';
import { useIgnoreLineWeight } from '../utils/pdfLineWeight';
import {
    THIN_LINES_EVENT,
    THIN_LINE_LEVELS,
    applyThinLines,
    ensureThinLinesFilters,
    loadThinLines,
    setThinLines,
} from '../utils/thinLines';

export const useThinLines = () => {
    const [value, setValue] = useState(() => loadThinLines());
    useEffect(() => {
        applyThinLines(value);
        const onEvent = (e) => setValue(String(e.detail || 'off'));
        window.addEventListener(THIN_LINES_EVENT, onEvent);
        return () => window.removeEventListener(THIN_LINES_EVENT, onEvent);
    }, [value]);
    // The erode radius is in device pixels: rebuild it when the ratio moves
    // (browser zoom, a window dragged to another screen).
    useEffect(() => {
        if (value === 'off' || typeof window === 'undefined' || !window.matchMedia) return undefined;
        let query = null;
        const watch = () => {
            ensureThinLinesFilters();
            query?.removeEventListener?.('change', watch);
            query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            query.addEventListener?.('change', watch);
        };
        watch();
        return () => query?.removeEventListener?.('change', watch);
    }, [value]);
    return [value, (next) => setValue(setThinLines(next))];
};

/** Line-weight glyph (Lucide-style, 24 grid, 1.5 stroke): a hairline, then two bars, each heavier. */
export const ThinLinesGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M4 5.5h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="4" y="10" width="16" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
        <rect x="4" y="16" width="16" height="4" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" />
    </svg>
);

/** `renderButton({ open, ref, onClick, on })`; `on` while any level is picked. */
export function ThinLinesMenu({ renderButton, glyphSize = 14 }) {
    const [value, pick] = useThinLines();
    const [uniform, setUniform] = useIgnoreLineWeight();
    const [open, setOpen] = useState(false);
    const buttonRef = useRef(null);
    const cardRef = useRef(null);
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
        <div className="page-grid-menu">
            {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v), on: value !== 'off' || uniform })}
            {open && (
                <RailFlyout
                    cardRef={cardRef}
                    role="dialog"
                    aria-label="Thin PDF lines"
                    title="Thin PDF lines"
                    data-thin-lines-menu="true"
                    className="page-grid-settings__card"
                >
                    <div role="radiogroup" aria-label="Line boost" className="rail-flyout__rows">
                        {THIN_LINE_LEVELS.map((level) => {
                            const checked = level.id === value;
                            return (
                                <button
                                    key={level.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={checked}
                                    data-thin-lines-level={level.id}
                                    className="rail-flyout__row"
                                    onClick={() => pick(level.id)}
                                >
                                    <span className="rail-flyout__label">{level.label}</span>
                                    <span className="rail-flyout__tick" aria-hidden="true">
                                        {checked && <Icon name="check" size={glyphSize} color="currentColor" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="page-grid-settings snapping-card thin-lines-card__switch">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={uniform}
                            className="page-grid-settings__switch snapping-card__row"
                            onClick={() => setUniform(!uniform)}
                            data-thin-lines-uniform="true"
                        >
                            <span className="snapping-card__text">
                                <span>Ignore line weight</span>
                                <span className="snapping-card__sub">Every PDF line one pixel wide</span>
                            </span>
                            <span className="page-grid-settings__knob" aria-hidden="true" />
                        </button>
                    </div>
                    <p className="page-grid-settings__hint thin-lines-card__hint">Makes faint lines easier to see. Only on your screen.</p>
                </RailFlyout>
            )}
        </div>
    );
}

export default ThinLinesMenu;
