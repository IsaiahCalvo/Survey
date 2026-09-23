/**
 * CompactColorPicker.jsx — the app's ONE shared colour picker.
 *
 * Every colour control in the app opens this component and no other: annotation
 * border and fill, counter pins, text colour, Survey entity colours. Each
 * instance keeps its own value; the component keeps no global state.
 *
 * THE LAYOUT IS BOARDS 17, 18 AND 19 (owner approved, pass 7, 2026-09-21), top
 * to bottom:
 *
 *   Border / Fill tabs        (only when the caller passes `tabs`)
 *   presets row, edge to edge (12 discs on the phone, 8 on the desktop)
 *   EITHER the grid           (12 or 8 square columns x 6 rows)
 *   OR     the gradient       (saturation/brightness area + hue slider)
 *   Opacity label + slider    (the gradient stacks its slider under the hue one)
 *   ONE bottom row            [Grid|Gradient] [eyedropper] [# hex] [opacity %]
 *
 * THE CHOSEN MARK IS NEVER GOLD (owner, verbatim): "a ring in the swatch's OWN
 * colour, a gap, and a white check in the middle", with a dark check on a light
 * cell. src/utils/quickStylePresets.js owns that decision so the picker's cells
 * and the toolbar's quick discs can never disagree about what "chosen" looks
 * like.
 *
 * WHAT DID NOT CHANGE, on purpose: the value contract (`onChange(hex, alpha)`
 * fires live as the user drags), the transparent / Match Fill first grid cell,
 * `minOpacity`, `showOpacity`, `attachedHeader`, `outsideBoundaryRef`,
 * `dismissInsideSelector`, the DismissBarrier first-tap dismissal, the
 * pointer-captured drags, and the keyboard handling on every slider.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import DismissBarrier from './DismissBarrier';
import { swatchCheckInk, swatchRingColour, needsSwatchHairline, normaliseQuickColour } from '../utils/quickStylePresets';

/*
 * The presets row, edge to edge. Boards 19 (desktop, 8) and 17/18 (phone, 12).
 * The first three are the toolbar's own quick colours, spelled with the same
 * hex, so a quick disc and the cell that looks identical set the same value —
 * tests/quickStyleRow.test.mjs pins that.
 */
const PRESET_COLORS = [
    '#FF0000', '#0000FF', '#000000', '#ffffff',
    '#f97316', '#22c55e', '#0ea5e9', '#a855f7',
];

const PHONE_PRESET_COLORS = [
    '#FF0000', '#0000FF', '#000000', '#ffffff',
    '#f97316', '#eab308', '#22c55e', '#0ea5e9',
    '#a855f7', '#ec4899', '#8b5a2b', '#6b7280',
];

/*
 * The grid. Six rows of one lightness each, one column per hue plus a
 * greyscale column on the right, exactly as boards 17 and 19 enumerate them:
 * the hue step is 360 / (columns - 1), the saturation is a flat 85%, and the
 * grey column runs on its own lightness ramp so it reaches real white and real
 * near-black rather than a washed grey.
 */
const GRID_LIGHTNESS = [88, 72, 56, 44, 32, 20];
const GRID_GREY_LIGHTNESS = [100, 80, 60, 45, 25, 8];
const GRID_SATURATION = 85;

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', sans-serif";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toHexPair = (channel) => `0${Math.round(clamp(channel, 0, 255)).toString(16)}`.slice(-2);

/** HSL to #rrggbb, so a grid cell hands the app a hex like every other cell. */
const hslToHex = (h, s, l) => {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = hp < 1 ? [c, x, 0]
        : hp < 2 ? [x, c, 0]
            : hp < 3 ? [0, c, x]
                : hp < 4 ? [0, x, c]
                    : hp < 5 ? [x, 0, c]
                        : [c, 0, x];
    const m = light - c / 2;
    return `#${toHexPair((r1 + m) * 255)}${toHexPair((g1 + m) * 255)}${toHexPair((b1 + m) * 255)}`;
};

/** The grid's cells, row by row, for a given column count. */
const buildGrid = (columns) => {
    const hues = columns - 1;
    return GRID_LIGHTNESS.map((lightness, row) => {
        const cells = [];
        for (let column = 0; column < hues; column += 1) {
            cells.push(hslToHex(Math.round((column * 360) / hues), GRID_SATURATION, lightness));
        }
        cells.push(hslToHex(0, 0, GRID_GREY_LIGHTNESS[row]));
        return cells;
    });
};

// Convert a #rrggbb hex into HSV so the gradient view opens already pointed at
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

const sameColour = (a, b) => Boolean(a) && Boolean(b)
    && normaliseQuickColour(a) === normaliseQuickColour(b);

/**
 * The chosen mark, from boards 1-12 and 17-19: a check on the swatch, drawn at
 * the weight the board draws it. A 1.5 stroke inside a 10px glyph renders at
 * half a device pixel and disappears, which is why DESIGN-SYSTEM.md allows a
 * small state glyph its own weight.
 */
const ChosenCheck = ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** The footer toggle's two glyphs, board 19. Both are filled, not stroked. */
const GridGlyph = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
);

const GradientGlyph = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M12 3L15 9L21 12L15 15L12 21L9 15L3 12L9 9L12 3Z" fill="currentColor" />
    </svg>
);

/** The eyedropper, from the boards' own review asset. Filled, no stroke. */
const EyedropperGlyph = () => (
    <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M224,67.3a35.79,35.79,0,0,0-11.26-25.66c-14-13.28-36.72-12.78-50.62,1.13L142.8,62.2a24,24,0,0,0-33.14.77l-9,9a16,16,0,0,0,0,22.64l2,2.06-51,51a39.75,39.75,0,0,0-10.53,38l-8,18.41A13.68,13.68,0,0,0,36,219.3a15.92,15.92,0,0,0,17.71,3.35L71.23,215a39.89,39.89,0,0,0,37.06-10.75l51-51,2.06,2.06a16,16,0,0,0,22.62,0l9-9a24,24,0,0,0,.74-33.18l19.75-19.87A35.75,35.75,0,0,0,224,67.3ZM97,193a24,24,0,0,1-24,6,8,8,0,0,0-5.55.31l-18.1,7.91L57,189.41a8,8,0,0,0,.25-5.75A23.88,23.88,0,0,1,63,159l51-51,33.94,34ZM202.13,82l-25.37,25.52a8,8,0,0,0,0,11.3l4.89,4.89a8,8,0,0,1,0,11.32l-9,9L112,83.26l9-9a8,8,0,0,1,11.31,0l4.89,4.89a8,8,0,0,0,11.33,0l24.94-25.09c7.81-7.82,20.5-8.18,28.29-.81a20,20,0,0,1,.39,28.7Z" />
    </svg>
);

/** The chequerboard behind a partly transparent opacity track (boards 17-19). */
const ALPHA_CHEQUER = 'repeating-conic-gradient(#6b7280 0 25%, #d1d5db 0 50%) 0 0 / 10px 10px';

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
 *  - platform     'desktop' (276px panel, 8 presets, 8 grid columns) or 'phone'
 *                 (full-width panel, 12 presets, 12 grid columns, 190px area)
 *  - tabs         optional { items: [{ id, label }], active, onSelect } — draws
 *                 the Border / Fill tablist inside the panel, boards 17-19
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
    platform = 'desktop',
    tabs = null,
    // Boards 17 and 18 draw the phone picker as the bottom SHEET'S own content:
    // the sheet paints the panel and pads it, and the presets row runs edge to
    // edge across the sheet's 358px band. A host that owns that sheet passes
    // chrome={false} so the picker adds no second panel and no second padding.
    // Left true by default so the picker always stands on its own when a host
    // just drops it on the page.
    chrome = true,
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
    const isPhone = platform === 'phone';
    const columns = isPhone ? 12 : 8;
    const presets = isPhone ? PHONE_PRESET_COLORS : PRESET_COLORS;
    const grid = useMemo(() => buildGrid(columns), [columns]);
    // RULED 2026-09-22 (owner): switching grid <-> spectrum must not change the
    // sheet's height or move the Opacity row and the bottom row. The spectrum
    // therefore takes EXACTLY the grid's box: its area is the grid's height
    // minus the hue track and the gap under it, so area + hue = grid. The grid
    // height is measured from the panel's width (square cells, 4px gaps, six
    // rows) rather than read from the DOM, so it is right before either view
    // has painted.
    const gridRef = useRef(null);
    const [gridHeight, setGridHeight] = useState(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const measure = () => {
            const w = el.getBoundingClientRect().width;
            if (!w) return;
            const cell = (w - (columns - 1) * 4) / columns;
            setGridHeight(6 * cell + 5 * 4);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [columns]);
    const HUE_TRACK_H = 12;
    const spectrumAreaHeight = gridHeight ? Math.max(96, gridHeight - HUE_TRACK_H - 10) : (isPhone ? 148 : 128);

    const isMatchFirst = firstPreset && typeof firstPreset === 'object' && firstPreset.kind === 'match';
    const matchFillColor = isMatchFirst ? (firstPreset.color || '#ffffff') : null;
    // 2026-05-25: When the parent supplies a fill opacity alongside the fill
    // colour, Match Fill snapshots both — border opacity locks to the fill
    // opacity in one click. Defaults to fully opaque when no opacity given.
    const matchFillOpacity = isMatchFirst
        ? (typeof firstPreset.opacity === 'number' ? Math.max(0, Math.min(1, firstPreset.opacity)) : 1)
        : 1;
    const [mode, setMode] = useState('grid'); // 'grid' or 'spectrum'
    /*
     * RULED 2026-09-22 (owner): switching Border <-> Fill (or Pin <-> Number,
     * or Text <-> anything) must not make the opacity thumb JUMP to the other
     * slot's value — it glides there, fast.
     *
     * This is PURELY VISUAL. `glideAlpha` only turns a CSS transition on for
     * one short beat; nothing that reaches `onChange` is interpolated, so the
     * annotation on the page still takes the new tab's real value on the very
     * first frame, exactly as before. A drag never glides (`alphaDragging`),
     * and prefers-reduced-motion never glides at all.
     */
    const ALPHA_GLIDE_MS = 200;
    const [glideAlpha, setGlideAlpha] = useState(false);
    const glideTimer = useRef(null);
    const alphaDragging = useRef(false);
    useEffect(() => () => clearTimeout(glideTimer.current), []);
    const startAlphaGlide = () => {
        if (typeof window === 'undefined') return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
        clearTimeout(glideTimer.current);
        setGlideAlpha(true);
        glideTimer.current = setTimeout(() => setGlideAlpha(false), ALPHA_GLIDE_MS + 60);
    };
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
    const alphaRef = useRef(null);
    const containerRef = useRef(null);
    const dismissInsideRefs = useMemo(
        () => outsideBoundaryRef ? [containerRef, outsideBoundaryRef] : [containerRef],
        [outsideBoundaryRef],
    );
    const svPointerId = useRef(null);
    const huePointerId = useRef(null);
    const alphaPointerId = useRef(null);

    // EyeDropper is Chromium-only. The button stays where the boards draw it —
    // "eyedropper, always visible, even in grid mode" — and is disabled with a
    // plain explanation elsewhere, so the footer never changes shape and the
    // control is never silently broken.
    const eyedropperSupported = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';

    // Keep the local hex AND the gradient's HSV in sync with the colour prop,
    // so opening the gradient view starts on the real current colour.
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
        // The thumb glides ONLY when the value arrived from outside — a tab
        // switch hands the picker the other slot's opacity. A drag or a key
        // press has already moved localOpacity to the same number by the time
        // the prop echoes back, so the difference is zero and nothing glides;
        // alphaDragging is the belt to that braces.
        if (!alphaDragging.current && Math.abs(Math.round(pct * 100) - Math.round(localOpacity)) >= 1) {
            startAlphaGlide();
        }
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

    const applyOpacityPercent = (next) => {
        const floor = Math.round(minOpacity * 100);
        const percent = clamp(Math.round(next), floor, 100);
        setLocalOpacity(percent);
        setTransparentMode(false);
        onChange(localHex, percent / 100);
    };

    // The opacity track is a real slider like hue, not an <input type=range>:
    // boards 17-19 draw a 12px chequered track with an 18px thumb, which no
    // browser's native range control can be made to look like.
    const handleAlphaChange = (e) => {
        const rect = alphaRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        applyOpacityPercent((x / rect.width) * 100);
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
    // gradient's HSV indicators in step so switching views stays consistent.
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
        // the fill currently is without picking from the gradient.
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

    const pickFromScreen = async () => {
        if (!eyedropperSupported) return;
        try {
            const result = await new window.EyeDropper().open();
            if (result?.sRGBHex) applyHex(result.sRGBHex);
        } catch {
            // The user pressed Escape, which cancels the pick. Nothing to do.
        }
    };

    // Pointer capture keeps both mouse and finger drags live when they leave
    // the small gradient/hue/opacity track. touchAction none prevents WebKit
    // from turning the same gesture into page panning after it has begun.
    const beginPointerDrag = (kind, event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (kind === 'sv') {
            svPointerId.current = event.pointerId;
            handleSVChange(event);
        } else if (kind === 'alpha') {
            alphaPointerId.current = event.pointerId;
            // A drag is instant: kill any glide in flight so the thumb never
            // lags the finger.
            alphaDragging.current = true;
            clearTimeout(glideTimer.current);
            setGlideAlpha(false);
            handleAlphaChange(event);
        } else {
            huePointerId.current = event.pointerId;
            handleHueChange(event);
        }
    };

    const movePointerDrag = (kind, event) => {
        const activeId = kind === 'sv' ? svPointerId.current
            : kind === 'alpha' ? alphaPointerId.current
                : huePointerId.current;
        if (activeId !== event.pointerId) return;
        event.preventDefault();
        if (kind === 'sv') handleSVChange(event);
        else if (kind === 'alpha') handleAlphaChange(event);
        else handleHueChange(event);
    };

    const endPointerDrag = (kind, event) => {
        const pointerRef = kind === 'sv' ? svPointerId
            : kind === 'alpha' ? alphaPointerId
                : huePointerId;
        if (pointerRef.current !== event.pointerId) return;
        pointerRef.current = null;
        if (kind === 'alpha') alphaDragging.current = false;
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

    const handleAlphaKeyDown = (event) => {
        const floor = Math.round(minOpacity * 100);
        let next = localOpacity;
        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown': next = localOpacity - 1; break;
            case 'ArrowRight':
            case 'ArrowUp': next = localOpacity + 1; break;
            case 'PageDown': next = localOpacity - 10; break;
            case 'PageUp': next = localOpacity + 10; break;
            case 'Home': next = floor; break;
            case 'End': next = 100; break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        applyOpacityPercent(next);
    };

    /* ------------------------------------------------------------- pieces */

    const panelBackground = 'var(--surface-1)';

    /**
     * The 18px white thumb both the hue and opacity tracks carry (board 18).
     *
     * The travel is inset by half the thumb so the thumb is flush with the
     * track's ends at 0% and 100% instead of hanging 9px outside the panel —
     * "nothing may spill, collide or clip", and 100% opacity is the default
     * every picker opens on. Every real slider is built this way.
     */
    const thumb = (percent, transition) => ({
        transition: transition || undefined,
        position: 'absolute',
        left: `calc(9px + (100% - 18px) * ${clamp(percent, 0, 100) / 100})`,
        top: '50%',
        width: '18px',
        height: '18px',
        margin: '-9px 0 0 -9px',
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
    });

    const track = {
        position: 'relative',
        height: '12px',
        borderRadius: '6px',
        cursor: 'pointer',
        touchAction: 'none',
    };

    const presetsRow = (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {presets.map((preset) => {
                const isSelected = !transparentMode && sameColour(localHex, preset);
                return (
                    <button
                        type="button"
                        key={preset}
                        /* This button's background IS the user's ink, so the
                           app-wide pressed fill in src/styles/states.css must
                           skip it — otherwise a press would paint theme grey
                           over the colour being chosen. states.css excludes it
                           by this attribute. */
                        data-ink-swatch="true"
                        aria-label={preset}
                        aria-pressed={isSelected}
                        title={preset}
                        onClick={() => applyHex(preset)}
                        style={{
                            width: '26px',
                            height: '26px',
                            padding: 0,
                            display: 'grid',
                            placeItems: 'center',
                            border: 0,
                            background: 'transparent',
                            flex: '0 0 auto',
                            cursor: 'pointer',
                        }}
                    >
                        <span style={{
                            display: 'grid',
                            placeItems: 'center',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: preset,
                            boxShadow: isSelected
                                ? `0 0 0 1.5px ${panelBackground}, 0 0 0 3px ${swatchRingColour(preset)}`
                                // UX: the resting hairline that lifts a dark
                                // preset ink off the dark panel. It rings a
                                // USER colour, so it uses the shared ink ring
                                // rather than a hand-typed white alpha.
                                : (needsSwatchHairline(preset) ? '0 0 0 1px var(--ink-ring)' : undefined),
                        }}>
                            {isSelected && (
                                <span style={{ color: swatchCheckInk(preset), lineHeight: 0 }}>
                                    <ChosenCheck size={12} />
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    const gridView = (
        <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: '4px',
            width: '100%',
        }}>
            {grid.flatMap((row, rowIndex) => row.map((cell, columnIndex) => {
                // 2026-05-25: Border tab on shapes swaps the first cell from
                // Transparent to Match Fill — shows the current fill colour with
                // a small chain glyph so the user can sync border to fill in one
                // click. Everything else in the grid is unchanged.
                const isFirstCell = rowIndex === 0 && columnIndex === 0;
                const isMatchSlot = isFirstCell && isMatchFirst;
                const isTransparent = isFirstCell && !isMatchFirst;
                const presetValue = isMatchSlot ? '__match__' : (isTransparent ? 'transparent' : cell);
                const swatch = isMatchSlot ? matchFillColor : cell;
                const isSelected = isMatchSlot
                    ? (!transparentMode && matchFillColor && sameColour(localHex, matchFillColor) && localOpacity >= 99)
                    : isTransparent
                        ? transparentMode
                        : (!transparentMode && sameColour(localHex, cell));
                const background = isTransparent
                    ? {
                        backgroundColor: '#ffffff',
                        backgroundImage:
                            'linear-gradient(45deg, #cfcfcf 25%, transparent 25%),'
                            + 'linear-gradient(-45deg, #cfcfcf 25%, transparent 25%),'
                            + 'linear-gradient(45deg, transparent 75%, #cfcfcf 75%),'
                            + 'linear-gradient(-45deg, transparent 75%, #cfcfcf 75%)',
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                    }
                    : { background: swatch };
                const title = isMatchSlot ? 'Match fill' : (isTransparent ? 'Transparent' : cell);
                return (
                    <button
                        type="button"
                        key={`${rowIndex}-${columnIndex}`}
                        /* Ink, not chrome — see the sibling swatch above. */
                        data-ink-swatch="true"
                        title={title}
                        aria-label={title}
                        aria-pressed={Boolean(isSelected)}
                        onClick={() => applyHex(presetValue)}
                        style={{
                            position: 'relative',
                            aspectRatio: '1',
                            border: 0,
                            borderRadius: '5px',
                            ...background,
                            boxShadow: isSelected
                                ? `0 0 0 2px ${panelBackground}, 0 0 0 3.5px ${swatchRingColour(isTransparent ? '#ffffff' : swatch)}`
                                : undefined,
                            display: 'grid',
                            placeItems: 'center',
                            padding: 0,
                            cursor: 'pointer',
                        }}
                    >
                        {isMatchSlot && (
                            <span style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                lineHeight: 1,
                                color: 'rgba(0,0,0,0.75)',
                                textShadow: '0 0 2px rgba(255,255,255,0.85), 0 0 1px rgba(255,255,255,0.85)',
                                letterSpacing: '-0.5px',
                                pointerEvents: 'none',
                            }}>≡</span>
                        )}
                        {isSelected && !isMatchSlot && !isTransparent && (
                            <span style={{ color: swatchCheckInk(swatch), lineHeight: 0 }}>
                                <ChosenCheck size={13} />
                            </span>
                        )}
                    </button>
                );
            }))}
        </div>
    );

    const opacityTrack = (labelled) => (
        <div
            ref={alphaRef}
            data-color-picker-opacity="true"
            role="slider"
            tabIndex={transparentMode ? -1 : 0}
            aria-label="Opacity"
            aria-orientation="horizontal"
            aria-valuemin={Math.round(minOpacity * 100)}
            aria-valuemax={100}
            aria-valuenow={Math.round(localOpacity)}
            aria-valuetext={`${Math.round(localOpacity)} percent`}
            aria-disabled={transparentMode || undefined}
            aria-description="Arrow keys adjust opacity by one percent. Page Up and Page Down adjust it by ten percent. Home and End set the minimum and maximum."
            onKeyDown={transparentMode ? undefined : handleAlphaKeyDown}
            onPointerDown={transparentMode ? undefined : ((event) => beginPointerDrag('alpha', event))}
            onPointerMove={transparentMode ? undefined : ((event) => movePointerDrag('alpha', event))}
            onPointerUp={transparentMode ? undefined : ((event) => endPointerDrag('alpha', event))}
            onPointerCancel={transparentMode ? undefined : ((event) => endPointerDrag('alpha', event))}
            onLostPointerCapture={() => { alphaPointerId.current = null; alphaDragging.current = false; }}
            className="picker-alpha-track"
            style={{
                ...track,
                /* The ink is a REGISTERED custom property (styles.css
                   @property --picker-alpha-ink), so the track's tint can be
                   transitioned like any other colour. Without the
                   registration a gradient stop cannot animate at all. */
                '--picker-alpha-ink': localHex,
                background: 'linear-gradient(to right, transparent, var(--picker-alpha-ink)),'
                    + ` ${ALPHA_CHEQUER}`,
                transition: glideAlpha
                    ? `--picker-alpha-ink ${ALPHA_GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
                    : 'none',
                opacity: transparentMode ? 0.4 : 1,
                cursor: transparentMode ? 'not-allowed' : 'pointer',
                marginTop: labelled ? 0 : undefined,
            }}
        >
            <span style={thumb(
                localOpacity,
                glideAlpha ? `left ${ALPHA_GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : undefined,
            )} />
        </div>
    );

    const gradientView = (
        <>
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
                    position: 'relative',
                    width: '100%',
                    height: `${spectrumAreaHeight}px`,
                    /* ONE RADIUS SCALE (2026-09-22): the spectrum takes the
                       grid's box, so it takes a surface radius, 9. Was 10,
                       which is the PILL radius and means something else. */
                    borderRadius: '9px',
                    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))`,
                    cursor: 'crosshair',
                    touchAction: 'none',
                }}
            >
                {/* Inset by half the handle, for the same reason as the track
                    thumbs: at full saturation the handle would otherwise hang
                    8px outside the panel. */}
                <span style={{
                    position: 'absolute',
                    left: `calc(8px + (100% - 16px) * ${clamp(saturation, 0, 100) / 100})`,
                    top: `calc(8px + (100% - 16px) * ${clamp(100 - value, 0, 100) / 100})`,
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: '2.5px solid #fff',
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                }} />
            </div>

            {/* RULED 2026-09-22: only the hue track lives under the area. The
                opacity slider keeps its labelled row below, in the same place
                it has in grid mode, so the two views differ only inside the
                grid's box. */}
            <div style={{ display: 'grid', gap: '10px' }}>
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
                        ...track,
                        background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
                    }}
                >
                    <span style={thumb((hue / 360) * 100)} />
                </div>
            </div>
        </>
    );

    const fieldChrome = {
        height: '30px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        color: 'var(--text-1)',
        background: 'var(--surface-2)',
        // A FIELD (the hex box with its eyedropper and alpha cells): its edge is
        // what says "you can type in here", so it takes the identifying rule.
        // The hairlines INSIDE it stay subtle — they only divide its cells.
        border: '1px solid var(--border-strong)',
        /* ONE RADIUS SCALE (2026-09-22): a 30px control is a button, 6. Was 8. */
        borderRadius: '6px',
        overflow: 'hidden',
        font: `600 12px/1 ${FONT}`,
        fontVariant: 'tabular-nums',
        flex: '1 1 0',
        minWidth: 0,
    };

    const modeTab = (id, label, glyph) => {
        const on = mode === id;
        return (
            <button
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={label}
                title={label}
                onClick={() => setMode(id)}
                style={{
                    flex: 1,
                    /* UX 2026-09-22 (desktop critic round): ONE height across
                       the picker's bottom row. The row held three: this toggle
                       well came to 28 (24 + a 2px inset each side), the joined
                       hex field is 30, and the eyedropper inside it asked for a
                       fourth. A row of controls that all do the same job must
                       sit on one baseline, so the segment is 26 and its well is
                       the field's 30. */
                    height: '26px',
                    display: 'grid',
                    placeItems: 'center',
                    border: 0,
                    /* ONE RADIUS SCALE (2026-09-22): a button is 6; 5 is the
                       grid CELL radius and belongs to the grid alone. */
                    borderRadius: '6px',
                    color: on ? 'var(--text-1)' : 'var(--text-3)',
                    background: on ? 'var(--surface-3)' : 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                }}
            >
                {glyph}
            </button>
        );
    };

    /* ------------------------------------------------------------- render */

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
            data-color-picker-platform={platform}
            style={{
            /* Board 19: a 276px panel inside the 308px stage. The phone sheet
               fills its host's width instead (boards 17/18 draw it at the
               sheet's own 358px content band). */
            width: isPhone ? '100%' : '276px',
            maxWidth: '100%',
            boxSizing: 'border-box',
            /* UX 2026-09-17 (revision-2 palette): the picker's CHROME comes from
               the token file like every other panel. Only the preset ink swatches
               and the checkerboard behind a transparent swatch stay literal —
               those are the user's colours, not the theme's. --surface-1 is the
               boards' own --ui-toolbar, and the ring gaps are painted in it. */
            background: chrome ? panelBackground : 'transparent',
            border: chrome ? '1px solid var(--border)' : 0,
            borderTop: attachedHeader ? 'none' : undefined,
            /* ONE RADIUS SCALE (2026-09-22): a popover is 9. Board 19 drew 12,
               but every other popover in the chrome (the dropdown menus) is 9
               and the owner ruled one scale over one board's number. */
            borderRadius: attachedHeader ? '0 0 9px 9px' : '9px',
            boxShadow: chrome ? '0 14px 32px rgba(0,0,0,0.45)' : 'none',
            padding: chrome ? '12px' : 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            userSelect: 'none',
            marginRight
        }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Border / Fill tabs, boards 17-19. A 26px segment in a 3px well;
                the chosen one is a raised --surface-3 segment with --text-1 ink,
                which is the tab component the boards drew. */}
            {tabs?.items?.length > 0 && (
                <div role="tablist" style={{
                    display: 'flex',
                    gap: '2px',
                    padding: '3px',
                    background: 'var(--surface-2)',
                    /* ONE RADIUS SCALE (2026-09-22): pills 10, sheet tops 16,
                       popovers and the wells on them 9, cells 5, buttons 6.
                       This well was 8. */
                    borderRadius: '9px',
                }}>
                    {tabs.items.map((item) => {
                        const on = tabs.active === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={on}
                                onClick={() => tabs.onSelect?.(item.id)}
                                style={{
                                    flex: 1,
                                    height: '26px',
                                    border: 0,
                                    borderRadius: '6px',
                                    color: on ? 'var(--text-1)' : 'var(--text-3)',
                                    background: on ? 'var(--surface-3)' : 'transparent',
                                    font: `600 12px/1 ${FONT}`,
                                    cursor: 'pointer',
                                    padding: 0,
                                }}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {presetsRow}

            {mode === 'grid' ? gridView : gradientView}

            {/* The labelled opacity row sits in the same place in both views
                (RULED 2026-09-22: the sheet must not grow or rearrange when the
                grid becomes the spectrum). */}
            {showOpacity && (
                <div style={{ display: 'grid', gap: '6px' }}>
                    <div style={{ color: 'var(--text-3)', font: `600 11px/1 ${FONT}` }}>Opacity</div>
                    {opacityTrack(true)}
                </div>
            )}

            {/* ONE bottom row: the view toggle, then the eyedropper, hex and
                opacity in a single joined field. Boards 17-19. */}
            <div className="picker-footer" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                <div role="tablist" style={{
                    display: 'flex',
                    gap: '2px',
                    padding: '2px',
                    background: 'var(--surface-2)',
                    /* ONE RADIUS SCALE (2026-09-22): was 7. */
                    borderRadius: '9px',
                    width: '64px',
                    flex: '0 0 64px',
                    /* UX 2026-09-22: 30px, the same as the hex field beside it —
                       see the segment height below. */
                    height: '30px',
                    boxSizing: 'border-box',
                }}>
                    {modeTab('grid', 'Preset colors', <GridGlyph />)}
                    {modeTab('spectrum', 'Color spectrum', <GradientGlyph />)}
                </div>
                <div style={fieldChrome}>
                    <button
                        type="button"
                        aria-label="Pick a color from the page"
                        title={eyedropperSupported
                            ? 'Pick a color from the page'
                            : 'Picking a color from the page needs Chrome or Edge'}
                        disabled={!eyedropperSupported}
                        onClick={pickFromScreen}
                        style={{
                            width: '34px',
                            /* UX 2026-09-22: fill the field's inner box instead
                               of asking for 30 inside a 28px content area —
                               that overflow was the third height in this row and
                               only `overflow: hidden` was keeping it tidy. */
                            height: '100%',
                            padding: 0,
                            display: 'grid',
                            placeItems: 'center',
                            background: 'transparent',
                            border: 0,
                            borderRight: '1px solid var(--border)',
                            flex: '0 0 34px',
                            color: 'var(--text-2)',
                            opacity: eyedropperSupported ? 1 : 0.4,
                            cursor: eyedropperSupported ? 'pointer' : 'default',
                        }}
                    >
                        <EyedropperGlyph />
                    </button>
                    <span style={{ padding: '0 9px', color: 'var(--text-3)' }}>#</span>
                    <input
                        type="text"
                        aria-label="Hex color"
                        spellCheck="false"
                        value={localHex.replace('#', '')}
                        onChange={(e) => {
                            const val = e.target.value;
                            setLocalHex(`#${val}`);
                            if (val.length === 6) {
                                applyHex(`#${val}`);
                            }
                        }}
                        style={{
                            flex: '1 1 0',
                            minWidth: 0,
                            height: '100%',
                            padding: 0,
                            color: 'inherit',
                            background: 'transparent',
                            border: 0,
                            font: 'inherit',
                            outline: 'none',
                        }}
                    />
                    {showOpacity && (
                        <>
                            <input
                                type="text"
                                inputMode="numeric"
                                aria-label="Opacity percentage"
                                value={Math.round(localOpacity)}
                                onChange={(e) => {
                                    const digits = e.target.value.replace(/[^0-9]/g, '');
                                    if (!digits) return;
                                    applyOpacityPercent(Number(digits));
                                }}
                                style={{
                                    width: '42px',
                                    flex: '0 0 42px',
                                    height: '100%',
                                    padding: '0 2px',
                                    color: 'inherit',
                                    background: 'transparent',
                                    border: 0,
                                    borderLeft: '1px solid var(--border)',
                                    font: 'inherit',
                                    textAlign: 'center',
                                    outline: 'none',
                                }}
                            />
                            <span style={{ paddingRight: '9px', color: 'var(--text-3)', flexShrink: 0 }}>%</span>
                        </>
                    )}
                </div>
            </div>
        </div>
        </>
    );
};

export default CompactColorPicker;
