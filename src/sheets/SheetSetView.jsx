// List and Grid views of a project's sheets (Nightly flag 'sheet-set-view'),
// copied from Drawboard Projects: List is every sheet in one scroll, one
// section per sheet with its number; Grid puts 4 to 8 sheets on a row (two
// on a phone). Each sheet shows its first page with its marks (the shared
// thumbnail); a press opens that sheet in the single view.

import { useEffect, useRef } from 'react';
import PdfPageThumb from '../home/PdfPageThumb';
import { useStorage } from '../hooks/useDatabase';
import { GRID_COLUMNS, sheetLabel } from './sheetSet.js';
import './sheetSet.css';

export default function SheetSetView({ sheets, currentId, view, columns, onColumns, onOpen, phone = false }) {
  const { downloadDocument } = useStorage();
  const scrollRef = useRef(null);
  const grid = view === 'grid';
  const cols = phone ? 2 : columns;

  // The open sheet is in view when the List or Grid opens.
  useEffect(() => {
    const host = scrollRef.current;
    const here = host?.querySelector(`[data-sheet-card="${CSS.escape(String(currentId))}"]`);
    here?.scrollIntoView?.({ block: 'nearest' });
  }, [view, currentId]);

  return (
    <div className={`sheet-set-view${phone ? ' is-phone' : ''}`} data-sheet-set-view={view}>
      <div className="sheet-set-view__head">
        <span className="sheet-set-view__title">Sheets<span className="sheet-set-view__count nums">{sheets.length}</span></span>
        {grid && !phone ? (
          <div role="radiogroup" aria-label="Sheets per row" className="sheet-set-view__cols">
            {GRID_COLUMNS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={columns === n}
                aria-label={`${n} per row`}
                data-sheet-columns={n}
                className={`sheet-set-view__col${columns === n ? ' is-picked' : ''}`}
                onClick={() => onColumns?.(n)}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className={`sheet-set-view__scroll slim-scroll${grid ? ' is-grid' : ' is-list'}`}
        style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {sheets.map((doc) => {
          const here = String(doc.id) === String(currentId);
          return (
            <button
              key={doc.id}
              type="button"
              data-sheet-card={doc.id}
              aria-current={here ? 'page' : undefined}
              aria-label={`Open ${sheetLabel(doc)}`}
              className={`sheet-set-card${here ? ' is-current' : ''}`}
              onClick={() => onOpen?.(doc)}
            >
              <span className="sheet-set-card__label">{sheetLabel(doc)}</span>
              <span className="sheet-set-card__page">
                <PdfPageThumb doc={doc} downloadDocument={downloadDocument} variant="preview" fill priority />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
