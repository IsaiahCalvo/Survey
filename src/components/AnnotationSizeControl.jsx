import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { focusMovedElsewhere } from './AnnotationDropdown';
import {
  getAnnotationSizePreviewThickness,
  normalizeAnnotationSize,
  sanitizeAnnotationSizeDraft,
  SIZE_SLIDER_STEPS,
  sizeToSliderPosition,
  sliderPositionToSize,
} from '../utils/annotationSize';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';
import './AnnotationSizeControl.css';

export const ANNOTATION_SIZE_PRESETS = Object.freeze({
  width: [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50],
  counter: [5, 8, 12, 16, 24, 32, 48, 64],
  eraser: [1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100],
});

/**
 * Shared size field with a Radix Popover preset menu.
 *
 * The visible input remains fast for custom sizes while the adjacent chevron
 * exposes battle-tested, keyboard-accessible preset selection. Callers own the
 * draft/commit state so the same control can drive drawing, erasing, and edits.
 *
 * UX 2026-09-09: `decimals` is how many decimal places the field keeps (0 =
 * whole numbers, the default for Counter Size / Eraser Size). The line Width
 * field passes ANNOTATION_WIDTH_DECIMALS (1) so the Cloud style's approved
 * 2.5-unit default reads back as "2.5" and stays 2.5 when committed, instead
 * of rounding to 3 at the display boundary.
 */
export default function AnnotationSizeControl({
  value,
  label = 'Size',
  min = 1,
  max = 100,
  decimals = 0,
  presets = ANNOTATION_SIZE_PRESETS.width,
  onValueChange,
  onValueCommit,
  onFocusChange,
  disabled = false,
  className = '',
  open: controlledOpen,
  onOpenChange,
  // PASS 7 (owner ruling, boards 8-15): on the desktop chrome a size is a
  // DROPDOWN ONLY — a pill showing what it will draw, the value with its unit,
  // and a chevron. `variant="pill"` is that presentation; the default keeps the
  // typed field for callers that still need one (the phone strip owns its own).
  variant = 'field',
  unit = '',
  width,
  preview,
  // w41: several picked marks with different widths. The pill reads "Mixed"
  // and no preset is ticked until one is chosen (then every picked mark takes
  // it). Reference: Bluebeam / Acrobat show a blank or "Mixed" field.
  mixed = false,
  // w42 (2026-09-26): the narrow-window look — "2 pt" reads "2" and the pill
  // hugs it. The stroke drawn beside it and the accessible name ("Width: 2 pt")
  // still say what the number is; the menu's rows keep the unit.
  compact = false,
  // 2026-10-22 (owner: "the stroke width selector ... looks like shit"): the
  // pill's menu is a card now (see SizeCard). `color` paints its preview in
  // the colour the tool will draw; `previewShape` is 'stroke' for a line
  // width, 'dot' for a round size (eraser rubber, counter pin).
  color,
  previewShape = 'stroke',
}) {
  const tip = useTooltip();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [focusedPresetIndex, setFocusedPresetIndex] = useState(0);
  const presetOptionRefs = useRef([]);
  const rawValueText = value == null ? '' : String(value).trim();
  // Normalize legacy/persisted values at the display boundary too: the field
  // never presents more decimal places than it keeps, even before its first
  // edit.
  const valueText = rawValueText === ''
    ? ''
    : String(normalizeAnnotationSize(rawValueText, min, max, decimals));
  // A mixed width shows an empty field ("Mixed" placeholder) until typed in.
  const [customValue, setCustomValue] = useState(mixed ? '' : valueText);
  // While a mixed field is being typed in, the draft is the user's: the
  // parent's value moves with each keystroke, and resetting to empty then
  // would throw the typing away (review 2026-09-25).
  const fieldFocusedRef = useRef(false);

  useEffect(() => {
    if (mixed && fieldFocusedRef.current) return;
    setCustomValue(mixed ? '' : valueText);
  }, [valueText, mixed]);

  const availablePresets = useMemo(() => (
    [...new Set(presets)]
      .map((preset) => normalizeAnnotationSize(preset, min, max))
      .filter((preset, index, list) => list.indexOf(preset) === index)
      .sort((a, b) => a - b)
  ), [max, min, presets]);
  const previewScaleMin = availablePresets[0] ?? min;
  const previewScaleMax = availablePresets[availablePresets.length - 1] ?? max;
  const selectedPresetIndex = mixed
    ? -1
    : availablePresets.findIndex((preset) => Number(valueText) === preset);

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setFocusedPresetIndex(selectedPresetIndex >= 0 ? selectedPresetIndex : 0);
    }
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const updateDraft = (next) => {
    const raw = sanitizeAnnotationSizeDraft(next, decimals);
    if (raw !== null) {
      setCustomValue(raw);
      onValueChange?.(raw);
    }
  };

  const commit = (next, { close = false } = {}) => {
    const normalized = String(normalizeAnnotationSize(next, min, max, decimals));
    setCustomValue(normalized);
    onValueChange?.(normalized);
    onValueCommit?.(normalized);
    if (close) handleOpenChange(false);
  };

  const movePresetFocus = (event, currentIndex) => {
    const lastIndex = availablePresets.length - 1;
    let nextIndex = currentIndex;

    if (event.key === 'ArrowDown') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    else return;

    event.preventDefault();
    setFocusedPresetIndex(nextIndex);
    presetOptionRefs.current[nextIndex]?.focus();
  };

  const allowsDecimals = decimals > 0;
  const inputProps = {
    type: 'text',
    // UX 2026-09-10 (round 4, defect 3): this is a numeric CHROME field, not a
    // text-editing surface. While a click-to-place draft (polygon / polyline)
    // is in flight it yields Enter and Escape to that draft — Enter commits
    // this value (the draft handler blurs, and blur commits) and finishes the
    // shape, Escape cancels it. Without the opt-out, nudging Width mid-draft
    // left the draft impossible to finish or cancel from the keyboard.
    'data-draft-yields-keys': 'true',
    inputMode: allowsDecimals ? 'decimal' : 'numeric',
    pattern: allowsDecimals ? '[0-9.]*' : '[0-9]*',
    title: label,
    disabled,
    value: customValue,
    onChange: (event) => updateDraft(event.target.value),
    onFocus: () => { fieldFocusedRef.current = true; onFocusChange?.(true); },
    placeholder: mixed ? 'Mixed' : undefined,
    // Leaving a mixed field untouched keeps every picked mark's own width.
    onBlur: (event) => {
      onFocusChange?.(false); fieldFocusedRef.current = false;
      if (mixed && !event.currentTarget.value.trim()) return;
      commit(event.currentTarget.value);
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if ((event.key === '.' && !allowsDecimals) || event.key === ',' || event.key === '-' || event.key === '+' || event.key === 'e') {
        event.preventDefault();
      }
    },
  };

  const isPill = variant === 'pill';
  const valueLabel = mixed ? 'Mixed' : `${valueText}${unit ? ` ${unit}` : ''}`;
  const isCompact = compact && !mixed;
  const shownLabel = isCompact ? valueText : valueLabel;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      {isPill ? (
        <div className={`annotation-size-control annotation-size-control--pill ${className}`.trim()} data-annotation-size-control="true">
          <Popover.Trigger asChild>
            <button
              type="button"
              className={`chrome-pill annotation-size-control__pill${isCompact ? ' chrome-pill--compact' : ''}`}
              aria-label={`${label}: ${valueLabel}`}
              {...tip(label, 'below')}
              aria-haspopup="listbox"
              disabled={disabled}
              style={width ? { '--chrome-pill-w': width } : undefined}
            >
              {/* A mixed width has no one stroke to preview. */}
              {preview && !mixed ? <span className="chrome-pill__preview" aria-hidden="true">{preview}</span> : null}
              <span className="chrome-pill__label">{shownLabel}</span>
              <span className="chrome-pill__chevron" aria-hidden="true">
                <Icon name="chevronDown" size={9} color="currentColor" />
              </span>
            </button>
          </Popover.Trigger>
        </div>
      ) : (
      <div className={`annotation-size-control ${className}`.trim()} data-annotation-size-control="true">
        <input {...inputProps} maxLength={allowsDecimals ? 4 + decimals : 3} aria-label={label} />
        <Popover.Trigger asChild>
          <button
            type="button"
            className="annotation-size-control__trigger"
            aria-label={`${label} presets`}
            {...tip(`${label} presets`, 'below')}
            disabled={disabled}
          >
            {/* UX 2026-09-16: this control sits beside Style / Arrowhead /
                Edit text, which all disclose with the shared 10x10 chevron.
                A bespoke 10x6 chevron here made the width control read as a
                different kind of control in the same row, so reuse the shared
                one. */}
            <Icon name="chevronDown" size={10} color="currentColor" />
          </button>
        </Popover.Trigger>
      </div>
      )}
      <Popover.Portal>
        <Popover.Content
          className="annotation-size-control__popover"
          data-annotation-size-popover="true"
          // Dismiss rules R1/R6: see AnnotationDropdown — never pull focus back
          // to this pill once the press that closed it focused another control.
          onCloseAutoFocus={(event) => {
            if (focusMovedElsewhere(event)) event.preventDefault();
          }}
          align={isPill ? 'start' : 'center'}
          sideOffset={6}
          collisionPadding={8}
          style={isPill && width ? { '--chrome-menu-field-w': width } : undefined}
          data-size-card={isPill ? 'true' : undefined}
        >
          {isPill ? (
            <SizeCard
              label={label}
              unit={unit}
              min={min}
              max={max}
              decimals={decimals}
              presets={availablePresets}
              valueText={valueText}
              draft={customValue}
              mixed={mixed}
              color={color}
              previewShape={previewShape}
              inputProps={inputProps}
              allowsDecimals={allowsDecimals}
              onDraft={updateDraft}
              onCommit={commit}
              onFocusChange={onFocusChange}
            />
          ) : (
          // PASS 7 (board 15): rows only — the pill above already names the
          // control, so a title row inside the menu was a second thing to read
          // in a 36px chrome.
          <div className="annotation-size-control__presets" role="listbox" aria-label={`${label} presets`}>
            {availablePresets.map((preset, index) => {
              const active = !mixed && Number(valueText) === preset;
              return (
                <button
                  key={preset}
                  ref={(element) => { presetOptionRefs.current[index] = element; }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={focusedPresetIndex === index ? 0 : -1}
                  className={active ? 'is-active' : ''}
                  onFocus={() => setFocusedPresetIndex(index)}
                  onKeyDown={(event) => movePresetFocus(event, index)}
                  onClick={() => commit(preset, { close: true })}
                >
                  <span className="annotation-size-control__preset-preview" aria-hidden="true">
                    <span
                      className="annotation-size-control__preset-stroke"
                      style={{
                        '--annotation-size-preview': `${getAnnotationSizePreviewThickness(
                          preset,
                          previewScaleMin,
                          previewScaleMax,
                        )}px`,
                      }}
                    />
                  </span>
                  <span className="annotation-size-control__preset-value">
                    {preset}{unit ? ` ${unit}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The pill's menu (owner 2026-10-22: the old 12-row list "looks like shit";
 * keep the dropdown and the typed number). Built after Drawboard PDF's pen
 * card - a sample of the stroke in the colour it will draw, a thickness
 * slider, quick picks - plus the typed field the owner asked to keep.
 *
 * The slider and the field only DRAFT while they move (the tool draws at the
 * draft at once); letting go of the slider, a key press on it, or leaving the
 * field COMMITS, so a drag over picked marks is one change, not fifty.
 */
function SizeCard({
  label,
  unit,
  min,
  max,
  decimals,
  presets,
  valueText,
  draft,
  mixed,
  color,
  previewShape,
  inputProps,
  allowsDecimals,
  onDraft,
  onCommit,
  onFocusChange,
}) {
  const shown = draft !== '' && Number.isFinite(Number(draft)) ? Number(draft) : Number(valueText);
  const hasValue = !mixed || draft !== '';
  const position = hasValue ? sizeToSliderPosition(shown, min, max) : 0;
  const latestRef = useRef(shown);
  latestRef.current = shown;
  const slidingRef = useRef(false);
  const [focusedChip, setFocusedChip] = useState(() => Math.max(0, presets.findIndex((p) => p === Number(valueText))));
  const chipRefs = useRef([]);
  const paint = color || 'currentColor';

  const endSlide = () => {
    if (!slidingRef.current) return;
    slidingRef.current = false;
    onCommit(String(latestRef.current));
  };

  const moveChipFocus = (event, index) => {
    const last = presets.length - 1;
    const perRow = 6;
    let next = index;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'ArrowDown') next = Math.min(last, index + perRow);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - perRow);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    setFocusedChip(next);
    chipRefs.current[next]?.focus();
  };

  // The sample is drawn at the size it will paint at 100% zoom (1 pt = 4/3
  // px), up to what the box can hold.
  const samplePx = Math.min(36, Math.max(1, shown * (4 / 3)));
  const amp = Math.max(0, 14 - samplePx / 3);
  const wave = `M 22 ${32 + amp} C 58 ${32 - 2 * amp}, 84 ${32 - 2 * amp}, 100 32 S 142 ${32 + 2 * amp}, 178 ${32 - amp}`;
  const dotPx = Math.min(52, Math.max(3, shown * (previewShape === 'dot' ? 0.75 : 4 / 3)));

  return (
    <div className="annotation-size-card">
      <div className="annotation-size-card__sample" aria-hidden="true" data-size-card-sample="true">
        {!hasValue ? (
          <span className="annotation-size-card__mixed">Mixed</span>
        ) : previewShape === 'dot' ? (
          <span className="annotation-size-card__dot" style={{ width: dotPx, height: dotPx, background: paint }} />
        ) : (
          <svg viewBox="0 0 200 64" preserveAspectRatio="xMidYMid meet">
            <path d={wave} fill="none" stroke={paint} strokeWidth={samplePx} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <div className="annotation-size-card__row">
        <input
          type="range"
          className="annotation-size-card__slider"
          aria-label={`${label} slider`}
          aria-valuetext={hasValue ? `${shown}${unit ? ` ${unit}` : ''}` : 'Mixed'}
          min={0}
          max={SIZE_SLIDER_STEPS}
          step={1}
          value={position}
          style={{ '--size-card-fill': `${(position / SIZE_SLIDER_STEPS) * 100}%` }}
          onPointerDown={() => { slidingRef.current = true; onFocusChange?.(true); }}
          onPointerUp={endSlide}
          onPointerCancel={endSlide}
          onKeyDown={() => { slidingRef.current = true; onFocusChange?.(true); }}
          onKeyUp={endSlide}
          onBlur={endSlide}
          onChange={(event) => {
            slidingRef.current = true;
            const next = sliderPositionToSize(event.target.value, min, max, decimals);
            latestRef.current = next;
            onDraft(String(next));
          }}
        />
        <label className="annotation-size-card__field">
          <input
            {...inputProps}
            maxLength={allowsDecimals ? 4 + decimals : 3}
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const base = Number.isFinite(Number(event.currentTarget.value)) && event.currentTarget.value !== ''
                  ? Number(event.currentTarget.value)
                  : shown;
                const step = allowsDecimals && base < 10 ? 0.5 : 1;
                const next = normalizeAnnotationSize(base + (event.key === 'ArrowUp' ? step : -step), min, max, decimals);
                onCommit(String(next));
                return;
              }
              inputProps.onKeyDown(event);
            }}
          />
          {unit ? <span className="annotation-size-card__unit" aria-hidden="true">{unit}</span> : null}
        </label>
      </div>

      <div className="annotation-size-card__chips" role="listbox" aria-label={`${label} presets`}>
        {presets.map((preset, index) => {
          const active = !mixed && Number(valueText) === preset;
          // Dots grow by rank, not by value: a 10 and a 12 pt dot drawn to
          // scale look the same at this size, and the number says the rest.
          const size = Math.round(2 + (presets.length > 1 ? index / (presets.length - 1) : 0) * 18);
          return (
            <button
              key={preset}
              ref={(element) => { chipRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={active}
              aria-label={`${preset}${unit ? ` ${unit}` : ''}`}
              tabIndex={focusedChip === index ? 0 : -1}
              className={`annotation-size-card__chip${active ? ' is-active' : ''}`}
              onFocus={() => setFocusedChip(index)}
              onKeyDown={(event) => moveChipFocus(event, index)}
              onClick={() => onCommit(preset, { close: true })}
            >
              <span className="annotation-size-card__chip-dot" aria-hidden="true">
                <span style={{ width: `${size}px`, height: `${size}px` }} />
              </span>
              <span className="annotation-size-card__chip-value" aria-hidden="true">{preset}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
