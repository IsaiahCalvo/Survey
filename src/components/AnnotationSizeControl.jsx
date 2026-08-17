import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../utils/annotationSize';
import './AnnotationSizeControl.css';

export const ANNOTATION_SIZE_PRESETS = Object.freeze({
  width: [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50],
  counter: [4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 50],
  eraser: [1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100],
});

/**
 * Shared whole-number size field with a Radix Popover preset menu.
 *
 * The visible input remains fast for custom sizes while the adjacent chevron
 * exposes battle-tested, keyboard-accessible preset selection. Callers own the
 * draft/commit state so the same control can drive drawing, erasing, and edits.
 */
export default function AnnotationSizeControl({
  value,
  label = 'Size',
  min = 1,
  max = 100,
  presets = ANNOTATION_SIZE_PRESETS.width,
  onValueChange,
  onValueCommit,
  onFocusChange,
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [focusedPresetIndex, setFocusedPresetIndex] = useState(0);
  const presetOptionRefs = useRef([]);
  const rawValueText = value == null ? '' : String(value).trim();
  // Normalize legacy/persisted fractional values at the display boundary too;
  // the field must never visually present a decimal even before its first edit.
  const valueText = rawValueText === ''
    ? ''
    : String(normalizeAnnotationSize(rawValueText, min, max));
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
  const selectedPresetIndex = availablePresets.findIndex((preset) => Number(valueText) === preset);

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setFocusedPresetIndex(selectedPresetIndex >= 0 ? selectedPresetIndex : 0);
    }
    setOpen(nextOpen);
  };

  const updateDraft = (next) => {
    const raw = sanitizeAnnotationSizeDraft(next);
    if (raw !== null) {
      setCustomValue(raw);
      onValueChange?.(raw);
    }
  };

  const commit = (next, { close = false } = {}) => {
    const whole = normalizeAnnotationSize(next, min, max);
    const normalized = String(whole);
    setCustomValue(normalized);
    onValueChange?.(normalized);
    onValueCommit?.(normalized);
    if (close) setOpen(false);
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

  const inputProps = {
    type: 'text',
    inputMode: 'numeric',
    pattern: '[0-9]*',
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
      if (event.key === '.' || event.key === ',' || event.key === '-' || event.key === '+' || event.key === 'e') {
        event.preventDefault();
      }
    },
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <div className={`annotation-size-control ${className}`.trim()} data-annotation-size-control="true">
        <input {...inputProps} maxLength={3} aria-label={label} />
        <Popover.Trigger asChild>
          <button
            type="button"
            className="annotation-size-control__trigger"
            aria-label={`${label} presets`}
            title={`${label} presets`}
            disabled={disabled}
          >
            <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
                      style={{ '--annotation-size-preview': `${Math.max(1, Math.min(preset, 14))}px` }}
                    />
                  </span>
                  <span className="annotation-size-control__preset-value">{preset}</span>
                  <span className="annotation-size-control__preset-check" aria-hidden="true">✓</span>
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
