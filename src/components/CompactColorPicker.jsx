/**
 * CompactColorPicker.jsx — the app's single shared colour picker popover.
 *
 * Default-exports the CompactColorPicker component: an 8-wide preset grid plus a
 * spectrum (HSV) view, an opacity slider, and a hex field. Used everywhere colours
 * are chosen (annotation fill/border, pins, etc). Supports a transparent first cell
 * or a "Match Fill" first cell (firstPreset), a minOpacity floor, and optional
 * opacity controls (showOpacity). Calls onChange(hex, alpha) live as the user drags.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import DismissBarrier from './DismissBarrier';
import {
    COLOR_PICKER_PRESETS,
    hexToHsv,
    hsvToHex,
    normalizeHexColor,
    applySpectrumKey,
    applyHueKey,
    applyColorPickerSelection,
    clampOpacityPercent,
} from '../utils/annotationStyleCatalog.js';

const PRESET_COLORS = COLOR_PICKER_PRESETS;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * CompactColorPicker — the app's one shared colour picker.
 *
 * Props:
 *  - color        current hex colour
 *  - opacity      current opacity 0..1 (default 1)
 *  - onChange(hex, alpha)
 *  - onClose
 *  - showOpacity  when false, hides the opacity slider + % field — for pickers
 *                 of things that have no transparency (e.g. counter pins)
 *  - attachedHeader when true, joins the picker to a tab/header directly above
 *  - outsideBoundaryRef optional ref whose element contains this picker plus any
 *                 attached controls that should not dismiss it (e.g. tabs)
 */
const CompactColorPicker = ({
    color,
    opacity = 1,
    onChange,
    onClose,
    showOpacity = true,
    marginRight = 0,
    attachedHeader = false,
    outsideBoundaryRef = null,
    // 2026-05-25: First preset cell behaviour.
    //   'transparent' (default) — zero-alpha picker; click sets opacity 0.
    //   'none' — no transparent cell (opaque targets such as font color).
    //   { kind: 'match', color }  — Match Fill picker; click snapshots the
    //     given color at full opacity. Lets the Border tab on shapes show a
    //     swatch that matches the current fill without ever offering zero
    //     opacity (shapes require a visible border).
    firstPreset = 'transparent',
    minOpacity = 0,
    dismissInsideSelector,
    // Sibling chrome (Width / Style / Font / Font size / other toolbar
    // triggers) should dismiss this picker and still receive their own
    // click. Without passthrough, DismissBarrier consumes the gesture and
    // the user has to click Width or Font twice after typing a hex value.
    passthroughSelector = '',
}) => {
    const hideTransparentCell = firstPreset === 'none';
    const gridPresets = hideTransparentCell
        ? COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent')
        : PRESET_COLORS;
    const isMatchFirst = firstPreset && typeof firstPreset === 'object' && firstPreset.kind === 'match';
    const matchFillColor = isMatchFirst ? (firstPreset.color || '#ffffff') : null;
    // 2026-05-25: When the parent supplies a fill opacity alongside the fill
    // colour, Match Fill snapshots both — border opacity locks to the fill
    // opacity in one click. Defaults to fully opaque when no opacity given.
    const matchFillOpacity = isMatchFirst
        ? (typeof firstPreset.opacity === 'number' ? Math.max(0, Math.min(1, firstPreset.opacity)) : 1)
        : 1;
    const [mode, setMode] = useState('grid'); // 'grid' or 'spectrum'
    const [localHex, setLocalHex] = useState(color || '#000000');
    // 2026-05-25: localOpacity is the SLIDER position, never zeroed by the
    // transparent preset. transparentMode is a separate flag — true when the
    // user picked the transparent tile (or the parent's opacity prop is 0).
    // The slider greys out in that mode but keeps its value so picking a
    // colored swatch restores the previously chosen opacity in one click.
    const [localOpacity, setLocalOpacity] = useState(opacity > 0 ? Math.round(opacity * 100) : 100);
    const [transparentMode, setTransparentMode] = useState(!(opacity > 0));

    // HSV State
    const [hue, setHue] = useState(0);
    const [saturation, setSaturation] = useState(100);
    const [value, setValue] = useState(100);

    const svRef = useRef(null);
    const hueRef = useRef(null);
    const containerRef = useRef(null);
    const dismissInsideRefs = useMemo(
        () => outsideBoundaryRef ? [containerRef, outsideBoundaryRef] : [containerRef],
        [outsideBoundaryRef],
    );
    const svPointerId = useRef(null);
    const huePointerId = useRef(null);

    // Keep the local hex AND the spectrum's HSV in sync with the colour prop,
    // so opening the spectrum view starts on the real current colour.
    useEffect(() => {
        setLocalHex(color || '#000000');
        const hsv = hexToHsv(color);
        if (hsv) {
            // 0° and 360° are the same hex. Keep End-key 360 so ArrowRight
            // clamps instead of looking like a wrap (360 → 0 → 1).
            setHue((prev) => (prev === 360 && hsv.h === 0 ? 360 : hsv.h));
            setSaturation(hsv.s);
            setValue(hsv.v);
        }
    }, [color]);

    // 2026-05-25: Sync the opacity slider position when the opacity prop
    // changes. Each tab behaves as an independent settings page. A prop
    // value of zero is treated as transparentMode and the slider value is
    // preserved so the user can pick a real colour and immediately see it
    // again at the remembered opacity.
    useEffect(() => {
        const pct = (opacity ?? 0);
        if (pct > 0) {
            setLocalOpacity(Math.round(pct * 100));
            setTransparentMode(false);
        } else {
            setTransparentMode(true);
        }
    }, [opacity]);

    // Handle Hue Change
    const handleHueChange = (e) => {
        const rect = hueRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const newHue = (x / rect.width) * 360;
        setHue(newHue);
        updateColorFromHSV(newHue, saturation, value);
    };

    // Handle SV Change
    const handleSVChange = (e) => {
        const rect = svRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

        const newSat = (x / rect.width) * 100;
        const newVal = 100 - ((y / rect.height) * 100);

        setSaturation(newSat);
        setValue(newVal);
        updateColorFromHSV(hue, newSat, newVal);
    };

    // Convert HSV to Hex and update
    const updateColorFromHSV = (h, s, v) => {
        const hex = hsvToHex(h, s, v);
        setLocalHex(hex);
        setTransparentMode(false);
        onChange(hex, localOpacity / 100);
    };

    // P1-39 leftover sibling: the hex field already skips applyHex on
    // garbage like zzzzzz, but Opacity still called onChange(localHex) so
    // composeColorForPatch leftover-persisted `#zzzzzz`. Commit opacity
    // against a normalized hex (typed field, else the live color prop).
    const commitRememberedOpacity = (nextPct) => {
        const hex = normalizeHexColor(localHex) || normalizeHexColor(color);
        setLocalOpacity(nextPct);
        if (!hex) return;
        onChange(hex, nextPct / 100);
    };

    // Apply a hex value coming from a preset swatch or the hex field — keeps the
    // spectrum's HSV indicators in step so switching views stays consistent.
    const applyHex = (hex) => {
        // Transparent preset: enter transparent mode (slider greys out) but
        // keep the slider's remembered value. Picking any other swatch
        // afterwards immediately renders that colour at the remembered
        // opacity, no manual slider bump needed.
        const next = applyColorPickerSelection({
            input: hex,
            currentHex: localHex,
            rememberedOpacityPct: localOpacity,
            minOpacity,
            matchFillColor,
            matchFillOpacity,
        });
        if (next.kind === 'invalid') return;
        if (next.kind === 'transparent') {
            setTransparentMode(true);
            onChange(next.hex, 0);
            return;
        }
        setLocalHex(next.hex);
        setLocalOpacity(next.rememberedOpacityPct);
        setTransparentMode(false);
        const hsv = hexToHsv(next.hex);
        if (hsv) {
            setHue(hsv.h);
            setSaturation(hsv.s);
            setValue(hsv.v);
        }
        onChange(next.hex, next.opacity);
    };

    // Pointer capture keeps both mouse and finger drags live when they leave
    // the small spectrum/hue track. touchAction none prevents WebKit from
    // turning the same gesture into page panning after it has begun.
    const beginPointerDrag = (kind, event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (kind === 'sv') {
            svPointerId.current = event.pointerId;
            handleSVChange(event);
        } else {
            huePointerId.current = event.pointerId;
            handleHueChange(event);
        }
    };

    const movePointerDrag = (kind, event) => {
        const activeId = kind === 'sv' ? svPointerId.current : huePointerId.current;
        if (activeId !== event.pointerId) return;
        event.preventDefault();
        if (kind === 'sv') handleSVChange(event);
        else handleHueChange(event);
    };

    const endPointerDrag = (kind, event) => {
        const pointerRef = kind === 'sv' ? svPointerId : huePointerId;
        if (pointerRef.current !== event.pointerId) return;
        pointerRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleSpectrumKeyDown = (event) => {
        const next = applySpectrumKey(event.key, saturation, value);
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        setSaturation(next.saturation);
        setValue(next.value);
        updateColorFromHSV(hue, next.saturation, next.value);
    };

    const handleHueKeyDown = (event) => {
        const nextHue = applyHueKey(event.key, hue);
        if (nextHue == null) return;
        event.preventDefault();
        event.stopPropagation();
        setHue(nextHue);
        updateColorFromHSV(nextHue, saturation, value);
    };

    return (
        <>
        <DismissBarrier
            active={typeof onClose === 'function'}
            insideRefs={dismissInsideRefs}
            insideSelector={dismissInsideSelector}
            passthroughSelector={passthroughSelector}
            onDismiss={onClose}
        />
        <div
            ref={containerRef}
            role="dialog"
            aria-label="Color"
            data-modal-focus-layer="true"
            data-testid="compact-color-picker"
            data-font-color-picker="true"
            style={{
            width: '260px',
            background: '#0d0f14',
            border: '1px solid #2a3140',
            borderTop: attachedHeader ? 'none' : undefined,
            borderRadius: attachedHeader ? '0 0 8px 8px' : '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            userSelect: 'none',
            marginRight
        }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: '#e8e2d4', fontSize: '13px', fontWeight: 600 }}>Color</span>
                <div style={{ display: 'flex', gap: '4px', background: '#2a3140', padding: '2px', borderRadius: '4px' }}>
                    <button
                        type="button"
                        aria-label="Preset colors"
                        onClick={() => setMode('grid')}
                        style={{
                            background: mode === 'grid' ? '#5a6473' : 'transparent',
                            border: 'none',
                            borderRadius: '2px',
                            padding: '4px',
                            cursor: 'pointer',
                            color: 'white',
                            display: 'flex'
                        }}
                    >
                        <div style={{ width: 12, height: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                            <div style={{ background: 'currentColor' }} />
                            <div style={{ background: 'currentColor' }} />
                            <div style={{ background: 'currentColor' }} />
                            <div style={{ background: 'currentColor' }} />
                        </div>
                    </button>
                    <button
                        type="button"
                        aria-label="Color spectrum"
                        onClick={() => setMode('spectrum')}
                        style={{
                            background: mode === 'spectrum' ? '#5a6473' : 'transparent',
                            border: 'none',
                            borderRadius: '2px',
                            padding: '4px',
                            cursor: 'pointer',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path d="M8 2L10 6L14 8L10 10L8 14L6 10L2 8L6 6L8 2Z" fill="currentColor" />
                        </svg>
                    </button>
                </div>
            </div>

            {mode === 'grid' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px' }}>
                    {gridPresets.map((c, idx) => {
                        // 2026-05-25: Border tab on shapes swaps the first cell
                        // from Transparent to Match Fill — shows the current
                        // fill colour with a small chain glyph so the user can
                        // sync border to fill in one click. Everything else in
                        // the grid is unchanged.
                        const isMatchSlot = idx === 0 && isMatchFirst;
                        const presetValue = isMatchSlot ? '__match__' : c;
                        const isTransparent = !isMatchSlot && c === 'transparent';
                        const matchOpacityPct = Math.round((Number(matchFillOpacity) || 1) * 100);
                        const isSelected = isMatchSlot
                            ? (!transparentMode && matchFillColor && localHex.toLowerCase() === matchFillColor.toLowerCase() && Math.abs(localOpacity - matchOpacityPct) <= 1)
                            : isTransparent
                                ? transparentMode
                                : (!transparentMode && localHex === c);
                        const matchBg = isMatchSlot
                            ? { background: matchFillColor }
                            : null;
                        const transparentBg = (!isMatchSlot && isTransparent)
                            ? {
                                backgroundColor: '#ffffff',
                                backgroundImage:
                                    'linear-gradient(45deg, #cfcfcf 25%, transparent 25%),'
                                    + 'linear-gradient(-45deg, #cfcfcf 25%, transparent 25%),'
                                    + 'linear-gradient(45deg, transparent 75%, #cfcfcf 75%),'
                                    + 'linear-gradient(-45deg, transparent 75%, #cfcfcf 75%)',
                                backgroundSize: '8px 8px',
                                backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0'
                            }
                            : (matchBg || { background: c });
                        const title = isMatchSlot ? 'Match fill' : (isTransparent ? 'Transparent' : c);
                        return (
                            <button
                                type="button"
                                key={isMatchSlot ? '__match__' : c}
                                title={title}
                                onClick={() => applyHex(presetValue)}
                                style={{
                                    width: '100%',
                                    aspectRatio: '1',
                                    borderRadius: '4px',
                                    ...transparentBg,
                                    border: isSelected ? '2px solid white' : '1px solid #3a4252',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: 0,
                                }}
                            >
                                {isMatchSlot && (
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        color: 'rgba(0,0,0,0.75)',
                                        textShadow: '0 0 2px rgba(255,255,255,0.85), 0 0 1px rgba(255,255,255,0.85)',
                                        letterSpacing: '-0.5px',
                                        pointerEvents: 'none',
                                    }}>≡</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <>
                    {/* SV Box */}
                    <div
                        ref={svRef}
                        data-color-picker-spectrum="true"
                        role="slider"
                        tabIndex={0}
                        aria-label="Saturation and brightness"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(saturation)}
                        aria-valuetext={`Saturation ${Math.round(saturation)}%, brightness ${Math.round(value)}%`}
                        aria-description="Left and right adjust saturation. Up and down adjust brightness. Page Up and Page Down adjust brightness by ten percent. Home and End set minimum and maximum saturation."
                        onKeyDown={handleSpectrumKeyDown}
                        onPointerDown={(event) => beginPointerDrag('sv', event)}
                        onPointerMove={(event) => movePointerDrag('sv', event)}
                        onPointerUp={(event) => endPointerDrag('sv', event)}
                        onPointerCancel={(event) => endPointerDrag('sv', event)}
                        onLostPointerCapture={() => { svPointerId.current = null; }}
                        style={{
                            width: '100%',
                            height: '150px',
                            position: 'relative',
                            borderRadius: '4px',
                            background: `
                linear-gradient(to top, #000, transparent),
                linear-gradient(to right, #FFF, transparent),
                hsl(${hue}, 100%, 50%)
              `,
                            cursor: 'crosshair',
                            touchAction: 'none'
                        }}
                    >
                        <div style={{
                            position: 'absolute',
                            left: `${saturation}%`,
                            top: `${100 - value}%`,
                            width: '12px',
                            height: '12px',
                            border: '2px solid white',
                            borderRadius: '50%',
                            transform: 'translate(-50%, -50%)',
                            boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                            background: localHex
                        }} />
                    </div>

                    {/* Hue Slider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#8d96a6', fontSize: '10px', width: '20px' }}>HUE</span>
                        <div
                            ref={hueRef}
                            data-color-picker-hue="true"
                            role="slider"
                            tabIndex={0}
                            aria-label="Hue"
                            aria-orientation="horizontal"
                            aria-valuemin={0}
                            aria-valuemax={360}
                            aria-valuenow={Math.round(hue)}
                            aria-valuetext={`${Math.round(hue)} degrees`}
                            aria-description="Arrow keys adjust hue by one degree. Page Up and Page Down adjust hue by ten degrees. Home and End set the minimum and maximum hue."
                            onKeyDown={handleHueKeyDown}
                            onPointerDown={(event) => beginPointerDrag('hue', event)}
                            onPointerMove={(event) => movePointerDrag('hue', event)}
                            onPointerUp={(event) => endPointerDrag('hue', event)}
                            onPointerCancel={(event) => endPointerDrag('hue', event)}
                            onLostPointerCapture={() => { huePointerId.current = null; }}
                            style={{
                                flex: 1,
                                height: '12px',
                                borderRadius: '6px',
                                background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
                                position: 'relative',
                                cursor: 'pointer',
                                touchAction: 'none'
                            }}
                        >
                            <div style={{
                                position: 'absolute',
                                left: `${(hue / 360) * 100}%`,
                                top: '50%',
                                width: '12px',
                                height: '12px',
                                background: 'white',
                                borderRadius: '50%',
                                transform: 'translate(-50%, -50%)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                            }} />
                        </div>
                        <span style={{ color: '#e8e2d4', fontSize: '11px', width: '24px', textAlign: 'right' }}>{Math.round(hue)}°</span>
                    </div>
                </>
            )}

            {/* Opacity Slider */}
            {showOpacity && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: transparentMode ? 0.4 : 1,
                }}>
                    <span style={{ color: '#8d96a6', fontSize: '10px', width: '40px' }}>OPACITY</span>
                    <input
                        type="range"
                        aria-label="Opacity"
                        min={Math.round(minOpacity * 100)}
                        max="100"
                        value={localOpacity}
                        disabled={transparentMode}
                        onChange={(e) => {
                            if (transparentMode) return;
                            const next = clampOpacityPercent(e.target.value, minOpacity);
                            commitRememberedOpacity(next);
                        }}
                        style={{
                            flex: 1,
                            height: '4px',
                            accentColor: '#d8a84e',
                            background: '#2a3140',
                            borderRadius: '2px',
                            appearance: 'auto',
                            cursor: transparentMode ? 'not-allowed' : 'pointer',
                        }}
                    />
                    <span style={{ color: '#e8e2d4', fontSize: '11px', width: '24px', textAlign: 'right' }}>{localOpacity}%</span>
                </div>
            )}

            {/* Footer: Hex Input */}
            <div style={{ display: 'flex', gap: '8px', minWidth: 0, paddingTop: '8px', borderTop: '1px solid #2a3140' }}>
                <div style={{
                    background: localHex,
                    width: '32px',
                    height: '32px',
                    flexShrink: 0,
                    borderRadius: '4px',
                    border: '1px solid #3a4252',
                    opacity: transparentMode ? 0 : (showOpacity ? localOpacity / 100 : 1)
                }} />
                <div style={{ flex: '1 1 auto', minWidth: 0, background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 8px', border: '1px solid #2a3140' }}>
                    <span style={{ color: '#5a6473', fontSize: '12px', marginRight: '4px' }}>#</span>
                    <input
                        type="text"
                        aria-label="Hex color"
                        value={localHex.replace('#', '')}
                        onChange={(e) => {
                            const val = e.target.value;
                            setLocalHex(`#${val}`);
                            const normalized = normalizeHexColor(val);
                            if (normalized) applyHex(normalized);
                        }}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#e8e2d4',
                            width: '100%',
                            minWidth: 0,
                            fontSize: '12px',
                            outline: 'none',
                            fontFamily: 'monospace'
                        }}
                    />
                </div>
                {showOpacity && (
                    <div style={{ background: '#111', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 6px', border: '1px solid #2a3140', width: '72px', flex: '0 0 72px' }}>
                        <input
                            type="number"
                            aria-label="Opacity percentage"
                            min="0"
                            max="100"
                            value={Math.round(localOpacity)}
                            onChange={(e) => {
                                const val = clampOpacityPercent(e.target.value, minOpacity);
                                commitRememberedOpacity(val);
                            }}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#e8e2d4',
                                flex: '1 1 auto',
                                minWidth: 0,
                                width: 'auto',
                                fontSize: '12px',
                                outline: 'none',
                                textAlign: 'center'
                            }}
                        />
                        <span style={{ color: '#5a6473', fontSize: '10px', flexShrink: 0 }}>%</span>
                    </div>
                )}
            </div>
        </div>
        </>
    );
};

export default CompactColorPicker;
