import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import Icon from '../Icons';
import './AnnotationDropdown.css';

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
            className="annotation-dropdown__trigger"
            aria-label={label}
            title={label}
            disabled={disabled}
            {...triggerProps}
            aria-haspopup="dialog"
            aria-expanded={open}
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
            <span className="annotation-dropdown__trigger-content">
              {triggerContent ?? options.find((option) => option.value === value)?.label ?? value}
            </span>
            <Icon name="chevronDown" size={10} color="currentColor" className="annotation-dropdown__chevron" />
          </button>
        </Popover.Trigger>
      </div>
      {renderContent(
        <Popover.Content
          className={`annotation-dropdown__popover ${contentClassName}`.trim()}
          data-annotation-dropdown-popover="true"
          role="dialog"
          aria-label={label}
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
          <div className="annotation-dropdown__heading">{label}</div>
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
          <Popover.Arrow className="annotation-dropdown__arrow" />
        </Popover.Content>
      )}
    </Popover.Root>
  );
}
