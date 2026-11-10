// The bar under a project sheet (Nightly flag 'sheet-set-view'), copied from
// Drawboard Projects' bottom bar: previous and next sheet, the sheet picker
// (the project's sheets by number, with a search field) and the view switch
// (Single, List, Grid). On a phone, as Drawboard's, the three views fold
// into one "View mode" menu and the arrows go (Shift+arrows and the picker
// stay). Rules: sheetSet.js. Shown only while the open document is one of
// two or more current sheets in a project.

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icons';
import { useTooltip } from '../components/Tooltip';
import { filterSheets, sheetLabel, sheetPosition, sheetRowParts } from './sheetSet.js';
import './sheetSet.css';

const VIEWS = [
  { id: 'single', label: 'Single sheet' },
  { id: 'list', label: 'List of sheets' },
  { id: 'grid', label: 'Grid of sheets' },
];

export function SheetViewGlyph({ view, size = 14 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {view === 'single' && <rect x="3.5" y="2" width="9" height="12" rx="1" {...common} />}
      {view === 'list' && (
        <>
          <rect x="4" y="1.5" width="8" height="6" rx="1" {...common} />
          <rect x="4" y="8.5" width="8" height="6" rx="1" {...common} />
        </>
      )}
      {view === 'grid' && (
        <>
          <rect x="2" y="2" width="5" height="5" rx="1" {...common} />
          <rect x="9" y="2" width="5" height="5" rx="1" {...common} />
          <rect x="2" y="9" width="5" height="5" rx="1" {...common} />
          <rect x="9" y="9" width="5" height="5" rx="1" {...common} />
        </>
      )}
    </svg>
  );
}

export default function SheetSetBar({ sheets, currentId, view = 'single', onView, onStep, onPick, phone = false, tip: chromeTip = null }) {
  // The viewer's own chip (AppShell's chromeTip) when given; else the nearest
  // tooltip host.
  const nearestTip = useTooltip();
  const tip = chromeTip || nearestTip;
  const { index, count } = sheetPosition(sheets, currentId);
  const current = index >= 0 ? sheets[index] : null;
  const [open, setOpen] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const searchRef = useRef(null);
  const shown = useMemo(() => filterSheets(sheets, query), [sheets, query]);

  useEffect(() => {
    if (!open && !viewMenu) return undefined;
    const close = () => { setOpen(false); setViewMenu(false); };
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) close();
    };
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    // A finger opens it to tap a row; only a pointer with a keyboard gets the
    // search field focused (no phone keyboard jumping up over the list).
    if (open && !phone) searchRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, viewMenu, phone]);
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  if (!current || count < 2) return null;
  const pick = (doc) => { setOpen(false); onPick?.(doc); };
  const currentView = VIEWS.find((v) => v.id === view) || VIEWS[0];

  return (
    <div ref={wrapRef} className={`sheet-set-bar${phone ? ' is-phone' : ''}`} data-sheet-set-bar role="toolbar" aria-label="Sheets">
      {phone ? (
        <div className="sheet-set-bar__menu-wrap">
          <button
            type="button"
            className="sheet-set-bar__btn"
            aria-haspopup="menu"
            aria-expanded={viewMenu}
            aria-label={`View mode: ${currentView.label}`}
            data-sheet-view-menu
            onClick={() => { setOpen(false); setViewMenu((v) => !v); }}
          >
            <SheetViewGlyph view={currentView.id} size={16} />
          </button>
          {viewMenu && (
            <div role="menu" aria-label="View mode" className="sheet-set-view-menu" data-sheet-view-menu-list>
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={view === v.id}
                  data-sheet-view={v.id}
                  className={`sheet-set-view-menu__row${view === v.id ? ' is-picked' : ''}`}
                  onClick={() => { setViewMenu(false); onView?.(v.id); }}
                >
                  <SheetViewGlyph view={v.id} size={16} />
                  <span>{v.label}</span>
                  {view === v.id ? <Icon name="check" size={12} color="currentColor" /> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {phone ? null : <button
        type="button"
        className="sheet-set-bar__btn"
        aria-label="Previous sheet"
        data-sheet-step="prev"
        disabled={index <= 0}
        onClick={() => onStep?.(-1)}
        {...tip('Previous sheet (Shift+Left)', 'above')}
      >
        <Icon name="chevronLeft" size={14} color="currentColor" />
      </button>}
      <button
        type="button"
        className="sheet-set-bar__picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sheet ${index + 1} of ${count}: ${sheetLabel(current)}`}
        data-sheet-picker-button
        onClick={() => { setViewMenu(false); setOpen((v) => !v); }}
      >
        <span className="sheet-set-bar__name">{sheetLabel(current)}</span>
        <span className="sheet-set-bar__count nums" data-sheet-count>{index + 1} / {count}</span>
        <Icon name="chevronDown" size={12} color="currentColor" />
      </button>
      {phone ? null : <button
        type="button"
        className="sheet-set-bar__btn"
        aria-label="Next sheet"
        data-sheet-step="next"
        disabled={index >= count - 1}
        onClick={() => onStep?.(1)}
        {...tip('Next sheet (Shift+Right)', 'above')}
      >
        <Icon name="chevronRight" size={14} color="currentColor" />
      </button>}
      {phone ? null : <span className="sheet-set-bar__rule" aria-hidden="true" />}
      {phone ? null : <div role="radiogroup" aria-label="Sheet view" className="sheet-set-bar__views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            aria-label={v.label}
            data-sheet-view={v.id}
            className={`sheet-set-bar__btn${view === v.id ? ' is-picked' : ''}`}
            onClick={() => onView?.(v.id)}
            {...tip(v.label, 'above')}
          >
            <SheetViewGlyph view={v.id} />
          </button>
        ))}
      </div>}
      {open && (
        <div className="sheet-set-picker" data-sheet-picker>
          <input
            ref={searchRef}
            className="sheet-set-picker__search"
            type="search"
            placeholder="Search sheets"
            aria-label="Search sheets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div role="listbox" aria-label="Project sheets" className="sheet-set-picker__list slim-scroll">
            {shown.length === 0 ? (
              <div className="sheet-set-picker__empty">No sheets match</div>
            ) : shown.map((doc) => {
              const here = String(doc.id) === String(currentId);
              return (
                <button
                  key={doc.id}
                  type="button"
                  role="option"
                  aria-selected={here}
                  data-sheet-option={doc.id}
                  className={`sheet-set-picker__row${here ? ' is-picked' : ''}`}
                  onClick={() => pick(doc)}
                >
                  <span className="sheet-set-picker__label">
                    <b className="sheet-set-picker__number">{sheetRowParts(doc).number}</b>
                    {sheetRowParts(doc).name ? <span className="sheet-set-picker__name">{sheetRowParts(doc).name}</span> : null}
                  </span>
                  {here ? <Icon name="check" size={12} color="currentColor" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
