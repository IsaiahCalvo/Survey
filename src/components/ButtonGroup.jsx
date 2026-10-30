import { moveGroupFocus } from '../utils/radioGroupKeys.js';
import './ButtonGroup.css';

/**
 * A row of joined buttons for picking one of a few choices (owner 2026-10-28,
 * from the shadcn "button group" he picked): the buttons share one outline
 * and a hairline between them, so the row reads as one control. The chosen
 * one is gold ink and nothing else (the selected-state rule), never a gold
 * fill or a gold edge.
 *
 * Arrow keys and Home / End move between the choices (radioGroupKeys);
 * Enter or Space picks. `fill` stretches it across its row with equal
 * buttons; `size="sm"` is the 26px row of a dense panel. An option may carry
 * a `hint` (a second, quieter line), an `ariaLabel` and `disabled`.
 *
 * options: [{ value, label, hint?, ariaLabel?, disabled? }]; onChange(value).
 */
export default function ButtonGroup({
  value,
  options,
  onChange,
  label,
  labelledBy,
  size = 'md',
  fill = false,
  className = '',
}) {
  const chosen = options.some((option) => option.value === value);
  const classes = ['button-group', `button-group--${size}`, fill ? 'button-group--fill' : '', className]
    .filter(Boolean).join(' ');
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={classes}
      onKeyDown={moveGroupFocus}
    >
      {options.map((option, index) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.ariaLabel}
            tabIndex={on || (!chosen && index === 0) ? 0 : -1}
            disabled={option.disabled}
            onClick={() => { if (!on) onChange?.(option.value); }}
          >
            <span>{option.label}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        );
      })}
    </div>
  );
}
