import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import Icon from '../Icons';
import './AnnotationDropdown.css';

/**
 * True when focus already sits on a real control outside the closing popover:
 * the press that closed it landed on (and focused) something else. Shared with
 * AnnotationSizeControl.
 */
export function focusMovedElsewhere(event) {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return false;
  const content = event?.currentTarget;
  if (content && typeof content.contains === 'function' && content.contains(active)) return false;
  return true;
}

/**
 * Shared annotation-toolbar dropdown. Simple menus pass options/onSelect;
 * richer menus (counter series, alignment) can pass children while retaining
 * the same Radix positioning, surface, heading, and dismissal behavior.
 */
export default function AnnotationDropdown({
  open,
  onOpenChange,
  label,
  value,
  triggerContent,
  triggerRef,
  triggerProps = {},
  options = [],
  onSelect,
  renderOption,
  children,
  align = 'start',
  contentWidth,
  className = '',
  contentClassName = '',
  disabled = false,
  dataMarker,
  preserveFocus = false,
  outsideBoundarySelector,
  // PASS 7 (boards 8-15): a setting pill is a PREVIEW, a value and a chevron.
  // `preview` is the drawing on the left (a stroke sample, an arrowhead, a
  // line style); `width` is the pill's own width token so every pill of the
  // same kind measures the same across tools. A caller that passes neither
  // still gets the old single-slot trigger.
  preview,
  width,
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const optionRefs = useRef([]);
  const keepEditorFocusForCycleRef = useRef(false);
  const editorFocusElementRef = useRef(null);
  const selectedIndex = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open || options.length === 0) return;
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, options.length, selectedIndex]);

  const moveFocus = (event, currentIndex) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(options[currentIndex]?.value);
      onOpenChange?.(false);
      return;
    }
    const lastIndex = options.length - 1;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    else return;
    event.preventDefault();
    setFocusedIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const markerProps = dataMarker ? { [dataMarker]: 'true' } : {};
  const shouldKeepEditorFocus = () => (
    preserveFocus
    && !document.activeElement?.closest?.('.annotation-dropdown, .annotation-dropdown__popover')
  );
  const renderContent = (content) => (
    preserveFocus ? content : <Popover.Portal>{content}</Popover.Portal>
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <div className={`annotation-dropdown ${className}`.trim()} {...markerProps}>
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className="chrome-pill annotation-dropdown__trigger"
            aria-label={label}
            title={label}
            disabled={disabled}
            {...triggerProps}
            style={width ? { '--chrome-pill-w': width, ...(triggerProps.style || {}) } : triggerProps.style}
            onMouseDown={(event) => {
              triggerProps.onMouseDown?.(event);
              if (preserveFocus) {
                keepEditorFocusForCycleRef.current = true;
                editorFocusElementRef.current = document.activeElement;
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {preview ? <span className="chrome-pill__preview" aria-hidden="true">{preview}</span> : null}
            <span className="chrome-pill__label annotation-dropdown__trigger-content">
              {triggerContent ?? options.find((option) => option.value === value)?.label ?? value}
            </span>
            {/* Board 15: the pill's chevron is 9px — smaller than a tool glyph,
                because it only has to say "there is a list behind this". */}
            <span className="chrome-pill__chevron annotation-dropdown__chevron" aria-hidden="true">
              <Icon name="chevronDown" size={9} color="currentColor" />
            </span>
          </button>
        </Popover.Trigger>
      </div>
      {renderContent(
        <Popover.Content
          className={`annotation-dropdown__popover ${contentClassName}`.trim()}
          data-annotation-dropdown-popover="true"
          {...markerProps}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          style={contentWidth ? { '--annotation-dropdown-width': contentWidth } : undefined}
          onOpenAutoFocus={(event) => {
            const keepEditorFocus = keepEditorFocusForCycleRef.current || shouldKeepEditorFocus();
            keepEditorFocusForCycleRef.current = keepEditorFocus;
            if (keepEditorFocus && !editorFocusElementRef.current) {
              editorFocusElementRef.current = document.activeElement;
            }
            if (keepEditorFocus) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Dismiss rules R1/R6 (owner 2026-09-23, src/components/dismissRules.js):
            // when this menu closed because the press went to another control
            // (another dropdown, the width pill), focus is already there. Handing
            // it back to this trigger would count as "focus outside" for the menu
            // that press just opened and close it again, so the second dropdown
            // never stayed open. Leave focus where the user put it.
            // (The text-editor focus cycle below keeps its own handling.)
            if (!keepEditorFocusForCycleRef.current && focusMovedElsewhere(event)) {
              editorFocusElementRef.current = null;
              event.preventDefault();
              return;
            }
            if (keepEditorFocusForCycleRef.current) {
              event.preventDefault();
              const editorElement = editorFocusElementRef.current;
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  const focusTarget = document.querySelector('[contenteditable="plaintext-only"]')
                    || (editorElement?.isConnected ? editorElement : null);
                  focusTarget?.focus?.({ preventScroll: true });
                });
              });
            }
            keepEditorFocusForCycleRef.current = false;
            editorFocusElementRef.current = null;
          }}
          onMouseDownCapture={(event) => {
            if (preserveFocus) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onPointerDownCapture={(event) => {
            if (preserveFocus) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (outsideBoundarySelector && event.target?.closest?.(outsideBoundarySelector)) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            if (outsideBoundarySelector && event.target?.closest?.(outsideBoundarySelector)) event.preventDefault();
          }}
        >
          {/* PASS 7 (board 15): a menu is rows and nothing else — no title row,
              no pointer arrow. The control it opens from already says what it
              is, and the chrome is 36px tall, so a second label was a second
              thing to read. The accessible name lives on the listbox. */}
          {children ?? (
            <div className="annotation-dropdown__options" role="listbox" aria-label={label}>
              {options.map((option, index) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    ref={(element) => { optionRefs.current[index] = element; }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={focusedIndex === index ? 0 : -1}
                    className={active ? 'is-active' : ''}
                    style={option.style}
                    onPointerDown={(event) => {
                      if (preserveFocus) event.preventDefault();
                    }}
                    onMouseDown={(event) => {
                      if (preserveFocus) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                    onFocus={() => setFocusedIndex(index)}
                    onKeyDown={(event) => moveFocus(event, index)}
                    onClick={() => {
                      if (preserveFocus && editorFocusElementRef.current?.isConnected) {
                        editorFocusElementRef.current.focus({ preventScroll: true });
                      }
                      onSelect?.(option.value);
                      onOpenChange?.(false);
                    }}
                  >
                    {renderOption ? renderOption(option, active) : option.label}
                  </button>
                );
              })}
            </div>
          )}
        </Popover.Content>
      )}
    </Popover.Root>
  );
}
