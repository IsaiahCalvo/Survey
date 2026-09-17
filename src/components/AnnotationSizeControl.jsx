import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  getAnnotationSizePreviewThickness,
  normalizeAnnotationSize,
  sanitizeAnnotationSizeDraft,
} from '../utils/annotationSize';
import Icon from '../Icons';
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
}) {
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
  const [customValue, setCustomValue] = useState(valueText);

  useEffect(() => {
    setCustomValue(valueText);
  }, [valueText]);

  const availablePresets = useMemo(() => (
    [...new Set(presets)]
      .map((preset) => normalizeAnnotationSize(preset, min, max))
      .filter((preset, index, list) => list.indexOf(preset) === index)
      .sort((a, b) => a - b)
  ), [max, min, presets]);
  const previewScaleMin = availablePresets[0] ?? min;
  const previewScaleMax = availablePresets[availablePresets.length - 1] ?? max;
  const selectedPresetIndex = availablePresets.findIndex((preset) => Number(valueText) === preset);

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
    onFocus: () => onFocusChange?.(true),
    onBlur: (event) => {
      onFocusChange?.(false);
      commit(event.currentTarget.value);
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if ((event.key === '.' && !allowsDecimals) || event.key === ',' || event.key === '-' || event.key === '+' || event.key === 'e') {
        event.preventDefault();
      }
    },
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <div className={`annotation-size-control ${className}`.trim()} data-annotation-size-control="true">
        <input {...inputProps} maxLength={allowsDecimals ? 4 + decimals : 3} aria-label={label} />
        <Popover.Trigger asChild>
          <button
            type="button"
            className="annotation-size-control__trigger"
            aria-label={`${label} presets`}
            title={`${label} presets`}
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
      <Popover.Portal>
        <Popover.Content
          className="annotation-size-control__popover"
          data-annotation-size-popover="true"
          align="center"
          sideOffset={6}
          collisionPadding={8}
        >
          <div className="annotation-size-control__heading">{label}</div>
          <div className="annotation-size-control__presets" role="listbox" aria-label={`${label} presets`}>
            {availablePresets.map((preset, index) => {
              const active = Number(valueText) === preset;
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
                  <span className="annotation-size-control__preset-value">{preset}</span>
                </button>
              );
            })}
          </div>
          <Popover.Arrow className="annotation-size-control__arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
