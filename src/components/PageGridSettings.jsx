/**
 * Page grid settings (Nightly, flag 'grid-settings'; owner 2026-10-26,
 * redesigned 2026-11-09): Show grid, then Fine / Normal / Wide in a row (the
 * grid glides to its new size), a spacing slider that redraws the grid live,
 * and the value with its unit: paper units (in, mm) or drawing units (ft, m)
 * that follow each page's scale. Sliding or typing makes it a custom size.
 * Desktop: the rail's grid button opens this as a small card. Phone: the
 * same panel sits under the Page grid row of the zoom menu.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AnchoredPopover from './AnchoredPopover';
import ButtonGroup from './ButtonGroup.jsx';
import ValueSelect from './ValueSelect.jsx';
import {
    PAGE_GRID_DENSITIES,
    PAGE_GRID_SETTINGS_EVENT,
    PAGE_GRID_UNITS,
    animateNextPageGridChange,
    applyPageGridSettings,
    endPageGridPreview,
    loadPageGridSettings,
    pageGridPresetValue,
    pageGridSliderPosition,
    pageGridSliderValue,
    pageGridUsesDrawingScale,
    previewPageGridSettings,
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
    // Saving dispatches PAGE_GRID_SETTINGS_EVENT, which PDFViewer turns into
    // its own setState, so it must run in the event handler, never inside a
    // setState updater (React runs those during render: "Cannot update a
    // component while rendering a different component").
    const latestRef = useRef(settings);
    useEffect(() => { latestRef.current = settings; }, [settings]);
    const update = useCallback((patch) => {
        const next = setPageGridSettings({ ...latestRef.current, ...patch });
        latestRef.current = next;
        setSettings(next);
    }, []);
    return [settings, update];
};

export function PageGridSettingsPanel({ on, toggle, phone = false, showSwitch = true }) {
    const [settings, update] = usePageGridSettings();
    const preset = settings.density !== 'custom';
    const paperUnit = !pageGridUsesDrawingScale({ ...settings, density: 'custom' });
    // A preset is a paper size: with a drawing unit saved, the card shows it
    // in inches. The field and slider show the preset's size, else the
    // custom value.
    const unit = preset && !paperUnit ? 'in' : settings.customUnit;
    const shownValue = preset ? pageGridPresetValue(settings.density, unit) : settings.customValue;
    const [draft, setDraft] = useState(String(shownValue));
    useEffect(() => { setDraft(String(shownValue)); }, [shownValue]);
    // A slider drag previews on the page each frame and saves once, on release.
    const [dragValue, setDragValue] = useState(null);
    const dragging = dragValue != null;
    const sliderValue = dragging ? dragValue : shownValue;
    const commitValue = (value) => {
        endPageGridPreview();
        if (value > 0 && Number.isFinite(value)) update({ customValue: value, customUnit: unit, density: 'custom' });
    };
    const commitDraft = () => {
        const n = Number(draft);
        if (n > 0 && Number.isFinite(n)) commitValue(n);
        else setDraft(String(shownValue));
    };
    const pickPreset = (density) => {
        if (density === settings.density) return;
        animateNextPageGridChange();
        update({ density, customUnit: unit, customValue: pageGridPresetValue(density, unit) });
    };
    const onSlide = (event) => {
        const value = pageGridSliderValue(event.target.value, unit);
        setDragValue(value);
        setDraft(String(value));
        previewPageGridSettings({ ...settings, density: 'custom', customUnit: unit, customValue: value }, settings);
    };
    const endSlide = () => {
        if (dragValue == null) return;
        const value = dragValue;
        setDragValue(null);
        commitValue(value);
    };
    const unitOptions = PAGE_GRID_UNITS.map((u) => ({ value: u.id, label: u.label }));
    const pickUnit = (customUnit) => {
        // Keep the same paper size when moving between in and mm.
        const fromPt = { in: 72, mm: 72 / 25.4 }[unit];
        const toPt = { in: 72, mm: 72 / 25.4 }[customUnit];
        if (fromPt && toPt) {
            const v = Math.round(((shownValue * fromPt) / toPt) * 100) / 100;
            update({ customUnit, customValue: v > 0 ? v : settings.customValue });
            return;
        }
        update({ customUnit, density: 'custom' });
    };
    return (
        <div className={`page-grid-settings${phone ? ' is-phone' : ''}`} data-page-grid-settings="true">
            {showSwitch && (
                <button type="button" role="switch" aria-checked={on} className="page-grid-settings__switch" onClick={toggle}>
                    <span>Show grid</span>
                    <span className="page-grid-settings__knob" aria-hidden="true" />
                </button>
            )}
            <ButtonGroup
                label="Grid spacing preset"
                size="sm"
                fill
                className="page-grid-settings__presets"
                value={settings.density}
                options={PAGE_GRID_DENSITIES.map((d) => ({ value: d.id, label: d.label, ariaLabel: `${d.label}, ${d.hint}` }))}
                onChange={pickPreset}
            />
            <input
                type="range"
                className="page-grid-settings__slider"
                min="0"
                max="1000"
                step="1"
                aria-label="Grid spacing"
                aria-valuetext={`${sliderValue} ${unit}`}
                value={pageGridSliderPosition(sliderValue, unit)}
                onChange={onSlide}
                onPointerUp={endSlide}
                onKeyUp={endSlide}
                onBlur={endSlide}
                style={{ '--fill': `${pageGridSliderPosition(sliderValue, unit) / 10}%` }}
            />
            <div className="page-grid-settings__custom">
                <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Grid spacing value"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                    onBlur={commitDraft}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
                />
                {phone ? (
                    <select aria-label="Grid unit" value={unit} onChange={(e) => pickUnit(e.target.value)}>
                        {unitOptions.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                ) : (
                    <ValueSelect
                        label="Grid unit"
                        size="sm"
                        className="page-grid-settings__unit"
                        value={unit}
                        options={unitOptions}
                        onChange={pickUnit}
                    />
                )}
            </div>
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
