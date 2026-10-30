import { useEffect, useRef, useState } from 'react';
import AnnotationDropdown from './AnnotationDropdown.jsx';
import { watchLightPopover } from './dismissRules.js';
import { useTooltip } from './Tooltip';
import './ValueSelect.css';

const MENU_CLASS = 'value-select__menu';

/**
 * The app's drop-down for picking one value, in place of a browser <select>
 * (owner 2026-10-27: a browser list "looks nothing like any of our other
 * dropdowns" and draws a white border). It is the toolbar's
 * AnnotationDropdown: the same setting pill, menu card, rows, keys and
 * motion everywhere.
 *
 * `look="field"` sizes the pill like the dialog field beside it (32px, 13px;
 * `size="sm"` 30px, 12px); `look="pill"` keeps the toolbar's 20px pill.
 * `placeholder` shows, quieter, while the value is not one of the options.
 * `hint` is a longer tooltip than the label.
 *
 * While open, the list is the topmost light popover (dismissRules R1/R5): a
 * press outside closes it, and Escape closes only the list, never the dialog
 * under it.
 *
 * Phones keep the browser's own list (its wheel), so callers render a native
 * <select> there.
 *
 * options: [{ value, label }]; onChange(value) only when the value changes.
 */
export default function ValueSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  hint,
  disabled = false,
  look = 'field',
  size = 'md',
  width = '100%',
  className = '',
}) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const picked = options.some((option) => option.value === value);

  // A press anywhere else closes the list (even where a dialog stops the
  // press from bubbling), and it is the topmost popover for Escape.
  useEffect(() => {
    if (!open) return undefined;
    return watchLightPopover({
      close: () => setOpen(false),
      contains: (target) => Boolean(
        triggerRef.current?.contains(target) || target?.closest?.(`.${MENU_CLASS}`),
      ),
    });
  }, [open]);

  const classes = [
    'value-select',
    `value-select--${look}`,
    `value-select--${size}`,
    width === '100%' ? 'value-select--block' : '',
    picked ? '' : 'is-empty',
    className,
  ].filter(Boolean).join(' ');

  return (
    <AnnotationDropdown
      open={open && !disabled}
      onOpenChange={setOpen}
      label={label}
      value={value}
      options={options}
      triggerContent={picked ? undefined : (placeholder ?? '')}
      // data-value: the picked value, for tests and for reading the DOM.
      triggerProps={{ 'data-value': value ?? '', ...(hint ? tip(hint, 'below') : {}) }}
      onSelect={(next) => { if (next !== value) onChange?.(next); }}
      triggerRef={triggerRef}
      width={width}
      contentWidth="var(--radix-popover-trigger-width)"
      className={classes}
      contentClassName={`${MENU_CLASS} ${MENU_CLASS}--${look}`}
      disabled={disabled}
    />
  );
}
