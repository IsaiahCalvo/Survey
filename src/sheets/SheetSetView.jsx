// List and Grid views of a project's sheets (Nightly flag 'sheet-set-view'),
// copied from Drawboard Projects: List is every sheet in one scroll, Grid
// puts them in rows (Auto: as many as there are sheets, up to 4; or the
// number typed in "Grid columns"). Each sheet shows its first page with its
// marks (the shared thumbnail) over a strip "NUMBER - NAME - Rev X". A press
// makes that sheet the current one and stays here; a double press, or View
// single, shows it alone.

import { useEffect, useRef, useState } from 'react';
import PdfPageThumb from '../home/PdfPageThumb';
import { useStorage } from '../hooks/useDatabase';
import { GRID_AUTO, GRID_MAX_COLUMNS, gridColumnsFor, sheetCardLabel } from './sheetSet.js';
import './sheetSet.css';

function GridColumns({ setting, count, onColumns }) {
  const auto = setting === GRID_AUTO;
  const shown = gridColumnsFor(setting, count);
  const [draft, setDraft] = useState(String(shown));
  useEffect(() => { setDraft(String(shown)); }, [shown]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || String(draft).trim() === '') { setDraft(String(shown)); return; }
    onColumns?.(Math.max(1, n));
  };
  return (
    <div className="sheet-set-view__cols" data-sheet-columns-setting={auto ? 'auto' : shown}>
      <label className="sheet-set-view__cols-label" htmlFor="sheet-set-grid-columns">Grid columns</label>
      <input
        id="sheet-set-grid-columns"
        className="sheet-set-view__cols-input nums"
        type="number"
        inputMode="numeric"
        min={1}
        max={GRID_MAX_COLUMNS}
        step={1}
        value={draft}
        data-sheet-columns-input
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } }}
      />
      <button
        type="button"
        role="switch"
        aria-checked={auto}
        className={`sheet-set-view__auto${auto ? ' is-on' : ''}`}
        data-sheet-columns-auto
        onClick={() => onColumns?.(auto ? shown : GRID_AUTO)}
      >
        <span className="sheet-set-view__auto-track" aria-hidden="true"><span className="sheet-set-view__auto-knob" /></span>
        Auto
      </button>
    </div>
  );
}

export default function SheetSetView({ sheets, currentId, view, columns, onColumns, onPick, onOpen, phone = false }) {
  const { downloadDocument } = useStorage();
  const scrollRef = useRef(null);
  const grid = view === 'grid';
  const cols = gridColumnsFor(columns, sheets.length);

  // The current sheet is in view when the List or Grid opens.
  useEffect(() => {
    const host = scrollRef.current;
    const here = host?.querySelector(`[data-sheet-card="${CSS.escape(String(currentId))}"]`);
    here?.scrollIntoView?.({ block: 'nearest' });
  }, [view, currentId]);

  return (
    <div className={`sheet-set-view${phone ? ' is-phone' : ''}`} data-sheet-set-view={view}>
      <div className="sheet-set-view__head">
        <span className="sheet-set-view__title">Sheets<span className="sheet-set-view__count nums">{sheets.length}</span></span>
        {grid ? <GridColumns setting={columns} count={sheets.length} onColumns={onColumns} /> : null}
      </div>
      <div
        ref={scrollRef}
        className={`sheet-set-view__scroll slim-scroll${grid ? ' is-grid' : ' is-list'}`}
        style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
        data-sheet-grid-columns={grid ? cols : undefined}
      >
        {sheets.map((doc) => {
          const here = String(doc.id) === String(currentId);
          const label = sheetCardLabel(doc);
          return (
            <button
              key={doc.id}
              type="button"
              data-sheet-card={doc.id}
              aria-current={here ? 'page' : undefined}
              aria-label={label}
              className={`sheet-set-card${here ? ' is-current' : ''}`}
              onClick={() => { if (!here) onPick?.(doc); }}
              onDoubleClick={() => onOpen?.(doc)}
            >
              <span className="sheet-set-card__page">
                <PdfPageThumb doc={doc} downloadDocument={downloadDocument} variant="preview" fill priority />
              </span>
              <span className="sheet-set-card__label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
