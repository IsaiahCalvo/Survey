/*
 * The phone "<Tool>" settings sheet's building blocks (owner 2026-10-02, Test 19:
 * "it looks like people just pushed it together ... have it be intentional").
 *
 * ONE layout for every tool that opens the sheet (pen, highlighter, the shapes,
 * counter, text box, callout, eraser):
 *   - sections with no card around them, split by one hairline;
 *   - a section label, or a row label, at 13/600 sentence case, always left;
 *   - every control row is 44px (a finger), every control sits on the sheet's
 *     one 16px gutter, and a row's value reads in one right-hand column;
 *   - nothing opens a list outside the sheet: a choice of a few is a segmented
 *     row, a number is a slider with its value field beside it.
 * The rows change nothing about WHAT is written - each one calls the same
 * handler the old card did (see MobileToolProperties).
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icons';
import { ChosenCheck } from '../components/QuickStyleControls';
import {
  needsSwatchHairline,
  normaliseQuickColour,
  swatchCheckInk,
  swatchRingColour,
} from '../utils/quickStylePresets';
import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../utils/annotationSize';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A labelled group of rows. `aside` sits at the right of the label line. */
export function SheetSection({ label, aside = null, className = '', children }) {
  return (
    <section className={`mobile-tool-sheet__section${className ? ` ${className}` : ''}`}>
      {(label || aside) && (
        <div className="mobile-tool-sheet__head">
          {label ? <strong>{label}</strong> : <span />}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** One 44px row: its label on the left, its control filling the rest. */
export function SheetRow({ label, className = '', children }) {
  return (
    <div className={`mobile-tool-sheet__row${className ? ` ${className}` : ''}`}>
      <strong>{label}</strong>
      {children}
    </div>
  );
}

/** One colour circle - the HeroUI swatch (src/styles/swatches.css): chosen =
    its own colour as the ring, and a check. Never gold. */
function SheetSwatch({ color, chosen, label, onPick }) {
  return (
    <button
      type="button"
      className="hero-swatch mobile-tool-sheet__swatch"
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

/**
 * The colour row: the presets and, in the last cell, the custom colour. Eight
 * equal cells across the gutter, so the row always fits the sheet exactly.
 * When the colour in force is none of the presets, the custom cell SHOWS it
 * (filled, ringed, checked) - it replaces the old lone big circle that floated
 * at the top right. Tapping it opens the shared colour picker either way.
 */
export function SheetSwatchRow({ colors, value, ariaLabel, swatchLabel, customLabel, onPick, onCustom }) {
  const current = value ? normaliseQuickColour(value) : null;
  const presetChosen = colors.some((color) => normaliseQuickColour(color) === current);
  const customChosen = Boolean(current) && !presetChosen;
  return (
    <div className="mobile-tool-sheet__swatches" role="group" aria-label={ariaLabel}>
      {colors.map((color) => (
        <SheetSwatch
          key={color}
          color={color}
          chosen={normaliseQuickColour(color) === current}
          label={swatchLabel(color)}
          onPick={() => onPick(color)}
        />
      ))}
      <button
        type="button"
        className={`hero-swatch mobile-tool-sheet__swatch mobile-tool-sheet__custom${customChosen ? ' is-custom' : ''}`}
        data-selected={customChosen ? 'true' : 'false'}
        aria-label={customLabel}
        style={{ borderRadius: '50%', '--hero-swatch-ring': customChosen ? swatchRingColour(value) : undefined }}
        onClick={onCustom}
      >
        {customChosen ? (
          <span
            className={`hero-swatch__fill${needsSwatchHairline(value) ? ' has-hairline' : ''}`}
            style={{ background: value }}
          >
            <span className="hero-swatch__check" style={{ color: swatchCheckInk(value) }} aria-hidden="true">
              <ChosenCheck size={12} />
            </span>
          </span>
        ) : (
          <>
            <span className="mobile-tool-sheet__rainbow" aria-hidden="true" />
            {/* The app's own plus (src/Icons.jsx), not a redrawn one. */}
            <span className="mobile-tool-sheet__plus" aria-hidden="true">
              <Icon name="plus" size={14} color="currentColor" />
            </span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * The drag part of a slider: pointer capture, a preview on every move and ONE
 * commit on release - the shared colour picker's drag contract
 * ({ phase: 'preview' } ... { phase: 'commit' }), so a drag is one undo step.
 * The sheet's swipe-to-close ignores a touch that starts on role="slider"
 * (useMobileSheetMotion FOREIGN_GESTURE_SELECTOR).
 */
function useSliderDrag({ fractionToValue, onMove, onRelease }) {
  const ref = useRef(null);
  const drag = useRef({ id: null, last: null });
  const valueAt = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    const inset = 10;
    return fractionToValue(clamp((clientX - rect.left - inset) / Math.max(1, rect.width - 2 * inset), 0, 1));
  };
  const end = (event) => {
    if (drag.current.id === null || (event && event.pointerId !== drag.current.id)) return;
    const { last } = drag.current;
    drag.current = { id: null, last: null };
    if (last !== null) onRelease(last);
  };
  return {
    ref,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const next = valueAt(event.clientX);
        drag.current = { id: event.pointerId, last: next };
        onMove(next);
      },
      onPointerMove: (event) => {
        if (drag.current.id !== event.pointerId) return;
        const next = valueAt(event.clientX);
        if (next === drag.current.last) return;
        drag.current.last = next;
        onMove(next);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    },
  };
}

/** Where a 0..1 fraction puts the thumb: inset 10px so it never pokes past the
    track's round ends (the shared picker's THUMB_INSET). */
const thumbLeft = (fraction) => `calc(10px + (100% - 20px) * ${clamp(fraction, 0, 1)})`;

/**
 * Opacity - the SAME slider the shared colour picker draws (a chequer under a
 * ramp to the live colour, a thumb filled with that colour), with its value
 * in percent beside it. `onChange(percent, meta)`.
 */
export function SheetOpacitySlider({ color, value, min = 0, onChange }) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setLocal(value); }, [value]);
  const floor = Math.round(min * 100);
  const { ref, handlers } = useSliderDrag({
    fractionToValue: (t) => clamp(Math.round(t * 100), floor, 100),
    onMove: (next) => { dragging.current = true; setLocal(next); onChange(next, { phase: 'preview' }); },
    onRelease: (next) => { dragging.current = false; setLocal(next); onChange(next, { phase: 'commit' }); },
  });
  const step = (next) => { const v = clamp(next, floor, 100); setLocal(v); onChange(v); };
  const shown = Math.round(local ?? 100);
  return (
    <SheetRow label="Opacity">
      <div
        ref={ref}
        className="mobile-tool-sheet__slider"
        role="slider"
        tabIndex={0}
        aria-label="Opacity"
        aria-valuemin={floor}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-valuetext={`${shown} percent`}
        onKeyDown={(event) => {
          const delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[event.key];
          if (delta) { event.preventDefault(); step(shown + delta); }
          else if (event.key === 'Home') { event.preventDefault(); step(floor); }
          else if (event.key === 'End') { event.preventDefault(); step(100); }
        }}
        {...handlers}
      >
        <span className="mobile-tool-sheet__track mobile-tool-sheet__track--alpha" style={{ '--sheet-slider-ink': color }}>
          <span className="mobile-tool-sheet__thumb" style={{ left: thumbLeft(shown / 100), background: color }} />
        </span>
      </div>
      <span className="mobile-tool-sheet__value">{shown}%</span>
    </SheetRow>
  );
}

/** Where a value sits on a scale of uneven stops (the app's preset lists):
    each stop is one equal step, and a value between two stops sits between
    them - so a typed 40pt or a cloud's 2.5pt still places the thumb. */
const fractionOf = (stops, value) => {
  const v = Number(value);
  if (!Number.isFinite(v) || stops.length < 2) return null;
  if (v <= stops[0]) return 0;
  const last = stops.length - 1;
  if (v >= stops[last]) return 1;
  for (let i = 0; i < last; i += 1) {
    if (v >= stops[i] && v <= stops[i + 1]) {
      return (i + (v - stops[i]) / (stops[i + 1] - stops[i])) / last;
    }
  }
  return null;
};

/**
 * A size slider over the app's own preset list (no list menu): a wedge that
 * grows left to right, a thumb that snaps to the presets, `onSlide(value)` on
 * every step and `onRelease(value)` once at the end. `value` null = mixed
 * (picked marks of different sizes): no thumb until one is chosen.
 */
export function SheetScaleSlider({ ariaLabel, stops, value, unit = '', onSlide, onRelease }) {
  const sorted = [...new Set(stops.map(Number))].sort((a, b) => a - b);
  const last = sorted.length - 1;
  const fraction = value === null || value === undefined || value === '' ? null : fractionOf(sorted, value);
  const { ref, handlers } = useSliderDrag({
    fractionToValue: (t) => sorted[clamp(Math.round(t * last), 0, last)],
    onMove: (next) => onSlide?.(next),
    onRelease: (next) => onRelease?.(next),
  });
  const index = fraction === null ? -1 : Math.round(fraction * last);
  const stepTo = (i) => { const next = sorted[clamp(i, 0, last)]; onSlide?.(next); onRelease?.(next); };
  return (
    <div
      ref={ref}
      className="mobile-tool-sheet__slider"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={sorted[0]}
      aria-valuemax={sorted[last]}
      aria-valuenow={fraction === null ? undefined : Number(value)}
      aria-valuetext={fraction === null ? 'Mixed' : `${value}${unit ? ` ${unit}` : ''}`}
      onKeyDown={(event) => {
        const delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
        if (delta) { event.preventDefault(); stepTo((index < 0 ? 0 : index) + delta); }
        else if (event.key === 'Home') { event.preventDefault(); stepTo(0); }
        else if (event.key === 'End') { event.preventDefault(); stepTo(last); }
      }}
      {...handlers}
    >
      <span
        className="mobile-tool-sheet__track mobile-tool-sheet__track--wedge"
        style={{ '--sheet-slider-at': fraction === null ? '0%' : `calc(10px + (100% - 20px) * ${fraction})` }}
      >
        <svg viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
          <path className="mobile-tool-sheet__wedge" d="M0 6.2 L100 0 L100 14 L0 7.8 Z" />
        </svg>
        <svg className="mobile-tool-sheet__wedge-fill" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 6.2 L100 0 L100 14 L0 7.8 Z" />
        </svg>
        {fraction !== null && <span className="mobile-tool-sheet__thumb" style={{ left: thumbLeft(fraction) }} />}
      </span>
    </div>
  );
}

/**
 * The typed value beside a size slider - the old field's contract kept as it
 * was (src/components/AnnotationSizeControl.jsx): every keystroke is a draft
 * (`onDraft`), leaving the field or Enter commits the clamped value
 * (`onCommit`), and a mixed field left empty changes nothing.
 */
export function SheetSizeField({ label, value, min, max, decimals = 0, unit = '', mixed = false, onDraft, onCommit, onFocusChange }) {
  const valueText = value === null || value === undefined || String(value).trim() === ''
    ? ''
    : String(normalizeAnnotationSize(value, min, max, decimals));
  const [draft, setDraft] = useState(mixed ? '' : valueText);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    setDraft(mixed ? '' : valueText);
  }, [valueText, mixed]);
  const allowsDecimals = decimals > 0;
  return (
    <label className="mobile-tool-sheet__field">
      <input
        type="text"
        inputMode={allowsDecimals ? 'decimal' : 'numeric'}
        pattern={allowsDecimals ? '[0-9.]*' : '[0-9]*'}
        // UX 2026-09-10: a numeric chrome field yields Enter / Escape to a
        // click-to-place draft (polygon / polyline).
        data-draft-yields-keys="true"
        aria-label={label}
        maxLength={allowsDecimals ? 4 + decimals : 3}
        placeholder={mixed ? 'Mixed' : undefined}
        value={draft}
        onFocus={() => { focused.current = true; onFocusChange?.(true); }}
        onChange={(event) => {
          const raw = sanitizeAnnotationSizeDraft(event.target.value, decimals);
          if (raw === null) return;
          setDraft(raw);
          onDraft?.(raw);
        }}
        onBlur={(event) => {
          focused.current = false;
          onFocusChange?.(false);
          if (mixed && !event.currentTarget.value.trim()) return;
          const next = String(normalizeAnnotationSize(event.currentTarget.value, min, max, decimals));
          setDraft(next);
          onDraft?.(next);
          onCommit?.(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if ((event.key === '.' && !allowsDecimals) || event.key === ',' || event.key === '-' || event.key === '+' || event.key === 'e') {
            event.preventDefault();
          }
        }}
      />
      {unit ? <span aria-hidden="true">{unit}</span> : null}
    </label>
  );
}

/**
 * A choice of a few, all on show: equal segments, the chosen one raised on the
 * field surface. `kind="tab"` makes it a tablist (Shape / Text, Fill / Border).
 */
export function SheetSegmented({ ariaLabel, value, options, onChange, kind = 'radio', className = '' }) {
  const isTab = kind === 'tab';
  return (
    <div
      className={`mobile-tool-sheet__seg${className ? ` ${className}` : ''}`}
      role={isTab ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={isTab ? 'tab' : 'radio'}
            aria-selected={isTab ? on : undefined}
            aria-checked={isTab ? undefined : on}
            aria-label={option.ariaLabel}
            className={on ? 'is-active' : ''}
            style={option.style}
            onClick={() => onChange(option.value)}
          >
            {option.preview}
            {option.label ? <span>{option.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- preview */

const PREVIEW_PAPER_STROKE_MAX = 22;
const previewWidth = (width, max = PREVIEW_PAPER_STROKE_MAX) => clamp(Number(width) || 1, 1, max);
const dashFor = (style, width) => {
  if (style === 'dashed') return `${width * 3} ${width * 2}`;
  if (style === 'dotted') return `0.01 ${width * 2}`;
  return undefined;
};

/**
 * What the tool will draw, on a strip of paper (paper, not chrome - see the
 * NOT-for-tokens list in src/styles/tokens.css), updated live as any row
 * moves. Ink colours are the user's, so they are passed in, never themed.
 */
export function SheetPreview({ kind, stroke, fill, width, lineStyle, arrowhead = 'none', text = null, shape = 'rect' }) {
  const w = previewWidth(width);
  let body = null;
  if (kind === 'stroke' || kind === 'line' || kind === 'polyline') {
    const d = kind === 'line'
      ? 'M40 24 H272'
      : kind === 'polyline'
        ? 'M44 34 L104 12 L164 34 L224 12 L276 30'
        : 'M40 30 C 86 4, 118 44, 160 24 S 238 6, 280 22';
    const lineW = kind === 'stroke' ? w : Math.min(w, 10);
    const capRound = lineStyle === 'dotted' || kind === 'stroke';
    body = (
      <>
        <path d={d} fill="none" stroke={stroke} strokeWidth={lineW} strokeLinecap={capRound ? 'round' : 'butt'} strokeLinejoin="round" strokeDasharray={dashFor(lineStyle, lineW)} />
        {kind === 'line' && arrowhead && arrowhead !== 'none' && (
          <path d={`M${272 + lineW * 2.4} 24 L${272 - lineW * 1.2} ${24 - lineW * 2} L${272 - lineW * 1.2} ${24 + lineW * 2} Z`} fill={stroke} />
        )}
      </>
    );
  } else if (kind === 'shape') {
    const sw = Math.min(w, 8);
    const common = { fill, stroke, strokeWidth: sw, strokeDasharray: dashFor(lineStyle, sw), strokeLinejoin: 'round', strokeLinecap: lineStyle === 'dotted' ? 'round' : 'butt' };
    body = shape === 'ellipse'
      ? <ellipse cx="160" cy="24" rx="62" ry="15" {...common} />
      : shape === 'polygon'
        ? <path d="M118 38 L106 18 L150 8 L210 14 L206 38 Z" {...common} />
        : <rect x="98" y="9" width="124" height="30" rx="1" {...common} />;
  } else if (kind === 'counter') {
    const r = clamp((Number(width) || 14) / 2, 6, 19);
    body = (
      <>
        <circle cx="160" cy="24" r={r} fill={fill} />
        <text x="160" y="24" textAnchor="middle" dominantBaseline="central" fill={stroke} style={{ font: `700 ${Math.round(r * 1.1)}px Arial` }}>1</text>
      </>
    );
  } else if (kind === 'eraser') {
    const r = clamp((Number(width) || 20) / 2, 1.5, 21);
    body = <circle cx="160" cy="24" r={r} fill="rgba(0,0,0,0.06)" stroke="#6b7280" strokeWidth="1" strokeDasharray="3 2" />;
  }
  return (
    <div className="mobile-tool-sheet__preview" aria-hidden="true">
      {kind === 'text' && text ? (
        <span style={text}>Sample text</span>
      ) : (
        <svg viewBox="0 0 320 48" preserveAspectRatio="xMidYMid meet">{body}</svg>
      )}
    </div>
  );
}
