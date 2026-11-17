import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import Icon from '../Icons';
import { registerLightPopover } from './dismissRules.js';
import { focusMovedElsewhere } from './AnnotationDropdown';
import './AnnotationDropdown.css';

/**
 * The More (⋯) button at the end of the tool bar's loadout (KAL-667).
 *
 * Intended UX: when a group has more tools than fit before the right-hand
 * buttons, the last ones wait in here, each on a row with its icon and name.
 * Picking one does exactly what pressing it in the row does, and the card
 * closes. The ⋯ only exists while something is in it, and looks like the
 * formatting row's own More (ToolbarOverflowMenu): a plain glyph, accent only
 * while its card is open. Dismiss rules as ToolbarOverflowMenu.
 *
 * `items` come from useLoadoutOverflow; `glyph` is a copy of the tool's own
 * icon from its button in the row.
 */
export default function LoadoutOverflowMenu({ items, onPick, tooltip }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    return registerLightPopover({
      contains: (target) => Boolean(target?.closest?.('[data-loadout-more], [data-loadout-more-menu]')),
      close: () => setOpen(false),
    });
  }, [open]);

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (items.length === 0) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-loadout-more="true"
          className="btn chrome-subcontrol btn-ghost"
          aria-label="More tools"
          aria-haspopup="menu"
          style={{ color: open ? 'var(--accent)' : undefined }}
          {...(tooltip || {})}
        >
          <Icon name="moreHorizontal" size={16} color="currentColor" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="annotation-dropdown__popover"
          data-loadout-more-menu="true"
          role="menu"
          aria-label="More tools"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (focusMovedElsewhere(event)) event.preventDefault();
          }}
        >
          <div className="annotation-dropdown__options">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className="annotation-dropdown__option"
                data-loadout-more-item={item.key}
                onClick={() => {
                  setOpen(false);
                  onPick(item.key);
                }}
              >
                <span
                  className="annotation-dropdown__sample"
                  aria-hidden="true"
                  // The tool's own icon: a copy of the row button's glyph.
                  ref={(el) => { if (el && item.glyph) el.replaceChildren(item.glyph.cloneNode(true)); }}
                />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
