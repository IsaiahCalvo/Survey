/* Nightly 'comment-pins': the Pin tool's split button (desktop tool row) and
   the "Show pins" card on the right rail. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RailFlyout from '../RailFlyout.jsx';
import { useTooltip } from '../Tooltip';
import { PinKindGlyph } from './PinGlyphs.jsx';
import { setPagePinsState, usePagePins } from '../../services/pagePinsStore.js';
import {
  PIN_KIND_LABELS,
  PIN_KINDS,
  pinFilterAllOn,
  savePinFilter,
  togglePinFilterMaster,
} from '../../utils/pagePins.js';

function useOutsideClose(open, setOpen, refs) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (refs.some((r) => r.current?.contains(event.target))) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, setOpen]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Drawboard's pin button: a click arms the current type; with the tool on, a
 * click (or the caret) opens Comment / Issue / Task. N arms, M cycles.
 */
export function PinToolButton({ active, onArm, glyphSize = 18 }) {
  const tip = useTooltip();
  const kind = usePagePins((s) => s.kind);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  useOutsideClose(open, setOpen, [buttonRef, menuRef]);
  const label = kind === 'comment' ? 'Add a pinned comment' : `Add a pinned ${PIN_KIND_LABELS[kind].toLowerCase()}`;
  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        aria-pressed={active}
        data-pin-tool-button={kind}
        data-tool-switch="true"
        className={`btn chrome-subcontrol ${active ? 'btn-active' : 'btn-ghost'}`}
        {...tip(open ? undefined : `${label}  N`, 'below')}
        onClick={() => {
          if (!active) { onArm(); return; }
          setOpen((o) => !o);
        }}
        style={{ position: 'relative', paddingRight: 14 }}
      >
        <PinKindGlyph kind={kind} size={glyphSize} />
        <span aria-hidden="true" style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-3)' }}>▾</span>
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Pin type"
          data-pin-kind-menu="true"
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            left: rect.left,
            minWidth: 150,
            padding: 4,
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-3)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            zIndex: 5800,
          }}
        >
          {PIN_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={k === kind}
              data-pin-kind-option={k}
              onClick={() => {
                setPagePinsState((s) => ({ kind: k, draft: s.draft ? { ...s.draft, kind: k } : null }));
                setOpen(false);
                onArm();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                height: 36,
                padding: '0 10px',
                border: 'none',
                borderRadius: 6,
                background: k === kind ? 'var(--surface-3)' : 'transparent',
                color: 'var(--text-1)',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <PinKindGlyph kind={k} size={16} />
              {PIN_KIND_LABELS[k]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const SWITCHES = [
  ['comments', 'Comments'],
  ['issues', 'Issues'],
  ['tasks', 'Tasks'],
];

/** The rail's "Show pins" card. `renderButton({ open, ref, onClick, on })`. */
export function PinFilterMenu({ renderButton }) {
  const tip = useTooltip();
  const enabled = usePagePins((s) => s.enabled);
  const filter = usePagePins((s) => s.filter);
  const userId = usePagePins((s) => s.userId);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const cardRef = useRef(null);
  useOutsideClose(open, setOpen, [buttonRef, cardRef]);
  if (!enabled) return null;
  const set = (next) => {
    setPagePinsState({ filter: next });
    savePinFilter(userId, next);
  };
  const allOn = pinFilterAllOn(filter);
  return (
    <div className="page-grid-menu">
      {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v), on: allOn })}
      {open && (
        <RailFlyout cardRef={cardRef} role="dialog" aria-label="Show pins" title="Show pins" data-pin-filter-menu="true" className="page-grid-settings__card">
          <div className="page-grid-settings">
            <button type="button" role="switch" aria-checked={allOn} data-pin-filter="all" className="page-grid-settings__switch" onClick={() => set(togglePinFilterMaster(filter))}>
              <span style={{ fontWeight: 600 }}>Show pins</span>
              <span className="page-grid-settings__knob" aria-hidden="true" />
            </button>
            {SWITCHES.map(([key, label]) => (
              <button key={key} type="button" role="switch" aria-checked={filter[key]} data-pin-filter={key} className="page-grid-settings__switch" onClick={() => set({ ...filter, [key]: !filter[key] })}>
                <span>{label}</span>
                <span className="page-grid-settings__knob" aria-hidden="true" />
              </button>
            ))}
            <div style={{ height: 1, background: 'var(--surface-3)', margin: '4px 0' }} />
            <button
              type="button"
              role="switch"
              aria-checked={filter.done}
              data-pin-filter="done"
              className="page-grid-settings__switch"
              {...tip('Pins count as done when an Issue is Closed, Approved or Rejected, or a Task is Closed.', 'left')}
              onClick={() => set({ ...filter, done: !filter.done })}
            >
              <span>Show done items</span>
              <span className="page-grid-settings__knob" aria-hidden="true" />
            </button>
          </div>
        </RailFlyout>
      )}
    </div>
  );
}
