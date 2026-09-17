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

const PRESET_COLORS = [
    'transparent', '#FF0000', '#FF0080', '#FF00FF', // Transparent + Reds/Pinks
    '#8000FF', '#0000FF', '#0080FF', '#00FFFF',     // Purples/Blues
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00',     // Greens/Yellow
    '#FF8000', '#FFFFFF', '#808080', '#000000',     // Orange + Greys (light grey removed)
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Convert a #rrggbb hex into HSV so the spectrum view opens already pointed at
// the current colour. Returns null for non-hex input (named colours, rgba()).
const hexToHsv = (hex) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
};

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
    //   { kind: 'match', color }  — Match Fill picker; click snapshots the
    //     given color at full opacity. Lets the Border tab on shapes show a
    //     swatch that matches the current fill without ever offering zero
    //     opacity (shapes require a visible border).
    firstPreset = 'transparent',
    minOpacity = 0,
    dismissInsideSelector,
}) => {
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
            setHue(hsv.h);
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
        const f = (n, k = (n + h / 60) % 6) => v / 100 - v / 100 * s / 100 * Math.max(Math.min(k, 4 - k, 1), 0);
        const r = Math.round(f(5) * 255);
        const g = Math.round(f(3) * 255);
        const b = Math.round(f(1) * 255);

        const toHex = (c) => ('0' + c.toString(16)).slice(-2);
        const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

        setLocalHex(hex.toUpperCase());
        setTransparentMode(false);
        onChange(hex, localOpacity / 100);
    };

    // Apply a hex value coming from a preset swatch or the hex field — keeps the
    // spectrum's HSV indicators in step so switching views stays consistent.
    const applyHex = (hex) => {
        // Transparent preset: enter transparent mode (slider greys out) but
        // keep the slider's remembered value. Picking any other swatch
        // afterwards immediately renders that colour at the remembered
        // opacity, no manual slider bump needed.
        if (hex === 'transparent') {
            setTransparentMode(true);
            onChange(localHex, 0);
            return;
        }
        // Match Fill: snapshot the current fill colour at full opacity. Border
        // tab on shapes uses this so the user can lock the border to whatever
        // the fill currently is without picking from the spectrum.
        if (hex === '__match__' && matchFillColor) {
            setLocalHex(matchFillColor.toUpperCase());
            setLocalOpacity(Math.round(matchFillOpacity * 100));
            setTransparentMode(false);
            const hsv = hexToHsv(matchFillColor);
            if (hsv) {
                setHue(hsv.h);
                setSaturation(hsv.s);
                setValue(hsv.v);
            }
            onChange(matchFillColor, matchFillOpacity);
            return;
        }
        setLocalHex(hex);
        setTransparentMode(false);
        const hsv = hexToHsv(hex);
        if (hsv) {
            setHue(hsv.h);
            setSaturation(hsv.s);
            setValue(hsv.v);
        }
        // Respect a caller-supplied minimum opacity (Border tab on shapes
        // enforces minOpacity=1 so a border can never go fully invisible).
        const alpha = Math.max(minOpacity, localOpacity / 100);
        if (alpha !== localOpacity / 100) setLocalOpacity(alpha * 100);
        onChange(hex, alpha);
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
        let nextSaturation = saturation;
        let nextValue = value;
        switch (event.key) {
            case 'ArrowLeft': nextSaturation = clamp(saturation - 1, 0, 100); break;
            case 'ArrowRight': nextSaturation = clamp(saturation + 1, 0, 100); break;
            case 'ArrowUp': nextValue = clamp(value + 1, 0, 100); break;
            case 'ArrowDown': nextValue = clamp(value - 1, 0, 100); break;
            case 'PageUp': nextValue = clamp(value + 10, 0, 100); break;
            case 'PageDown': nextValue = clamp(value - 10, 0, 100); break;
            case 'Home': nextSaturation = 0; break;
            case 'End': nextSaturation = 100; break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        setSaturation(nextSaturation);
        setValue(nextValue);
        updateColorFromHSV(hue, nextSaturation, nextValue);
    };

    const handleHueKeyDown = (event) => {
        let nextHue = hue;
        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown': nextHue = clamp(hue - 1, 0, 360); break;
            case 'ArrowRight':
            case 'ArrowUp': nextHue = clamp(hue + 1, 0, 360); break;
            case 'PageDown': nextHue = clamp(hue - 10, 0, 360); break;
            case 'PageUp': nextHue = clamp(hue + 10, 0, 360); break;
            case 'Home': nextHue = 0; break;
            case 'End': nextHue = 360; break;
            default: return;
        }
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
            onDismiss={onClose}
        />
        <div
            ref={containerRef}
            data-modal-focus-layer="true"
            data-testid="compact-color-picker"
            style={{
            width: '260px',
            /* UX 2026-09-17 (revision-2 palette): the picker's CHROME comes from
               the token file like every other panel. Only the preset ink swatches
               and the checkerboard behind a transparent swatch stay literal —
               those are the user's colours, not the theme's. */
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
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
                <span style={{ color: 'var(--text-1)', fontSize: '13px', fontWeight: 600 }}>Color</span>
                {/* UX: a segmented control is a well (--surface-2) on the panel with the
                    chosen segment raised one step (--surface-3) and its glyph in gold,
                    the palette's own "this is the one you are on". The unchosen glyph is
                    --text-3 so the pair differ by ink as well as by fill. */}
                <div style={{ display: 'flex', gap: '4px', background: 'var(--surface-2)', padding: '2px', borderRadius: '4px' }}>
                    <button
                        type="button"
                        aria-label="Preset colors"
                        onClick={() => setMode('grid')}
                        style={{
                            background: mode === 'grid' ? 'var(--surface-3)' : 'transparent',
                            border: 'none',
                            borderRadius: '2px',
                            padding: '4px',
                            cursor: 'pointer',
                            color: mode === 'grid' ? 'var(--accent)' : 'var(--text-3)',
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
                            background: mode === 'spectrum' ? 'var(--surface-3)' : 'transparent',
                            border: 'none',
                            borderRadius: '2px',
                            padding: '4px',
                            cursor: 'pointer',
                            color: mode === 'spectrum' ? 'var(--accent)' : 'var(--text-3)',
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
                    {PRESET_COLORS.map((c, idx) => {
                        // 2026-05-25: Border tab on shapes swaps the first cell
                        // from Transparent to Match Fill — shows the current
                        // fill colour with a small chain glyph so the user can
                        // sync border to fill in one click. Everything else in
                        // the grid is unchanged.
                        const isMatchSlot = idx === 0 && isMatchFirst;
                        const presetValue = isMatchSlot ? '__match__' : c;
                        const isTransparent = !isMatchSlot && c === 'transparent';
                        const isSelected = isMatchSlot
                            ? (!transparentMode && matchFillColor && localHex.toLowerCase() === matchFillColor.toLowerCase() && localOpacity >= 99)
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
                                    border: isSelected ? '2px solid white' : '1px solid var(--border)',
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
                        <span style={{ color: 'var(--text-3)', fontSize: '10px', width: '20px' }}>HUE</span>
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
                        <span style={{ color: 'var(--text-2)', fontSize: '11px', width: '24px', textAlign: 'right' }}>{Math.round(hue)}°</span>
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
                    <span style={{ color: 'var(--text-3)', fontSize: '10px', width: '40px' }}>OPACITY</span>
                    <input
                        type="range"
                        min={Math.round(minOpacity * 100)}
                        max="100"
                        value={localOpacity}
                        disabled={transparentMode}
                        onChange={(e) => {
                            if (transparentMode) return;
                            const next = Math.max(minOpacity * 100, Number(e.target.value));
                            setLocalOpacity(next);
                            onChange(localHex, next / 100);
                        }}
                        style={{
                            flex: 1,
                            height: '4px',
                            accentColor: 'var(--accent)',
                            background: 'var(--surface-2)',
                            borderRadius: '2px',
                            appearance: 'auto',
                            cursor: transparentMode ? 'not-allowed' : 'pointer',
                        }}
                    />
                    <span style={{ color: 'var(--text-2)', fontSize: '11px', width: '24px', textAlign: 'right' }}>{localOpacity}%</span>
                </div>
            )}

            {/* Footer: Hex Input */}
            <div style={{ display: 'flex', gap: '8px', minWidth: 0, paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                <div style={{
                    background: localHex,
                    width: '32px',
                    height: '32px',
                    flexShrink: 0,
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                    opacity: transparentMode ? 0 : (showOpacity ? localOpacity / 100 : 1)
                }} />
                <div style={{ flex: '1 1 auto', minWidth: 0, background: 'var(--surface-0)', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 8px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-disabled)', fontSize: '12px', marginRight: '4px' }}>#</span>
                    <input
                        type="text"
                        value={localHex.replace('#', '')}
                        onChange={(e) => {
                            const val = e.target.value;
                            setLocalHex(`#${val}`);
                            if (val.length === 6) {
                                applyHex(`#${val}`);
                            }
                        }}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-1)',
                            width: '100%',
                            minWidth: 0,
                            fontSize: '12px',
                            outline: 'none',
                            fontFamily: 'monospace'
                        }}
                    />
                </div>
                {showOpacity && (
                    <div style={{ background: 'var(--surface-0)', borderRadius: '4px', display: 'flex', alignItems: 'center', padding: '0 6px', border: '1px solid var(--border)', width: '72px', flex: '0 0 72px' }}>
                        <input
                            type="number"
                            aria-label="Opacity percentage"
                            min="0"
                            max="100"
                            value={Math.round(localOpacity)}
                            onChange={(e) => {
                                const val = Math.min(100, Math.max(0, Number(e.target.value)));
                                setLocalOpacity(val);
                                onChange(localHex, val / 100);
                            }}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-1)',
                                flex: '1 1 auto',
                                minWidth: 0,
                                width: 'auto',
                                fontSize: '12px',
                                outline: 'none',
                                textAlign: 'center'
                            }}
                        />
                        <span style={{ color: 'var(--text-disabled)', fontSize: '10px', flexShrink: 0 }}>%</span>
                    </div>
                )}
            </div>
        </div>
        </>
    );
};

export default CompactColorPicker;
