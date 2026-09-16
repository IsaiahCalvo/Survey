import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import AnnotationSizeControl, { ANNOTATION_SIZE_PRESETS } from '../components/AnnotationSizeControl';
import { COUNTER_SIZE_MAX, COUNTER_SIZE_MIN, ANNOTATION_WIDTH_DECIMALS } from '../utils/annotationSize';
import CompactColorPicker from '../components/CompactColorPicker';
import DismissBarrier from '../components/DismissBarrier';
import { ARROWHEAD_STYLE_LABELS } from '../components/Callout/types';
import { ZOOM_MODE_OPTIONS } from '../viewerShared';
import { getMobileSyncPresentation, getMobileTextMarkupPresentation, normalizeMobilePresence } from './mobilePdfViewerModel.js';
import { getSelectFamilyIconName, getSelectFamilyLabel, getSelectModeIconName, getSelectModeMenuFocusIndex, isSelectModeActive, SELECT_MODE_OPTIONS } from '../utils/selectModes.js';
import { tooltipForLabel } from '../utils/toolShortcuts.js';
import { useMobileSheetMotion } from './useMobileSheetMotion';
import './mobilePdfViewer.css';

// UX 2026-09-16 (sizing pass, owner ruling): one glyph size per tier, taken
// from Drawboard's iPhone rail, where the glyph fills roughly two thirds of
// its chip. The CSS tokens set the chips (30px rail, 24px sub-tool, 26px
// header); these set what is drawn inside them.
const RAIL_GLYPH = 20;
// The line-style dropdown and the width field are one control size (owner
// ruling 2026-09-16). Both read the same token, so neither can drift.
const STRIP_DROPDOWN_WIDTH = 'var(--mobile-strip-dropdown-w)';
const SUBTOOL_GLYPH = 16;
const HEADER_GLYPH = 17;
const DOCK_GLYPH = 18;

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
      { id: 'eraser', label: 'Partial erase' /* UX: same tool name as desktop. */, icon: 'eraser' },
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
const MOBILE_ARROWHEAD_STYLE_LABELS = {
  ...ARROWHEAD_STYLE_LABELS,
  solidTriangle: 'Solid Triangle',
  vShape: 'V-Shape',
  openCircle: 'Open Circle',
  openTriangle: 'Open Triangle',
  horizontalLine: 'Horizontal Line',
};

const MOBILE_ANNOTATION_COLORS = [
  '#ff0000',
  '#4A90E2',
  '#27C07D',
  '#F4D35E',
  '#ffffff',
  '#1e293b',
  '#C7A7FF',
  '#FF8A3D',
  '#000000',
];

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
};

/**
 * MobileColorPickerSurface — mobile takeover host for the app's ONE shared
 * CompactColorPicker (project rule: every colour control reuses it, never the
 * OS <input type=color>). Mirrors the demo's in-panel gradient/HSV picker
 * (AnnotationEditPanel/styles.ts:1631-1783): SB square + hue + opacity + hex.
 * Rendered as a near-invisible-backdrop popover above the edit sheet, matching
 * the demo's never-dim overlay convention.
 */
function MobileColorPickerSurface({ color, opacity, showOpacity = true, firstPreset, minOpacity, onChange, onClose, title }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <button
        type="button"
        className="mobile-pdf-colorpicker-backdrop"
        aria-label={`Close ${title || 'color'} picker`}
        onClick={onClose}
      />
      <div className="mobile-pdf-colorpicker-surface" role="dialog" aria-label={`${title || 'Color'} picker`}>
        <CompactColorPicker
          color={color}
          opacity={opacity}
          showOpacity={showOpacity}
          firstPreset={firstPreset}
          minOpacity={minOpacity}
          onChange={onChange}
          onClose={onClose}
        />
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
function MobileStyledSelect({ value, options, onChange, ariaLabel, disabled = false, minWidth, placeholder }) {
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
      minWidth: rect.width,
      openUp,
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? (window.innerHeight - rect.top + 4) : undefined,
    });
  };

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
        style={minWidth ? { minWidth } : undefined}
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
        <span>{currentLabel}</span>
        <Icon name="chevronDown" size={11} color="currentColor" />
      </button>
      {open && typeof document !== 'undefined' && pos && createPortal(
        <div
          ref={menuRef}
          className="mobile-styled-select__menu"
          role="listbox"
          aria-label={ariaLabel}
          data-modal-focus-layer="true"
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            minWidth: pos.minWidth,
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
                <span>{option.label}</span>
                {active && <Icon name="check" size={14} color="currentColor" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

const categoryGlyph = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
};

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

/* UX 2026-09-16 (icon-set pass + sizing pass, merged): ONE glyph size per rail
   tier, and no per-glyph exceptions inside a tier. The rail used to run 19 with
   the Select cursor at 21, so Select was visibly the odd one out down a column
   where everything else lined up. The size now comes from RAIL_GLYPH for a rail
   tool and SUBTOOL_GLYPH for a sub-tool, because those are the two chip sizes
   (30px and 24px) and each glyph sits at the same two-thirds fill inside its own
   chip. Do not pass a bare number here. */
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

function MobileTextAlignmentGlyph({ axis, value, active }) {
  const stroke = active ? '#F4F7FB' : '#D8DEE9';
  const common = {
    stroke,
    strokeWidth: 6,
    strokeLinecap: 'round',
  };

  if (axis === 'horizontal') {
    const leftContent = (
      <>
        <line x1="48" y1="44" x2="48" y2="212" {...common} />
        <rect x="70" y="62" width="150" height="34" rx="8" fill="#d8a84e" />
        <rect x="70" y="111" width="76" height="34" rx="8" fill="#e8d5a8" />
        <rect x="70" y="160" width="116" height="34" rx="8" fill="#d8a84e" />
      </>
    );
    return (
      <svg width="48" height="34" viewBox="0 0 256 256" aria-hidden="true">
        {value === 0 && leftContent}
        {value === 1 && (
          <>
            <line x1="128" y1="44" x2="128" y2="212" {...common} />
            <rect x="53" y="62" width="150" height="34" rx="8" fill="#d8a84e" />
            <rect x="91" y="111" width="74" height="34" rx="8" fill="#e8d5a8" />
            <rect x="72" y="160" width="112" height="34" rx="8" fill="#d8a84e" />
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
          <rect x="53" y="66" width="150" height="34" rx="8" fill="#d8a84e" />
          <line x1="128" y1="130" x2="128" y2="202" {...common} />
          <path d="M128 130 L105 153 M128 130 L151 153" fill="none" {...common} strokeLinejoin="round" />
        </>
      )}
      {value === 1 && (
        <>
          <rect x="53" y="111" width="150" height="34" rx="8" fill="#d8a84e" />
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
          <rect x="53" y="156" width="150" height="34" rx="8" fill="#d8a84e" />
        </>
      )}
    </svg>
  );
}

// Demo zoom-fit dropdown lists ONLY the fit modes (demo constants.tsx:92-96:
// Fit Page / Fit Width / Fit Height). 'manual' is the pinch-zoom RESULT state,
// never a menu choice, so it's filtered out here — keeps parity with the demo's
// 3-item fit menu while surfacing Fit Height (now that it's wired end-to-end in
// the pdf.js viewer: zoomController FIT_HEIGHT + PDFViewer handleZoomModeSelect).
const ZOOM_FIT_OPTIONS = ZOOM_MODE_OPTIONS.filter((option) => option.id !== 'manual');

export function MobilePdfViewerHeader({ id, documentName, onBack, topToolbarApi, bottomToolbarApi }) {
  // OWNER DECISION 2 (2026-07-12): the page pill has two tap zones — the
  // fraction opens an inline page-jump input (type-to-jump), the chevron opens
  // the zoom/fit dropdown ONLY. The old combined page+zoom single surface is
  // gone. (demo App.tsx:462-475 inline input; :1215-1239 pill; :410-428 menu.)
  const [pageEditing, setPageEditing] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  // Marquee reveal for long titles (demo App.tsx:441-460, 1295-1319): tapping a
  // title >18 chars slides the text left to reveal its tail, then springs back.
  const [titleRevealing, setTitleRevealing] = useState(false);
  const pagesRef = useRef(null);
  const dismissInsideRefs = useMemo(() => [pagesRef], []);
  const title = documentName || 'Document';
  // Live scale, straight off the same state the desktop zoom field shows.
  const rawZoomPercent = Number.parseInt(bottomToolbarApi?.zoomInputValue, 10);
  const zoomPercent = Number.isFinite(rawZoomPercent) && rawZoomPercent > 0 ? rawZoomPercent : 100;

  const revealTitle = () => {
    // Only long titles marquee (demo gates on length > 18). The is-revealing
    // class runs the reveal keyframe; animationend clears it back to ellipsis.
    if (title.length <= 18) return;
    setTitleRevealing(false);
    requestAnimationFrame(() => setTitleRevealing(true));
  };

  const openPageEdit = () => {
    setZoomOpen(false);
    setPageEditing(true);
  };

  const toggleZoom = () => {
    setPageEditing(false);
    setZoomOpen((open) => !open);
  };

  return (
    <header id={id} className="mobile-pdf-header" data-mobile-pdf-header="true">
      <DismissBarrier
        active={pageEditing || zoomOpen}
        insideRefs={dismissInsideRefs}
        onDismiss={() => {
          setPageEditing(false);
          setZoomOpen(false);
        }}
      />
      <div className="mobile-pdf-header__document">
        {/* UX 2026-09-16: 17, the size undo/redo and the page chevrons use. At 21
            the back chevron was a third bigger than the identical chevron glyph
            two controls to its right. */}
        <button type="button" className="mobile-pdf-header__icon" aria-label="Back to documents" onClick={onBack}>
          <Icon name="chevronLeft" size={HEADER_GLYPH} color="currentColor" />
        </button>
        <button
          type="button"
          className={`mobile-pdf-header__title${titleRevealing ? ' is-revealing' : ''}`}
          title={title}
          aria-label="Document title"
          onClick={revealTitle}
        >
          <span
            className="mobile-pdf-header__title-text"
            onAnimationEnd={() => setTitleRevealing(false)}
          >
            {title}
          </span>
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
                value={bottomToolbarApi?.pageInputValue ?? ''}
                onFocus={(event) => event.target.select()}
                onChange={bottomToolbarApi?.handlePageInputChange}
                onKeyDown={(event) => {
                  bottomToolbarApi?.handlePageInputKeyDown?.(event);
                  if (event.key === 'Enter') setPageEditing(false);
                }}
                onBlur={(event) => {
                  bottomToolbarApi?.handlePageInputBlur?.(event);
                  setPageEditing(false);
                }}
              />
              <span className="mobile-pdf-header__page-total">/ {bottomToolbarApi?.numPages || 1}</span>
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
              {bottomToolbarApi?.pageNum || 1}
              <span className="mobile-pdf-header__page-total">/ {bottomToolbarApi?.numPages || 1}</span>
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
                <Icon name="minus" size={15} color="currentColor" />
              </button>
              <span className="mobile-pdf-header__zoom-percent" aria-live="polite">{`${zoomPercent}%`}</span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoomPercent >= MOBILE_ZOOM_MAX_PERCENT}
                onClick={() => bottomToolbarApi.zoomIn?.()}
              >
                <Icon name="plus" size={15} color="currentColor" />
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
          <Icon name="undo" size={HEADER_GLYPH} color="currentColor" />
        </button>
        <button
          type="button"
          className="mobile-pdf-header__icon"
          aria-label="Redo"
          disabled={!topToolbarApi?.canRedo}
          onClick={topToolbarApi?.onRedo || undefined}
        >
          {/* UX: share the desktop redo arrow without changing the phone touch target. */}
          <Icon name="redo" size={HEADER_GLYPH} color="currentColor" />
        </button>
      </div>
    </header>
  );
}

export function MobileToolProperties({ api }) {
  const [counterMenuOpen, setCounterMenuOpen] = useState(false);
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
    dragHandlers: textSheetDragHandlers,
    requestClose: requestTextSheetClose,
  } = useMobileSheetMotion(() => setTextDefaultsOpen(false));
  const [textDefaultsTab, setTextDefaultsTab] = useState('text');
  const [textShapeColorSection, setTextShapeColorSection] = useState('fill');
  const counterMenuRef = useRef(null);
  const counterMenuInsideRefs = useMemo(() => [counterMenuRef], []);
  const tool = api?.contextTool || api?.activeTool;
  const textMarkup = getMobileTextMarkupPresentation(api);

  useEffect(() => {
    // Close every tool-scoped popover/sheet when the active tool changes so a
    // stale colour picker or edit sheet never bleeds across tools.
    setCounterMenuOpen(false);
    setColorPicker(null);
    setTextDefaultsOpen(false);
    api?.setShowAnnotationColorPicker?.(false);
  }, [tool]);

  if (!api) return null;

  if (api.regionEditing && api.regionToolbarApi) {
    const region = api.regionToolbarApi;
    // UX (demo parity): tapping "Full Page" swaps this strip into an inline
    // "Make region full page?" Confirm/Cancel step instead of a browser
    // dialog — matches demo App.tsx:1644-1658 / AnnotationFormattingBar.tsx:195-207.
    if (region.fullPageConfirmPending) {
      return (
        <div className="mobile-pdf-properties mobile-pdf-properties--actions" data-mobile-tool-properties="true" role="toolbar" aria-label="Confirm full page region">
          <span className="mobile-pdf-properties__confirm-label">Make region full page?</span>
          <button type="button" className="mobile-pdf-properties__primary" onClick={region.confirmFullPage}>Confirm</button>
          <button type="button" onClick={region.cancelFullPage}>Cancel</button>
        </div>
      );
    }
    return (
      <div className="mobile-pdf-properties mobile-pdf-properties--actions" data-mobile-tool-properties="true" role="toolbar" aria-label="Region editing">
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
      <div className="mobile-pdf-properties mobile-pdf-properties--survey" data-mobile-tool-properties="true" role="toolbar" aria-label="Survey placement">
        {/* App-styled dropdown (OWNER DECISION 3) replaces the OS module roller. */}
        <MobileStyledSelect
          ariaLabel="Survey module"
          minWidth={138}
          disabled={!survey.modules?.length}
          placeholder="No modules"
          value={survey.selectedModuleId || ''}
          options={(survey.modules || []).map((module) => ({ value: module.id, label: module.name || 'Untitled Module' }))}
          onChange={(value) => survey.onSelectModule?.(value)}
        />
        <button
          type="button"
          className={`mobile-pdf-properties__keep${survey.keepCategoryActive ? ' is-active' : ''}`}
          role="checkbox"
          aria-checked={Boolean(survey.keepCategoryActive)}
          onClick={() => survey.onKeepCategoryActiveChange?.(!survey.keepCategoryActive)}
        >
          <span aria-hidden="true">{survey.keepCategoryActive ? <Icon name="check" size={14} /> : null}</span>
          Keep active
        </button>
      </div>
    );
  }

  if (api.richTextEditor) {
    const editor = api.richTextEditor;
    const state = editor.state || {};
    const editorApi = editor.api || {};
    const alignment = `${state.verticalAlign || 'top'}|${state.textAlign || 'left'}`;
    return (
      <>
      <div className="mobile-pdf-properties mobile-pdf-properties--text" data-mobile-tool-properties="true" role="toolbar" aria-label="Text formatting">
        {/* UX 2026-07-12 (Phase E, demo parity): font-colour swatch opens the
            app's shared CompactColorPicker takeover, not an OS colour input. */}
        <button
          type="button"
          className="mobile-pdf-properties__color"
          aria-label="Font color"
          title="Font color"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setColorPicker('fontColorLive')}
        >
          <span style={{ background: toHexColor(state.fontColor, '#1e293b') }} />
        </button>
        <MobileStyledSelect
          ariaLabel="Font"
          value={state.fontFamily || 'Arial'}
          options={['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'].map((family) => ({ value: family, label: family }))}
          onChange={(family) => editorApi.setFontFamily?.(family)}
          minWidth={96}
        />
        <input
          className="mobile-pdf-properties__font-size"
          aria-label="Font size"
          inputMode="numeric"
          value={state.fontSize ?? 16}
          onChange={(event) => {
            const size = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(size)) editorApi.setFontSize?.(Math.max(1, Math.min(200, size)));
          }}
        />
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
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => editorApi[method]?.()}
          >
            <Icon name={iconName} size={18} />
          </button>
        ))}
        <MobileStyledSelect
          ariaLabel="Text alignment"
          value={alignment}
          options={['top', 'middle', 'bottom'].flatMap((vertical) => ['left', 'center', 'right'].map((horizontal) => ({
            value: `${vertical}|${horizontal}`,
            label: `${vertical} ${horizontal}`,
          })))}
          onChange={(nextAlignment) => {
            const [vertical, horizontal] = nextAlignment.split('|');
            editorApi.setTextAlign?.(horizontal);
            editorApi.setVerticalAlign?.(vertical);
          }}
          minWidth={104}
        />
      </div>
      {colorPicker === 'fontColorLive' && (
        <MobileColorPickerSurface
          title="Font color"
          color={toHexColor(state.fontColor, '#1e293b')}
          showOpacity={false}
          onChange={(hex) => editorApi.setFontColor?.(hex)}
          onClose={() => setColorPicker(null)}
        />
      )}
      </>
    );
  }

  if (textMarkup.active) {
    const markupColor = toHexColor(textMarkup.color, '#f4d35e');
    const markupOpacity = textMarkup.opacity / 100;
    if (textMarkup.sharedToolbarActive) {
      return api.showAnnotationColorPicker ? (
        <MobileColorPickerSurface
          title="Text markup color"
          color={markupColor}
          opacity={markupOpacity}
          minOpacity={0.05}
          onChange={(hex, alpha) => {
            const opacity = Math.round(Math.max(0.05, alpha ?? markupOpacity) * 100);
            if (api.handleTextMarkupPaintChange) api.handleTextMarkupPaintChange(hex, opacity);
            else {
              api.handleStrokeColorChange?.(hex);
              api.handleStrokeOpacityChange?.(opacity);
            }
          }}
          onClose={() => api.setShowAnnotationColorPicker?.(false)}
        />
      ) : null;
    }
    return (
      <>
        <div
          className="mobile-pdf-properties mobile-pdf-properties--text-markup"
          data-mobile-tool-properties="true"
          data-mobile-text-markup-controls={textMarkup.editingSelection ? 'edit' : 'create'}
          role="toolbar"
          aria-label={textMarkup.editingSelection ? 'Edit text markup' : 'Text markup defaults'}
        >
          <button
            type="button"
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
            onChange={(hex, alpha) => {
              const opacity = Math.round(Math.max(0.05, alpha ?? markupOpacity) * 100);
              if (api.handleTextMarkupPaintChange) api.handleTextMarkupPaintChange(hex, opacity);
              else {
                api.handleStrokeColorChange?.(hex);
                api.handleStrokeOpacityChange?.(opacity);
              }
            }}
            onClose={() => api.setShowAnnotationColorPicker?.(false)}
          />
        )}
      </>
    );
  }

  if (api.activeTool === 'pan' || (api.activeTool === 'select' && (!api.contextTool || api.contextTool === 'select'))) return null;

  const isEraser = tool === 'eraser';
  const showWidth = isEraser || WIDTH_TOOLS.has(tool);
  const showFill = FILL_TOOLS.has(tool) && typeof api.handleFillColorChange === 'function';
  const showBorderStyle = BORDER_STYLE_TOOLS.has(tool) && typeof api.setLineBorderStyle === 'function';
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
  const updateTextDefaults = (patch) => api.onTextStyleDefaultsChange?.({ ...textDefaults, ...patch });
  // 2026-07-12 (Phase E, demo parity — matrix §6): the full edit sheet now
  // opens for EVERY annotation tool (demo AnnotationEditPanel), not just
  // text/callout. Non-text tools show only the shape-side cards.
  const isTextTool = tool === 'text' || tool === 'callout';
  const sheetTitle = TOOL_LABELS[tool] || 'Annotation';
  // Effective sheet tab: text/callout keep the Text/Shape segmented control;
  // pen/shape/counter force the shape-side cards.
  const sheetTab = isTextTool ? textDefaultsTab : 'shape';
  // Tools without a fill (pen/highlighter/line/arrow) collapse the shape
  // colour card to a single Stroke section (no Fill/Stroke sub-tabs).
  const hasFillSheet = FILL_TOOLS.has(tool);
  const shapeSection = hasFillSheet ? textShapeColorSection : 'stroke';
  const showBorderStyleSheet = BORDER_STYLE_TOOLS.has(tool) && typeof api.setLineBorderStyle === 'function';
  const showArrowheadSheet = (tool === 'arrow' || tool === 'callout') && typeof api.setArrowheadStyle === 'function';
  const shapeColor = shapeSection === 'fill'
    ? toHexColor(api.fillColor, '#ffffff')
    : toHexColor(api.strokeColor, '#ff0000');
  const applyShapeColor = (color) => {
    if (shapeSection === 'fill') api.handleFillColorChange?.(color);
    else api.handleStrokeColorChange?.(color);
  };
  // Open the edit sheet from a strip swatch, focused on the tapped colour
  // section (demo: swatch → AnnotationEditPanel focused on that colour).
  const openSheet = (section) => {
    if (section === 'fill' || section === 'stroke') setTextShapeColorSection(section);
    setTextDefaultsTab('shape');
    setTextDefaultsOpen(true);
  };
  // Config for the shared CompactColorPicker takeover, per open target.
  const colorPickerConfig = colorPicker === 'textColor'
    ? {
      title: 'Text color',
      color: toHexColor(textDefaults.fontColor, '#1e293b'),
      showOpacity: false,
      onChange: (hex) => updateTextDefaults({ fontColor: hex }),
    }
    : colorPicker === 'fill'
      ? {
        title: 'Fill color',
        color: toHexColor(api.fillColor, '#ffffff'),
        opacity: Math.max(0, Math.min(1, (api.fillOpacity ?? 100) / 100)),
        showOpacity: typeof api.handleFillOpacityChange === 'function',
        firstPreset: 'transparent',
        onChange: (hex, alpha) => {
          api.handleFillColorChange?.(hex);
          api.handleFillOpacityChange?.(Math.round((alpha ?? 1) * 100));
        },
      }
      : colorPicker === 'stroke'
        ? {
          title: 'Stroke color',
          color: toHexColor(api.strokeColor, '#ff0000'),
          opacity: Math.max(0, Math.min(1, (api.strokeOpacity ?? 100) / 100)),
          showOpacity: typeof api.handleStrokeOpacityChange === 'function',
          firstPreset: 'transparent',
          onChange: (hex, alpha) => {
            api.handleStrokeColorChange?.(hex);
            api.handleStrokeOpacityChange?.(Math.round((alpha ?? 1) * 100));
          },
        }
        : null;

  return (
    <>
    <DismissBarrier
      active={counterMenuOpen}
      insideRefs={counterMenuInsideRefs}
      onDismiss={() => setCounterMenuOpen(false)}
    />
    <div className="mobile-pdf-properties" data-mobile-tool-properties="true" role="toolbar" aria-label={`${tool || 'Annotation'} formatting`}>
      {isEraser && api.setEraserMode && (
        <MobileStyledSelect
          ariaLabel="Eraser mode"
          minWidth={104}
          value={api.eraserMode || 'partial'}
          options={[
            { value: 'partial', label: 'Partial Erase' },
            { value: 'entire', label: 'Full Stroke' },
          ]}
          onChange={(value) => api.setEraserMode(value)}
        />
      )}
      {!isEraser && showStroke && (
        <div className="mobile-pdf-properties__color-anchor">
          {/* UX 2026-07-12 (Phase E, demo parity — matrix §6 "Stroke color
              swatch"/"Fill+border swatch"): the strip swatch opens the full
              edit sheet focused on the tapped colour (demo AFB swatch →
              AnnotationEditPanel), which hosts the shared CompactColorPicker.
              Replaces the OS <input type=color> (project rule: one shared
              colour picker, never the native OS picker). */}
          <button
            type="button"
            className={`mobile-pdf-properties__swatch${tool === 'counter' ? ' is-counter' : ''}`}
            aria-label={showFill ? (tool === 'counter' ? 'Counter colors' : 'Fill and border colors') : 'Stroke color'}
            style={{
              '--mobile-swatch-fill': showFill ? toHexColor(api.fillColor, '#ff0000') : toHexColor(api.strokeColor, '#ff0000'),
              '--mobile-swatch-stroke': toHexColor(api.strokeColor, '#ff0000'),
            }}
            onClick={() => openSheet(showFill ? 'fill' : 'stroke')}
          >
            {tool === 'counter' ? '1' : null}
          </button>
        </div>
      )}
      {showWidth && tool !== 'counter' && (
        <AnnotationSizeControl
          className="mobile-pdf-properties__size-control"
          label={sizeLabel}
          value={sizeValue}
          min={sizeMin}
          max={sizeMax}
          decimals={isEraser ? 0 : ANNOTATION_WIDTH_DECIMALS}
          presets={sizePresets}
          onValueChange={handleSizeDraft}
          onValueCommit={handleSizeCommit}
          onFocusChange={handleSizeFocus}
        />
      )}
      {tool === 'counter' && (
        <div className="mobile-pdf-properties__menu-anchor" ref={counterMenuRef}>
          <button
            type="button"
            className="mobile-pdf-properties__text-button"
            aria-expanded={counterMenuOpen}
            onClick={() => setCounterMenuOpen((open) => !open)}
          >
            {(api.counterSeriesList || []).find((series) => series.seriesId === api.activeCounterSeriesId)?.label || 'Counter Series'}
          </button>
          {counterMenuOpen && (
            <div className="mobile-pdf-properties__menu">
              <strong>Counter Series</strong>
              <button type="button" onClick={() => { api.onNewCounterSeries?.(); setCounterMenuOpen(false); }}>+ New Count</button>
              {!!api.counterSeriesList?.length && <span>Continue Count</span>}
              {(api.counterSeriesList || []).map((series) => (
                <button
                  type="button"
                  key={series.seriesId}
                  className={series.seriesId === api.activeCounterSeriesId ? 'is-active' : ''}
                  onClick={() => { api.onSwitchCounterSeries?.(series.seriesId); setCounterMenuOpen(false); }}
                >
                  <i style={{ background: series.color }} />
                  <b>{series.label}</b>
                  <em>{series.count}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showWidth && tool === 'counter' && (
        <AnnotationSizeControl
          className="mobile-pdf-properties__size-control"
          label="Size"
          value={sizeValue}
          min={sizeMin}
          max={sizeMax}
          presets={sizePresets}
          onValueChange={handleSizeDraft}
          onValueCommit={handleSizeCommit}
          onFocusChange={handleSizeFocus}
        />
      )}
      {showBorderStyle && (
        <MobileStyledSelect
          ariaLabel="Border style"
          minWidth={STRIP_DROPDOWN_WIDTH}
          value={api.lineBorderStyle === 'cloud' && !api.supportsCloudStyle ? 'solid' : (api.lineBorderStyle || 'solid')}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' },
            /* UX 2026-09-09: Cloud is offered on every shape a revision cloud
               can enclose or trace (rectangle, ellipse/circle, polygon,
               polyline) and never on arrow, counter or a single straight line.
               supportsCloudStyle mirrors the desktop gate exactly. */
            ...(api.supportsCloudStyle ? [{ value: 'cloud', label: 'Cloud' }] : []),
          ]}
          onChange={(value) => api.setLineBorderStyle(value)}
        />
      )}
      {api.supportsCloudStyle && api.lineBorderStyle === 'cloud' && api.setCloudIntensity && (
        <label className="mobile-pdf-properties__bump">
          <span>Bump</span>
          <input
            aria-label="Cloud bump size"
            inputMode="numeric"
            // UX 2026-09-10: numeric chrome field — yields Enter / Escape to a
            // click-to-place draft (see draftKeyboardTarget).
            data-draft-yields-keys="true"
            value={api.cloudIntensity ?? 2}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value)) api.setCloudIntensity(Math.max(1, Math.min(20, value)));
            }}
          />
        </label>
      )}
      {showArrowhead && (
        <MobileStyledSelect
          ariaLabel="Arrowhead style"
          minWidth={124}
          value={api.arrowheadStyle || 'solidTriangle'}
          options={Object.entries(MOBILE_ARROWHEAD_STYLE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => api.setArrowheadStyle(value)}
        />
      )}
      {/* "Both ends" (owner 2026-09-02) — same toggle as desktop, mobile chrome. */}
      {showArrowhead && tool === 'arrow' && typeof api.setArrowBothEnds === 'function' && (
        <button
          type="button"
          className={`mobile-pdf-properties__edit${api.arrowBothEnds ? ' is-active' : ''}`}
          onClick={() => api.setArrowBothEnds(!api.arrowBothEnds)}
          aria-label="Arrowhead on both ends"
          aria-pressed={!!api.arrowBothEnds}
        >
          Both ends
        </button>
      )}
      {api.onEnterTextEdit && (tool === 'text' || tool === 'callout' || api.richTextEditor) && (
        <button
          type="button"
          className={`mobile-pdf-properties__edit${api.richTextEditor ? ' is-active' : ''}`}
          aria-label="Text formatting"
          aria-expanded={textDefaultsOpen}
          onClick={() => {
            if (api.canEnterTextEdit || api.richTextEditor) api.onEnterTextEdit();
            else {
              setTextDefaultsTab('text');
              setTextDefaultsOpen(true);
            }
          }}
        >
          Aa
        </button>
      )}
      {api.canEnterBBoxEdit && api.onEnterBBoxEdit && (
        <button
          type="button"
          className="mobile-pdf-properties__edit"
          aria-label="Resize and rotate"
          onClick={api.onEnterBBoxEdit}
        >
          ↗
        </button>
      )}
    </div>
    {textDefaultsOpen && typeof document !== 'undefined' && createPortal(
      <>
        <button
          type="button"
          className="mobile-pdf-sheet-backdrop"
          aria-label="Close text formatting"
          onClick={requestTextSheetClose}
        />
        <section
          className={`mobile-pdf-text-defaults is-${sheetTab}${tool === 'callout' ? ' is-callout' : ''}`}
          aria-label={`${sheetTitle} settings`}
          style={textSheetMotionStyle}
        >
          <div
            className="mobile-pdf-sheet__handle"
            onTouchStart={textSheetDragHandlers.onTouchStart}
            onTouchMove={textSheetDragHandlers.onTouchMove}
            onTouchEnd={textSheetDragHandlers.onTouchEnd}
          />
          <header>
            <div>
              <strong>{sheetTitle} settings</strong>
              <span>Focused on {sheetTab === 'text' ? 'Text' : 'Shape'}</span>
            </div>
            <button type="button" aria-label="Close annotation settings" onClick={requestTextSheetClose}>
              <Icon name="close" size={17} color="currentColor" />
            </button>
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
            {sheetTab === 'text' ? (
              <>
                <section className="mobile-pdf-text-card mobile-pdf-text-card--color mobile-pdf-text-card--text-color">
                  <div className="mobile-pdf-text-card__header">
                    <div>
                      <strong>Text color</strong>
                      <span>{toHexColor(textDefaults.fontColor, '#1e293b').toUpperCase()}</span>
                    </div>
                    <button
                      type="button"
                      className="mobile-pdf-text-card__large-swatch"
                      aria-label="Open Text color picker"
                      style={{ '--mobile-text-color': toHexColor(textDefaults.fontColor, '#1e293b') }}
                      onClick={() => setColorPicker('textColor')}
                    />
                  </div>
                  <div className="mobile-pdf-text-card__colors">
                    {MOBILE_ANNOTATION_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Set Text color ${color}`}
                        aria-pressed={color.toLowerCase() === toHexColor(textDefaults.fontColor, '#1e293b').toLowerCase()}
                        className={color.toLowerCase() === toHexColor(textDefaults.fontColor, '#1e293b').toLowerCase() ? 'is-active' : ''}
                        onClick={() => updateTextDefaults({ fontColor: color })}
                      >
                        <span style={{ backgroundColor: color }} />
                      </button>
                    ))}
                  </div>
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
                    <input
                      inputMode="numeric"
                      aria-label="Font size"
                      value={textDefaults.fontSize ?? 16}
                      onChange={(event) => {
                        const fontSize = Number.parseInt(event.target.value, 10);
                        if (Number.isFinite(fontSize)) updateTextDefaults({ fontSize: Math.max(1, Math.min(200, fontSize)) });
                      }}
                    />
                  </label>
                </section>

                <section className="mobile-pdf-text-card mobile-pdf-text-card--alignment">
                  <strong>Text alignment</strong>
                  <div className="mobile-pdf-text-defaults__alignments" role="toolbar" aria-label="Text alignment">
                    {['left', 'center', 'right'].map((alignment) => (
                      <button
                        key={alignment}
                        type="button"
                        aria-label={`${alignment[0].toUpperCase()}${alignment.slice(1)} horizontal alignment`}
                        aria-pressed={(textDefaults.textAlign || 'left') === alignment}
                        className={(textDefaults.textAlign || 'left') === alignment ? 'is-active' : ''}
                        onClick={() => updateTextDefaults({ textAlign: alignment })}
                      >
                        <MobileTextAlignmentGlyph axis="horizontal" value={['left', 'center', 'right'].indexOf(alignment)} active={(textDefaults.textAlign || 'left') === alignment} />
                      </button>
                    ))}
                  </div>
                  <div className="mobile-pdf-text-defaults__alignments" role="toolbar" aria-label="Vertical text alignment">
                    {['top', 'middle', 'bottom'].map((alignment) => (
                      <button
                        key={alignment}
                        type="button"
                        aria-label={`${alignment === 'middle' ? 'Center' : `${alignment[0].toUpperCase()}${alignment.slice(1)}`} vertical alignment`}
                        aria-pressed={(textDefaults.verticalAlign || 'top') === alignment}
                        className={(textDefaults.verticalAlign || 'top') === alignment ? 'is-active' : ''}
                        onClick={() => updateTextDefaults({ verticalAlign: alignment })}
                      >
                        <MobileTextAlignmentGlyph axis="vertical" value={['top', 'middle', 'bottom'].indexOf(alignment)} active={(textDefaults.verticalAlign || 'top') === alignment} />
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className={`mobile-pdf-text-card mobile-pdf-text-card--color mobile-pdf-text-card--shape-color${hasFillSheet ? '' : ' mobile-pdf-text-card--stroke-only'}`}>
                  {/* Fill/Stroke sub-tabs only for tools that HAVE a fill
                      (rect/ellipse/counter). Pen/highlighter/line/arrow show a
                      single stroke section — matches demo AnnotationEditPanel,
                      which omits the fill face for strokes-only annotations. */}
                  {hasFillSheet && (
                    <div className="mobile-pdf-text-card__color-tabs" role="tablist" aria-label="Shape color section">
                      {['fill', 'stroke'].map((section) => (
                        <button
                          key={section}
                          type="button"
                          role="tab"
                          aria-label={`${section === 'fill' ? 'Fill' : 'Stroke'} color`}
                          aria-selected={textShapeColorSection === section}
                          className={textShapeColorSection === section ? 'is-active' : ''}
                          onClick={() => setTextShapeColorSection(section)}
                        >
                          <i style={{ backgroundColor: section === 'fill' ? toHexColor(api.fillColor, '#ffffff') : toHexColor(api.strokeColor, '#ff0000') }} />
                          {section === 'fill' ? 'Fill' : 'Stroke'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mobile-pdf-text-card__header">
                    <div>
                      <strong>{shapeSection === 'fill' ? 'Fill' : 'Stroke'} color</strong>
                      <span>{shapeColor.toUpperCase()}</span>
                    </div>
                    {/* Large swatch opens the shared CompactColorPicker takeover
                        (demo AnnotationEditPanel large swatch → gradient/HSV +
                        opacity picker). No OS <input type=color>. */}
                    <button
                      type="button"
                      className="mobile-pdf-text-card__large-swatch"
                      aria-label={`Open ${shapeSection} color picker`}
                      style={{ '--mobile-text-color': shapeColor }}
                      onClick={() => setColorPicker(shapeSection)}
                    />
                  </div>
                  <div className="mobile-pdf-text-card__colors">
                    {MOBILE_ANNOTATION_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Set ${shapeSection === 'fill' ? 'Fill' : 'Stroke'} color ${color}`}
                        aria-pressed={color.toLowerCase() === shapeColor.toLowerCase()}
                        className={color.toLowerCase() === shapeColor.toLowerCase() ? 'is-active' : ''}
                        onClick={() => applyShapeColor(color)}
                      >
                        <span style={{ backgroundColor: color }} />
                      </button>
                    ))}
                  </div>
                </section>

                <section className={`mobile-pdf-text-card mobile-pdf-text-card--split${showBorderStyleSheet ? '' : ' mobile-pdf-text-card--width-only'}`}>
                  {showBorderStyleSheet && (
                    <>
                      <div className="mobile-pdf-text-card__pane">
                        <strong>Stroke style</strong>
                        {/* App-styled dropdown (OWNER DECISION 3) — same reusable
                            menu as the strip, so the sheet matches. */}
                        {/* UX 2026-09-09: the sheet is the mobile "style
                            sheet", so once Cloud is picked here the Bump size
                            sits right beside it on the same row - same 1..20
                            clamp as the strip and desktop, so a cloud looks the
                            same wherever it was set. Same row (not a second
                            row) because the sheet has a fixed height and a
                            taller pane clipped at the bottom on the iPhone 17
                            Pro simulator. */}
                        <div className="mobile-pdf-text-card__style-row">
                          <MobileStyledSelect
                            ariaLabel="Stroke style"
                            value={api.lineBorderStyle === 'cloud' && !api.supportsCloudStyle ? 'solid' : (api.lineBorderStyle || 'solid')}
                            options={[
                              { value: 'solid', label: 'Solid' },
                              { value: 'dashed', label: 'Dashed' },
                              { value: 'dotted', label: 'Dotted' },
                              /* Same Cloud rule as the strip picker above. */
                              ...(api.supportsCloudStyle ? [{ value: 'cloud', label: 'Cloud' }] : []),
                            ]}
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
                    <AnnotationSizeControl
                      label={tool === 'counter' ? 'Size' : 'Width'}
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

                {showArrowheadSheet && (
                  <section className="mobile-pdf-text-card mobile-pdf-text-card--arrowhead">
                    <strong>Arrowhead</strong>
                    {/* App-styled dropdown (OWNER DECISION 3). */}
                    <MobileStyledSelect
                      ariaLabel="Arrowhead"
                      value={api.arrowheadStyle || 'solidTriangle'}
                      options={Object.entries(MOBILE_ARROWHEAD_STYLE_LABELS).map(([value, label]) => ({ value, label }))}
                      onChange={(value) => api.setArrowheadStyle?.(value)}
                    />
                    {tool === 'arrow' && typeof api.setArrowBothEnds === 'function' && (
                      <button
                        type="button"
                        className={`mobile-pdf-properties__edit${api.arrowBothEnds ? ' is-active' : ''}`}
                        onClick={() => api.setArrowBothEnds(!api.arrowBothEnds)}
                        aria-label="Arrowhead on both ends"
                        aria-pressed={!!api.arrowBothEnds}
                      >
                        Both ends
                      </button>
                    )}
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
        onChange={colorPickerConfig.onChange}
        onClose={() => setColorPicker(null)}
      />
    )}
    </>
  );
}

export function MobilePdfViewerToolRail({ bottomToolbarApi, leftRailApi, onOpenPanel, onAuxPanelStateChange }) {
  const [openCategory, setOpenCategory] = useState(null);
  const [selectModeOpen, setSelectModeOpen] = useState(false);
  const [selectModePosition, setSelectModePosition] = useState(null);
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
    dragHandlers: usersSheetDragHandlers,
    requestClose: requestUsersSheetClose,
  } = useMobileSheetMotion(() => setPresenceOpen(false));
  const popoverRef = useRef(null);
  const selectModeButtonRef = useRef(null);
  const selectModeCaretRef = useRef(null);
  const selectModeMenuRef = useRef(null);
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

  useEffect(() => {
    if (!selectModeOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      const menu = selectModeMenuRef.current;
      const selected = menu?.querySelector?.('[role="menuitemradio"][aria-checked="true"]');
      (selected || menu?.querySelector?.('[role="menuitemradio"]'))?.focus?.();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [selectModeOpen]);

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

  useEffect(() => {
    if (activeGroup) {
      setOpenCategory(activeGroup);
    } else {
      setOpenCategory(null);
    }
  }, [activeGroup, activeTool]);

  const selectTool = (toolId) => {
    bottomToolbarApi?.setActiveTool?.(toolId);
    bottomToolbarApi?.setActiveCategoryDropdown?.(null);
  };

  const openSelectModeMenu = () => {
    const rect = selectModeButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = Math.min(180, Math.max(0, window.innerWidth - 16));
      const menuHeight = 152;
      setSelectModePosition({
        left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right + 8)),
        top: Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.top + (rect.height / 2) - (menuHeight / 2))),
      });
    }
    setSelectModeOpen(true);
  };

  useEffect(() => {
    if (!selectModeOpen) return undefined;
    const reposition = () => {
      const rect = selectModeButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const menuWidth = Math.min(180, Math.max(0, viewportWidth - 16));
      const menuHeight = 152;
      setSelectModePosition({
        left: Math.max(viewportLeft + 8, Math.min(viewportLeft + viewportWidth - menuWidth - 8, rect.right + 8)),
        top: Math.max(viewportTop + 8, Math.min(viewportTop + viewportHeight - menuHeight - 8, rect.top + (rect.height / 2) - (menuHeight / 2))),
      });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('orientationchange', reposition);
    window.visualViewport?.addEventListener?.('resize', reposition);
    window.visualViewport?.addEventListener?.('scroll', reposition);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('orientationchange', reposition);
      window.visualViewport?.removeEventListener?.('resize', reposition);
      window.visualViewport?.removeEventListener?.('scroll', reposition);
    };
  }, [selectModeOpen]);

  const chooseSelectMode = (mode) => {
    bottomToolbarApi?.setSelectionMode?.(mode);
    if (mode === 'text') {
      selectTool('text-select');
    } else {
      selectTool('select');
    }
    setOpenCategory(null);
    setSelectModeOpen(false);
    window.requestAnimationFrame(() => selectModeCaretRef.current?.focus?.());
  };

  const toggleCategory = (groupId) => {
    const group = TOOL_GROUPS[groupId];
    // UX 2026-09-16 (phone chrome pass): a second tap on the group that is
    // already open closes its strip and gives the rail its height back. The
    // armed tool is deliberately left alone — closing the strip is a view
    // change, not a tool change. Reference: Drawboard PDF's phone rail
    // collapses an expanded group on a repeat tap. Opening a group still arms
    // its last-used tool (unchanged).
    if (openCategory === groupId) {
      setOpenCategory(null);
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
          <div
            ref={selectModeButtonRef}
            className="mobile-pdf-tools__select-family"
            data-active={activeTool === 'select' || activeTool === 'text-select' ? 'true' : 'false'}
          >
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
            <button
              ref={selectModeCaretRef}
              type="button"
              className="mobile-pdf-tools__select-caret"
              aria-label="Selection mode"
              aria-haspopup="menu"
              aria-expanded={selectModeOpen}
              aria-controls="mobile-select-mode-menu"
              onClick={() => {
                selectModeOpen ? setSelectModeOpen(false) : openSelectModeMenu();
              }}
            >
              {/* UX: 8px full-contrast caret keeps the phone's only mode
                  disclosure legible at 1x in both active and idle states.
                  2026-09-16: currentColor, not a hard-coded cream. The colour was
                  a literal, so when the Select family went active and its glyph
                  turned gold the caret stayed cream — one control showing two
                  different active colours. */}
              <Icon
                name={selectModeOpen ? 'chevronLeft' : 'chevronRight'}
                size={8}
                color="currentColor"
              />
            </button>
          </div>
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
          {openCategory && (
            <>
              <div className="mobile-pdf-tools__divider is-short" />
              <div className="mobile-pdf-tools__subtools">
                {TOOL_GROUPS[openCategory].tools.map((tool) => (
                  <RailButton
                    key={tool.id}
                    active={activeTool === tool.id}
                    icon={tool.icon}
                    glyph={SUBTOOL_GLYPH}
                    label={tool.label}
                    disabled={tool.disabled}
                    onClick={() => { if (!tool.disabled) selectTool(tool.id); }}
                  />
                ))}
              </div>
            </>
          )}
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
                    onClick={() => bottomToolbarApi.surveyToolbar.onSelectCategory?.(category.id)}
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
                    onClick={() => bottomToolbarApi.surveyToolbar.onSelectEntity?.(entity.id)}
                  >
                    <span style={{ background: entity.color || '#6f7785' }} />
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
              label="Version history"
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
              {typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && (
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
              )}
              <button type="button" onClick={() => { bottomToolbarApi?.zoomOut?.(); setMoreOpen(false); }}>
                <Icon name="minus" size={16} color="currentColor" />
                Zoom out
              </button>
              <button type="button" onClick={() => { bottomToolbarApi?.zoomIn?.(); setMoreOpen(false); }}>
                <Icon name="plus" size={16} color="currentColor" />
                Zoom in
              </button>
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
      {selectModeOpen && selectModePosition && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="mobile-pdf-select-mode__backdrop"
            aria-hidden="true"
            onPointerDown={() => setSelectModeOpen(false)}
          />
          <div
            id="mobile-select-mode-menu"
            ref={selectModeMenuRef}
            className="mobile-pdf-select-mode__menu"
            role="menu"
            aria-label="Selection mode"
            style={{ left: selectModePosition.left, top: selectModePosition.top }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setSelectModeOpen(false);
                window.requestAnimationFrame(() => selectModeCaretRef.current?.focus?.());
                return;
              }
              const items = Array.from(e.currentTarget.querySelectorAll('[role="menuitemradio"]'));
              const currentIndex = Math.max(0, items.indexOf(document.activeElement));
              const nextIndex = getSelectModeMenuFocusIndex(e.key, currentIndex, items.length);
              if (nextIndex != null) {
                e.preventDefault();
                items[nextIndex]?.focus();
              }
            }}
          >
            {SELECT_MODE_OPTIONS.map((option) => {
              const selected = isSelectModeActive(option, bottomToolbarApi?.selectionMode);
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={selected ? 'is-active' : ''}
                  onClick={() => chooseSelectMode(option.mode)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name={getSelectModeIconName(option.mode)} size={19} color="currentColor" />
                    <span>{option.label}</span>
                  </span>
                  {selected && <Icon name="check" size={14} color="currentColor" />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
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
          />
          <section className="mobile-pdf-sheet mobile-pdf-users-sheet" aria-label="Active users" style={usersSheetMotionStyle}>
            <div
              className="mobile-pdf-sheet__handle"
              onTouchStart={usersSheetDragHandlers.onTouchStart}
              onTouchMove={usersSheetDragHandlers.onTouchMove}
              onTouchEnd={usersSheetDragHandlers.onTouchEnd}
            />
            <header>
              <div>
                <strong>Active users</strong>
                <span>{presenceCount} viewing this document</span>
              </div>
              <button type="button" aria-label="Close active users" onClick={requestUsersSheetClose}>
                <Icon name="close" size={17} color="currentColor" />
              </button>
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

export function MobilePdfViewerDock({ onOpenPanel, onToggleHub, onOpenSurvey, hubMode = 'pages', hubOpen = false, spacesActive, surveyActive }) {
  const hubLabels = { pages: 'Pages', search: 'Search', bookmarks: 'Bookmarks' };
  const hubIcons = { pages: 'document', search: 'search', bookmarks: 'bookmark' };
  return (
    <nav className="mobile-pdf-dock" aria-label="Document panels">
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
            21 / 18 / 22. DOCK_GLYPH is that size, two thirds of the 30px dock
            chip the sizing pass settled on. */}
        <Icon name={hubIcons[hubMode] || 'pages'} size={DOCK_GLYPH} color="currentColor" />
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
