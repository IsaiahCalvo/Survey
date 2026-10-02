/**
 * SectionIconButton.jsx — the ONE control for a section header action.
 *
 * Owner ruling 2026-10-02 (reversing 2026-10-01's quiet words): section header
 * actions such as "Select" and "+ Category" are ICONS, not words — "The icons
 * looked way better." Every list header that offers them puts them on the
 * label row, right-aligned, always in this order:
 *
 *   LABEL count ............................ [Select] [Add]
 *
 * The pair is fixed here so no screen invents its own glyph or size:
 *   select -> list-checks, add -> plus (from the editor proposal the owner
 *   picked the icons from). A header with a different action of the same
 *   kind (Edit, Export, Manage team) passes `icon`.
 *
 * The word lives in the accessible name and the tooltip ("Select",
 * "Add category", ...). A mode toggle (Select / Edit) passes `active` while
 * its mode is on: its name becomes "Done" (the caller passes that label) and
 * the glyph swaps to a check in the same calm ink - no gold (owner).
 *
 * `word` swaps the glyph for a short word on the same box, ink and states
 * ("All" / "None" in a select-mode row, 13px/500).
 *
 * Tooltip: inside the PDF viewer the app's shared chip (TooltipContext); on
 * the home hub, which has no chip host, the native title.
 */
import { useContext } from 'react';
import Icon from '../Icons.jsx';
import { TooltipContext } from './Tooltip.jsx';
import './SectionIconButton.css';

export const SECTION_ACTION_ICONS = Object.freeze({
  select: 'listChecks',
  add: 'plus',
  // A list header's edit-mode toggle (owner 2026-10-02: not the Draw pencil).
  edit: 'editList',
  // The select-mode action row (SelectModeButtons below).
  duplicate: 'duplicate',
  move: 'moveTo',
  copy: 'copy',
  share: 'share',
  delete: 'trash',
});

/** A mode toggle that is on shows this "Done" glyph, in the same ink. */
export const SECTION_DONE_ICON = 'check';

export const SECTION_ICON_SIZES = Object.freeze({
  desktop: { hit: 28, glyph: 16 },
  phone: { hit: 44, glyph: 18 },
});

export default function SectionIconButton({
  action = 'add',
  icon,
  word,
  label,
  tooltip,
  active = false,
  phone = false,
  className = '',
  tooltipPlacement = 'below',
  ...rest
}) {
  const bindTooltip = useContext(TooltipContext);
  const tip = tooltip || label;
  const tipProps = bindTooltip ? bindTooltip(tip, tooltipPlacement) : { title: tip };
  const size = phone ? SECTION_ICON_SIZES.phone : SECTION_ICON_SIZES.desktop;
  return (
    <button
      type="button"
      data-glyph-only=""
      data-section-action={action}
      aria-label={label}
      className={`section-icon-btn${word ? ' is-word' : ''}${phone ? ' is-phone' : ''}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      {...tipProps}
      {...rest}
    >
      {word
        ? <span className="section-icon-btn__word">{word}</span>
        : <Icon name={active ? SECTION_DONE_ICON : (icon || SECTION_ACTION_ICONS[action] || 'plus')} size={size.glyph} color="currentColor" />}
    </button>
  );
}

/** The right-aligned row that holds a header's icons, [Select] then [Add]. */
export function SectionIconActions({ phone = false, className = '', children, ...rest }) {
  return (
    <span className={`section-icon-actions${phone ? ' is-phone' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </span>
  );
}

/**
 * The select-mode action row (owner 2026-10-02): once Select is on, a list
 * header shows, in this order and nowhere else defined,
 *
 *   [All] [Duplicate] [Move] [Copy] [Share] [Delete] ... then the caller's Done
 *
 * every one a SectionIconButton - same box, glyph, ink and hover / press as
 * Select / Add / Done. "All" stays a word (it reads "None" once everything is
 * picked). An action whose handler is not passed is left out (a template
 * list cannot be moved; a project list has no Move / Copy). With nothing
 * selected the actions are disabled: dimmed, no hover, no press.
 */
export const SELECT_MODE_ACTIONS = Object.freeze([
  { key: 'duplicate', label: 'Duplicate', handler: 'onDuplicate' },
  { key: 'move', label: 'Move', handler: 'onMove' },
  { key: 'copy', label: 'Copy', handler: 'onCopy' },
  { key: 'share', label: 'Share', handler: 'onShare' },
  { key: 'delete', label: 'Delete', handler: 'onDelete' },
]);

export function SelectModeButtons({
  phone = false,
  count = 0,
  allSelected = false,
  onToggleAll,
  tooltipPlacement = 'below',
  deleteProps,
  ...handlers
}) {
  const none = !count;
  return (
    <>
      {onToggleAll ? (
        <SectionIconButton
          phone={phone}
          action="all"
          word={allSelected ? 'None' : 'All'}
          label={allSelected ? 'Select none' : 'Select all'}
          tooltipPlacement={tooltipPlacement}
          onClick={onToggleAll}
        />
      ) : null}
      {SELECT_MODE_ACTIONS.map(({ key, label, handler }) => (typeof handlers[handler] === 'function' ? (
        <SectionIconButton
          key={key}
          phone={phone}
          action={key}
          label={label}
          disabled={none}
          className={key === 'delete' ? 'is-danger' : ''}
          tooltipPlacement={tooltipPlacement}
          onClick={() => { if (!none) handlers[handler](); }}
          {...(key === 'delete' ? deleteProps : null)}
        />
      ) : null))}
    </>
  );
}
