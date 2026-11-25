/* Nightly 'comment-pins': the Pin tool's split button (desktop tool row) and
   the "On the page" card on the right rail. Owner 2026-11-24 ("I don't even
   know what a pin is"): Survey already says pin for Pinned tools and Counter
   pins, so the words people see call these comments, issues and tasks on the
   page; the code keeps its pin names. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../Icons';
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
 * When extraItems (e.g. Sticky note, Audio note) are supplied, clicking opens
 * one combined Comments & notes sub-menu so related tools do not sprawl.
 */
export function PinToolButton({ active, onArm, glyphSize = 18, extraItems = [], onSelectExtra }) {
  const tip = useTooltip();
  const kind = usePagePins((s) => s.kind);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  useOutsideClose(open, setOpen, [buttonRef, menuRef]);
  const label = PIN_KIND_LABELS[kind];
  const hasExtras = extraItems.length > 0;
  const activeExtra = extraItems.find((item) => item.active) || null;
  const isPressed = Boolean(active || activeExtra);
  const tooltipText = open
    ? undefined
    : activeExtra
      ? `Comments & notes: ${activeExtra.label}`
      : hasExtras
        ? `Comments & notes (${label}, N)`
        : `${label} (N)`;
  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const menuLeft = rect
    ? Math.max(8, Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 210))
    : 8;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={hasExtras ? 'Comments & notes' : label}
        aria-pressed={isPressed}
        data-pin-tool-button={kind}
        data-tool-switch="true"
        className={`btn chrome-subcontrol ${isPressed || open ? 'btn-active' : 'btn-ghost'}`}
        {...tip(tooltipText, 'below')}
        onClick={() => {
          if (hasExtras) {
            setOpen((o) => !o);
            return;
          }
          if (!active) { onArm(); return; }
          setOpen((o) => !o);
        }}
        style={{ position: 'relative', width: 'auto', minWidth: 34, paddingLeft: 6, paddingRight: 15 }}
      >
        {activeExtra ? <Icon name={activeExtra.iconName} size={glyphSize} /> : <PinKindGlyph kind={kind} size={glyphSize} />}
        <span aria-hidden="true" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-3)' }}>▾</span>
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={hasExtras ? 'Comments & notes' : 'Comment, issue or task'}
          data-pin-kind-menu="true"
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            left: menuLeft,
            minWidth: 180,
            padding: 4,
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-3)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            zIndex: 5800,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {PIN_KINDS.map((k) => {
            const selected = active && k === kind;
            return (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={selected}
                data-pin-kind-option={k}
                onClick={() => {
                  setPagePinsState((s) => ({ kind: k, draft: s.draft ? { ...s.draft, kind: k } : null }));
                  setOpen(false);
                  onArm();
                }}
                onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = selected ? 'var(--surface-3)' : 'transparent'; }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  height: 34,
                  padding: '0 10px',
                  border: 'none',
                  borderRadius: 6,
                  background: selected ? 'var(--surface-3)' : 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--text-1)',
                  fontSize: 12.5,
                  fontWeight: selected ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                <PinKindGlyph kind={k} size={16} />
                <span>{PIN_KIND_LABELS[k]}</span>
              </button>
            );
          })}
          {hasExtras && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '3px 6px' }} />
              {extraItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={Boolean(item.active)}
                  data-review-group-item={item.id}
                  onClick={(e) => {
                    setOpen(false);
                    onSelectExtra?.(item, e);
                  }}
                  onMouseEnter={(e) => { if (!item.active) e.currentTarget.style.background = 'var(--hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = item.active ? 'var(--surface-3)' : 'transparent'; }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    width: '100%',
                    height: 34,
                    padding: '0 10px',
                    border: 'none',
                    borderRadius: 6,
                    background: item.active ? 'var(--surface-3)' : 'transparent',
                    color: item.active ? 'var(--accent)' : 'var(--text-1)',
                    fontSize: 12.5,
                    fontWeight: item.active ? 600 : 400,
                    cursor: 'pointer',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Icon name={item.iconName} size={16} color={item.active ? 'var(--accent)' : 'var(--text-2)'} />
                  <span>{item.label}</span>
                </button>
              ))}
            </>
          )}
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

/** The rail's "On the page" card. `renderButton({ open, ref, onClick, on })`. */
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
        <RailFlyout cardRef={cardRef} role="dialog" aria-label="Comments, issues and tasks" title="On the page" data-pin-filter-menu="true" className="page-grid-settings__card">
          <div className="page-grid-settings">
            <button type="button" role="switch" aria-checked={allOn} data-pin-filter="all" className="page-grid-settings__switch" onClick={() => set(togglePinFilterMaster(filter))}>
              <span style={{ fontWeight: 600 }}>Show all</span>
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
              {...tip('An issue is done when it is Closed, Approved or Rejected; a task when it is Closed.', 'left')}
              onClick={() => set({ ...filter, done: !filter.done })}
            >
              <span>Show done ones</span>
              <span className="page-grid-settings__knob" aria-hidden="true" />
            </button>
          </div>
        </RailFlyout>
      )}
    </div>
  );
}
