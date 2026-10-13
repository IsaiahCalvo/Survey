/**
 * The Pencil-only switch (drawboardAudit C2; docs/GESTURE-CONTRACT.md).
 *
 * Drawboard puts "Annotate with Pencil or Touch / Annotate with Pencil only"
 * as one icon button in its bottom utility bar, beside the page controls, and
 * shows it only once a pen has been used. Survey's equivalent spot is the
 * utility end of each rail: the desktop right rail's footer (zoom / page / fit)
 * and the phone rail's footer (More / sync / history). Same button, same
 * two-row menu, on both. It renders nothing until a pen was seen.
 */
import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons.jsx';
import { watchLightPopover } from './dismissRules.js';
import {
  DRAW_MODE_OPTIONS, getPencilModeState, setDrawMode, subscribePencilMode,
} from '../utils/pencilMode.js';
import './pencilModeControl.css';

export function usePencilMode() {
  return useSyncExternalStore(subscribePencilMode, getPencilModeState, getPencilModeState);
}

/**
 * @param {'desktop'|'phone'} surface — row size (28 px desktop rows, 44 px
 *   phone rows) and which side the menu opens on (left of the right rail on
 *   desktop, right of the left rail on the phone).
 */
export default function PencilModeControl({ surface = 'desktop', className, style, glyph = 16, buttonProps, onOpen }) {
  const { penSeen, drawMode } = usePencilMode();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    return watchLightPopover({
      contains: (target) => Boolean(buttonRef.current?.contains(target) || menuRef.current?.contains(target)),
      close: () => setOpen(false),
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bottom = Math.max(8, window.innerHeight - rect.bottom);
    setPlace(surface === 'phone'
      ? { left: Math.round(rect.right + 6), bottom: Math.round(bottom) }
      : { right: Math.round(window.innerWidth - rect.left + 6), bottom: Math.round(bottom) });
  }, [open, surface]);

  if (!penSeen) return null;
  const current = DRAW_MODE_OPTIONS.find((option) => option.mode === drawMode) || DRAW_MODE_OPTIONS[0];

  const choose = (mode) => {
    setDrawMode(mode);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        style={style}
        data-pencil-mode-toggle="true"
        data-draw-mode={drawMode}
        aria-label={`Touch drawing: ${current.short}`}
        aria-haspopup="menu"
        aria-expanded={open}
        {...buttonProps}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <Icon name={current.icon} size={glyph} color="currentColor" />
      </button>
      {open && place && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Touch drawing"
          className={`pencil-mode-menu is-${surface}`}
          data-pencil-mode-menu="true"
          style={place}
        >
          {DRAW_MODE_OPTIONS.map((option) => {
            const checked = option.mode === drawMode;
            return (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                data-pencil-mode-option={option.mode}
                className={checked ? 'is-checked' : undefined}
                onClick={() => choose(option.mode)}
              >
                <span className="pencil-mode-menu__check" aria-hidden="true">
                  {checked ? <Icon name="check" size={surface === 'phone' ? 16 : 14} color="currentColor" /> : null}
                </span>
                <span className="pencil-mode-menu__label">{option.label}</span>
                <Icon name={option.icon} size={surface === 'phone' ? 18 : 15} color="currentColor" className="pencil-mode-menu__glyph" />
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
