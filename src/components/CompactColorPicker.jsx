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
 * fires live as the user drags — once per frame at most since 2026-09-23, with
 * a third `{ phase }` argument during a drag; see "UX 2026-09-23" below), the transparent / Match Fill first grid cell,
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

/*
 * RULED 2026-09-23 (owner, desktop popover: "everything smaller ... put back
 * those options, but shrink down the grid so that it still fits"). The desktop
 * keeps the same eight presets and the same 8 x 6 grid, on a smaller scale:
 * 20px cells on the grid's 4px gap, so the grid and everything under it is
 * 8 * 20 + 7 * 4 = 188px wide, inside 10px of padding and a 1px edge — a
 * 210px popover, down from board 19's 276px.
 */
const DESKTOP_CELL = 20;
const DESKTOP_CONTENT_W = 8 * DESKTOP_CELL + 7 * 4;
const DESKTOP_PANEL_W = DESKTOP_CONTENT_W + 2 * 10 + 2;

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
const GridGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
);

const GradientGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M12 3L15 9L21 12L15 15L12 21L9 15L3 12L9 9L12 3Z" fill="currentColor" />
    </svg>
);

/** The eyedropper, from the boards' own review asset. Filled, no stroke. */
const EyedropperGlyph = ({ size = 17 }) => (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M224,67.3a35.79,35.79,0,0,0-11.26-25.66c-14-13.28-36.72-12.78-50.62,1.13L142.8,62.2a24,24,0,0,0-33.14.77l-9,9a16,16,0,0,0,0,22.64l2,2.06-51,51a39.75,39.75,0,0,0-10.53,38l-8,18.41A13.68,13.68,0,0,0,36,219.3a15.92,15.92,0,0,0,17.71,3.35L71.23,215a39.89,39.89,0,0,0,37.06-10.75l51-51,2.06,2.06a16,16,0,0,0,22.62,0l9-9a24,24,0,0,0,.74-33.18l19.75-19.87A35.75,35.75,0,0,0,224,67.3ZM97,193a24,24,0,0,1-24,6,8,8,0,0,0-5.55.31l-18.1,7.91L57,189.41a8,8,0,0,0,.25-5.75A23.88,23.88,0,0,1,63,159l51-51,33.94,34ZM202.13,82l-25.37,25.52a8,8,0,0,0,0,11.3l4.89,4.89a8,8,0,0,1,0,11.32l-9,9L112,83.26l9-9a8,8,0,0,1,11.31,0l4.89,4.89a8,8,0,0,0,11.33,0l24.94-25.09c7.81-7.82,20.5-8.18,28.29-.81a20,20,0,0,1,.39,28.7Z" />
    </svg>
);

/* Every control that OPENS a colour picker (not the swatches inside one). */
const COLOUR_TRIGGER_SELECTOR = [
    'button[title="Edit color"]',
    'button[aria-label="Edit color"]',
    'button[title="Text color"]',
    'button[title="Font color"]',
    'button[title="Text markup color and opacity"]',
    'button[aria-label="Open Text color picker"]',
    '.quick-style__swatch',
    '.quick-style__dot--custom',
    '.mobile-pdf-tool-sheet__swatch',
    '.mobile-pdf-properties__color',
    '.mobile-survey-detail-swatch-btn',
    // A text field outside the picker (an entity name, a title): the tap closes
    // the picker AND lands in the field, so you can type at once (owner
    // 2026-09-23: "I shouldn't have to click twice").
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])',
    'textarea',
    '[contenteditable="true"]',
].join(', ');

/* The see-through swatch: a checkerboard of paper colours (user ink, not chrome). */
const CHECKER_FILL = {
    backgroundColor: '#ffffff',
    backgroundImage:
        'linear-gradient(45deg, #cfcfcf 25%, transparent 25%),'
        + 'linear-gradient(-45deg, #cfcfcf 25%, transparent 25%),'
        + 'linear-gradient(45deg, transparent 75%, #cfcfcf 75%),'
        + 'linear-gradient(-45deg, transparent 75%, #cfcfcf 75%)',
    backgroundSize: '8px 8px',
    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
};

/** Match fill as a LINK (Templates entities): two chain links, stroked. */
const LinkGlyph = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** The chequerboard behind a partly transparent opacity track (boards 17-19). */
const ALPHA_CHEQUER = 'repeating-conic-gradient(#6b7280 0 25%, #d1d5db 0 50%) 0 0 / 10px 10px';
// The desktop's 6px band takes a 6px chequer (two 3px squares tall), so the
// pattern still reads as a chequer instead of a cut-off stripe.
const ALPHA_CHEQUER_DESKTOP = 'repeating-conic-gradient(#6b7280 0 25%, #d1d5db 0 50%) 0 0 / 6px 6px';

/**
 * CompactColorPicker — the app's one shared colour picker.
 *
 * Props:
 *  - color        current hex colour
 *  - opacity      current opacity 0..1 (default 1)
 *  - onChange(hex, alpha, meta) — meta is { phase: "preview" | "commit" } during
 *                 a slider drag (see "UX 2026-09-23" below), undefined otherwise
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
    denseLayout,
    // UX 2026-09-23 (owner, Templates entity Border tab): the value follows
    // something else — the entity's border is matched to its fill. Every
    // control dims and stops answering EXCEPT the tabs and the Match fill
    // cell, which is how the user turns the link back off. The grid is shown
    // while locked so that cell is always on screen.
    locked = false,
}) => {
    const isPhone = platform === 'phone';
    /*
     * UX 2026-09-23 (owner, Templates entity colour panel on the desktop:
     * "resize these things so everything doesn't look so bulky and everything
     * looks like it fits neatly"). A desktop host that paints the panel itself
     * (chrome={false}) sits in a ~250px column with 234px of content, not the
     * 276px popover the boards drew. It gets the DENSE sizes: one 8px rhythm
     * between blocks, 22px tabs and swatches, 14px round sliders and a 26px
     * bottom row whose hex stays fully readable. (Superseded on the desktop
     * by the slim scale below; the phone keeps its board-17/18 sizes.)
     */
    // denseLayout lets a host ask for the compact sizes on the phone (the
    // Templates Entities sheet); undefined keeps the full phone sizes.
    /*
     * RULED 2026-09-23 (owner, desktop popover: "too big ... sliders way too
     * thick, input field too thick, text too thick ... not so bulky"; then
     * "put back those options, but shrink down the grid"). EVERY desktop picker — the canvas popover (chrome on) and the
     * Templates entity panel (chrome off) — now takes one slim desktop scale,
     * which replaces both the old 276px board-19 sizes and the old desktop
     * dense sizes. `dense` is therefore a PHONE-only switch now (the Templates
     * Entities sheet); the phone's own board-17/18 sizes are untouched.
     */
    const isDesktop = !isPhone;
    const dense = isPhone && denseLayout === true;
    const PANEL_GAP = isDesktop ? 8 : (dense ? 8 : 10);
    const THUMB_SIZE = isDesktop ? 12 : (dense ? 12 : 16);
    // The thumb's centre travels this far in from each round end. On the
    // desktop the thumb is wider than the thin track, so its travel is inset
    // by exactly half the thumb: flush with the ends at 0% and 100%.
    const THUMB_INSET = isDesktop ? 6 : (dense ? 8 : 10);
    const columns = isPhone ? 12 : 8;
    const presets = isPhone ? PHONE_PRESET_COLORS : PRESET_COLORS;
    const grid = useMemo(() => buildGrid(columns), [columns]);
    // RULED 2026-09-22 (owner): switching grid <-> spectrum must not change the
    // sheet's height or move the Opacity row and the bottom row. The spectrum
    // therefore takes EXACTLY the grid's box: its area is the grid's height
    // minus the hue track and the gap under it, so area + hue = grid. The grid
    // height is measured from the panel's CONTENT width (square cells, 4px
    // gaps, six rows) rather than read from the DOM, so it is right
    // before either view has painted. The panel's own padding is taken off
    // first — it used to be counted, which made the desktop spectrum taller
    // than the grid it replaces.
    const gridRef = useRef(null);
    const [gridHeight, setGridHeight] = useState(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const measure = () => {
            const style = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : null;
            const pad = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
            const w = (el.clientWidth || el.getBoundingClientRect().width) - pad;
            if (!w || w <= 0) return;
            const cell = (w - (columns - 1) * 4) / columns;
            setGridHeight(6 * cell + 5 * 4);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [columns]);
    // UX 2026-09-23 (owner: sliders like 21st.dev micka_design color-picker):
    // an 18px fully-round track. The spectrum still takes grid - track - gap.
    // RULED 2026-09-23 (owner: desktop sliders "way too thick"): on the
    // desktop the track PAINTS only 6px, centred in a 16px box that is still
    // the slider — so it stays easy to grab with a mouse while looking thin.
    const HUE_TRACK_H = isDesktop ? 16 : (dense ? 14 : 18);
    const TRACK_PAINT_PAD = isDesktop ? 5 : 0;
    const spectrumAreaHeight = gridHeight ? Math.max(96, gridHeight - HUE_TRACK_H - PANEL_GAP) : (isPhone ? 148 : 128);

    const isMatchFirst = firstPreset && typeof firstPreset === 'object' && firstPreset.kind === 'match';
    const matchFillColor = isMatchFirst ? (firstPreset.color || '#ffffff') : null;
    // A Match fill cell with `onToggle` is a persistent LINK (Templates
    // entities), not a one-shot snapshot (canvas shapes): clicking it calls the
    // host, and it reads as chosen while `linked` is true.
    const matchIsToggle = isMatchFirst && typeof firstPreset.onToggle === 'function';
    // The first grid cell MORPHS between see-through (Fill tab) and the Match
    // fill link (Border tab) both ways (owner 2026-09-23: switching back "just
    // snaps"). The link layer stays mounted and scales/fades, so it needs the
    // last colour it showed while it fades out on the Fill tab.
    const lastMatchRef = useRef({ color: '#ffffff', toggle: false });
    if (isMatchFirst) lastMatchRef.current = { color: matchFillColor, toggle: matchIsToggle };
    // Flip the layer on/off a frame AFTER it mounts, so even the first visit to
    // the Border tab animates in rather than appearing already grown.
    const [morphOn, setMorphOn] = useState(false);
    useEffect(() => {
        const next = Boolean(isMatchFirst && matchIsToggle);
        if (typeof requestAnimationFrame !== 'function') { setMorphOn(next); return undefined; }
        const frame = requestAnimationFrame(() => setMorphOn(next));
        return () => cancelAnimationFrame(frame);
    }, [isMatchFirst, matchIsToggle]);
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
    // The hover readout: { kind: 'hue'|'alpha', x, value } while a mouse rests
    // over a track (not while dragging). Only the number shows — the source
    // component's cursor-following wash is left out on purpose (owner).
    const [readout, setReadout] = useState(null);
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

    /*
     * UX 2026-09-23 (owner: "Dragging this is laggy ... make sure this
     * animation across all color pickers, even any slider in general, is super
     * smooth"). A DRAG on the spectrum, hue or opacity slider moves the thumb,
     * the readout and the swatch from this picker's own state on every pointer
     * event — that is cheap, and it is all the eye tracks. What the drag does
     * to the rest of the app (repainting the selected mark, saving it) is the
     * expensive part, so it is published upstream at most ONCE PER FRAME, and
     * less often still when the host is slow: after a publish that took N ms
     * the next one waits at least N ms, so the host can never take more than
     * half of the main thread away from the thumb. The value under the pointer
     * when the drag ends is ALWAYS delivered, on release, so nothing is lost.
     *
     * The third onChange argument tells a host which is which:
     *   { phase: 'preview' } — the drag is still going; show it, do not record it
     *   { phase: 'commit' }  — the drag ended on this value; record it once
     * Clicks and key presses pass no third argument, exactly as before, and
     * hosts that ignore the argument simply see fewer, coalesced calls.
     * Reference: every native range control and Figma/Procreate sliders —
     * the thumb stays under the finger and the canvas follows as fast as it can.
     */
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const dragEmit = useRef({ active: false, latest: null, pending: false, frame: 0, notBefore: 0, emittedAt: 0 });
    const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // One frame loop runs while a drag has work: it publishes the newest value
    // when the host is ready, and it times the frame right after each publish.
    const scheduleDragEmit = () => {
        const state = dragEmit.current;
        if (state.frame || typeof requestAnimationFrame !== 'function') return;
        const tick = () => {
            state.frame = 0;
            if (!state.active) return;
            const now = clock();
            // Adaptive back-off. Most of a publish's cost lands AFTER the call
            // returns (the host re-renders the page and saves), so it shows up
            // as a long frame right after it. Wait out the part beyond a
            // normal frame before publishing again: a slow host gets at most
            // about half the main thread, and the thumb keeps the rest.
            if (state.emittedAt) {
                const cost = now - state.emittedAt;
                if (cost > 20) state.notBefore = Math.max(state.notBefore, now + (cost - 16));
                state.emittedAt = 0;
            }
            if (!state.pending) return;
            if (now < state.notBefore) { state.frame = requestAnimationFrame(tick); return; }
            state.pending = false;
            emitNow(state.latest, 'preview');
        };
        state.frame = requestAnimationFrame(tick);
    };
    const emitNow = (args, phase) => {
        const fn = onChangeRef.current;
        if (typeof fn !== 'function') return;
        const start = clock();
        fn(args[0], args[1], { phase });
        const end = clock();
        const state = dragEmit.current;
        if (phase !== 'preview' || !state.active) return;
        // The call itself counts too, and the next frame times what followed.
        state.notBefore = end + (end - start);
        state.emittedAt = end;
        scheduleDragEmit();
    };
    // Every value change goes through here. Outside a drag it is the plain,
    // immediate onChange it always was.
    const publish = (hex, alpha) => {
        const state = dragEmit.current;
        if (!state.active) {
            onChangeRef.current?.(hex, alpha);
            return;
        }
        const first = !state.latest;
        state.latest = [hex, alpha];
        // The press itself answers at once, so a click on the track is felt
        // immediately; only the moves after it are coalesced.
        if (first || typeof requestAnimationFrame !== 'function') { emitNow(state.latest, 'preview'); return; }
        state.pending = true;
        scheduleDragEmit();
    };
    const startDragEmit = () => {
        const state = dragEmit.current;
        if (state.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
        dragEmit.current = { active: true, latest: null, pending: false, frame: 0, notBefore: 0, emittedAt: 0 };
        // Belt to the track's own pointerup: if the track is swapped out or
        // loses its handlers mid-drag (a view or tab change), its lost-capture
        // event never reaches React, so the release is also heard here.
        if (typeof window !== 'undefined') {
            const end = () => finishDragEmitRef.current();
            window.addEventListener('pointerup', end, true);
            window.addEventListener('pointercancel', end, true);
            dragEmit.current.detach = () => {
                window.removeEventListener('pointerup', end, true);
                window.removeEventListener('pointercancel', end, true);
            };
        }
    };
    // Idempotent: pointerup, pointercancel, lost capture and unmount all end
    // the drag, and whichever comes first delivers the released value once.
    const finishDragEmit = () => {
        const state = dragEmit.current;
        if (!state.active) return;
        state.active = false;
        state.pending = false;
        state.detach?.();
        if (state.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
        state.frame = 0;
        if (state.latest) emitNow(state.latest, 'commit');
    };
    const finishDragEmitRef = useRef(finishDragEmit);
    finishDragEmitRef.current = finishDragEmit;
    useEffect(() => () => finishDragEmitRef.current(), []);

    // EyeDropper is Chromium-only. The button stays where the boards draw it —
    // "eyedropper, always visible, even in grid mode" — and is disabled with a
    // plain explanation elsewhere, so the footer never changes shape and the
    // control is never silently broken.
    const eyedropperSupported = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';

    // Keep the local hex AND the gradient's HSV in sync with the colour prop,
    // so opening the gradient view starts on the real current colour.
    useEffect(() => {
        // Mid-drag the host echoes back values the picker already shows — and,
        // since publishing is coalesced, sometimes an OLDER one than the thumb
        // is at. Taking it would pull the thumb backwards under the pointer.
        // The picker's own state is the truth until the drag is released.
        if (dragEmit.current.active) return;
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
        // See the colour sync above: a mid-drag echo never moves the thumb.
        if (dragEmit.current.active) return;
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

    const trackFraction = (el, clientX) => {
        const rect = el.getBoundingClientRect();
        const travel = Math.max(1, rect.width - 2 * THUMB_INSET);
        return clamp((clientX - rect.left - THUMB_INSET) / travel, 0, 1);
    };

    // Handle Hue Change
    const handleHueChange = (e) => {
        // The thumb travels 10px in from each round end, so the value under
        // the cursor is measured on that same inner run — the click, the thumb
        // and the hover number always agree (owner 2026-09-23).
        const newHue = trackFraction(hueRef.current, e.clientX) * 360;
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
        publish(localHex, percent / 100);
    };

    // The opacity track is a real slider like hue, not an <input type=range>:
    // boards 17-19 draw a 12px chequered track with an 18px thumb, which no
    // browser's native range control can be made to look like.
    const handleAlphaChange = (e) => {
        applyOpacityPercent(trackFraction(alphaRef.current, e.clientX) * 100);
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
        publish(hex, localOpacity / 100);
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
        if (hex === '__match__' && matchIsToggle) {
            firstPreset.onToggle();
            return;
        }
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
        // One drag at a time: a second finger landing mid-drag is ignored
        // rather than stealing (and never committing) the first one's drag.
        if (dragEmit.current.active) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startDragEmit();
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
        finishDragEmit();
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
    // UX 2026-09-23 (owner, micka_design reference): a 16px thumb filled with
    // the LIVE colour, a thin white edge and a soft shadow, travelling inset
    // by 10px so it never reaches past the track's round ends.
    const thumb = (percent, transition, fill = '#fff') => ({
        transition: transition || undefined,
        position: 'absolute',
        left: `calc(${THUMB_INSET}px + (100% - ${2 * THUMB_INSET}px) * ${clamp(percent, 0, 100) / 100})`,
        top: '50%',
        width: `${THUMB_SIZE}px`,
        height: `${THUMB_SIZE}px`,
        margin: `-${THUMB_SIZE / 2}px 0 0 -${THUMB_SIZE / 2}px`,
        boxSizing: 'border-box',
        borderRadius: '50%',
        background: fill,
        border: '1px solid rgba(255,255,255,0.9)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
    });

    const track = {
        position: 'relative',
        height: `${HUE_TRACK_H}px`,
        borderRadius: '9999px',
        cursor: 'ew-resize',
        touchAction: 'none',
        // Desktop: the box stays 16px tall to grab; the colour is painted in
        // the middle 6px only (each background layer is clipped to the content
        // box below), and the corners are 3px across by 8px down so that
        // painted band still ends in true half-circles.
        ...(TRACK_PAINT_PAD ? {
            boxSizing: 'border-box',
            padding: `${TRACK_PAINT_PAD}px 0`,
            borderRadius: `${HUE_TRACK_H / 2 - TRACK_PAINT_PAD}px / ${HUE_TRACK_H / 2}px`,
        } : null),
    };
    // Appended to each background layer so the thin desktop band paints only
    // its content box. Inside the layer (not a separate backgroundClip) so a
    // later background update can never reset it.
    const paintBox = TRACK_PAINT_PAD ? ' content-box' : '';

    // Hover readout: the value UNDER THE CURSOR (not the thumb), snapped to a
    // whole number, in a small pill above the track. Mouse only; hidden while
    // a button is down, the way the reference hides it mid-drag.
    // Read on POINTER events (fractional coordinates, the same ones the click
    // uses) so the number and the clicked value are always identical; and
    // any press hides it at once (the page swallows mouse events mid-drag).
    const trackHover = (kind, max) => (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        if (event.buttons) { setReadout(null); return; }
        const el = event.currentTarget;
        const t = trackFraction(el, event.clientX);
        const travel = Math.max(1, el.getBoundingClientRect().width - 2 * THUMB_INSET);
        setReadout({ kind, x: THUMB_INSET + t * travel, value: Math.round(t * max) });
    };
    const clearReadout = () => setReadout(null);
    const readoutPill = (kind) => (readout && readout.kind === kind ? (
        <span className="picker-slider-readout" style={{ left: `${readout.x}px` }}>{readout.value}</span>
    ) : null);

    // While locked, everything but the tabs and the Match fill cell dims and
    // stops answering (see `locked`).
    const lockedStyle = locked ? { opacity: 0.4, pointerEvents: 'none' } : null;

    const presetsRow = (
        <div style={(dense || isDesktop)
            /* Dense and desktop: the presets sit on the grid's own eight
               columns, one disc centred over each column, so the two blocks
               line up. */
            ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '4px', justifyItems: 'center', ...lockedStyle }
            : { display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...lockedStyle }}>
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
                        /* HeroUI swatch (owner 2026-09-23): hover grows the
                           colour, choosing rings it in its own colour and pops
                           the check in. See src/styles/swatches.css. */
                        className="hero-swatch"
                        data-selected={isSelected ? 'true' : 'false'}
                        style={{
                            width: '26px',
                            height: '26px',
                            ...(dense ? { width: '22px', height: '22px' } : null),
                            // RULED 2026-09-23 (desktop slim): 20px discs.
                            ...(isDesktop ? { width: '20px', height: '20px' } : null),
                            borderRadius: '50%',
                            flex: '0 0 auto',
                            '--hero-swatch-ring': swatchRingColour(preset),
                        }}
                    >
                        <span
                            className={`hero-swatch__fill${needsSwatchHairline(preset) ? ' has-hairline' : ''}`}
                            style={{ background: preset }}
                        >
                            {isSelected && (
                                <span className="hero-swatch__check" style={{ color: swatchCheckInk(preset) }}>
                                    <ChosenCheck size={isDesktop ? 10 : (dense ? 11 : 12)} />
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
                    ? (matchIsToggle ? Boolean(firstPreset.linked) : (!transparentMode && matchFillColor && sameColour(localHex, matchFillColor) && localOpacity >= 99))
                    : isTransparent
                        ? transparentMode
                        : (!transparentMode && sameColour(localHex, cell));
                const background = isTransparent ? CHECKER_FILL : { background: swatch };
                const title = isMatchSlot
                    ? (matchIsToggle && firstPreset.linked ? 'Match fill (on) - click to unlink' : 'Match fill')
                    : (isTransparent ? 'Transparent' : cell);
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
                        className="hero-swatch"
                        data-selected={isSelected ? 'true' : 'false'}
                        style={{
                            aspectRatio: '1',
                            borderRadius: '7px',
                            ...(dense ? { borderRadius: '6px' } : null),
                            // Desktop's 20px cell takes the one-scale CELL radius, 5.
                            ...(isDesktop ? { borderRadius: '5px' } : null),
                            /* The Match fill cell stays live while locked: it is
                               the one control that unlinks the border. */
                            ...(isMatchSlot && matchIsToggle ? null : lockedStyle),
                            '--hero-swatch-ring': swatchRingColour(isTransparent ? '#ffffff' : swatch),
                        }}
                    >
                        <span className="hero-swatch__fill" style={isFirstCell && lastMatchRef.current.toggle ? CHECKER_FILL : background}>
                        {isFirstCell && lastMatchRef.current.toggle && (
                            <span
                                className={`hero-swatch__morph${morphOn && isMatchSlot ? ' is-on' : ''}`}
                                style={{ background: lastMatchRef.current.color, color: swatchCheckInk(lastMatchRef.current.color) }}
                            >
                                <LinkGlyph size={isDesktop ? 13 : (dense ? 16 : 17)} />
                            </span>
                        )}
                        {isMatchSlot && !matchIsToggle && (
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
                            <span className="hero-swatch__check" style={{ color: swatchCheckInk(swatch) }}>
                                <ChosenCheck size={isDesktop ? 11 : 13} />
                            </span>
                        )}
                        </span>
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
            onPointerMoveCapture={transparentMode ? undefined : trackHover('alpha', 100)}
            onPointerDownCapture={clearReadout}
            onPointerLeave={clearReadout}
            onPointerUp={transparentMode ? undefined : ((event) => endPointerDrag('alpha', event))}
            onPointerCancel={transparentMode ? undefined : ((event) => endPointerDrag('alpha', event))}
            onLostPointerCapture={() => { alphaPointerId.current = null; alphaDragging.current = false; finishDragEmit(); }}
            className="picker-alpha-track"
            style={{
                ...track,
                /* The ink is a REGISTERED custom property (styles.css
                   @property --picker-alpha-ink), so the track's tint can be
                   transitioned like any other colour. Without the
                   registration a gradient stop cannot animate at all. */
                '--picker-alpha-ink': localHex,
                background: `linear-gradient(to right, transparent, var(--picker-alpha-ink))${paintBox},`
                    + ` ${isDesktop ? ALPHA_CHEQUER_DESKTOP : ALPHA_CHEQUER}${paintBox}`,
                transition: glideAlpha
                    ? `--picker-alpha-ink ${ALPHA_GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
                    : 'none',
                opacity: transparentMode ? 0.4 : 1,
                cursor: transparentMode ? 'not-allowed' : 'ew-resize',
                marginTop: labelled ? 0 : undefined,
            }}
        >
            <span style={thumb(
                localOpacity,
                glideAlpha ? `left ${ALPHA_GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : undefined,
                localHex,
            )} />
            {readoutPill('alpha')}
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
                onLostPointerCapture={() => { svPointerId.current = null; finishDragEmit(); }}
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
            <div style={{ display: 'grid', gap: `${PANEL_GAP}px` }}>
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
                    onPointerMoveCapture={trackHover('hue', 360)}
                    onPointerDownCapture={clearReadout}
                    onPointerLeave={clearReadout}
                    onPointerUp={(event) => endPointerDrag('hue', event)}
                    onPointerCancel={(event) => endPointerDrag('hue', event)}
                    onLostPointerCapture={() => { huePointerId.current = null; finishDragEmit(); }}
                    style={{
                        ...track,
                        background: `linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)${paintBox}`,
                    }}
                >
                    <span style={thumb((hue / 360) * 100, undefined, `hsl(${hue} 100% 50%)`)} />
                    {readoutPill('hue')}
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
        // Dense: the row is 26 tall, the same as the tabs above it.
        ...(dense ? { height: '26px', font: `600 11.5px/1 ${FONT}` } : null),
        // RULED 2026-09-23 (owner, desktop: "the input field is too thick, the
        // text is too thick"): a 24px field, and regular-weight 11px digits.
        ...(isDesktop ? { height: '24px', font: `400 11px/1 ${FONT}` } : null),
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
                    ...(dense ? { height: '22px' } : null),
                    // Desktop: a 20px segment in the 24px well.
                    ...(isDesktop ? { height: '20px' } : null),
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
            /* Owner 2026-09-23: with one picker open, tapping ANOTHER colour
               swatch opens that one at once — the tap closes this picker and
               still reaches the other swatch, no second tap needed. */
            passthroughSelector={COLOUR_TRIGGER_SELECTOR}
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
            /* A host that paints the panel (chrome={false}) sets the width
               too: the picker fills it instead of forcing 276px into it. */
            /* RULED 2026-09-23 (owner: desktop picker smaller, slimmer): the
               popover is 210px — the 188px grid plus 10px padding and a 1px
               edge — down from board 19's 276px. */
            width: (isPhone || !chrome) ? '100%' : `${DESKTOP_PANEL_W}px`,
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
            // RULED 2026-09-23 (desktop slim): 10px of padding, was 12.
            padding: chrome ? (isPhone ? '12px' : '10px') : 0,
            display: 'flex',
            flexDirection: 'column',
            gap: `${PANEL_GAP}px`,
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
                    padding: (dense || isDesktop) ? '2px' : '3px',
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
                                    height: isDesktop ? '20px' : (dense ? '22px' : '26px'),
                                    border: 0,
                                    borderRadius: '6px',
                                    color: on ? 'var(--text-1)' : 'var(--text-3)',
                                    background: on ? 'var(--surface-3)' : 'transparent',
                                    font: isDesktop ? `500 11px/1 ${FONT}` : `600 ${dense ? '11.5px' : '12px'}/1 ${FONT}`,
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

            {(mode === 'grid' || locked) ? gridView : gradientView}

            {/* The labelled opacity row sits in the same place in both views
                (RULED 2026-09-22: the sheet must not grow or rearrange when the
                grid becomes the spectrum). */}
            {showOpacity && (
                <div style={{ display: 'grid', gap: isDesktop ? '2px' : '6px', ...lockedStyle }}>
                    {/* Desktop: a regular-weight label; the 16px track box
                        below adds 5px of air above its thin painted band. */}
                    <div style={{ color: 'var(--text-3)', font: `${isDesktop ? 400 : 600} ${(dense || isDesktop) ? '10.5px' : '11px'}/1 ${FONT}` }}>Opacity</div>
                    {opacityTrack(true)}
                </div>
            )}

            {/* ONE bottom row: the view toggle, then the eyedropper, hex and
                opacity in a single joined field. Boards 17-19. */}
            {/* In a narrow host panel (chrome={false}, 224px of content) the row
                tightens its gaps so the six hex digits stay readable. */}
            <div className="picker-footer" style={{ display: 'flex', alignItems: 'center', gap: (dense || isDesktop) ? '6px' : '8px', width: '100%', ...lockedStyle }}>
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
                    // Dense: 52 wide, 26 tall, like the field beside it.
                    ...(dense ? { width: '52px', flex: '0 0 52px', height: '26px' } : null),
                    // Desktop slim: 46 wide, 24 tall, like the field beside it.
                    ...(isDesktop ? { width: '46px', flex: '0 0 46px', height: '24px' } : null),
                }}>
                    {modeTab('grid', 'Preset colors', <GridGlyph size={isDesktop ? 12 : 14} />)}
                    {modeTab('spectrum', 'Color spectrum', <GradientGlyph size={isDesktop ? 12 : 14} />)}
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
                            ...(dense ? { width: '28px', flex: '0 0 28px' } : null),
                            ...(isDesktop ? { width: '22px', flex: '0 0 22px' } : null),
                            color: 'var(--text-2)',
                            opacity: eyedropperSupported ? 1 : 0.4,
                            cursor: eyedropperSupported ? 'pointer' : 'default',
                        }}
                    >
                        <EyedropperGlyph size={isDesktop ? 12 : (dense ? 14 : 17)} />
                    </button>
                    <span style={{ padding: isDesktop ? '0 2px 0 5px' : (dense ? '0 3px 0 7px' : '0 9px'), color: 'var(--text-3)' }}>#</span>
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
                                    ...(dense ? { width: '32px', flex: '0 0 32px' } : null),
                                    /* RULED 2026-09-23 (owner, desktop: at 100% the
                                       "100" sat against the divider). The box is
                                       29px, not 24: the divider moves 5px left and
                                       "100" gets ~5px of air each side. The hex
                                       cell (flex) gives up those 5px and still
                                       holds six of the widest hex digits; the
                                       row's width and height do not change. */
                                    ...(isDesktop ? { width: '29px', flex: '0 0 29px' } : null),
                                    height: '100%',
                                    padding: isDesktop ? '0 1px' : '0 2px',
                                    color: 'inherit',
                                    background: 'transparent',
                                    border: 0,
                                    borderLeft: '1px solid var(--border)',
                                    font: 'inherit',
                                    textAlign: 'center',
                                    outline: 'none',
                                }}
                            />
                            <span style={{ paddingRight: '9px', color: 'var(--text-3)', flexShrink: 0, ...(dense ? { paddingRight: '7px' } : null), ...(isDesktop ? { paddingRight: '5px' } : null) }}>%</span>
                        </>
                    )}
                </div>
            </div>
        </div>
        </>
    );
};

export default CompactColorPicker;
