/**
 * Page grid settings (Nightly, flag 'grid-settings'; owner 2026-10-26):
 * how dense the grid is - Fine, Normal or Wide - or a custom spacing in paper
 * units (in, mm) or drawing units (ft, m) that follow each page's scale.
 * Desktop: the rail's grid button opens this as a small card. Phone: the
 * same panel sits under the Page grid row of the zoom menu.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AnchoredPopover from './AnchoredPopover';
import ValueSelect from './ValueSelect.jsx';
import {
    PAGE_GRID_DENSITIES,
    PAGE_GRID_SETTINGS_EVENT,
    PAGE_GRID_UNITS,
    applyPageGridSettings,
    loadPageGridSettings,
    pageGridUsesDrawingScale,
    setPageGridSettings,
} from '../utils/pageGrid';
import './PageGridSettings.css';

export const usePageGridSettings = () => {
    const [settings, setSettings] = useState(() => loadPageGridSettings());
    useEffect(() => {
        applyPageGridSettings(settings);
        const onEvent = (e) => setSettings(e.detail || loadPageGridSettings());
        window.addEventListener(PAGE_GRID_SETTINGS_EVENT, onEvent);
        return () => window.removeEventListener(PAGE_GRID_SETTINGS_EVENT, onEvent);
    }, [settings]);
    const update = useCallback((patch) => setSettings((prev) => setPageGridSettings({ ...prev, ...patch })), []);
    return [settings, update];
};

export function PageGridSettingsPanel({ on, toggle, phone = false, showSwitch = true }) {
    const [settings, update] = usePageGridSettings();
    const [draft, setDraft] = useState(String(settings.customValue));
    useEffect(() => { setDraft(String(settings.customValue)); }, [settings.customValue]);
    const commitDraft = () => {
        const n = Number(draft);
        if (n > 0 && Number.isFinite(n)) update({ customValue: n, density: 'custom' });
        else setDraft(String(settings.customValue));
    };
    return (
        <div className={`page-grid-settings${phone ? ' is-phone' : ''}`} data-page-grid-settings="true">
            {showSwitch && (
                <button type="button" role="switch" aria-checked={on} className="page-grid-settings__switch" onClick={toggle}>
                    <span>Show grid</span>
                    <span className="page-grid-settings__knob" aria-hidden="true" />
                </button>
            )}
            <div className="page-grid-settings__label" id="page-grid-spacing">Spacing</div>
            <div className="page-grid-settings__seg" role="radiogroup" aria-labelledby="page-grid-spacing">
                {PAGE_GRID_DENSITIES.map((d) => (
                    <button
                        key={d.id}
                        type="button"
                        role="radio"
                        aria-checked={settings.density === d.id}
                        aria-label={`${d.label}, ${d.hint}`}
                        className={settings.density === d.id ? 'is-on' : ''}
                        onClick={() => update({ density: d.id })}
                    >
                        <span>{d.label}</span>
                        <small>{d.hint}</small>
                    </button>
                ))}
                <button
                    type="button"
                    role="radio"
                    aria-checked={settings.density === 'custom'}
                    className={settings.density === 'custom' ? 'is-on' : ''}
                    onClick={() => update({ density: 'custom' })}
                >
                    <span>Custom</span>
                    <small>{settings.customValue} {settings.customUnit}</small>
                </button>
            </div>
            {settings.density === 'custom' && (
                <div className="page-grid-settings__custom">
                    <span>Every</span>
                    <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        aria-label="Grid spacing"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitDraft}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
                    />
                    {phone ? (
                        <select aria-label="Grid unit" value={settings.customUnit} onChange={(e) => update({ customUnit: e.target.value, density: 'custom' })}>
                            {PAGE_GRID_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                    ) : (
                        <ValueSelect
                            label="Grid unit"
                            size="sm"
                            className="page-grid-settings__unit"
                            value={settings.customUnit}
                            options={PAGE_GRID_UNITS.map((u) => ({ value: u.id, label: u.label }))}
                            onChange={(customUnit) => update({ customUnit, density: 'custom' })}
                        />
                    )}
                </div>
            )}
            {pageGridUsesDrawingScale(settings) && (
                <p className="page-grid-settings__hint">Follows each page's scale. Pages with no scale keep a 1/2 in grid.</p>
            )}
        </div>
    );
}

/** The rail's grid button with the settings card. `renderButton({ open, onClick, ref })`. */
export function PageGridMenu({ on, toggle, renderButton }) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef(null);
    const cardRef = useRef(null);
    const getAnchor = useCallback(() => buttonRef.current, []);
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return;
            // The unit list is portalled to <body>; a press in it is the card's.
            if (event.target?.closest?.('.value-select__menu')) return;
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
            {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v) })}
            {open && (
                <AnchoredPopover getAnchor={getAnchor} gap={6}>
                    <div
                        ref={cardRef}
                        role="dialog"
                        aria-label="Page grid"
                        className="page-grid-settings__card"
                        style={{ position: 'absolute', top: '100%', left: '50%', marginTop: 6, transform: 'translate(-50%, 0)' }}
                    >
                        <PageGridSettingsPanel on={on} toggle={toggle} />
                    </div>
                </AnchoredPopover>
            )}
        </>
    );
}
