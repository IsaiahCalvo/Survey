import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import AnnotationSizeControl, { ANNOTATION_SIZE_PRESETS } from '../components/AnnotationSizeControl';
import { COUNTER_SIZE_MAX, COUNTER_SIZE_MIN, ANNOTATION_WIDTH_DECIMALS } from '../utils/annotationSize';
import { needsSwatchHairline, normaliseQuickColour, swatchCheckInk, swatchRingColour, withQuickColoursFirst } from '../utils/quickStylePresets';
import CompactColorPicker from '../components/CompactColorPicker';
import { composeTextColor, splitTextColor } from '../utils/textColorOpacity';
import { resolveFontSizeDraft } from '../utils/selectedTextFormatting.js';
import { ChosenCheck, QuickColourDots, QuickPaintSwatch } from '../components/QuickStyleControls';
import DismissBarrier from '../components/DismissBarrier';
import ActiveSpaceChip from '../sidebar/ActiveSpaceChip';
import { ARROWHEAD_MENU_ORDER, ARROWHEAD_SHORT_LABELS } from '../components/Callout/types';
import { ZOOM_MODE_OPTIONS, ensureRgbaOpacity, getCategoryGlyphLabel } from '../viewerShared';
import { getMobileSyncPresentation, getMobileTextMarkupPresentation, normalizeMobilePresence } from './mobilePdfViewerModel.js';
import { getSelectFamilyIconName, getSelectFamilyLabel, getSelectFamilyTransition, getSelectModeIconName } from '../utils/selectModes.js';
import { tooltipForLabel } from '../utils/toolShortcuts.js';
import { useMobileSheetMotion } from './useMobileSheetMotion';
import useRailGroupMotion from './useRailGroupMotion.js';
import { useViewerTopOverlayRef } from '../utils/viewerTopOverlay.js';
import './mobilePdfViewer.css';

// UX 2026-09-16 (phone sweep, owner ruling "everything reads a little big").
// ONE glyph:control ratio for every phone tier, and it is Drawboard's: its
// desktop glyph fills 0.53 of its button and its phone rail chip is about 28pt.
// Ours were drawn at two thirds of the chip, which is why the whole phone read
// heavy - rail 20-in-30 (0.67), sub-tool 16-in-24 (0.67), header 17-in-26
// (0.65), dock 18-in-30 (0.60). Every tier is 0.55-0.60 now: rail 17-in-30,
// sub-tool 14-in-24, header 15-in-26, dock 17-in-30. The CSS tokens still set
// the chips; these set what is drawn inside them, and the hit pads are
// untouched, so nothing got harder to tap.
// RULED CHANGE: tests/mobilePhoneSizing.test.mjs pinned the old three.
const RAIL_GLYPH = 17;
// The line-style dropdown and the width field are one control size (owner
// ruling 2026-09-16). Both read the same token, so neither can drift.
const STRIP_DROPDOWN_WIDTH = 'var(--mobile-strip-dropdown-w)';
// RULED CHANGE 2026-09-22 (owner, phone build: the sub-tools read a size smaller
// than the tools above them). A sub-tool chip is the SAME chip as the tool that
// opened it — 28px — so its glyph is the rail's 17, not 14. 17-in-28 is 0.607,
// the identical fill the rail, header and dock tiers carry, so this is one chip
// size on the phone rather than a second, smaller one.
const SUBTOOL_GLYPH = 17;
// RULED CHANGE 2026-09-21 (pass 7, board 1: "rail 36px wide, chips 28px / icon
// 17px" and the same 17px on every header action). 15-in-26 was the 2026-09-16
// ratio; the approved boards draw a 17px glyph in a 28px box, so both numbers
// move together and the ratio is unchanged at 0.61.
const HEADER_GLYPH = 17;
// RULED CHANGE 2026-09-22 (owner): undo/redo draw smaller than the other
// header glyphs. Their solid arrowheads carry more ink than the rail's open
// strokes, so at 17 they read as the heaviest thing in the bar; 14 sits them
// level with the rail optically. Chip and 44px hit box unchanged.
const HISTORY_GLYPH = 14;
// RULED CHANGE 2026-09-21 (pass 7): 12, not 14. The strip control is 20px on the
// approved boards where it was 24, so 14 would have been 0.70 of its box - by a
// wide margin the heaviest glyph on the phone. 12-in-20 is 0.60, the same fill
// every other tier carries, and 12 is also the glyph size the boards' own
// segmented toggles draw (boards 6 and 7).
const STRIP_GLYPH = 12;
// Owner 2026-10-01 (iPhone): "The icons for pages, search, and bookmarks, I
// would prefer them to be bigger. I don't want the actual row that they're in
// to grow." The Pages / Search / Bookmarks glyph in the dock pill draws at 20
// (it was 17); then "make the Spaces and Survey dock icons match too", so the
// circles either side draw at 20 as well. The 30px pill, its label and its
// chevron and the circles' size are unchanged. Same 1.5 stroke on the 24 grid
// - the glyphs simply draw larger.
const DOCK_HUB_GLYPH = 20;
const DOCK_GLYPH = 20;

/**
 * Keeps the live text editor focused while one of its formatting buttons is
 * pressed, without killing touch scrolling on the bar those buttons sit in.
 *
 * UX 2026-09-16 (r4 phone pass). With a mouse, preventDefault on pointerdown is
 * the standard trick: the caret and selection inside the contenteditable never
 * move, so Bold applies to exactly what was selected. On a touch screen it is a
 * trap - a prevented pointerdown tells the engine the page is handling this
 * gesture, so the browser never starts its own pan. Measured in the iOS
 * Simulator: a drag that began on any of Bold / Italic / Underline / Strike (or
 * the colour swatch) did not scroll the formatting bar at all, which left the
 * Text-alignment dropdown at the far end unreachable on a 375pt screen, because
 * those five buttons are most of the bar's width.
 *
 * Coarse pointers therefore let the default run. Focus survives anyway: the bar
 * carries the data-rich-text-toolbar opt-out, so a touch on it does not commit
 * and close the editor, and every style call ends by re-focusing the editable
 * (TextEditOverlay's applyStyle -> focus({ preventScroll: true })).
 */
const keepTextEditFocus = (event) => {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
  event.preventDefault();
};

// Group icons stay shared with the desktop toolbar. Sub-tools keep their own
// glyphs, so the Text group can differ from its Text Box option.
const TOOL_GROUPS = {
  draw: {
    label: 'Draw',
    icon: 'drawGroup',
    fallback: 'pen',
    tools: [
      { id: 'pen', label: 'Pen', icon: 'pen' },
      { id: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
      /* UX 2026-09-22 (owner, with the desktop rail): the tool is "Eraser". It
         was "Partial erase", which collided with the Partial half of the
         Partial / Whole toggle its own strip carries — two different things
         wearing one name. The toggle keeps its own names, and they are the ones
         that mean partial and whole. */
      { id: 'eraser', label: 'Eraser', icon: 'eraser' },
    ],
  },
  shape: {
    label: 'Shapes',
    icon: 'shapes',
    fallback: 'rect',
    tools: [
      { id: 'rect', label: 'Rectangle', icon: 'rect' },
      { id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
      // UX: same Shapes ordering as desktop. NOTE — Polygon/Polyline are
      // click-to-place (tap each corner, then tap a checkmark to finish);
      // the flow is pointer-driven and has not been tuned for touch yet.
      { id: 'polygon', label: 'Polygon', icon: 'polygon' },
      { id: 'polyline', label: 'Polyline', icon: 'polyline' },
      { id: 'line', label: 'Line', icon: 'line' },
      { id: 'arrow', label: 'Arrow', icon: 'arrow' },
      { id: 'counter', label: 'Counter', icon: 'counter' },
    ],
  },
  review: {
    label: 'Text',
    icon: 'textGroup',
    fallback: 'text',
    tools: [
      { id: 'text', label: 'Text', icon: 'textBox' },
      { id: 'callout', label: 'Callout', icon: 'callout' },
    ],
  },
};

const TOOL_TO_GROUP = Object.entries(TOOL_GROUPS).reduce((result, [groupId, group]) => {
  group.tools.forEach((tool) => {
    result[tool.id] = groupId;
  });
  return result;
}, {});

const WIDTH_TOOLS = new Set(['pen', 'highlighter', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'text', 'callout', 'counter']);
const FILL_TOOLS = new Set(['rect', 'ellipse', 'polygon', 'text', 'callout', 'counter']);
// UX 2026-09-09: polygon and polyline join the shape tools that get a border
// style picker on mobile, so their Cloud option has somewhere to live.
const BORDER_STYLE_TOOLS = new Set(['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'text', 'callout']);

// UX 2026-09-17 (owner): the settings sheet's palette opens with the same
// quick colours the strip's dots offer, then its own longer tail. Its old first
// three were a red that matched, a blue that did not (#4A90E2 against the dot's
// #0000FF) and a green that did not (#27C07D against #00FF00) — near-misses a
// single tap apart from the dots above them. Those are gone; the tail keeps the
// colours the dots do not carry.
// RESTORED 2026-09-23 (owner: "We had panels for every single annotation ...
// The only thing that we had fixed regarding this lower panel ... was the color
// picker"). The 2026-09-22 row-list rebuild deleted this palette with the
// panel's row of colour circles; both are back. The panel's big swatch opens the
// NEW shared picker sheet, which is the one change the owner asked for.
const MOBILE_ANNOTATION_COLORS = withQuickColoursFirst([
  '#F4D35E',
  '#ffffff',
  '#1e293b',
  '#C7A7FF',
  '#FF8A3D',
]);

// Mirrors zoomController's clampScale bounds (MIN_SCALE 0.01, MAX_SCALE 40) so
// the phone steppers grey out at exactly the limits the desktop toolbar hits.
const MOBILE_ZOOM_MIN_PERCENT = 1;
const MOBILE_ZOOM_MAX_PERCENT = 4000;

const MOBILE_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Human labels for the edit-sheet header, per tool. (demo AnnotationEditPanel
// titles the sheet with the annotation kind — App.tsx tool set.)
const TOOL_LABELS = {
  pen: 'Pen',
  highlighter: 'Highlighter',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  polyline: 'Polyline',
  line: 'Line',
  arrow: 'Arrow',
  counter: 'Counter',
  text: 'Text',
  callout: 'Callout',
  // 2026-09-23: the eraser has a "..." and a settings panel like every tool.
  eraser: 'Eraser',
};

/**
 * MobileColorPickerSurface — mobile takeover host for the app's ONE shared
 * CompactColorPicker (project rule: every colour control reuses it, never the
 * OS <input type=color>). Mirrors the demo's in-panel gradient/HSV picker
 * (AnnotationEditPanel/styles.ts:1631-1783): SB square + hue + opacity + hex.
 * Rendered as a near-invisible-backdrop popover above the edit sheet, matching
 * the demo's never-dim overlay convention.
 */
function MobileColorPickerSurface({ color, opacity, showOpacity = true, firstPreset, minOpacity, onChange, onClose, title, tabs = null }) {
  // Owner 2026-09-30: the colour sheet moves like every other phone sheet -
  // it slides up, follows a swipe down from anywhere on it (the gradient and
  // sliders keep their own drags), and slides off on a tap outside or Done.
  const {
    motionStyle,
    backdropStyle,
    sheetProps,
    requestClose,
  } = useMobileSheetMotion(onClose);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {/* data-rich-text-toolbar (2026-09-23, owner: tapping the rainbow in the
          Font color sheet closed the whole sheet): this sheet portals to
          document.body, outside the text strip that opened it, so without
          TextEditOverlay's opt-out the FIRST touch anywhere in it - the rainbow,
          a swatch, the hex field, even the title - landed on the editor's
          document-level pointerdown listener, which commits and closes the text
          box. Closing the editor takes its strip and this sheet down with it,
          so the tap never reached the picker. The backdrop carries it too: a
          tap there closes only the sheet and leaves the text box open, the
          same as the text settings panel's backdrop. In every other colour
          sheet no text box is open, so the attribute changes nothing there. */}
      <button
        type="button"
        className="mobile-pdf-colorpicker-backdrop"
        data-rich-text-toolbar
        aria-label={`Close ${title || 'color'} picker`}
        onClick={() => requestClose()}
        style={backdropStyle}
      />
      {/* PASS 7 (boards 17 & 18): the picker is a bottom sheet in the shared
          sheet frame, not a floating panel in the middle of the screen. It
          opened at the Standard panel height until 2026-09-22; it is a SETTINGS
          sheet, so its CSS sizes it to its content now. Same handle row, same title, same gold Done as every
          other phone panel, so it arrives from the same edge and closes the same
          way. The panel inside it is the app's ONE shared CompactColorPicker
          (project rule) — its presets, grid, gradient and opacity row belong to
          the picker pass, and this only gives them the sheet to sit in. */}
      <div
        className="mobile-pdf-colorpicker-surface"
        data-rich-text-toolbar
        role="dialog"
        aria-label={`${title || 'Color'} picker`}
        {...sheetProps}
        style={motionStyle}
      >
        <div className="mobile-pdf-sheet__handle" />
        <header className="mobile-pdf-tool-sheet__header">
          <strong>{title || 'Color'}</strong>
          <button type="button" aria-label="Done" onClick={() => requestClose()}>Done</button>
        </header>
        <div className="mobile-pdf-colorpicker-surface__body">
          <CompactColorPicker
            /* platform="phone" gives the picker its 12-preset phone layout, and
               chrome={false} turns off its own panel background, border, radius
               and padding, because on boards 17 and 18 the SHEET is the panel and
               the presets run edge to edge across its band. Both props belong to
               the picker pass; until that branch lands they are simply ignored,
               and the desktop-width picker still fits this sheet. */
            platform="phone"
            chrome={false}
            color={color}
            opacity={opacity}
            showOpacity={showOpacity}
            firstPreset={firstPreset}
            minOpacity={minOpacity}
            /* Boards 17 and 18: a mark with two colours gets the Border / Fill
               tabs at the top of the sheet body. A single-colour control (a pen's
               stroke, a text colour) passes none, and the sheet opens straight
               onto the presets. */
            tabs={tabs}
            /* The sheet's own handle, title and Done are part of the picker: a
               tap on Done must close it through its own click, not as an
               "outside" tap. Counted as outside, the tap armed the picker's
               trailing-click blocker, which then swallowed the NEXT tap for up
               to 0.9s - so the first tap on the settings panel or the strip
               right after Done did nothing. */
            dismissInsideSelector=".mobile-pdf-colorpicker-surface"
            /* R4 (owner 2026-09-23 dismiss rules): the sheet sits over a
               full-screen backdrop, so a tap outside it only closes the sheet
               and never reaches the strip or the page behind. */
            dismissMode="blocking"
            onChange={onChange}
            onClose={() => requestClose()}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * MobileStyledSelect — one reusable app-styled dropdown that replaces the OS
 * native `<select>` rollers on mobile (OWNER DECISION 3, 2026-07-12; matrix §6
 * dropdown rows). Trigger sits inline in the formatting strip like its sibling
 * controls; the open menu is the demo's dark context-menu chrome (#181B20 /
 * #3C424D / radius 8 / 34px rows / gold active — same chrome Phase D used).
 * Portals to <body> as a fixed-position layer measured off the trigger rect so
 * it works both in the top strip (opens down) and inside the bottom edit sheet
 * (opens up). Keyboard: Enter/Space or ArrowDown opens; arrows move; Enter
 * selects; Escape closes. Tap: outside pointerdown closes.
 */
function MobileStyledSelect({ value, options, onChange, ariaLabel, disabled = false, minWidth, width, placeholder, fitOptions = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const optionRefs = useRef([]);
  const dismissInsideRefs = useMemo(() => [triggerRef, menuRef], []);
  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const currentLabel = selected?.label || placeholder || 'No selection';

  const measure = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const openUp = rect.bottom > (window.innerHeight * 0.6);
    setPos({
      left: rect.left,
      // Board 15: "Menus: exactly as wide as their field" - as a FLOOR. The
      // owner found "10 pt" / "12 pt" cut to "1..." in the 72px width menu
      // (2026-09-22), so the menu now grows to its widest row (desktop does the
      // same) and is nudged left when that would run off the screen.
      width: rect.width,
      openUp,
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? (window.innerHeight - rect.top + 4) : undefined,
    });
  };

  // After the menu renders at its natural width, keep it on screen: if its
  // right edge passes the viewport, slide it left (never past the left gutter).
  useEffect(() => {
    if (!open || !pos) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const overflow = rect.right - (window.innerWidth - 8);
    if (overflow > 0) {
      setPos((prev) => (prev ? { ...prev, left: Math.max(8, prev.left - overflow) } : prev));
    }
  }, [open, pos?.width]);

  const openMenu = (index = selectedIndex) => {
    if (disabled) return;
    measure();
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.querySelector('button')?.focus({ preventScroll: true }));
  };

  const selectOption = (index) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeMenu(true);
  };

  const moveActiveOption = (event, nextIndex) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveIndex(Math.max(0, Math.min(options.length - 1, nextIndex)));
  };

  const closeAndMoveFocus = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = triggerRef.current?.querySelector('button');
    const candidates = Array.from(document.querySelectorAll(MOBILE_FOCUSABLE_SELECTOR))
      .filter((element) => !menuRef.current?.contains(element) && element.getClientRects().length > 0);
    const triggerIndex = candidates.indexOf(trigger);
    const nextIndex = triggerIndex + (event.shiftKey ? -1 : 1);
    const next = candidates[nextIndex] || trigger;
    setOpen(false);
    requestAnimationFrame(() => next?.focus?.({ preventScroll: true }));
  };

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, open]);

  const onMenuKeyDown = (event) => {
    if (event.key === 'ArrowDown') moveActiveOption(event, (activeIndex + 1) % options.length);
    else if (event.key === 'ArrowUp') moveActiveOption(event, (activeIndex - 1 + options.length) % options.length);
    else if (event.key === 'Home') moveActiveOption(event, 0);
    else if (event.key === 'End') moveActiveOption(event, options.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      selectOption(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeAndMoveFocus(event);
    }
  };

  return (
    <div className="mobile-styled-select" ref={triggerRef}>
      <DismissBarrier
        active={open}
        insideRefs={dismissInsideRefs}
        dismissOnEscape={false}
        onDismiss={() => closeMenu(true)}
      />
      <button
        type="button"
        className={`mobile-styled-select__trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${currentLabel}`}
        disabled={disabled}
        style={width ? { width, minWidth: width } : (minWidth ? { minWidth } : undefined)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu();
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          } else if (event.key === 'Home') {
            event.preventDefault();
            openMenu(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            openMenu(options.length - 1);
          }
        }}
        onClick={() => (open ? closeMenu(false) : openMenu())}
      >
        {/* Board pills read preview | label | chevron, left to right. The
            preview is the control's own sample - a stroke at its real weight, a
            dashed rule, an arrowhead - so it belongs to the option, not to this
            component. */}
        {selected?.preview ? <span className="mobile-styled-select__preview" aria-hidden="true">{selected.preview}</span> : null}
        {fitOptions ? (
          /* `fitOptions` (owner 2026-09-30, the survey module pill): the pill is
             exactly as wide as its LONGEST option - every label sits invisibly
             in one grid cell under the live one - so it neither hugs whichever
             name is picked (and jumps when you switch) nor pads a short name
             out to a fixed width. A cap on the trigger still ellipsises a
             very long name. */
          <span className="mobile-styled-select__fit">
            <span>{currentLabel}</span>
            {options.map((option) => (
              <span key={option.value} className="mobile-styled-select__fit-ghost" aria-hidden="true">{option.label}</span>
            ))}
          </span>
        ) : <span>{currentLabel}</span>}
        <Icon name="chevronDown" size={9} color="currentColor" />
      </button>
      {open && typeof document !== 'undefined' && pos && createPortal(
        <div
          ref={menuRef}
          className="mobile-styled-select__menu"
          role="listbox"
          aria-label={ariaLabel}
          data-modal-focus-layer="true"
          /* This menu portals to document.body, so it sits OUTSIDE the strip
             that carries TextEditOverlay's opt-out. Without the attribute here,
             picking a font or a size while a text box was being edited landed a
             pointerdown on plain document, which committed and closed the editor
             before the style could be applied — and no chrome menu should ever
             commit a text box. */
          data-rich-text-toolbar
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            minWidth: pos.width,
            width: 'max-content',
            maxWidth: 'calc(100vw - 16px)',
          }}
        >
          {options.map((option, index) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={index === activeIndex ? 0 : -1}
                className={active ? 'is-active' : ''}
                onFocus={() => setActiveIndex(index)}
                onClick={() => selectOption(index)}
              >
                {/* Board 15: a row's sample is longer horizontally than the
                    trigger's (24px against 12-18), and the word sits right of
                    it. The current row is gold; there are NO check marks - the
                    gold IS the selected state, the same rule the rest of the
                    chrome follows. */}
                {(option.menuPreview || option.preview) ? (
                  <span className="mobile-styled-select__row-preview" aria-hidden="true">
                    {option.menuPreview || option.preview}
                  </span>
                ) : null}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Owner 2026-10-01: the rail's category discs read exactly like the desktop
// survey row's chips - the initial of each word ("Cameras" -> C, "Access
// Control" -> AC) - from the one shared helper, not the first two letters.
const categoryGlyph = getCategoryGlyphLabel;

const toHexColor = (value, fallback = '#d8a84e') => {
  const source = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(source)) return source;
  if (/^#[0-9a-f]{3}$/i.test(source)) {
    return `#${source.slice(1).split('').map((char) => `${char}${char}`).join('')}`;
  }
  const rgb = source.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * The paint the combined swatch is shown, colour AND opacity together.
 *
 * MEASURED 2026-09-22 (phone): a rectangle with NO fill painted a solid WHITE
 * centre. The phone was sending the swatch `toHexColor(fillColor)`, and a hex
 * cannot carry "none" — a fill of #ffffff at 0% opacity came out #ffffff. The
 * desktop bar composes the two before it hands them over (AppShell:
 * `ensureRgbaOpacity(fillColor, fillOpacity / 100)`), which is why the same
 * rectangle reads empty there. This is that line, so the two bars now show the
 * one mark the same way, and nothing in the phone stylesheet paints this centre.
 */
const toSwatchPaint = (color, opacityPercent, fallback) => ensureRgbaOpacity(
  color || fallback,
  Math.max(0, Math.min(1, (opacityPercent ?? 100) / 100)),
);

/* ---------------------------------------------------------------------------
 * PASS 7 PHONE STRIP PRIMITIVES (owner-approved boards 1-7 / 15 / 16).
 *
 * The strip is a CENTRED row of 20px controls, 4px apart, on a painted 36px
 * band, and it must never scroll and never clip. Everything below exists so the
 * strip can be assembled per tool out of exactly the controls its board shows:
 * a hairline divider, a segmented toggle, and the samples the pills draw.
 *
 * INTENDED UX: the strip carries only what the boards call the essentials for
 * that tool. Anything the desktop bar shows and the strip does not lives one tap
 * away behind the "..." button, in the tool's own bottom sheet. Reference: the
 * approved artboards; the desktop bar shows everything because it has the room.
 * ------------------------------------------------------------------------- */

/** The board's 1px x 16px hairline, with its 5px of air on each side. */
const MobileStripDivider = () => (
  <span aria-hidden="true" className="mobile-pdf-properties__divider" />
);

/**
 * MobileStripSegmented — the Partial/Whole and Box/Lasso/Text toggles (boards 6
 * and 7). One quiet well, and the chosen segment turns its word and its glyph
 * gold. Deliberately NOT a raised thumb: the owner's selected-state ruling is
 * "the glyph turns gold, no fill and no border", and a sliding thumb is a fill.
 */
function MobileStripSegmented({ ariaLabel, value, options, onChange, width }) {
  return (
    <div
      className="mobile-pdf-properties__segmented"
      role="group"
      aria-label={ariaLabel}
      style={{ width }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel || option.label}
            className={active ? 'is-active' : ''}
            onClick={() => onChange?.(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={12} color="currentColor" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A line at its real weight — 12px in a pill, 24px in a menu row (board 15). */
const strokeSample = (width, length) => (
  <span
    style={{
      display: 'block',
      width: length,
      height: 0,
      borderTop: `${Math.max(1, Math.min(6, Number(width) || 1))}px solid currentColor`,
      borderRadius: 1,
    }}
  />
);

/* Board 15's four line-style samples, at the two lengths the board uses. Cloud
   is the Drawboard-style scallop: three bumps plus the two half-bumps that make
   the run read as a continuous edge. */
const lineStyleSample = (style, length) => {
  const w = length;
  if (style === 'dashed') {
    return (
      <svg width={w} height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
        <path d="M1 6H6M9.5 6H14.5M18 6H23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (style === 'dotted') {
    return (
      <svg width={w} height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
        {/* The house 1.5 weight, not the board's 1.8: every chrome glyph in this
            app strokes 1.5 on the 24 grid (tests/chromeInlineIconWholeTree) and a
            dotted rule reads fine at it. */}
        <path d="M1 6H23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 4" />
      </svg>
    );
  }
  if (style === 'cloud') {
    return (
      <svg width={w} height="14" viewBox="0 0 24 14" fill="none" aria-hidden="true">
        <path
          d="M1 11a2.75 2.75 0 0 1 5.5 0 2.75 2.75 0 0 1 5.5 0 2.75 2.75 0 0 1 5.5 0 2.75 2.75 0 0 1 5.5 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width={w} height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
      <path d="M1 6H23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

/* Board 15's arrowhead drawings — the head itself, on a shaft, so the menu reads
   as "what the end of my arrow will look like" rather than as a list of words.
   Keys are the app's own arrowhead vocabulary (ARROWHEAD_STYLES). */
const arrowheadSample = (style, size) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  const stroke = { stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (style === 'none') {
    return <svg {...common}><path d="M3 12H21" {...stroke} /></svg>;
  }
  if (style === 'vShape' || style === 'openTriangle') {
    return (
      <svg {...common}>
        <path d="M3 12H21" {...stroke} />
        <path d="M15 7L21 12L15 17" {...stroke} />
      </svg>
    );
  }
  if (style === 'openCircle') {
    return (
      <svg {...common}>
        <path d="M3 12H15" {...stroke} />
        <circle cx="18" cy="12" r="3" fill="currentColor" />
      </svg>
    );
  }
  if (style === 'square') {
    return (
      <svg {...common}>
        <path d="M3 12H15" {...stroke} />
        <rect x="15" y="9" width="6" height="6" fill="currentColor" />
      </svg>
    );
  }
  if (style === 'diamond') {
    return (
      <svg {...common}>
        <path d="M3 12H15" {...stroke} />
        <path d="M18 9L21 12L18 15L15 12Z" fill="currentColor" {...stroke} />
      </svg>
    );
  }
  if (style === 'horizontalLine') {
    return (
      <svg {...common}>
        <path d="M3 12H18" {...stroke} />
        <path d="M18 7.5V16.5" {...stroke} />
      </svg>
    );
  }
  if (style === 'slash') {
    return (
      <svg {...common}>
        <path d="M3 12H18" {...stroke} />
        <path d="M15 16.5L21 7.5" {...stroke} />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 12H16" {...stroke} />
      <path d="M13 8L19 12L13 16Z" fill="currentColor" {...stroke} />
    </svg>
  );
};

/* Board 16's Arrow-ends drawings: lucide move-right / move-horizontal / minus,
   all the same length so the three read as one control changing its ends.
   These are the SHARED glyphs from src/Icons.jsx, which the desktop pass added
   for the identical dropdown in its own bar (board 10) - so the bar and the
   sheet draw the same three arrows. The phone pass had them inline because that
   set had not landed yet.
   The sizes are the sheet's own: 15px in the pill's preview, 18px in a menu row,
   where board 15 draws a row's sample longer than the trigger's. */
const ARROW_ENDS_OPTIONS = [
  { value: 'end', label: 'End', icon: 'moveRight' },
  { value: 'both', label: 'Both', icon: 'moveHorizontal' },
  { value: 'none', label: 'None', icon: 'arrowEndsNone' },
].map((option) => ({
  ...option,
  preview: <Icon name={option.icon} size={15} color="currentColor" />,
  menuPreview: <Icon name={option.icon} size={18} color="currentColor" />,
}));

/* ---------------------------------------------------------------------------
 * PASS 7 — THE LIVE TEXT-EDIT STRIP (2026-09-22).
 *
 * The strip that appears while a text box or a callout is being typed into is
 * the one phone strip no board covers, and until now it was the one strip that
 * scrolled: colour disc | "Arial" | "16" | B | I | U | S | "top left", which ran
 * off the right edge of a 402pt phone and worse at 375 and 390, so the alignment
 * control was unreachable with a thumb unless the row was dragged sideways.
 *
 * The boards' rule applies to it like every other strip — "essentials only; it
 * must NEVER scroll and NEVER clip; if a strip does not fit at 375px, move the
 * least essential control into the sheet" — so it is measured to fit now:
 *   colour disc | divider | font | size | divider | B I U S | alignment
 * and the two alignment AXES (desktop board 12 shows them as six buttons) live
 * in the sheet the alignment button opens. That button draws the horizontal
 * alignment in force, so the strip still says which way the text is set.
 *
 * The lists below are the DESKTOP bar's own lists (src/AppShell.jsx, the board-12
 * row), so the two platforms can never offer a different font or a different
 * size. Single-name fonts only — a CSS fallback stack drifts the Fabric text
 * cursor (gotcha 2026-04-08).
 * ------------------------------------------------------------------------- */
const MOBILE_FONT_FAMILY_OPTIONS = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana']
  .map((family) => ({ value: family, label: family }));

const MOBILE_FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];

/* Board 12 + the units ruling: a size field says "16 pt", never a bare "16". A
   size the presets do not hold — one typed on the desktop, one carried in by an
   imported mark — is prepended so the pill never lies about the text in force,
   exactly as the desktop dropdown does. */
const mobileFontSizeOptions = (current) => {
  const size = Number(current);
  const live = Number.isFinite(size) ? size : 16;
  const sizes = MOBILE_FONT_SIZE_PRESETS.includes(live)
    ? MOBILE_FONT_SIZE_PRESETS
    : [live, ...MOBILE_FONT_SIZE_PRESETS];
  return sizes.map((value) => ({ value: String(value), label: `${value} pt` }));
};

/* The app's own horizontal alignment glyphs (src/Icons.jsx, drawn for board
   12). The live text strip's alignment button draws the one in force; the two
   alignment rows themselves are the settings panel's big icons
   (MobileTextAlignmentGlyph below). */
const HORIZONTAL_ALIGNMENTS = [
  { value: 'left', icon: 'alignLeft', label: 'Align left' },
  // US spelling, app-wide ruling (owner 2026-09-22): "center", never "centre".
  { value: 'center', icon: 'alignCenter', label: 'Align center' },
  { value: 'right', icon: 'alignRight', label: 'Align right' },
];

/* UX 2026-09-16 (icon-set pass + sizing pass, merged): ONE glyph size per rail
   tier, and no per-glyph exceptions inside a tier. The rail used to run 19 with
   the Select cursor at 21, so Select was visibly the odd one out down a column
   where everything else lined up. The size now comes from RAIL_GLYPH for a rail
   tool and SUBTOOL_GLYPH for a sub-tool. 2026-09-22: those two constants are now
   the SAME 17, because the owner ruled the sub-tool chip up to the rail's 28px -
   one chip size on the phone. They stay two names so a future tier can move on
   its own, and because the region sub-strip passes no glyph at all and so already
   drew the rail's. Each glyph sits at the same fill inside its own chip -
   0.57 since the 2026-09-16 phone sweep, where it used to be two thirds.
   Do not pass a bare number here. */
const RailButton = ({ active = false, disabled = false, icon, label, glyph = RAIL_GLYPH, onClick, children, ...buttonProps }) => (
  <button
    type="button"
    className={`mobile-pdf-tools__button${active ? ' is-active' : ''}`}
    aria-label={label}
    // UX 2026-09-16: on a tablet or a narrow desktop window this shell gets a
    // real pointer, so the hover hint names the key that arms the tool
    // ("Rectangle  R") exactly as the desktop chip does. A finger never sees
    // it, and the aria-label stays the plain name so a screen reader never
    // reads the keycap as part of the control's name.
    title={tooltipForLabel(label)}
    disabled={disabled}
    onClick={onClick}
    {...buttonProps}
  >
    {children || <Icon name={icon} size={glyph} color="currentColor" />}
  </button>
);

/* The settings panel's big alignment icons (demo AnnotationEditPanel), drawn on a
   256-unit grid at 48x34 for the two rows of alignment buttons in the Text card.
   RESTORED 2026-09-23 with the panel they belong to (owner: "We already had panel
   layouts with icons and all that"). One adaptation, for the selected-state
   ruling ("selected = gold glyph only"): the bars used to be painted gold on
   EVERY button, chosen or not, so all six read as selected. They take the
   button's own colour now - grey at rest, gold when chosen - and the middle bar
   is the same colour at 55% so the glyph keeps its two-tone look. */
function MobileTextAlignmentGlyph({ axis, value }) {
  const common = {
    stroke: 'currentColor',
    strokeWidth: 6,
    strokeLinecap: 'round',
  };
  const bar = { fill: 'currentColor' };
  const softBar = { fill: 'currentColor', fillOpacity: 0.55 };

  if (axis === 'horizontal') {
    const leftContent = (
      <>
        <line x1="48" y1="44" x2="48" y2="212" {...common} />
        <rect x="70" y="62" width="150" height="34" rx="8" {...bar} />
        <rect x="70" y="111" width="76" height="34" rx="8" {...softBar} />
        <rect x="70" y="160" width="116" height="34" rx="8" {...bar} />
      </>
    );
    return (
      <svg width="48" height="34" viewBox="0 0 256 256" aria-hidden="true">
        {value === 0 && leftContent}
        {value === 1 && (
          <>
            <line x1="128" y1="44" x2="128" y2="212" {...common} />
            <rect x="53" y="62" width="150" height="34" rx="8" {...bar} />
            <rect x="91" y="111" width="74" height="34" rx="8" {...softBar} />
            <rect x="72" y="160" width="112" height="34" rx="8" {...bar} />
          </>
        )}
        {value === 2 && <g transform="translate(256 0) scale(-1 1)">{leftContent}</g>}
      </svg>
    );
  }

  return (
    <svg width="48" height="34" viewBox="0 0 256 256" aria-hidden="true">
      {value === 0 && (
        <>
          <rect x="53" y="66" width="150" height="34" rx="8" {...bar} />
          <line x1="128" y1="130" x2="128" y2="202" {...common} />
          <path d="M128 130 L105 153 M128 130 L151 153" fill="none" {...common} strokeLinejoin="round" />
        </>
      )}
      {value === 1 && (
        <>
          <rect x="53" y="111" width="150" height="34" rx="8" {...bar} />
          <line x1="128" y1="40" x2="128" y2="82" {...common} />
          <path d="M128 82 L105 59 M128 82 L151 59" fill="none" {...common} strokeLinejoin="round" />
          <line x1="128" y1="174" x2="128" y2="216" {...common} />
          <path d="M128 174 L105 197 M128 174 L151 197" fill="none" {...common} strokeLinejoin="round" />
        </>
      )}
      {value === 2 && (
        <>
          <line x1="128" y1="48" x2="128" y2="120" {...common} />
          <path d="M128 120 L105 97 M128 120 L151 97" fill="none" {...common} strokeLinejoin="round" />
          <rect x="53" y="156" width="150" height="34" rx="8" {...bar} />
        </>
      )}
    </svg>
  );
}

/* The Text card's "Text size" field. Review 2026-09-23: it used to save on
   every keystroke, so typing 24 on a picked text box saved 2 and then 24 (two
   undo steps, and collaborators saw 2pt text in between). It now keeps a draft
   while typing (and may be cleared), and saves once on blur or Enter,
   clamped to the live editor's 6-200 range; an empty or invalid draft puts
   the current size back.
   Hardening 2026-09-23: the iOS number keypad has no Enter and closing the
   sheet can unmount the field without a blur, which lost the typed size. A
   pending valid draft is now also saved when the field unmounts - once (the
   draft is cleared by whichever save runs first), clamped, and not at all
   when it equals the current size (resolveFontSizeDraft). */
function MobileFontSizeField({ value, onCommit }) {
  const [draft, setDraftState] = useState(null);
  // The draft is read from a ref so Enter-then-blur (or Escape-then-blur)
  // settles exactly once, whatever render the blur handler came from.
  const draftRef = useRef(null);
  const setDraft = (next) => {
    draftRef.current = next;
    setDraftState(next);
  };
  // The latest size and save callback, for the unmount save below.
  const latestRef = useRef({ value, onCommit });
  latestRef.current = { value, onCommit };
  const shown = draft ?? String(value ?? 16);
  const commit = () => {
    const pending = draftRef.current;
    if (pending === null) return;
    setDraft(null);
    const fontSize = resolveFontSizeDraft(pending, value);
    if (fontSize !== null) onCommit?.(fontSize);
  };
  useEffect(() => () => {
    const pending = draftRef.current;
    draftRef.current = null;
    const fontSize = resolveFontSizeDraft(pending, latestRef.current.value);
    if (fontSize !== null) latestRef.current.onCommit?.(fontSize);
  }, []);
  return (
    <input
      inputMode="numeric"
      aria-label="Font size"
      value={shown}
      onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/* The Text card's alignment rows, shared by the settings panel (text defaults)
   and the live text-edit strip's alignment button (the editor's own state).
   `keepFocus` is the live editor's pointerdown guard; the defaults panel passes
   none. Labels are the panel's own ("Left horizontal alignment", US "Center"). */
function MobileTextAlignmentCard({ textAlign = 'left', verticalAlign = 'top', onTextAlign, onVerticalAlign, keepFocus, showVertical = true }) {
  return (
    <section className="mobile-pdf-text-card mobile-pdf-text-card--alignment">
      <strong>Text alignment</strong>
      <div className="mobile-pdf-text-defaults__alignments" role="toolbar" aria-label="Text alignment">
        {['left', 'center', 'right'].map((alignment) => (
          <button
            key={alignment}
            type="button"
            aria-label={`${alignment[0].toUpperCase()}${alignment.slice(1)} horizontal alignment`}
            aria-pressed={textAlign === alignment}
            className={textAlign === alignment ? 'is-active' : ''}
            onPointerDown={keepFocus}
            onClick={() => onTextAlign?.(alignment)}
          >
            <MobileTextAlignmentGlyph axis="horizontal" value={['left', 'center', 'right'].indexOf(alignment)} />
          </button>
        ))}
      </div>
      {/* Review 2026-09-23: callout text is always vertically centred, so
          its card has no top / middle / bottom row (showVertical). */}
      {showVertical && (
      <div className="mobile-pdf-text-defaults__alignments" role="toolbar" aria-label="Vertical text alignment">
        {['top', 'middle', 'bottom'].map((alignment) => (
          <button
            key={alignment}
            type="button"
            aria-label={`${alignment === 'middle' ? 'Center' : `${alignment[0].toUpperCase()}${alignment.slice(1)}`} vertical alignment`}
            aria-pressed={verticalAlign === alignment}
            className={verticalAlign === alignment ? 'is-active' : ''}
            onPointerDown={keepFocus}
            onClick={() => onVerticalAlign?.(alignment)}
          >
            <MobileTextAlignmentGlyph axis="vertical" value={['top', 'middle', 'bottom'].indexOf(alignment)} />
          </button>
        ))}
      </div>
      )}
    </section>
  );
}

/* One of the panel's colour circles. HeroUI swatch behaviour (owner 2026-09-23,
   src/styles/swatches.css): the chosen colour is ringed in its OWN colour with a
   white (or dark, on a light colour) check - never gold. */
function MobilePanelColorSwatch({ color, chosen, label, onPick }) {
  return (
    <button
      type="button"
      className="hero-swatch"
      data-selected={chosen ? 'true' : 'false'}
      data-ink-swatch="true"
      aria-label={label}
      aria-pressed={chosen}
      style={{ borderRadius: '50%', '--hero-swatch-ring': swatchRingColour(color) }}
      onClick={onPick}
    >
      <span
        className={`hero-swatch__fill${needsSwatchHairline(color) ? ' has-hairline' : ''}`}
        style={{ background: color }}
      >
        {chosen && (
          <span className="hero-swatch__check" style={{ color: swatchCheckInk(color) }} aria-hidden="true">
            <ChosenCheck size={12} />
          </span>
        )}
      </span>
    </button>
  );
}
// Demo zoom-fit dropdown lists ONLY the fit modes (demo constants.tsx:92-96:
// Fit Page / Fit Width / Fit Height). 'manual' is the pinch-zoom RESULT state,
// never a menu choice, so it's filtered out here — keeps parity with the demo's
// 3-item fit menu while surfacing Fit Height (now that it's wired end-to-end in
// the pdf.js viewer: zoomController FIT_HEIGHT + PDFViewer handleZoomModeSelect).
const ZOOM_FIT_OPTIONS = ZOOM_MODE_OPTIONS.filter((option) => option.id !== 'manual');

export function MobilePdfViewerHeader({ id, documentName, onBack, topToolbarApi, bottomToolbarApi, activeSpace = null, onOpenSpaces = null, onTurnOffSpace = null }) {
  // OWNER DECISION 2 (2026-07-12): the page pill has two tap zones — the
  // fraction opens an inline page-jump input (type-to-jump), the chevron opens
  // the zoom/fit dropdown ONLY. The old combined page+zoom single surface is
  // gone. (demo App.tsx:462-475 inline input; :1215-1239 pill; :410-428 menu.)
  const [pageEditing, setPageEditing] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const pagesRef = useRef(null);
  const dismissInsideRefs = useMemo(() => [pagesRef], []);
  const title = documentName || 'Document';
  // Live scale, straight off the same state the desktop zoom field shows.
  const rawZoomPercent = Number.parseInt(bottomToolbarApi?.zoomInputValue, 10);
  const zoomPercent = Number.isFinite(rawZoomPercent) && rawZoomPercent > 0 ? rawZoomPercent : 100;

  const openPageEdit = () => {
    setZoomOpen(false);
    setPageEditing(true);
  };

  const toggleZoom = () => {
    setPageEditing(false);
    setZoomOpen((open) => !open);
  };

  return (
    /* UX 2026-09-21 (pass 7, board 1): the header does NOT show the PDF name.
       A phone header has room for three things and the name was pushing the
       page cluster and undo/redo into each other; the name is on the document
       list you came from, and it stays here as this bar's accessible name so a
       screen reader still announces which document is open. */
    <header id={id} className="mobile-pdf-header" data-mobile-pdf-header="true" aria-label={title}>
      <DismissBarrier
        active={pageEditing || zoomOpen}
        insideRefs={dismissInsideRefs}
        onDismiss={() => {
          setPageEditing(false);
          setZoomOpen(false);
        }}
      />
      <div className="mobile-pdf-header__document">
        {/* UX 2026-09-16: one glyph size for every action icon in this bar.
            Back, the two page chevrons and undo/redo all draw at HEADER_GLYPH,
            so the same chevron is never two different sizes side by side — back
            used to be a third bigger than the identical page chevron two
            controls to its right. The zoom disclosure caret stays smaller on
            purpose: it reads as a caret beside a label, not as an action
            icon. */}
        <button type="button" className="mobile-pdf-header__icon" aria-label="Back to documents" onClick={onBack}>
          <Icon name="chevronLeft" size={HEADER_GLYPH} color="currentColor" />
        </button>
      </div>

      <div className="mobile-pdf-header__pages" ref={pagesRef}>
        <button
          type="button"
          className="mobile-pdf-header__page-nav"
          aria-label="Previous page"
          disabled={(bottomToolbarApi?.pageNum || 1) <= 1}
          onClick={bottomToolbarApi?.goToPreviousPage}
        >
          {/* UX 2026-09-16: same HEADER_GLYPH as Back and undo/redo. */}
          <Icon name="chevronLeft" size={HEADER_GLYPH} color="currentColor" />
        </button>

        <div className={`mobile-pdf-header__page-pill${(pageEditing || zoomOpen) ? ' is-open' : ''}`}>
          {pageEditing ? (
            <span className="mobile-pdf-header__page-frac">
              <input
                className="mobile-pdf-header__page-input"
                aria-label="Page number"
                inputMode="numeric"
                maxLength={3}
                autoFocus
                /* Uncontrolled while open (2026-09-23 rail audit): the value
                   returns from PDFViewer a render late, so a controlled field
                   snapped back between fast keystrokes and dropped digits.
                   Enter / blur commit this DOM value. */
                defaultValue={bottomToolbarApi?.pageInputValue ?? ''}
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  const clean = event.target.value.replace(/\D/g, '');
                  if (clean !== event.target.value) event.target.value = clean;
                  bottomToolbarApi?.handlePageInputChange?.(event);
                }}
                onKeyDown={(event) => {
                  bottomToolbarApi?.handlePageInputKeyDown?.(event);
                  if (event.key === 'Enter') setPageEditing(false);
                }}
                onBlur={(event) => {
                  bottomToolbarApi?.handlePageInputBlur?.(event);
                  setPageEditing(false);
                }}
              />
              <span className="mobile-pdf-header__page-total">/ {bottomToolbarApi?.activeSpaceHasNoPages ? 0 : (bottomToolbarApi?.numPages || 1)}</span>
            </span>
          ) : (
            /* UX: the WHOLE "n / N" fraction is the page-jump tap zone (owner
               decision 2) — flex-grows to fill the pill left of the chevron so
               it's a comfortable target, not just the ordinal digit. */
            <button
              type="button"
              className="mobile-pdf-header__page-frac"
              aria-label="Jump to page"
              onClick={openPageEdit}
            >
              {bottomToolbarApi?.activeSpaceHasNoPages ? 0 : (bottomToolbarApi?.pageNum || 1)}
              <span className="mobile-pdf-header__page-total">/ {bottomToolbarApi?.activeSpaceHasNoPages ? 0 : (bottomToolbarApi?.numPages || 1)}</span>
            </button>
          )}
          <button
            type="button"
            className="mobile-pdf-header__page-chevron"
            aria-label="Zoom and fit options"
            aria-expanded={zoomOpen}
            onClick={toggleZoom}
          >
            <Icon name="chevronDown" size={11} color="currentColor" />
          </button>
        </div>

        <button
          type="button"
          className="mobile-pdf-header__page-nav"
          aria-label="Next page"
          disabled={(bottomToolbarApi?.pageNum || 1) >= (bottomToolbarApi?.numPages || 1)}
          onClick={bottomToolbarApi?.goToNextPage}
        >
          {/* UX 2026-09-16: same HEADER_GLYPH as Back and undo/redo. */}
          <Icon name="chevronRight" size={HEADER_GLYPH} color="currentColor" />
        </button>

        {/* Phase F: the zoom/fit dropdown stays mounted so it can animate BOTH
            in (~150ms) and out (~130ms) via CSS — opacity + translateY(-4->0) +
            scale(.97->1), demo App.tsx:410-428. `is-open` drives the state;
            visibility flips off only after the out-transition so it leaves the
            tab order when closed. prefers-reduced-motion drops the easing. */}
        {bottomToolbarApi && (
          <div
            className={`mobile-pdf-header__zoom-menu${zoomOpen ? ' is-open' : ''}`}
            aria-hidden={!zoomOpen}
          >
            {/* UX 2026-09-16 (phone reach pass): the phone could only pick a fit
                mode here — there was no way to step the zoom by hand and no
                number telling you where you were, so the only manual zoom on a
                phone was a pinch. Minus and plus step by exactly the desktop's
                1.25x per tap and honour the same 1%-4000% limits (they call the
                very same zoomOut/zoomIn the desktop toolbar uses), and the
                reading between them is the live scale. The menu deliberately
                stays open so you can tap up or down repeatedly. Reference:
                Drawboard PDF's phone zoom control pairs steppers with a live
                percentage rather than fit modes alone. */}
            <div className="mobile-pdf-header__zoom-steppers" role="group" aria-label="Zoom level">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoomPercent <= MOBILE_ZOOM_MIN_PERCENT}
                onClick={() => bottomToolbarApi.zoomOut?.()}
              >
                <Icon name="minus" size={HEADER_GLYPH} color="currentColor" />
              </button>
              <span className="mobile-pdf-header__zoom-percent" aria-live="polite">{`${zoomPercent}%`}</span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoomPercent >= MOBILE_ZOOM_MAX_PERCENT}
                onClick={() => bottomToolbarApi.zoomIn?.()}
              >
                <Icon name="plus" size={HEADER_GLYPH} color="currentColor" />
              </button>
            </div>
            <div className="mobile-pdf-header__zoom-fits" role="listbox" aria-label="Zoom and fit mode">
              {ZOOM_FIT_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  role="option"
                  aria-selected={bottomToolbarApi.zoomMode === option.id}
                  className={bottomToolbarApi.zoomMode === option.id ? 'is-active' : ''}
                  onClick={() => {
                    bottomToolbarApi.handleZoomModeSelect(option.id);
                    setZoomOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {bottomToolbarApi.zoomMode === option.id && <Icon name="check" size={14} color="currentColor" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mobile-pdf-header__history">
        <button
          type="button"
          className="mobile-pdf-header__icon"
          aria-label="Undo"
          disabled={!topToolbarApi?.canUndo}
          onClick={topToolbarApi?.onUndo || undefined}
        >
          {/* UX: share the desktop undo arrow without changing the phone touch target. */}
          <Icon name="undo" size={HISTORY_GLYPH} color="currentColor" />
        </button>
        <button
          type="button"
          className="mobile-pdf-header__icon"
          aria-label="Redo"
          disabled={!topToolbarApi?.canRedo}
          onClick={topToolbarApi?.onRedo || undefined}
        >
          {/* UX: share the desktop redo arrow without changing the phone touch target. */}
          <Icon name="redo" size={HISTORY_GLYPH} color="currentColor" />
        </button>
      </div>
      {/* Spaces chunk B: the active space, floating just under the top bar
          (and under a tool strip when one is open - see the CSS). The words
          open the Spaces sheet; x turns the space off. Hidden while drawing
          a space's areas: it sat over the top of the page and blocked
          starting an area there (owner 2026-10-01). */}
      {activeSpace && !bottomToolbarApi?.regionEditing && (
        <div className="mobile-pdf-header__space">
          <ActiveSpaceChip
            name={activeSpace.name}
            pageCount={activeSpace.pageCount}
            onOpen={onOpenSpaces}
            onTurnOff={onTurnOffSpace}
          />
        </div>
      )}
    </header>
  );
}

export function MobileToolProperties({ api }) {
  // 2026-07-12 (Phase E, demo parity): which colour control has the shared
  // CompactColorPicker takeover open. null | 'textColor' | 'fill' | 'stroke'
  // | 'fontColorLive'. Replaces the old OS <input type=color> swatches so
  // every mobile colour control reuses the app's one shared picker (project
  // rule: color_picker_unified).
  const [colorPicker, setColorPicker] = useState(null);
  const [textDefaultsOpen, setTextDefaultsOpen] = useState(false);
  // Phase F (motion & feel): the text-defaults sheet gets the shared bottom-sheet
  // motion — finger-follow drag off the handle, dy>82/vy>0.65 dismiss, spring-
  // back, and a 170ms slide-down exit before the portal unmounts (demo
  // AnnotationEditPanel.tsx:141-199 / inv-demo §17).
  const {
    motionStyle: textSheetMotionStyle,
    backdropStyle: textSheetBackdropStyle,
    sheetProps: textSheetProps,
    requestClose: requestTextSheetClose,
  } = useMobileSheetMotion(() => setTextDefaultsOpen(false), { open: textDefaultsOpen });
  /* RESTORED 2026-09-23 (owner: "We had panels for every single annotation ...
     I hope we didn't lose what we had before"). The panel above is the ONE
     "<Tool> settings" panel again - opened from the "..." at the end of every
     tool strip, from "Aa" on a text box or callout (its Text side), and from the
     live text strip's alignment button (its alignment card). The row-list
     sheets that replaced it on 2026-09-22 (the arrow / counter "..." sheet, the
     "Aa" Text sheet and the Text alignment sheet) are gone; their controls live
     in the panel's cards. */
  const [textDefaultsTab, setTextDefaultsTab] = useState('text');
  const [textShapeColorSection, setTextShapeColorSection] = useState('fill');
  const tool = api?.contextTool || api?.activeTool;
  // Every strip below lies over the top of the PDF scroll area; registering it
  // gives the viewer scroll room to move the page out from under it (owner
  // 2026-09-23, src/utils/viewerTopOverlay.js).
  const topOverlayRef = useViewerTopOverlayRef();
  const textMarkup = getMobileTextMarkupPresentation(api);
  const liveTextEditing = Boolean(api?.richTextEditor);

  useEffect(() => {
    // Close every tool-scoped popover/sheet when the active tool changes so a
    // stale colour picker or edit sheet never bleeds across tools. Starting or
    // ending a live text edit closes it too: the panel shows the editor's
    // alignment card while typing and the tool's defaults otherwise, so one must
    // never carry over into the other.
    setColorPicker(null);
    setTextDefaultsOpen(false);
    api?.setShowAnnotationColorPicker?.(false);
  }, [tool, liveTextEditing]);

  if (!api) return null;

  if (api.regionEditing && api.regionToolbarApi) {
    const region = api.regionToolbarApi;
    // UX (demo parity): tapping "Full Page" swaps this strip into an inline
    // "Make region full page?" Confirm/Cancel step instead of a browser
    // dialog — matches demo App.tsx:1644-1658 / AnnotationFormattingBar.tsx:195-207.
    if (region.fullPageConfirmPending) {
      return (
        <div className="mobile-pdf-properties mobile-pdf-properties--actions" data-mobile-tool-properties="true" role="toolbar" aria-label="Confirm full page region" ref={topOverlayRef}>
          <span className="mobile-pdf-properties__confirm-label">Make region full page?</span>
          <button type="button" className="mobile-pdf-properties__primary" onClick={region.confirmFullPage}>Confirm</button>
          <button type="button" onClick={region.cancelFullPage}>Cancel</button>
        </div>
      );
    }
    return (
      <div className="mobile-pdf-properties mobile-pdf-properties--actions" data-mobile-tool-properties="true" role="toolbar" aria-label="Region editing" ref={topOverlayRef}>
        <button type="button" className="mobile-pdf-properties__primary" onClick={region.confirm}>Confirm</button>
        <button type="button" disabled={!region.canDelete} onClick={region.deleteSelected}>Delete</button>
        <button type="button" disabled={!region.canSetFullPage} onClick={region.setFullPage}>Full page</button>
        <button type="button" onClick={region.cancel}>Cancel</button>
      </div>
    );
  }

  if (
    api.showSurveyPanel
    && api.surveyToolbar
    && ['survey-marker', 'pan', 'select'].includes(api.activeTool)
    && (!api.contextTool || api.contextTool === api.activeTool)
  ) {
    const survey = api.surveyToolbar;
    return (
      <div className="mobile-pdf-properties mobile-pdf-properties--survey" data-mobile-tool-properties="true" role="toolbar" aria-label="Survey placement" ref={topOverlayRef}>
        {/* App-styled dropdown (OWNER DECISION 3) replaces the OS module roller. */}
        {/* Owner 2026-09-30 (survey bar design, decided after a design review):
              [ Module v ] (switch) Reuse  ...  | Exit
            - The pill is exactly as wide as its LONGEST module name
              (fitOptions: every name sits invisibly in one grid cell), so
              switching module never moves the switch; it shrinks and
              ellipsises only when the row runs out of room.
            - "Keep active" is the desktop survey row's plateless switch,
              relabelled "Repeat", then "Reuse" (owner 2026-10-01): it keeps
              the CATEGORY armed after a Survey Marker is placed (PDFViewer
              clears selectedCategoryId otherwise).
            - Exit is a red word on the trailing edge after a rule; it calls
              the same handler as the Survey panel's "Exit Survey", with no
              confirm step. */}
        <MobileStyledSelect
          ariaLabel="Survey module"
          fitOptions
          disabled={!survey.modules?.length}
          placeholder="No modules"
          value={survey.selectedModuleId || ''}
          options={(survey.modules || []).map((module) => ({ value: module.id, label: module.name || 'Untitled Module' }))}
          onChange={(value) => survey.onSelectModule?.(value)}
        />
        <button
          type="button"
          className="mobile-pdf-properties__keep"
          role="switch"
          aria-checked={Boolean(survey.keepCategoryActive)}
          aria-label="Reuse category"
          onClick={() => survey.onKeepCategoryActiveChange?.(!survey.keepCategoryActive)}
        >
          <span className="mobile-pdf-properties__keep-track" aria-hidden="true" />
          <span>Reuse</span>
        </button>
        {survey.onExit ? (
          <>
            <span aria-hidden="true" className="mobile-pdf-properties__divider mobile-pdf-properties__divider--push" />
            <button
              type="button"
              className="mobile-pdf-properties__exit"
              aria-label="Exit Survey mode"
              onClick={() => survey.onExit()}
            >
              Exit
            </button>
          </>
        ) : null}
      </div>
    );
  }

  if (api.richTextEditor) {
    const editor = api.richTextEditor;
    const state = editor.state || {};
    const editorApi = editor.api || {};
    const textAlign = state.textAlign || 'left';
    const verticalAlign = state.verticalAlign || 'top';
    const liveAlignment = HORIZONTAL_ALIGNMENTS.find((option) => option.value === textAlign)
      || HORIZONTAL_ALIGNMENTS[0];
    return (
      <>
      {/* data-rich-text-toolbar is TextEditOverlay's opt-out contract: a
          pointerdown anywhere inside it must not commit-and-close the editor.
          The desktop sub-row has always carried it; the phone bar did not, so a
          tap on Bold committed the text and then styled an editor that was
          already unmounting. */}
      <div className="mobile-pdf-properties mobile-pdf-properties--text" data-mobile-tool-properties="true" data-rich-text-toolbar role="toolbar" aria-label="Text formatting" ref={topOverlayRef}>
        {/* UX 2026-07-12 (Phase E, demo parity): font-colour swatch opens the
            app's shared CompactColorPicker takeover, not an OS colour input.
            PASS 7: it stays ONE swatch rather than gaining the quick-colour
            discs — four discs plus a rainbow is 110px, and this strip has 331px
            for seven controls. */}
        <button
          type="button"
          className="mobile-pdf-properties__color"
          aria-label="Font color"
          title="Font color"
          onPointerDown={keepTextEditFocus}
          onClick={() => setColorPicker('fontColorLive')}
        >
          <span style={{ background: composeTextColor(splitTextColor(state.fontColor).hex, splitTextColor(state.fontColor).opacity) }} />
        </button>
        <MobileStripDivider />
        {/* The font name ellipsises rather than widening the pill: a strip is a
            row of fixed widths, and the menu shows every name in full. */}
        <MobileStyledSelect
          ariaLabel="Font"
          value={state.fontFamily || 'Arial'}
          options={MOBILE_FONT_FAMILY_OPTIONS}
          onChange={(family) => editorApi.setFontFamily?.(family)}
          width="var(--mobile-strip-font-w)"
        />
        {/* The bare numeric input this replaced could not carry its unit and
            needed the iOS keypad for a value that is almost always one of the
            standard sizes. It is the desktop bar's dropdown now, at the strip's
            own size, and it reads "16 pt". */}
        <MobileStyledSelect
          ariaLabel="Font size"
          value={String(state.fontSize ?? 16)}
          options={mobileFontSizeOptions(state.fontSize ?? 16)}
          onChange={(size) => {
            const next = Number.parseInt(size, 10);
            if (Number.isFinite(next)) editorApi.setFontSize?.(Math.max(1, Math.min(200, next)));
          }}
          width="var(--mobile-strip-fontsize-w)"
        />
        <MobileStripDivider />
        {/* B / I / U / S are one 80px group of four 20px buttons, not four
            separate 28px controls 4px apart (124px). Their hit pads tile the
            group exactly — 20 x 44 each, no overlap — because two pads that
            overlap hand the press to the later sibling. */}
        <div className="mobile-pdf-properties__format-group" role="group" aria-label="Text style">
          {[
            ['formatBold', 'bold', 'toggleBold', 'Bold'],
            ['formatItalic', 'italic', 'toggleItalic', 'Italic'],
            ['formatUnderline', 'underline', 'toggleUnderline', 'Underline'],
            ['formatStrikethrough', 'strike', 'toggleStrike', 'Strikethrough'],
          ].map(([iconName, stateKey, method, title]) => (
            <button
              key={stateKey}
              type="button"
              className={`mobile-pdf-properties__format${state[stateKey] ? ' is-active' : ''}`}
              aria-label={title}
              aria-pressed={Boolean(state[stateKey])}
              onPointerDown={keepTextEditFocus}
              onClick={() => editorApi[method]?.()}
            >
              <Icon name={iconName} size={STRIP_GLYPH} />
            </button>
          ))}
        </div>
        {/* ONE alignment button, drawing the horizontal alignment in force. It
            opens the tool's settings panel on its alignment card (restored
            2026-09-23 - it used to open a separate "Text alignment" row sheet).
            It replaces a 104px pill whose label read "top left" and whose menu
            was nine rows of "vertical horizontal" - the control that fell off
            the right edge of every phone we support. */}
        <button
          type="button"
          className={`mobile-pdf-properties__align${textDefaultsOpen ? ' is-active' : ''}`}
          aria-label="Text alignment"
          title="Text alignment"
          aria-expanded={textDefaultsOpen}
          onPointerDown={keepTextEditFocus}
          onClick={() => setTextDefaultsOpen((open) => !open)}
        >
          <Icon name={liveAlignment.icon} size={STRIP_GLYPH} color="currentColor" />
        </button>
      </div>
      {colorPicker === 'fontColorLive' && (
        <MobileColorPickerSurface
          title="Font color"
          /* UX 2026-09-23 (owner: text colour opacity everywhere text colour
             is picked). The Opacity row the desktop text popover has; the
             sheet hugs its content, so the row adds its own height and
             nothing else moves. 5% floor, as for a highlight; the
             Transparent cell never makes text invisible. */
          color={splitTextColor(state.fontColor).hex}
          opacity={splitTextColor(state.fontColor).opacity}
          minOpacity={0.05}
          firstPreset="none"
          onChange={(hex, alpha, meta) => editorApi.setFontColor?.(
            composeTextColor(hex, alpha > 0 ? alpha : splitTextColor(state.fontColor).opacity),
            meta,
          )}
          onClose={() => setColorPicker(null)}
        />
      )}
      {/* The restored settings panel, on its alignment card, acting on the text
          being typed. Everything else the Text side holds (colour, font, size,
          B / I / U / S) is on the live strip right above it. It carries
          data-rich-text-toolbar because it portals to document.body: without the
          opt-out, TextEditOverlay's document-level pointerdown listener would
          commit and close the text box the moment a finger landed on it (see
          TextEditOverlay's onDocPointerDown). */}
      {textDefaultsOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            className="mobile-pdf-sheet-backdrop"
            data-rich-text-toolbar
            aria-label="Close text formatting"
            onPointerDown={keepTextEditFocus}
            onClick={requestTextSheetClose}
            style={textSheetBackdropStyle}
          />
          <section
            className="mobile-pdf-text-defaults is-text"
            data-rich-text-toolbar
            aria-label={`${TOOL_LABELS[tool] || 'Text'} settings`}
            {...textSheetProps}
            style={textSheetMotionStyle}
          >
            <div className="mobile-pdf-sheet__handle" />
            {/* Owner 2026-09-30: no close X - a tap outside or a swipe down
                (anywhere on the sheet) closes it. */}
            <header>
              <div>
                <strong>{TOOL_LABELS[tool] || 'Text'} settings</strong>
                <span>Focused on Text</span>
              </div>
            </header>
            <div className="mobile-pdf-text-defaults__scroll">
              <MobileTextAlignmentCard
                textAlign={textAlign}
                verticalAlign={verticalAlign}
                keepFocus={keepTextEditFocus}
                showVertical={api.textVerticalAlignSupported !== false}
                onTextAlign={(next) => editorApi.setTextAlign?.(next)}
                onVerticalAlign={(next) => editorApi.setVerticalAlign?.(next)}
              />
            </div>
          </section>
        </>,
        document.body,
      )}
      </>
    );
  }

  // BOARD 7 — Select. The strip is the Box / Lasso / Text segmented toggle and
  // nothing else, using the app's own three select glyphs. It is the SAME
  // control as the desktop bar's, so a mode picked on one platform reads the
  // same on the other.
  // 2026-09-22 (owner ruling): this is now the ONLY mode control — the rail's
  // caret and its pop-up are gone — so it has to be reachable from ALL THREE
  // modes, Text included. It therefore sits ABOVE the text-markup branch and
  // covers text-select too: with Text Select armed and no range dragged yet,
  // the strip is the toggle, so Text is never a one-way door. The moment a
  // range is live, or a mark is selected (contextTool names that mark's tool),
  // the strip below belongs to the mark instead.
  const selectFamilyActive = api.activeTool === 'select' || api.activeTool === 'text-select';
  if (
    selectFamilyActive
    && (!api.contextTool || api.contextTool === api.activeTool)
    && !api.hasLiveTextSelection
  ) {
    const selectMode = api.activeTool === 'text-select' ? 'text' : (api.selectionMode || 'rectangle');
    return (
      <div className="mobile-pdf-properties" data-mobile-tool-properties="true" role="toolbar" aria-label="Select settings" ref={topOverlayRef}>
        <MobileStripSegmented
          ariaLabel="Selection mode"
          width={150}
          value={selectMode}
          onChange={(mode) => {
            const next = getSelectFamilyTransition(mode);
            api.setSelectionMode?.(next.selectionMode);
            api.setActiveTool?.(next.activeTool);
          }}
          options={[
            { value: 'rectangle', label: 'Box', ariaLabel: 'Box select', icon: getSelectModeIconName('rectangle') },
            { value: 'lasso', label: 'Lasso', ariaLabel: 'Lasso select', icon: getSelectModeIconName('lasso') },
            { value: 'text', label: 'Text', ariaLabel: 'Text select', icon: getSelectModeIconName('text') },
          ]}
        />
      </div>
    );
  }

  if (textMarkup.active) {
    const markupColor = toHexColor(textMarkup.color, '#f4d35e');
    const markupOpacity = textMarkup.opacity / 100;
    // The one write this strip's colour controls share — the quick dots and the
    // picker the colour button opens. A highlight keeps its own strength unless
    // the picker's slider is what moved, so a dot passes no alpha and the mark
    // keeps the opacity it had; 5% is the floor below which a highlight stops
    // marking anything at all.
    // `meta` is the picker's drag phase (UX 2026-09-23, CompactColorPicker):
    // a drag previews live and lands as ONE undo step on release.
    const applyMarkupPaint = (hex, alpha, meta) => {
      const opacity = Math.round(Math.max(0.05, alpha ?? markupOpacity) * 100);
      if (api.handleTextMarkupPaintChange) api.handleTextMarkupPaintChange(hex, opacity, meta);
      else {
        api.handleStrokeColorChange?.(hex, meta?.phase === 'commit' ? { phase: 'settle' } : meta);
        api.handleStrokeOpacityChange?.(opacity, meta);
      }
    };
    // 2026-09-22 (owner ruling: a selected mark's own controls must appear in
    // the strip). This used to return the picker alone and NO strip whenever a
    // text markup was selected or a range was live — the one annotation kind on
    // the phone that showed nothing when you tapped it, while the desktop bar
    // showed its colour row. The row renders in both states now; it is the same
    // row, acting on the selected mark or on the live range, and the floating
    // action bar it sits above owns the Highlight / Underline / Strike actions,
    // not the paint.
    return (
      <>
        <div
          className="mobile-pdf-properties mobile-pdf-properties--text-markup"
          data-mobile-tool-properties="true"
          data-mobile-text-markup-controls={textMarkup.editingSelection ? 'edit' : 'create'}
          role="toolbar"
          aria-label={textMarkup.editingSelection ? 'Edit text markup' : 'Text markup defaults'}
          ref={topOverlayRef}
        >
          {/* UX 2026-09-17 (owner): the same four quick colours the desktop
              text-markup row leads with. The phone strip had the colour
              button but no dots, which made highlighting the one place on
              the phone where changing colour still cost a sheet — and the
              one place the two platforms disagreed about what a tool row
              looks like. A tap repaints the armed markup and the selected
              one at the strength they already have. */}
          <QuickColourDots
            platform="phone"
            value={markupColor}
            onPick={(hex) => applyMarkupPaint(hex)}
          />
          <button
            type="button"
            /* No chosen mark on this button: the discs beside it carry it, and
               the class that used to put a gold ring here has had no rule behind
               it since the owner reversed that on 2026-09-21. */
            className="mobile-pdf-properties__color"
            aria-label="Text markup color and opacity"
            title="Text markup color and opacity"
            aria-expanded={Boolean(api.showAnnotationColorPicker)}
            onClick={() => api.setShowAnnotationColorPicker?.(true)}
          >
            <span style={{ background: markupColor, opacity: markupOpacity }} />
          </button>
          <MobileStyledSelect
            ariaLabel="Highlight overlap mode"
            minWidth={92}
            value={textMarkup.overlapMode}
            options={[
              { value: 'layered', label: 'Layered' },
              { value: 'uniform', label: 'Uniform' },
            ]}
            onChange={(value) => api.setTextMarkupOverlapMode?.(value)}
          />
        </div>
        {api.showAnnotationColorPicker && (
          <MobileColorPickerSurface
            title="Text markup color"
            color={markupColor}
            opacity={markupOpacity}
            minOpacity={0.05}
            onChange={applyMarkupPaint}
            onClose={() => api.setShowAnnotationColorPicker?.(false)}
          />
        )}
      </>
    );
  }

  // Pan has nothing to set, so it has no strip and the page keeps the 36px.
  if (api.activeTool === 'pan') return null;

  const isEraser = tool === 'eraser';
  // w41: the picked mark(s) decide what can change - a partly erased or
  // imported pen stroke has no width to set, and a mixed pick offers only what
  // at least one picked mark has (PDFViewer selectionCapabilities).
  const selectionCaps = api.selectionCapabilities || null;
  const showWidth = isEraser || (WIDTH_TOOLS.has(tool) && selectionCaps?.width !== false);
  const showFill = FILL_TOOLS.has(tool) && typeof api.handleFillColorChange === 'function';
  const showBorderStyle = BORDER_STYLE_TOOLS.has(tool) && typeof api.setLineBorderStyle === 'function'
    && selectionCaps?.lineStyle !== false;
  const showArrowhead = (tool === 'arrow' || tool === 'callout') && typeof api.setArrowheadStyle === 'function';
  const showStroke = !isEraser && (WIDTH_TOOLS.has(tool) || FILL_TOOLS.has(tool));
  const sizeLabel = isEraser || tool === 'counter' ? 'Size' : 'Width';
  const sizeValue = isEraser ? api.eraserSizeInputValue : api.strokeWidthInputValue;
  const sizeMin = tool === 'counter' ? COUNTER_SIZE_MIN : 1;
  const sizeMax = isEraser ? 100 : tool === 'counter' ? COUNTER_SIZE_MAX : 50;
  const sizePresets = isEraser
    ? ANNOTATION_SIZE_PRESETS.eraser
    : tool === 'counter'
      ? ANNOTATION_SIZE_PRESETS.counter
      : ANNOTATION_SIZE_PRESETS.width;
  const handleSizeDraft = (value) => {
    const handler = isEraser ? api.handleEraserSizeInputChange : api.handleStrokeWidthInputChange;
    handler?.({ target: { value } });
  };
  const handleSizeCommit = (value) => {
    const handler = isEraser ? api.handleEraserSizeInputBlur : api.handleStrokeWidthInputBlur;
    handler?.({ currentTarget: { value } });
  };
  const handleSizeFocus = (focused) => {
    if (isEraser) api.setIsEraserSizeFocused?.(focused);
    else api.setIsStrokeWidthFocused?.(focused);
  };

  if (!isEraser && !showStroke && !showFill && !showBorderStyle && !showArrowhead) return null;

  const textDefaults = api.textStyleDefaults || {
    fontColor: '#1e293b',
    fontFamily: 'Arial',
    fontSize: 16,
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    textAlign: 'left',
    verticalAlign: 'top',
  };
  // UX 2026-09-23: with a text box or callout selected, PDFViewer publishes
  // ITS text style here and writes changes to it (utils/selectedTextFormatting);
  // `meta` is the colour picker's drag phase, so a drag is one undo step. The
  // third argument is ONLY what this control changed, so a picked mark is
  // patched with that alone (never this render's possibly stale other fields).
  const updateTextDefaults = (patch, meta) => api.onTextStyleDefaultsChange?.({ ...textDefaults, ...patch }, meta, patch);
  // 2026-07-12 (Phase E, demo parity — matrix §6): the full edit panel opens
  // for EVERY annotation tool (demo AnnotationEditPanel), not just text/callout.
  // Non-text tools show only the shape-side cards; the eraser shows its own card.
  const isTextTool = tool === 'text' || tool === 'callout';
  const sheetTitle = TOOL_LABELS[tool] || 'Annotation';
  // Effective panel tab: text/callout keep the Text/Shape segmented control;
  // pen/shape/counter force the shape-side cards.
  const sheetTab = isTextTool ? textDefaultsTab : 'shape';
  // Tools without a fill (pen/highlighter/line/arrow/polyline) collapse the
  // shape colour card to a single Stroke section (no Fill/Stroke sub-tabs).
  const hasFillSheet = FILL_TOOLS.has(tool);
  const shapeSection = hasFillSheet ? textShapeColorSection : 'stroke';
  const showBorderStyleSheet = BORDER_STYLE_TOOLS.has(tool) && typeof api.setLineBorderStyle === 'function';
  const shapeColor = shapeSection === 'fill'
    ? toHexColor(api.fillColor, '#ffffff')
    : toHexColor(api.strokeColor, '#ff0000');
  const applyShapeColor = (color) => {
    if (shapeSection === 'fill') {
      api.handleFillColorChange?.(color);
      // A shape with no fill is a fill at 0% opacity, so a circle tapped on the
      // Fill tab would change a colour nobody can see. Picking a fill makes it
      // visible; a fill that already has a strength keeps it.
      if (Number(api.fillOpacity) === 0) api.handleFillOpacityChange?.(100);
    } else api.handleStrokeColorChange?.(color);
  };
  // A counter's two colours are its pin (the fill) and the number printed on it
  // (the stroke), so its second tab is "Number" - the same word the colour
  // picker's tab uses for it.
  const shapeSectionLabel = (section) => {
    if (section === 'fill') return 'Fill';
    // Owner 2026-09-23: one word app-wide - the colour picker's tabs say
    // "Border", so this panel does too (it said "Stroke").
    return tool === 'counter' ? 'Number' : 'Border';
  };
  // Open the panel. "..." opens the Shape side on the channel the strip's swatch
  // shows (the border for a shape, the pin for a counter); "Aa" opens the Text
  // side (demo: swatch / Aa -> AnnotationEditPanel focused on that face).
  const openSheet = (tab = 'shape') => {
    setTextShapeColorSection(tool === 'counter' ? 'fill' : 'stroke');
    setTextDefaultsTab(tab);
    setTextDefaultsOpen(true);
  };
  // UX 2026-09-17: WHICH COLOUR A QUICK DOT CHANGES — the same rule as the
  // desktop bar (see resolveAnnotationPaint in src/AppShell.jsx). The dots
  // change the paint you can see, which for every tool but one is the line:
  // the stroke of a pen or an arrow, the border of a rectangle, ellipse,
  // polygon, text box or callout. That is also what the two controls beside
  // them act on — the line width and the line type. The counter is the
  // exception and takes the fill, because a pin's colour IS its fill and its
  // stroke is only the number printed on it. Opacity is untouched: it belongs
  // to the sheet's slider, not to a dot.
  const quickColourValue = tool === 'counter'
    ? toHexColor(api.fillColor, '#ef4444')
    : toHexColor(api.strokeColor, '#ff0000');
  // w41: picked marks in different colours ring no disc.
  const quickColourShown = api.selectionMixed?.strokeColor ? null : quickColourValue;
  const applyQuickColour = (hex) => {
    if (tool === 'counter') api.handleFillColorChange?.(hex);
    else api.handleStrokeColorChange?.(hex);
  };
  // ---- PASS 7 strip option lists ------------------------------------------
  // The strip's pills are dropdowns ONLY (owner ruling: "Width is a dropdown
  // ONLY — stroke sample + '2 pt' + chevron. Never a bare line."), so the
  // options are built here from the app's own preset lists rather than from a
  // second list this file invents. A value the presets do not hold — a 2.5pt
  // cloud line, a width typed into the sheet — is prepended so the pill always
  // reads the width actually in force instead of falling back to a placeholder.
  const withCurrentValue = (presets, current) => {
    const value = String(current ?? '');
    const list = presets.map((preset) => String(preset));
    return list.includes(value) && value ? list : [value, ...list].filter(Boolean);
  };
  const widthOptions = withCurrentValue(ANNOTATION_SIZE_PRESETS.width, sizeValue).map((width) => ({
    value: width,
    label: `${width} pt`,
    preview: strokeSample(width, 12),
    menuPreview: strokeSample(width, 24),
  }));
  // Board 6: the eraser's size field reads a bare number with a round nib
  // beside it — an eraser is measured in screen pixels, not in points, so it is
  // the one numeric field on the strip with no unit.
  const eraserSizeOptions = withCurrentValue(ANNOTATION_SIZE_PRESETS.eraser, sizeValue).map((size) => ({
    value: size,
    label: size,
    preview: <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />,
    menuPreview: <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />,
  }));
  // w41: picked marks with different line styles read "Mixed" (no row
  // chosen) until one style is picked for all of them.
  const lineStyleMixed = !!api.selectionMixed?.lineStyle;
  const lineStylePlaceholder = lineStyleMixed ? 'Mixed' : undefined;
  const lineStyleValue = lineStyleMixed
    ? ''
    : api.lineBorderStyle === 'cloud' && !api.supportsCloudStyle
    ? 'solid'
    : (api.lineBorderStyle || 'solid');
  const lineStyleOptions = [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
    /* Cloud is offered on every shape a revision cloud can enclose or trace and
       never on an arrow, a counter or a single straight line. supportsCloudStyle
       mirrors the desktop gate exactly. */
    ...(api.supportsCloudStyle ? [{ value: 'cloud', label: 'Cloud' }] : []),
  ].map((option) => ({
    ...option,
    preview: lineStyleSample(option.value, 18),
    menuPreview: lineStyleSample(option.value, 24),
  }));
  const arrowheadValue = api.arrowheadStyle || 'solidTriangle';
  /* PASS 7 (boards 15 + 16): the six heads the boards offer, in board order,
     each named with ONE word — None, Solid, Open, Circle, Square, Bar. The list
     and the words are the shared ARROWHEAD_MENU_ORDER / ARROWHEAD_SHORT_LABELS
     (src/components/Callout/types.js), which the desktop bar reads too, so the
     phone sheet and the desktop pill can never name the same head differently.
     This used to hold the app's PROSE names, stretched longer still ("Solid
     Triangle", "Horizontal Line"), and a 96px field sliced them mid-word.
     An imported-only head (open triangle, diamond, slash) is prepended when it
     is the live one, exactly as the desktop bar does, so the pill never lies
     about the mark in force. */
  const arrowheadOptions = [
    ...(ARROWHEAD_MENU_ORDER.includes(arrowheadValue) ? [] : [arrowheadValue]),
    ...ARROWHEAD_MENU_ORDER,
  ].map((value) => ({
    value,
    label: ARROWHEAD_SHORT_LABELS[value] || 'Arrowhead',
    preview: arrowheadSample(value, 15),
    menuPreview: arrowheadSample(value, 20),
  }));
  // Board 16's Arrow ends: End / Both / None. "None" is the app's own
  // arrowhead style 'none' (no head at either end), "Both" is its arrowBothEnds
  // flag, and "End" is the plain one-headed arrow — the three states the arrow
  // already had, given the one control the board draws for them.
  const arrowEndsValue = arrowheadValue === 'none' ? 'none' : (api.arrowBothEnds ? 'both' : 'end');
  const applyArrowEnds = (next) => {
    // w41: several picked arrows take the ends in one write (each keeps its
    // own head style; see PDFViewer setGroupArrowEnds).
    if (typeof api.setGroupArrowEnds === 'function') {
      api.setGroupArrowEnds(next);
      return;
    }
    if (next === 'none') {
      api.setArrowBothEnds?.(false);
      api.setArrowheadStyle?.('none');
      return;
    }
    // Leaving "None" restores a visible head rather than silently keeping none.
    if (arrowheadValue === 'none') api.setArrowheadStyle?.('solidTriangle');
    api.setArrowBothEnds?.(next === 'both');
  };
  /* BOARD 15 (counter series menu) — words only: "Count 1", "Count 2", then a
     plus and "New count". The rows come from the app's own series list, which is
     derived from the pins already on the document (getCounterSeriesList in
     src/utils/counterNumbering.js), so a name here can never disagree with the
     name the desktop menu shows for the same group.

     MEASURED 2026-09-22 (phone): that list alone left the strip's pill reading
     its placeholder ("Count") and the menu holding a single "New count" row,
     because the list counts PLACED pins and the series the next pin will join
     has none yet — so the control looked dead. The live series is named here as
     the count it is about to become, which gives the pill the group in force and
     the menu something to switch between from the first tap. */
  const counterSeriesRows = (api.counterSeriesList || []).map((series, index) => ({
    value: series.seriesId,
    label: series.label || `Count ${index + 1}`,
  }));
  const activeCounterSeriesId = api.activeCounterSeriesId || '';
  if (!counterSeriesRows.some((row) => row.value === activeCounterSeriesId)) {
    counterSeriesRows.push({ value: activeCounterSeriesId, label: `Count ${counterSeriesRows.length + 1}` });
  }
  const counterSeriesOptions = [
    ...counterSeriesRows,
    {
      value: '__new',
      label: 'New count',
      // The app's own plus, not a redrawn one.
      menuPreview: <Icon name="plus" size={13} color="currentColor" />,
    },
  ];
  const applyCounterSeries = (seriesId) => {
    if (seriesId === '__new') api.onNewCounterSeries?.();
    // The row the tool is already on (including the not-yet-drawn first count,
    // which has no id to switch to) is a no-op rather than a failed lookup.
    else if (seriesId && seriesId !== activeCounterSeriesId) api.onSwitchCounterSeries?.(seriesId);
  };
  // Which board a tool's strip follows. Multi-colour tools show ONE combined
  // swatch instead of the three preset discs (owner ruling); the counter's
  // swatch is its pin with its number.
  const isMultiColour = FILL_TOOLS.has(tool);
  const showLineStyleOnStrip = showBorderStyle && tool !== 'callout';
  // A selected line / polygon / polyline / counter can switch from point
  // handles to a resize-and-rotate box. That used to be a bare diagonal-arrow
  // glyph on the strip that nobody could read (owner, 2026-09-22); it is a named
  // button in the settings panel's Handles card.
  const canResizeRotate = !!(api.canEnterBBoxEdit && api.onEnterBBoxEdit);
  /* RESTORED 2026-09-23 (owner: "We had panels for every single annotation").
     EVERY tool strip ends in "..." and it opens that tool's settings panel - pen,
     highlighter, line, arrow, rectangle, ellipse, polygon, polyline, the cloud
     shapes, counter, text box, callout and eraser alike. It used to show only
     where a row sheet had something to hold (arrow, callout, counter, a mark
     that can resize-and-rotate). With a mark selected, the strip is that mark's,
     so the same "..." opens the same panel acting on the selection. Every strip
     still fits a 375px phone with it (tests/mobileToolPropertiesReach). */
  const showMoreOnStrip = true;

  /* PASS 7 (boards 17 and 18): the COLOUR SHEET the strip's colour controls
     open — titled "Color", with a gold Done, the shared picker's 12 presets
     edge to edge, its grid or gradient, its opacity slider and its one bottom
     row, at the Standard sheet height.

     A multi-colour tool opens it with the Border / Fill tabs, and a tab simply
     re-points this sheet at that channel — the target IS the tab, so the two can
     never disagree. A counter's two channels are its pin and the number printed
     on it, so its first tab is called "Number".

     WHAT THIS REPLACED: the rainbow custom disc did nothing at all on the phone
     (it carried a tooltip and no handler), and the combined swatch opened the
     "Rectangle settings" panel instead of a colour picker. The strip's colour
     controls open this picker sheet; the settings panel itself is reached from
     the strip's "..." (restored 2026-09-23), and ITS big swatch opens this same
     picker sheet. */
  const isCounterTool = tool === 'counter';
  const paintTabs = isMultiColour ? {
    // Owner 2026-09-23: Fill first, then Border, app-wide (the Templates order).
    items: [
      { id: 'fill', label: 'Fill' },
      { id: 'stroke', label: isCounterTool ? 'Number' : 'Border' },
    ],
    active: colorPicker,
    onSelect: (id) => setColorPicker(id),
  } : null;
  // Config for the shared CompactColorPicker takeover, per open target.
  const colorPickerConfig = colorPicker === 'textColor'
    ? {
      title: 'Text color',
      // UX 2026-09-23: text colour carries its opacity (see fontColorLive).
      color: splitTextColor(textDefaults.fontColor).hex,
      opacity: splitTextColor(textDefaults.fontColor).opacity,
      showOpacity: true,
      minOpacity: 0.05,
      firstPreset: 'none',
      onChange: (hex, alpha, meta) => updateTextDefaults({
        fontColor: composeTextColor(hex, alpha > 0 ? alpha : splitTextColor(textDefaults.fontColor).opacity),
      }, meta),
    }
    : colorPicker === 'fill'
      ? {
        title: 'Color',
        tabs: paintTabs,
        color: toHexColor(api.fillColor, '#ffffff'),
        opacity: Math.max(0, Math.min(1, (api.fillOpacity ?? 100) / 100)),
        showOpacity: typeof api.handleFillOpacityChange === 'function',
        firstPreset: 'transparent',
        // `meta` is the picker's drag phase (UX 2026-09-23): the colour write
        // settles, the opacity write after it commits the drag as one step.
        onChange: (hex, alpha, meta) => {
          api.handleFillColorChange?.(hex, meta?.phase === 'commit' ? { phase: 'settle' } : meta);
          api.handleFillOpacityChange?.(Math.round((alpha ?? 1) * 100), meta);
        },
      }
      : colorPicker === 'stroke'
        ? {
          title: 'Color',
          tabs: paintTabs,
          color: toHexColor(api.strokeColor, '#ff0000'),
          opacity: Math.max(0, Math.min(1, (api.strokeOpacity ?? 100) / 100)),
          showOpacity: typeof api.handleStrokeOpacityChange === 'function',
          firstPreset: 'transparent',
          onChange: (hex, alpha, meta) => {
            api.handleStrokeColorChange?.(hex, meta?.phase === 'commit' ? { phase: 'settle' } : meta);
            api.handleStrokeOpacityChange?.(Math.round((alpha ?? 1) * 100), meta);
          },
        }
        : null;

  return (
    <>
    {/* PASS 7 STRIP — the composition is per tool and comes straight off the
        approved boards. Order is always: colour, a divider, the shape controls,
        a divider, the tool's own extras. Nothing here scrolls: every strip is
        measured to fit a 375px screen (see tests/mobileToolPropertiesReach).

        board 1 pen / highlighter  discs | width
        board 2 rectangle          combined swatch | width | line style
        board 3 arrow              discs | width | line style | ...
        board 4 counter            pin swatch | series
        board 5 text box           combined swatch | width | line style | Aa
        board 6 eraser             Partial/Whole | size
        board 7 select             Box/Lasso/Text            */}
    <div className="mobile-pdf-properties" data-mobile-tool-properties="true" role="toolbar" aria-label={`${tool || 'Annotation'} settings`} ref={topOverlayRef}>
      {/* BOARD 6 — the eraser leads with its Partial/Whole toggle. It was a
          104px "Partial Erase / Full Stroke" dropdown, which is two taps and a
          menu to flip a two-state switch. */}
      {isEraser && api.setEraserMode && (
        <MobileStripSegmented
          ariaLabel="Eraser mode"
          width={100}
          value={api.eraserMode === 'entire' ? 'entire' : 'partial'}
          onChange={(mode) => api.setEraserMode(mode)}
          options={[
            { value: 'partial', label: 'Partial', ariaLabel: 'Partial erase' },
            { value: 'entire', label: 'Whole', ariaLabel: 'Erase the whole mark' },
          ]}
        />
      )}
      {/* BOARDS 1 & 3 — single-colour tools get the three preset discs plus the
          rainbow custom disc, which opens the shared picker. The discs and the
          swatch are the picker pass's components (src/components/
          QuickStyleControls.jsx); this file only says which tool gets which and
          where it sits. A tap applies straight away to the armed tool and to a
          selected mark, and it changes the paint you can SEE: the stroke of a
          pen or an arrow, the border of a shape. */}
      {!isEraser && showStroke && !isMultiColour && (
        <QuickColourDots
          platform="phone"
          value={quickColourShown}
          customActive={api.selectionMixed?.strokeColor ? false : undefined}
          onPick={applyQuickColour}
          /* Boards 17/18: the rainbow disc opens the Colour sheet. It used to
             carry a tooltip and no handler, so tapping it did nothing. */
          onOpenPicker={() => setColorPicker('stroke')}
        />
      )}
      {/* BOARDS 2, 4 & 5 — a multi-colour tool gets ONE combined swatch instead
          of the presets: fill in the centre, border as a 2px ring, and for the
          counter its real pin outline with its number. Tapping it opens the
          picker on the Border tab. Two colours cannot be shown by four discs, so
          the discs would have had to lie about one of them.
          This is the SAME component the desktop bar shows (QuickPaintSwatch in
          src/components/QuickStyleControls.jsx). The phone carried its own copy
          while the two passes were built side by side; the copy is gone. */}
      {!isEraser && showStroke && isMultiColour && (
        <QuickPaintSwatch
          platform="phone"
          variant={tool === 'counter' ? 'counter' : 'shape'}
          label={tool === 'counter' ? 'Pin and number colors' : 'Border and fill colors'}
          ring={tool === 'counter'
            ? toSwatchPaint(api.fillColor, api.fillOpacity, '#ef4444')
            : toSwatchPaint(api.strokeColor, api.strokeOpacity, '#ff0000')}
          /* Colour AND opacity, the way the desktop bar composes them: a shape
             with no fill hands the swatch a transparent centre instead of white.
             A counter's centre is the number printed on its pin. */
          center={tool === 'counter'
            ? toSwatchPaint(api.strokeColor, api.strokeOpacity, '#ffffff')
            : toSwatchPaint(api.fillColor, api.fillOpacity, '#ffffff')}
          /* Boards 17/18: the swatch opens the Colour sheet on the channel it is
             showing — the border ring for a shape, the pin for a counter — with
             the Border / Fill tabs for the other one. It used to open the old
             "<Tool> settings" sheet instead, which is not a colour picker. */
          onOpen={() => setColorPicker(tool === 'counter' ? 'fill' : 'stroke')}
        />
      )}
      <MobileStripDivider />
      {/* Width is a dropdown ONLY: a stroke at its real weight, "2 pt", and a
          chevron. The three preset width chips the 2026-09-17 pass put here are
          gone (owner ruling) — the preset list they held is what this dropdown
          lists, so nothing became unreachable. A width the presets do not hold
          is still typed in the tool's own sheet. */}
      {showWidth && !isEraser && tool !== 'counter' && (
        <MobileStyledSelect
          ariaLabel="Line width"
          width="var(--mobile-strip-dropdown-w)"
          // w41: picked marks with different widths read "Mixed".
          value={api.selectionMixed?.width ? '' : String(sizeValue ?? '')}
          placeholder={api.selectionMixed?.width ? 'Mixed' : undefined}
          options={widthOptions}
          onChange={(width) => { handleSizeDraft(width); handleSizeCommit(width); }}
        />
      )}
      {isEraser && (
        <MobileStyledSelect
          ariaLabel="Eraser size"
          width="var(--mobile-strip-dropdown-w)"
          value={String(sizeValue ?? '')}
          options={eraserSizeOptions}
          onChange={(size) => { handleSizeDraft(size); handleSizeCommit(size); }}
        />
      )}
      {/* BOARD 4 — the counter's series picker. Words only: a series is "Count
          1", not a colour, and the pin beside it already carries the colour.
          The counter's SIZE is behind this strip's "..." (board 16's sheet
          frame), because the board gives the strip two controls and a size is
          not one of them. */}
      {tool === 'counter' && (
        <MobileStyledSelect
          ariaLabel="Counter series"
          width="var(--mobile-strip-series-w)"
          value={activeCounterSeriesId}
          placeholder="Count"
          options={counterSeriesOptions}
          onChange={applyCounterSeries}
        />
      )}
      {showLineStyleOnStrip && (
        <MobileStyledSelect
          ariaLabel="Line style"
          width="var(--mobile-strip-linestyle-w)"
          value={lineStyleValue}
          placeholder={lineStylePlaceholder}
          options={lineStyleOptions}
          onChange={(value) => api.setLineBorderStyle(value)}
        />
      )}
      {(showMoreOnStrip || (api.onEnterTextEdit && (tool === 'text' || tool === 'callout'))) && <MobileStripDivider />}
      {/* BOARD 5 — "Aa" opens text formatting: the live editor when there is
          something to edit, otherwise the settings panel on its Text side. */}
      {api.onEnterTextEdit && (tool === 'text' || tool === 'callout' || api.richTextEditor) && (
        <button
          type="button"
          className={`mobile-pdf-properties__edit${api.richTextEditor ? ' is-active' : ''}`}
          aria-label="Text formatting"
          aria-expanded={textDefaultsOpen && sheetTab === 'text'}
          onClick={() => {
            if (api.canEnterTextEdit || api.richTextEditor) api.onEnterTextEdit();
            else openSheet('text');
          }}
        >
          Aa
        </button>
      )}
      {/* "..." at the end of every tool strip opens that tool's settings panel
          (restored 2026-09-23) on its Shape side - or, for the eraser, its own
          card. Gold while the panel is open, the selected state every chip uses. */}
      {showMoreOnStrip && (
        <button
          type="button"
          className={`mobile-pdf-properties__more${textDefaultsOpen ? ' is-active' : ''}`}
          aria-label={`More ${TOOL_LABELS[tool] || 'annotation'} settings`}
          aria-expanded={textDefaultsOpen}
          onClick={() => {
            if (textDefaultsOpen) requestTextSheetClose();
            else openSheet('shape');
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
    {/* BOARD 16 content, folded into the restored panel (2026-09-23): the
        arrowhead card carries the Arrowhead dropdown and board 16's Arrow ends
        (End / Both / None, with the lucide move-right / move-horizontal / minus
        drawings). There is no separate arrow row sheet any more - the arrow has
        one panel like every other tool.

        THE "<Tool> settings" PANEL — ported from the owner's demo app
        (mobile-expo-go/src/components/format/AnnotationEditPanel.tsx) in
        4cd79d37f and RESTORED 2026-09-23 from 38f1ec95c, after the 2026-09-22
        row-list rebuild deleted it (owner: "We already had panel layouts with
        icons and all that that would come up from the bottom panel ... The only
        thing that we had fixed regarding this lower panel ... was the color
        picker"). Cards, per tool:
          Shape side  colour card (Fill / Stroke tabs on a fillable mark - Fill /
                      Number on a counter), a row of colour circles and the big
                      swatch that opens the NEW shared colour picker sheet;
                      line style + cloud bump | typed width (or typed size);
                      arrowhead + arrow ends (arrow, callout); counter series;
                      Resize and rotate when the selected mark can.
          Text side   text colour card, font, B / I / U / S | typed text size,
                      and the two rows of big alignment icons (text box, callout).
          Eraser      eraser mode | typed size.
        Adapted only where a later owner ruling requires it: the panel hugs its
        content under the shared max-height cap; "Color" is spelled the US way;
        the chosen colour circle is the HeroUI swatch (its own colour as the ring
        and a check, never gold); no gold box, ring or underline on a field; and
        the big swatch opens the new picker sheet. */}
    {textDefaultsOpen && typeof document !== 'undefined' && createPortal(
      <>
        <button
          type="button"
          className="mobile-pdf-sheet-backdrop"
          aria-label="Close text formatting"
          onClick={requestTextSheetClose}
          style={textSheetBackdropStyle}
        />
        <section
          className={`mobile-pdf-text-defaults is-${isEraser ? 'eraser' : sheetTab}${tool === 'callout' ? ' is-callout' : ''}`}
          aria-label={`${sheetTitle} settings`}
          {...textSheetProps}
          style={textSheetMotionStyle}
        >
          <div className="mobile-pdf-sheet__handle" />
          {/* Owner 2026-09-30: no close X - a tap outside or a swipe down
              (anywhere on the sheet) closes it. */}
          <header>
            <div>
              <strong>{sheetTitle} settings</strong>
              <span>Focused on {isEraser ? 'Eraser' : sheetTab === 'text' ? 'Text' : 'Shape'}</span>
            </div>
          </header>
          {/* Text/Shape segmented control only for text & callout — pen/shape/
              counter show shape-side cards directly (demo AnnotationEditPanel
              tabs appear only when both a text and a shape face exist). */}
          {isTextTool && (
          <div className="mobile-pdf-text-defaults__tabs" role="tablist" aria-label="Annotation settings section">
            <button
              type="button"
              role="tab"
              aria-label="Shape settings"
              aria-selected={textDefaultsTab === 'shape'}
              className={textDefaultsTab === 'shape' ? 'is-active' : ''}
              onClick={() => setTextDefaultsTab('shape')}
            >
              Shape
            </button>
            <span aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-label="Text settings"
              aria-selected={textDefaultsTab === 'text'}
              className={textDefaultsTab === 'text' ? 'is-active' : ''}
              onClick={() => setTextDefaultsTab('text')}
            >
              Text
            </button>
          </div>
          )}
          <div className="mobile-pdf-text-defaults__scroll">
            {isEraser ? (
              /* The eraser's card: its mode and its TYPED size side by side - the
                 two controls the old eraser strip carried (a mode menu and a
                 typed size), in the panel's own split card. The strip keeps its
                 Partial / Whole toggle and its size dropdown. */
              <section className="mobile-pdf-text-card mobile-pdf-text-card--split">
                <div className="mobile-pdf-text-card__pane">
                  <strong>Eraser mode</strong>
                  <MobileStyledSelect
                    ariaLabel="Eraser mode"
                    value={api.eraserMode === 'entire' ? 'entire' : 'partial'}
                    options={[
                      { value: 'partial', label: 'Partial' },
                      { value: 'entire', label: 'Whole' },
                    ]}
                    onChange={(mode) => api.setEraserMode?.(mode)}
                  />
                </div>
                <span className="mobile-pdf-text-card__divider" aria-hidden="true" />
                <div className="mobile-pdf-text-card__pane mobile-pdf-text-card__size">
                  <strong>Size</strong>
                  <AnnotationSizeControl
                    label={sizeLabel}
                    value={sizeValue}
                    min={sizeMin}
                    max={sizeMax}
                    decimals={0}
                    presets={sizePresets}
                    onValueChange={handleSizeDraft}
                    onValueCommit={handleSizeCommit}
                    onFocusChange={handleSizeFocus}
                  />
                </div>
              </section>
            ) : sheetTab === 'text' ? (
              <>
                <section className="mobile-pdf-text-card mobile-pdf-text-card--color mobile-pdf-text-card--text-color">
                  <div className="mobile-pdf-text-card__header">
                    <div>
                      <strong>Text color</strong>
                      {/* The colour AND its opacity (UX 2026-09-23): "#1E293B" at
                          full strength, "#1E293B · 40%" when see-through. */}
                      <span>{splitTextColor(textDefaults.fontColor).hex.toUpperCase()}{splitTextColor(textDefaults.fontColor).opacity < 1 ? ` · ${Math.round(splitTextColor(textDefaults.fontColor).opacity * 100)}%` : ''}</span>
                    </div>
                    {/* The big swatch opens the NEW shared colour picker sheet. */}
                    <button
                      type="button"
                      className="mobile-pdf-text-card__large-swatch"
                      aria-label="Open Text color picker"
                      style={{ '--mobile-text-color': composeTextColor(splitTextColor(textDefaults.fontColor).hex, splitTextColor(textDefaults.fontColor).opacity) }}
                      onClick={() => setColorPicker('textColor')}
                    />
                  </div>
                  <div className="mobile-pdf-text-card__colors">
                    {MOBILE_ANNOTATION_COLORS.map((color) => (
                      <MobilePanelColorSwatch
                        key={color}
                        color={color}
                        chosen={normaliseQuickColour(color) === normaliseQuickColour(splitTextColor(textDefaults.fontColor).hex)}
                        label={`Set Text color ${color}`}
                        onPick={() => updateTextDefaults({ fontColor: composeTextColor(color, splitTextColor(textDefaults.fontColor).opacity) })}
                      />
                    ))}
                  </div>
                </section>

                {/* KEPT from the 2026-09-22 row sheet (nothing may be lost): the
                    font picker, on the desktop bar's own list (single-name fonts
                    only - gotcha 2026-04-08). */}
                <section className="mobile-pdf-text-card mobile-pdf-text-card--inline mobile-pdf-text-card--font">
                  <strong>Font</strong>
                  <MobileStyledSelect
                    ariaLabel="Font"
                    value={textDefaults.fontFamily || 'Arial'}
                    options={MOBILE_FONT_FAMILY_OPTIONS}
                    onChange={(fontFamily) => updateTextDefaults({ fontFamily })}
                  />
                </section>

                <section className="mobile-pdf-text-card mobile-pdf-text-card--split">
                  <div className="mobile-pdf-text-card__pane">
                    <strong>Text formatting</strong>
                    <div className="mobile-pdf-text-defaults__format" role="toolbar" aria-label="Text formatting">
                      {[
                        ['formatBold', 'bold', 'Bold'],
                        ['formatItalic', 'italic', 'Italic'],
                        ['formatUnderline', 'underline', 'Underline'],
                        ['formatStrikethrough', 'strike', 'Strikethrough'],
                      ].map(([iconName, key, title]) => (
                        <button
                          key={key}
                          type="button"
                          className={`${key}${textDefaults[key] ? ' is-active' : ''}`}
                          aria-label={title}
                          aria-pressed={Boolean(textDefaults[key])}
                          onClick={() => updateTextDefaults({ [key]: !textDefaults[key] })}
                        >
                          <Icon name={iconName} size={18} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="mobile-pdf-text-card__divider" aria-hidden="true" />
                  <label className="mobile-pdf-text-card__pane mobile-pdf-text-card__size">
                    <strong>Text size</strong>
                    <MobileFontSizeField
                      value={textDefaults.fontSize ?? 16}
                      onCommit={(fontSize) => updateTextDefaults({ fontSize })}
                    />
                  </label>
                </section>

                <MobileTextAlignmentCard
                  textAlign={textDefaults.textAlign || 'left'}
                  verticalAlign={textDefaults.verticalAlign || 'top'}
                  showVertical={api.textVerticalAlignSupported !== false}
                  onTextAlign={(textAlign) => updateTextDefaults({ textAlign })}
                  onVerticalAlign={(verticalAlign) => updateTextDefaults({ verticalAlign })}
                />
              </>
            ) : (
              <>
                <section className={`mobile-pdf-text-card mobile-pdf-text-card--color mobile-pdf-text-card--shape-color${hasFillSheet ? '' : ' mobile-pdf-text-card--stroke-only'}`}>
                  {/* Fill/Stroke sub-tabs only for tools that HAVE a fill
                      (rect/ellipse/polygon/text/callout/counter). Pen/highlighter/
                      line/arrow/polyline show a single stroke section — matches
                      demo AnnotationEditPanel, which omits the fill face for
                      strokes-only annotations. */}
                  {hasFillSheet && (
                    <div className="mobile-pdf-text-card__color-tabs" role="tablist" aria-label="Shape color section">
                      {['fill', 'stroke'].map((section) => (
                        <button
                          key={section}
                          type="button"
                          role="tab"
                          aria-label={`${shapeSectionLabel(section)} color`}
                          aria-selected={textShapeColorSection === section}
                          className={textShapeColorSection === section ? 'is-active' : ''}
                          onClick={() => setTextShapeColorSection(section)}
                        >
                          <i style={{ backgroundColor: section === 'fill' ? toHexColor(api.fillColor, '#ffffff') : toHexColor(api.strokeColor, '#ff0000') }} />
                          {shapeSectionLabel(section)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mobile-pdf-text-card__header">
                    <div>
                      <strong>{shapeSectionLabel(shapeSection)} color</strong>
                      <span>{shapeColor.toUpperCase()}</span>
                    </div>
                    {/* The big swatch opens the NEW shared colour picker sheet
                        (the one change to this panel the owner asked for), on the
                        channel this card is showing. */}
                    <button
                      type="button"
                      className="mobile-pdf-text-card__large-swatch"
                      aria-label={`Open ${shapeSectionLabel(shapeSection)} color picker`}
                      style={{ '--mobile-text-color': shapeColor }}
                      onClick={() => setColorPicker(shapeSection)}
                    />
                  </div>
                  <div className="mobile-pdf-text-card__colors">
                    {MOBILE_ANNOTATION_COLORS.map((color) => (
                      <MobilePanelColorSwatch
                        key={color}
                        color={color}
                        chosen={normaliseQuickColour(color) === normaliseQuickColour(shapeColor)}
                        label={`Set ${shapeSectionLabel(shapeSection)} color ${color}`}
                        onPick={() => applyShapeColor(color)}
                      />
                    ))}
                  </div>
                </section>

                <section className={`mobile-pdf-text-card mobile-pdf-text-card--split${showBorderStyleSheet ? '' : ' mobile-pdf-text-card--width-only'}`}>
                  {showBorderStyleSheet && (
                    <>
                      <div className="mobile-pdf-text-card__pane">
                        <strong>Stroke style</strong>
                        {/* UX 2026-09-09: once Cloud is picked here the Bump size
                            sits right beside it on the same row - same 1..20
                            clamp as the desktop bar, so a cloud looks the same
                            wherever it was set. This is the bump's home on the
                            phone for every cloud shape (rectangle, ellipse,
                            polygon, polyline, text box, callout). */}
                        <div className="mobile-pdf-text-card__style-row">
                          <MobileStyledSelect
                            ariaLabel="Stroke style"
                            value={lineStyleValue}
                            placeholder={lineStylePlaceholder}
                            options={lineStyleOptions}
                            onChange={(value) => api.setLineBorderStyle?.(value)}
                          />
                          {api.supportsCloudStyle && api.lineBorderStyle === 'cloud' && api.setCloudIntensity && (
                            <label className="mobile-pdf-properties__bump mobile-pdf-text-card__bump">
                              <span>Bump</span>
                              <input
                                aria-label="Cloud bump size"
                                inputMode="numeric"
                                // UX 2026-09-10: numeric chrome field — yields
                                // Enter / Escape to a click-to-place draft.
                                data-draft-yields-keys="true"
                                value={api.cloudIntensity ?? 2}
                                onChange={(event) => {
                                  const value = Number.parseInt(event.target.value, 10);
                                  if (Number.isFinite(value)) api.setCloudIntensity(Math.max(1, Math.min(20, value)));
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </div>
                      <span className="mobile-pdf-text-card__divider" aria-hidden="true" />
                    </>
                  )}
                  <div className="mobile-pdf-text-card__pane mobile-pdf-text-card__size">
                    <strong>{tool === 'counter' ? 'Size' : 'Width'}</strong>
                    {/* The TYPED width (or a counter's typed size): the strip's
                        pill offers the presets only, and a cloud's own default
                        is 2.5pt (the decimal contract tests/cloudFillKnockout
                        pins). */}
                    <AnnotationSizeControl
                      label={tool === 'counter' ? 'Size' : 'Width'}
                      mixed={!!api.selectionMixed?.width}
                      value={api.strokeWidthInputValue}
                      min={tool === 'counter' ? COUNTER_SIZE_MIN : 1}
                      max={tool === 'counter' ? COUNTER_SIZE_MAX : 50}
                      decimals={tool === 'counter' ? 0 : ANNOTATION_WIDTH_DECIMALS}
                      presets={tool === 'counter' ? ANNOTATION_SIZE_PRESETS.counter : ANNOTATION_SIZE_PRESETS.width}
                      onValueChange={(value) => api.handleStrokeWidthInputChange?.({ target: { value } })}
                      onValueCommit={(value) => api.handleStrokeWidthInputBlur?.({ currentTarget: { value } })}
                      onFocusChange={(focused) => api.setIsStrokeWidthFocused?.(focused)}
                    />
                  </div>
                </section>

                {/* The arrowhead card, with board 16's content folded in: the
                    Arrowhead dropdown (the six one-word heads the desktop bar
                    lists) and, for the arrow, Arrow ends - End / Both / None,
                    the IDENTICAL control the desktop bar carries. It replaces
                    the old "Both ends" on/off button. */}
                {showArrowhead && (
                  <section className="mobile-pdf-text-card mobile-pdf-text-card--arrowhead">
                    <strong>Arrowhead</strong>
                    <MobileStyledSelect
                      ariaLabel="Arrowhead"
                      value={arrowheadValue}
                      options={arrowheadOptions}
                      onChange={(value) => api.setArrowheadStyle?.(value)}
                    />
                    {tool === 'arrow' && typeof api.setArrowBothEnds === 'function' && (
                      <>
                        <strong>Arrow ends</strong>
                        <MobileStyledSelect
                          ariaLabel="Arrow ends"
                          value={arrowEndsValue}
                          options={ARROW_ENDS_OPTIONS}
                          onChange={applyArrowEnds}
                        />
                      </>
                    )}
                  </section>
                )}

                {/* The counter's series beside its size: the strip's own series
                    pill and this one are the same control (one option list,
                    one handler), so the two can never disagree. */}
                {tool === 'counter' && (
                  <section className="mobile-pdf-text-card mobile-pdf-text-card--inline">
                    <strong>Counter series</strong>
                    <MobileStyledSelect
                      ariaLabel="Counter series"
                      value={activeCounterSeriesId}
                      placeholder="Count"
                      options={counterSeriesOptions}
                      onChange={applyCounterSeries}
                    />
                  </section>
                )}

                {/* A selected line / polygon / polyline / counter can switch from
                    point handles to a resize-and-rotate box. */}
                {canResizeRotate && (
                  <section className="mobile-pdf-text-card mobile-pdf-text-card--inline">
                    <strong>Handles</strong>
                    <button
                      type="button"
                      className="mobile-pdf-tool-sheet__action"
                      aria-label="Resize and rotate"
                      onClick={() => { requestTextSheetClose(); api.onEnterBBoxEdit(); }}
                    >
                      Resize and rotate
                    </button>
                  </section>
                )}
              </>
            )}
          </div>
        </section>
      </>,
      document.body
    )}
    {colorPickerConfig && (
      <MobileColorPickerSurface
        title={colorPickerConfig.title}
        color={colorPickerConfig.color}
        opacity={colorPickerConfig.opacity}
        showOpacity={colorPickerConfig.showOpacity}
        firstPreset={colorPickerConfig.firstPreset}
        tabs={colorPickerConfig.tabs}
        minOpacity={colorPickerConfig.minOpacity}
        onChange={colorPickerConfig.onChange}
        onClose={() => setColorPicker(null)}
      />
    )}
    </>
  );
}

export function MobilePdfViewerToolRail({ bottomToolbarApi, leftRailApi, onOpenPanel, onAuxPanelStateChange, auxCloseRequestKey = 0 }) {
  const [openCategory, setOpenCategory] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [syncDetailsPosition, setSyncDetailsPosition] = useState(null);
  const [hasTouchPointer, setHasTouchPointer] = useState(false);
  // Phase F (motion & feel): the active-users sheet gets the shared bottom-sheet
  // motion — finger-follow drag off the handle + dy>82/vy>0.65 dismiss + spring-
  // back + 170ms slide-down exit before unmount (inv-demo §17).
  const {
    motionStyle: usersSheetMotionStyle,
    backdropStyle: usersBackdropStyle,
    sheetProps: usersSheetProps,
    requestClose: requestUsersSheetClose,
  } = useMobileSheetMotion(() => setPresenceOpen(false), { open: presenceOpen });
  const popoverRef = useRef(null);
  const syncButtonRef = useRef(null);
  const syncDetailsRef = useRef(null);
  const popoverInsideRefs = useMemo(() => [popoverRef, syncDetailsRef], []);
  const presenceUsers = useMemo(() => normalizeMobilePresence({
    presence: leftRailApi?.presence,
    currentUserId: leftRailApi?.currentUserId,
    currentUserEmail: leftRailApi?.currentUserEmail,
    currentUserDisplayName: leftRailApi?.currentUserDisplayName,
  }), [
    leftRailApi?.presence,
    leftRailApi?.currentUserId,
    leftRailApi?.currentUserEmail,
    leftRailApi?.currentUserDisplayName,
  ]);
  const sync = useMemo(() => getMobileSyncPresentation(
    leftRailApi?.cloudSyncStatus,
    leftRailApi?.cloudSyncQueueSize,
    leftRailApi?.cloudSyncEnabled !== false,
  ), [leftRailApi?.cloudSyncStatus, leftRailApi?.cloudSyncQueueSize, leftRailApi?.cloudSyncEnabled]);

  useEffect(() => {
    const coarseQuery = window.matchMedia?.('(pointer: coarse)');
    const update = () => setHasTouchPointer(
      !!coarseQuery?.matches || (navigator.maxTouchPoints || 0) > 0,
    );
    update();
    coarseQuery?.addEventListener?.('change', update);
    return () => coarseQuery?.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (sync.state === 'synced') setSyncDetailsOpen(false);
  }, [sync.state]);

  const activateSyncStatus = () => {
    setMoreOpen(false);
    setPresenceOpen(false);
    if (sync.state === 'synced') {
      setSyncDetailsOpen(false);
      void leftRailApi?.cloudSyncOnRetry?.();
      return;
    }
    const rect = syncButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setSyncDetailsPosition({ left: rect.right + 8, top: rect.top + (rect.height / 2) });
    }
    setSyncDetailsOpen((open) => !open);
  };

  const activeTool = bottomToolbarApi?.activeTool || 'pan';
  const activeGroup = TOOL_TO_GROUP[activeTool] || null;
  const userInitial = presenceUsers[0]?.initials || 'U';
  const presenceCount = Math.max(presenceUsers.length, 1);

  useEffect(() => {
    onAuxPanelStateChange?.(presenceOpen ? 'users' : null);
    return () => onAuxPanelStateChange?.(null);
  }, [onAuxPanelStateChange, presenceOpen]);

  // Another panel was opened (the dock stays usable under this sheet since
  // 2026-10-01): slide the Active users sheet away so only one sheet is up.
  const auxCloseKeyRef = useRef(auxCloseRequestKey);
  useEffect(() => {
    if (auxCloseKeyRef.current === auxCloseRequestKey) return;
    auxCloseKeyRef.current = auxCloseRequestKey;
    if (presenceOpen) requestUsersSheetClose();
  }, [auxCloseRequestKey, presenceOpen, requestUsersSheetClose]);

  useEffect(() => {
    if (activeGroup) {
      setOpenCategory(activeGroup);
    } else {
      setOpenCategory(null);
    }
  }, [activeGroup, activeTool]);

  const [groupToolsEl, setGroupToolsEl] = useState(null);
  const [groupBoxEl, setGroupBoxEl] = useState(null);
  const [groupSlotEl, setGroupSlotEl] = useState(null);
  const [groupGhostLayerEl, setGroupGhostLayerEl] = useState(null);
  useRailGroupMotion({
    wrap: groupToolsEl, box: groupBoxEl, slot: groupSlotEl, layer: groupGhostLayerEl, groupKey: openCategory, glyphPx: SUBTOOL_GLYPH,
  });

  const selectTool = (toolId) => {
    bottomToolbarApi?.setActiveTool?.(toolId);
    bottomToolbarApi?.setActiveCategoryDropdown?.(null);
  };

  // 2026-10-01 (owner: rail toggles must read the way they look): a survey
  // category or entity disc that is already armed (gold) disarms on a second
  // tap and hands the tool back to Pan, like a closed tool group. Any other tap
  // arms it exactly as before.
  const toggleSurveyPick = (picked, arm) => {
    if (picked && activeTool === 'survey-marker') {
      selectTool('pan');
      return;
    }
    arm();
  };

  const toggleCategory = (groupId) => {
    const group = TOOL_GROUPS[groupId];
    // UX 2026-09-16 (phone chrome pass): a second tap on the group that is
    // already open closes its strip and gives the rail its height back. The
    // armed tool is deliberately left alone — closing the strip is a view
    // change, not a tool change. Reference: Drawboard PDF's phone rail
    // collapses an expanded group on a repeat tap. Opening a group still arms
    // its last-used tool (unchanged).
    // RULED CHANGE 2026-10-01 (owner: closing a group that way left its icon
    // gold, because its tool stayed armed): the repeat tap now also hands the
    // tool back to Pan, so a closed group is never the live one. Pan, not
    // "whatever came before": it is the phone's resting tool, the tool a
    // one-shot Survey Marker placement already returns to, and the same
    // result every time, whatever was armed before the group opened.
    if (openCategory === groupId) {
      setOpenCategory(null);
      if (activeGroup === groupId) selectTool('pan');
      return;
    }
    setOpenCategory(groupId);
    if (activeGroup !== groupId) {
      const preferred = groupId === 'draw'
        ? bottomToolbarApi?.lastDrawTool
        : groupId === 'shape'
          ? bottomToolbarApi?.lastShapeTool
          : bottomToolbarApi?.lastReviewTool;
      selectTool(preferred && TOOL_TO_GROUP[preferred] === groupId ? preferred : group.fallback);
    }
  };

  return (
    <>
      <DismissBarrier
        active={moreOpen || syncDetailsOpen}
        insideRefs={popoverInsideRefs}
        onDismiss={() => {
          setMoreOpen(false);
          setSyncDetailsOpen(false);
        }}
      />
      <aside className="mobile-pdf-tools" aria-label="Document tools">
        <div className="mobile-pdf-tools__main">
          <RailButton active={activeTool === 'pan'} icon="pan" label="Pan" onClick={() => { setOpenCategory(null); selectTool('pan'); }} />
          {/* PASS 7 (board 7, owner ruling 2026-09-22): Select is a PLAIN rail
              chip, the same 28px square as Pan and the group buttons. Tapping it
              arms the family and nothing else — no caret, no pop-up menu, and no
              gold box around the armed chip; armed reads as the gold glyph only.
              Which mode is live (Box / Lasso / Text) is chosen in the segmented
              toggle the strip shows while Select is armed, which is the same
              control the desktop bar draws, so a mode picked on one platform
              reads the same on the other. */}
          <RailButton
            active={activeTool === 'select' || activeTool === 'text-select'}
            label={getSelectFamilyLabel(activeTool, bottomToolbarApi?.selectionMode)}
            onClick={() => {
              setOpenCategory(null);
              selectTool(
                activeTool === 'text-select' || bottomToolbarApi?.selectionMode === 'text'
                  ? 'text-select'
                  : 'select',
              );
            }}
          >
            {/* UX: centre the glyph on the phone rail axis; the desktop
                horizontal pair's -3px shift does not fit a vertical rail. */}
            <Icon name={getSelectFamilyIconName(activeTool, bottomToolbarApi?.selectionMode)} size={RAIL_GLYPH} color="currentColor" />
          </RailButton>
          <div className="mobile-pdf-tools__divider" />
          {Object.entries(TOOL_GROUPS).map(([groupId, group]) => (
            <RailButton
              key={groupId}
              active={activeGroup === groupId || openCategory === groupId}
              icon={group.icon}
              label={group.label}
              onClick={() => toggleCategory(groupId)}
            />
          ))}
          {/* Owner 2026-10-01: the desktop group-switch morph on the phone
              (useRailGroupMotion). The block stays mounted, closed at zero
              height, so a switch can morph slot by slot and the block can
              glide open and shut instead of popping in and out. */}
          <div
            ref={setGroupToolsEl}
            className={`mobile-pdf-tools__group-tools${openCategory ? ' is-open' : ''}`}
          >
            <div className="mobile-pdf-tools__divider is-short" />
            <div ref={setGroupBoxEl} className="mobile-pdf-tools__subtools is-group">
              <div ref={setGroupSlotEl} className="mobile-pdf-tools__group-slot">
                {(TOOL_GROUPS[openCategory]?.tools || []).map((tool) => (
                  <RailButton
                    key={tool.id}
                    active={activeTool === tool.id}
                    icon={tool.icon}
                    glyph={SUBTOOL_GLYPH}
                    label={tool.label}
                    disabled={tool.disabled}
                    data-morph-icon={tool.icon}
                    onClick={() => { if (!tool.disabled) selectTool(tool.id); }}
                  />
                ))}
              </div>
              <div ref={setGroupGhostLayerEl} className="mobile-pdf-tools__group-ghosts" data-loadout-ghost-layer="true" aria-hidden="true" />
            </div>
          </div>
          {bottomToolbarApi?.regionEditing && bottomToolbarApi?.regionToolbarApi && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__subtools" aria-label="Region tools">
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.toolType === 'move'}
                  icon="cursor"
                  label="Select region"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setToolType?.('move')}
                />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.toolType === 'rectangular'}
                  icon="rect"
                  label="Rectangular region"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setToolType?.('rectangular')}
                />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.toolType === 'freehand'}
                  icon="pen"
                  label="Freehand region"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setToolType?.('freehand')}
                />
                <div className="mobile-pdf-tools__divider is-short" />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.selectionMode === 'add'}
                  icon="plus"
                  label="Additive region mode"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setSelectionMode?.('add')}
                />
                <RailButton
                  active={bottomToolbarApi.regionToolbarApi.selectionMode === 'subtract'}
                  icon="minus"
                  label="Subtractive region mode"
                  onClick={() => bottomToolbarApi.regionToolbarApi.setSelectionMode?.('subtract')}
                />
              </div>
            </>
          )}
          {bottomToolbarApi?.showSurveyPanel
            && bottomToolbarApi?.surveyToolbar
            && !bottomToolbarApi?.regionEditing
            && !!bottomToolbarApi.surveyToolbar.categories?.length && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__survey-categories" aria-label="Survey categories">
                {bottomToolbarApi.surveyToolbar.categories.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    className={bottomToolbarApi.surveyToolbar.selectedCategoryId === category.id && activeTool === 'survey-marker' ? 'is-active' : ''}
                    aria-label={`Survey category ${category.name || 'Untitled Category'}`}
                    title={category.name || 'Untitled Category'}
                    onClick={() => toggleSurveyPick(bottomToolbarApi.surveyToolbar.selectedCategoryId === category.id, () => bottomToolbarApi.surveyToolbar.onSelectCategory?.(category.id))}
                  >
                    {categoryGlyph(category.name)}
                  </button>
                ))}
              </div>
            </>
          )}
          {bottomToolbarApi?.showSurveyPanel
            && bottomToolbarApi?.surveyToolbar
            && !bottomToolbarApi?.regionEditing
            && !!bottomToolbarApi.surveyToolbar.entities?.length && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__survey-entities" aria-label="Survey entities">
                {bottomToolbarApi.surveyToolbar.entities.map((entity) => (
                  <button
                    type="button"
                    key={entity.id}
                    className={bottomToolbarApi.surveyToolbar.selectedEntityId === entity.id && activeTool === 'survey-marker' ? 'is-active' : ''}
                    aria-label={`Survey entity ${entity.name || 'Untitled Entity'}`}
                    title={entity.name || 'Untitled Entity'}
                    onClick={() => toggleSurveyPick(bottomToolbarApi.surveyToolbar.selectedEntityId === entity.id, () => bottomToolbarApi.surveyToolbar.onSelectEntity?.(entity.id))}
                  >
                    <span style={{ background: entity.color || 'var(--border-strong)' }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mobile-pdf-tools__footer" ref={popoverRef}>
          <RailButton
            icon="more"
            label="More document options"
            active={moreOpen}
            onClick={() => { setMoreOpen((open) => !open); setPresenceOpen(false); }}
          />
          <div className="mobile-pdf-tools__footer-stack">
            <button
              ref={syncButtonRef}
              type="button"
              className="mobile-pdf-tools__sync"
              aria-label={sync.state === 'synced' ? `${sync.label}. Tap to sync now.` : `${sync.label}. ${sync.compactMessage}`}
              aria-expanded={sync.state !== 'synced' && syncDetailsOpen}
              aria-controls="mobile-sync-status-details"
              title={sync.state === 'synced' ? `${sync.label}. Tap to sync now.` : `${sync.label}. Tap for details.`}
              disabled={leftRailApi?.cloudSyncEnabled === false}
              onClick={activateSyncStatus}
            >
              <span style={{ background: sync.color }} />
            </button>
            <RailButton
              icon="history"
              label="History"
              disabled={!leftRailApi?.documentId}
              onClick={() => {
                setPresenceOpen(false);
                setMoreOpen(false);
                onOpenPanel?.('history');
              }}
            />
            <RailButton
              label={`${presenceCount} active user${presenceCount === 1 ? '' : 's'}`}
              active={presenceOpen}
              onClick={() => { setPresenceOpen((open) => !open); setMoreOpen(false); }}
            >
              <span className="mobile-pdf-tools__avatar">{userInitial}</span>
              {presenceCount > 1 && <span className="mobile-pdf-tools__user-count">+{presenceCount - 1}</span>}
            </RailButton>
          </div>

          {moreOpen && (
            <div className="mobile-pdf-tools__popover is-more">
              <button
                type="button"
                disabled={!bottomToolbarApi?.exportAnnotatedPdf}
                onClick={() => {
                  setMoreOpen(false);
                  bottomToolbarApi?.exportAnnotatedPdf?.();
                }}
              >
                <Icon name="download" size={16} color="currentColor" />
                Export annotated PDF
              </button>
              {/* RULED 2026-09-22 (owner): "More = Export + Save log". Save log
                  used to be gated on window.Capacitor.isNativePlatform(), so the
                  menu on web mobile held ONE row and the ruling's second item
                  simply was not there — and web mobile is the only place a phone
                  user can hit Cmd+Shift+L from, which is to say nowhere. The row
                  fires the same event that shortcut does (see AppShell's
                  keyHandler), so the two paths are one path and it works wherever
                  the app runs. */}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  const buffer = window.__consoleLogBuffer;
                  window.dispatchEvent(new CustomEvent('save-log-banner-start', {
                    detail: {
                      consoleText: Array.isArray(buffer) && buffer.length > 0
                        ? buffer.join('\n')
                        : '(no console output captured)',
                    },
                  }));
                }}
              >
                <Icon name="document" size={16} color="currentColor" />
                Save log
              </button>
              {/* UX (owner ruling 2026-09-17): zoom lives in exactly ONE place on
                  phone — the header's zoom menu behind the % pill. The two
                  duplicate zoom rows that used to sit here were removed so the
                  kebab stays a short document-actions list (export, and Save log
                  on native) instead of a second zoom control. Guarded by
                  tests/mobilePhoneSheetAndMoreMenuGuard.test.mjs. */}
            </div>
          )}

        </div>
      </aside>
      {hasTouchPointer && activeTool === 'select' && bottomToolbarApi?.selectionMode === 'lasso' && (
        // UX: touch has no Shift, Alt, or Space key. This small group gives
        // phone and tablet users the same lasso choices before they draw.
        <div className="mobile-pdf-lasso-controls" role="group" aria-label="Lasso options" data-mobile-lasso-controls="true">
          <button
            type="button"
            aria-pressed={bottomToolbarApi?.lassoTouchOperation === 'add'}
            className={bottomToolbarApi?.lassoTouchOperation === 'add' ? 'is-active' : ''}
            onClick={() => bottomToolbarApi?.setLassoTouchOperation?.(
              bottomToolbarApi?.lassoTouchOperation === 'add' ? 'replace' : 'add',
            )}
          >
            Add
          </button>
          <button
            type="button"
            aria-pressed={bottomToolbarApi?.lassoTouchOperation === 'subtract'}
            className={bottomToolbarApi?.lassoTouchOperation === 'subtract' ? 'is-active' : ''}
            onClick={() => bottomToolbarApi?.setLassoTouchOperation?.(
              bottomToolbarApi?.lassoTouchOperation === 'subtract' ? 'replace' : 'subtract',
            )}
          >
            Subtract
          </button>
          <button type="button" onClick={() => bottomToolbarApi?.cycleLassoTouchMode?.()}>
            {bottomToolbarApi?.lassoTouchMode === 'crossing'
              ? 'Crossing'
              : bottomToolbarApi?.lassoTouchMode === 'fence' ? 'Fence' : 'Window'}
          </button>
        </div>
      )}
      {syncDetailsOpen && sync.state !== 'synced' && syncDetailsPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={syncDetailsRef}
          id="mobile-sync-status-details"
          className="mobile-pdf-tools__sync-details"
          role="dialog"
          aria-label="Sync status details"
          style={{ left: syncDetailsPosition.left, top: syncDetailsPosition.top }}
        >
          <span data-sync-message>{sync.compactMessage}</span>
          {typeof leftRailApi?.cloudSyncOnRetry === 'function' && (
            <button
              type="button"
              aria-label="Retry now"
              title="Retry now"
              style={{ color: sync.color }}
              onClick={() => {
                setSyncDetailsOpen(false);
                void leftRailApi.cloudSyncOnRetry();
              }}
            >
              <Icon name="retry" size={17} color="currentColor" />
            </button>
          )}
        </div>,
        document.body,
      )}
      {presenceOpen && (
        <>
          <button
            type="button"
            className="mobile-pdf-sheet-backdrop"
            aria-label="Close active users"
            onClick={requestUsersSheetClose}
            style={usersBackdropStyle}
          />
          <section className="mobile-pdf-sheet mobile-pdf-users-sheet" aria-label="Active users" {...usersSheetProps} style={usersSheetMotionStyle}>
            <div className="mobile-pdf-sheet__handle" />
            {/* Owner 2026-09-30: no close X - a tap outside or a swipe down
                (anywhere on the sheet) closes it. */}
            <header>
              <div>
                <strong>Active users</strong>
                <span>{presenceCount} viewing this document</span>
              </div>
            </header>
            <div className="mobile-pdf-users-sheet__list">
              {(presenceUsers.length ? presenceUsers : [{ id: 'current', label: 'You', initials: 'U', isCurrent: true }]).map((person) => (
                <div key={person.id} className="mobile-pdf-users-sheet__row">
                  <span className="mobile-pdf-users-sheet__avatar">{person.initials}</span>
                  <p>
                    <strong>{person.label}{person.isCurrent ? ' (you)' : ''}</strong>
                    <span>{person.role || (person.isCurrent ? 'Document owner' : 'Collaborator')}</span>
                  </p>
                  <em>{person.status || (person.isCurrent ? 'Viewing document' : 'Online')}</em>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      <MobileToolProperties api={bottomToolbarApi} />
    </>
  );
}

export function MobilePdfViewerDock({ onOpenPanel, onToggleHub, onOpenSurvey, hubMode = 'pages', hubOpen = false, spacesActive, surveyActive, covered = false }) {
  const hubLabels = { pages: 'Pages', search: 'Search', bookmarks: 'Bookmarks' };
  const hubIcons = { pages: 'document', search: 'search', bookmarks: 'bookmark' };
  // `covered`: a phone panel is open over the dock. The dock stays mounted
  // under it (so it is already in place when the panel slides away - see
  // AppShell), but takes no focus, taps or screen-reader reads meanwhile.
  return (
    <nav
      className="mobile-pdf-dock"
      aria-label="Document panels"
      aria-hidden={covered ? 'true' : undefined}
      inert={covered ? '' : undefined}
    >
      <div className="mobile-pdf-dock__surface" aria-hidden="true" />
      <button
        type="button"
        className={`mobile-pdf-dock__side${spacesActive ? ' is-active' : ''}`}
        aria-label="Open spaces"
        onClick={() => onOpenPanel?.('spaces')}
      >
        <Icon name="layers" size={DOCK_GLYPH} color="currentColor" />
      </button>
      <button
        type="button"
        className={`mobile-pdf-dock__center${hubOpen ? ' is-active' : ''}`}
        aria-label="Open pages, search, and bookmarks"
        onClick={onToggleHub}
      >
        {/* UX 2026-09-16: one size across all three dock controls; they ran
            21 / 18 / 22. DOCK_GLYPH is that size, 0.57 of the 30px dock
            chip the sizing pass settled on. */}
        <Icon name={hubIcons[hubMode] || 'pages'} size={DOCK_HUB_GLYPH} color="currentColor" />
        <span>{hubLabels[hubMode] || 'Pages'}</span>
        <Icon name="chevronDown" size={12} color="currentColor" />
      </button>
      <button
        type="button"
        className={`mobile-pdf-dock__side${surveyActive ? ' is-active' : ''}`}
        aria-label="Open survey"
        onClick={onOpenSurvey}
      >
        <Icon name="survey" size={DOCK_GLYPH} color="currentColor" />
      </button>
    </nav>
  );
}
