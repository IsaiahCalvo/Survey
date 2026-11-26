/* Nightly 'comment-pins': the Pin tool's split button (desktop tool row) and
   the "On the page" card on the right rail. With Nightly 'view-strip' the
   View drawer leaves that card out (owner 2026-11-26: "a lot of this seems
   extra"), so the same switches sit under the tool's Comment / Issue / Task
   choices. Owner 2026-11-24 ("I don't even
   know what a pin is"): Survey already says pin for Pinned tools and Counter
   pins, so the words people see call these comments, issues and tasks on the
   page; the code keeps its pin names. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RailFlyout from '../RailFlyout.jsx';
import '../PageGridSettings.css';
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
  const label = kind === 'issue' ? 'Add an issue on the page' : `Add a ${PIN_KIND_LABELS[kind].toLowerCase()} on the page`;
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
          aria-label="Comment, issue or task"
          data-pin-kind-menu="true"
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            left: rect.left,
            minWidth: 200,
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
          <div aria-hidden="true" style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <div role="group" aria-labelledby="pin-kind-filter-caption" data-pin-kind-filter="true" className="page-grid-settings" style={{ padding: '2px 8px 4px', gap: 4 }}>
            <span id="pin-kind-filter-caption" style={{ padding: '4px 2px 2px', font: '500 11px/13px var(--font-ui)', color: 'var(--text-3)' }}>On the page</span>
            <PinFilterSwitches tipSide="right" />
          </div>
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

/** Show all, Comments, Issues, Tasks and Show done ones: what shows on the page. */
function PinFilterSwitches({ tipSide }) {
  const tip = useTooltip();
  const filter = usePagePins((s) => s.filter);
  const userId = usePagePins((s) => s.userId);
  const set = (next) => {
    setPagePinsState({ filter: next });
    savePinFilter(userId, next);
  };
  const allOn = pinFilterAllOn(filter);
  return (
    <>
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
        {...tip('An issue is done when it is Closed, Approved or Rejected; a task when it is Closed.', tipSide)}
        onClick={() => set({ ...filter, done: !filter.done })}
      >
        <span>Show done ones</span>
        <span className="page-grid-settings__knob" aria-hidden="true" />
      </button>
    </>
  );
}

/** The rail's "On the page" card. `renderButton({ open, ref, onClick, on })`. */
export function PinFilterMenu({ renderButton }) {
  const enabled = usePagePins((s) => s.enabled);
  const filter = usePagePins((s) => s.filter);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const cardRef = useRef(null);
  useOutsideClose(open, setOpen, [buttonRef, cardRef]);
  if (!enabled) return null;
  const allOn = pinFilterAllOn(filter);
  return (
    <div className="page-grid-menu">
      {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v), on: allOn })}
      {open && (
        <RailFlyout cardRef={cardRef} role="dialog" aria-label="Comments, issues and tasks" title="On the page" data-pin-filter-menu="true" className="page-grid-settings__card">
          <div className="page-grid-settings">
            <PinFilterSwitches tipSide="left" />
          </div>
        </RailFlyout>
      )}
    </div>
  );
}
