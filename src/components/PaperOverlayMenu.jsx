/**
 * Nightly 'paper-overlays' (Drawboard Projects VT-46): the rail's Paper
 * button opens a card of paper swatches in three groups (Notetaking, Grids
 * and graphs, Music). Picking one lays it over every page, above the PDF and
 * under the marks; "Blank page" takes it off. View only, for this sitting:
 * src/utils/paperOverlays.js.
 */
import { useEffect, useRef, useState } from 'react';
import RailFlyout from './RailFlyout.jsx';
import '../styles/paperOverlays.css';
import {
    PAPER_NONE,
    PAPER_OVERLAY_EVENT,
    PAPER_OVERLAY_GROUPS,
    getPaperOverlay,
    paperOverlayVars,
    setPaperOverlay,
} from '../utils/paperOverlays';

// The swatch shows the paper's top-left corner a bit under a third of its size,
// so the lines still read in a 61 x 79 px page.
const SWATCH_SCALE = 0.3;

export const usePaperOverlay = () => {
    const [value, setValue] = useState(() => getPaperOverlay());
    useEffect(() => {
        const onEvent = (e) => setValue(String(e.detail || PAPER_NONE));
        window.addEventListener(PAPER_OVERLAY_EVENT, onEvent);
        return () => window.removeEventListener(PAPER_OVERLAY_EVENT, onEvent);
    }, []);
    return [value, (id) => setValue(setPaperOverlay(id))];
};

/** A page with ruled lines (Lucide-style, 24 grid, 1.5 stroke). */
export const PaperOverlayGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 8.5h14M5 12.5h14M5 16.5h14M9 3v18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

function Swatch({ kind, checked, onPick }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={checked}
            data-paper-kind={kind.id}
            className="paper-overlay-swatch"
            onClick={() => onPick(kind.id)}
        >
            <span
                className="paper-overlay-swatch__page"
                aria-hidden="true"
                style={{ ...paperOverlayVars(kind.id), '--survey-page-scale': SWATCH_SCALE }}
            />
            <span className="paper-overlay-swatch__name">{kind.label}</span>
        </button>
    );
}

/** `renderButton({ open, ref, onClick, on })`; `on` while a paper is showing. */
export function PaperOverlayMenu({ renderButton }) {
    const [value, pick] = usePaperOverlay();
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
            {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v), on: value !== PAPER_NONE })}
            {open && (
                <RailFlyout
                    cardRef={cardRef}
                    role="dialog"
                    aria-label="Paper"
                    title="Paper"
                    data-paper-overlay-menu="true"
                    className="page-grid-settings__card paper-overlay-card"
                >
                    <div className="paper-overlay-card__scroll">
                        {PAPER_OVERLAY_GROUPS.map((group) => (
                            <div key={group.id} className="paper-overlay-card__group" role="radiogroup" aria-label={group.label}>
                                <div className="paper-overlay-card__group-title">{group.label}</div>
                                <div className="paper-overlay-card__tiles">
                                    {group.kinds.map((kind) => (
                                        <Swatch key={kind.id} kind={kind} checked={value === kind.id} onPick={pick} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </RailFlyout>
            )}
        </div>
    );
}

export default PaperOverlayMenu;
