import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import Icon from '../Icons';
import { registerLightPopover } from './dismissRules.js';
import { focusMovedElsewhere } from './AnnotationDropdown';
import './AnnotationDropdown.css';

/**
 * The desktop tool bar's More (⋯) menu (w42, 2026-09-26).
 *
 * Intended UX: when the window is too narrow for every setting of the armed
 * tool, the least important ones leave the bar and wait in here — the SAME
 * controls, doing the same thing, each on a row with its name. The ⋯ sits at
 * the end of the settings and only exists while something is in it. Pressing
 * a pill inside opens that pill's own menu on top, and the More card stays
 * open under it until you press elsewhere or press Escape (Escape closes the
 * pill's menu first, then More — dismiss rule R5).
 *
 * Dismiss rules (src/components/dismissRules.js): R1 — a press outside closes
 * the card and still does its job (Radix never blocks it); R2/R5 through the
 * shared registry; R6 — opening another popover is an outside press for this
 * one. Pressing ⋯ again closes it (Radix toggles its own trigger).
 *
 * The button is a plain glyph like every other chrome control (no plate), and
 * turns gold only while the card is open — the "selected = gold glyph" rule.
 * Reference behaviour matched: the phone strip's "..." settings button.
 */
export default function ToolbarOverflowMenu({ items, tooltip }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    return registerLightPopover({
      contains: (target) => Boolean(target?.closest?.('[data-toolbar-more], [data-toolbar-more-menu], [data-annotation-dropdown-popover], [data-annotation-size-popover]')),
      close: () => setOpen(false),
    });
  }, [open]);

  // Nothing left in More (the window widened): the card goes with the button.
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (items.length === 0) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-toolbar-more="true"
          className="btn chrome-control btn-default"
          aria-label="More settings"
          aria-haspopup="dialog"
          style={{ color: open ? 'var(--accent)' : undefined }}
          {...(tooltip || {})}
        >
          <Icon name="moreHorizontal" size={16} color="currentColor" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="annotation-dropdown__popover toolbar-overflow-menu"
          data-toolbar-more-menu="true"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="More settings"
          onCloseAutoFocus={(event) => {
            if (focusMovedElsewhere(event)) event.preventDefault();
          }}
        >
          {items.map((item) => (
            <div key={item.id} className="toolbar-overflow-menu__row" data-toolbar-more-row={item.id}>
              {item.label ? <span className="toolbar-overflow-menu__label">{item.label}</span> : null}
              <span className="toolbar-overflow-menu__control">{item.node}</span>
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
