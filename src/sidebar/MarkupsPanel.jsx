// Markups panel (Nightly, flag 'markup-list'; Drawboard deep test gap):
// every mark on the document, page by page, with search, filters (type, who,
// layer, measurements only), measurement totals and a CSV of what is shown.
// A press on a row picks the mark and glides to it, as a comment does.
// The list itself is pure (markupList/markupList.js); the marks come from the
// viewer through getMarkupSnapshot, read again while the panel is open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import SectionIconButton from '../components/SectionIconButton.jsx';
import { useTooltip } from '../components/Tooltip';
import { useDocumentPeople } from '../hooks/useDocumentPeople.js';
import { personLabel } from '../services/markComments.js';
import { showToast } from '../utils/toast';
import { historyAnnotationInkBox } from '../utils/historyGeometry.js';
import { measureMarkBox } from '../components/revisions/historyPageOverlay.js';
import {
  filterMarkupRows,
  markupCsv,
  markupCsvFileName,
  markupFacets,
  markupRows,
  markupTotals,
} from '../markupList/markupList.js';
import './MarkupsPanel.css';

const REFRESH_MS = 800;
const EMPTY = Object.freeze({ annotationsByPage: {}, surveyMarkers: {}, layerState: null, documentName: '' });

function toggleIn(list, id) {
  if (!Array.isArray(list)) return [id];
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return next.length ? next : null;
}

function FilterGroup({ title, items, chosen, onToggle, testId }) {
  if (items.length < 2 && !(Array.isArray(chosen) && chosen.length)) return null;
  return (
    <div className="markups-filter-group" role="group" aria-label={title} data-markups-filter={testId}>
      <span className="markups-filter-group__title">{title}</span>
      <div className="markups-chips">
        {items.map((item) => {
          const on = Array.isArray(chosen) && chosen.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`markups-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onToggle(item.id)}
            >
              {item.label}
              <span className="markups-chip__count nums">{item.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MarkupsPanel({
  documentId = null,
  isActive = false,
  getMarkupSnapshot = null,
  locateHistoryMark = null,
  focusHistoryMark = null,
  selectHistoryMark = null,
  onNavigateToPage = null,
  headActionsHost = null,
  onRequestSheetClose = undefined,
  phone = false,
}) {
  const tip = useTooltip();
  const people = useDocumentPeople(documentId, { enabled: Boolean(documentId && isActive) });
  const nameOf = useCallback((id) => personLabel(people.find((p) => p.id === id) || null), [people]);

  // Read the marks again while open; only a changed store rebuilds the list.
  const [snapshot, setSnapshot] = useState(EMPTY);
  const lastRef = useRef(null);
  useEffect(() => {
    if (!isActive || typeof getMarkupSnapshot !== 'function') return undefined;
    const read = () => {
      const next = getMarkupSnapshot() || EMPTY;
      const last = lastRef.current;
      if (last && last.annotationsByPage === next.annotationsByPage && last.surveyMarkers === next.surveyMarkers
        && last.layerState === next.layerState) return;
      lastRef.current = next;
      setSnapshot(next);
    };
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isActive, getMarkupSnapshot]);

  const rows = useMemo(() => markupRows(snapshot), [snapshot]);
  const facets = useMemo(() => markupFacets(rows, { nameOf }), [rows, nameOf]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ types: null, authors: null, layers: null, measuresOnly: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shown = useMemo(() => filterMarkupRows(rows, { query, ...filters }, { nameOf }), [rows, query, filters, nameOf]);
  const totals = useMemo(() => markupTotals(shown), [shown]);
  const filterCount = ['types', 'authors', 'layers'].reduce((n, k) => n + (Array.isArray(filters[k]) ? 1 : 0), 0) + (filters.measuresOnly ? 1 : 0);
  const hasMeasures = rows.some((r) => r.measure);

  const groups = useMemo(() => {
    const out = [];
    for (const row of shown) {
      const last = out[out.length - 1];
      if (last && last.pageNumber === row.pageNumber) last.rows.push(row);
      else out.push({ pageNumber: row.pageNumber, rows: [row] });
    }
    return out;
  }, [shown]);

  const goTo = useCallback((row) => {
    const located = row.id && typeof locateHistoryMark === 'function' ? locateHistoryMark(row.id) : null;
    const page = located?.pageNumber || row.pageNumber;
    const box = (typeof document !== 'undefined' ? measureMarkBox(document, row.id, page) : null)
      || (located?.annotation ? historyAnnotationInkBox(located.annotation) : null);
    const picked = located && typeof selectHistoryMark === 'function' ? selectHistoryMark(row.id) : false;
    if (typeof onRequestSheetClose === 'function') onRequestSheetClose();
    const focus = () => {
      const focused = typeof focusHistoryMark === 'function' ? focusHistoryMark(page, box, { animate: true }) : false;
      if (!focused) onNavigateToPage?.(page, { fallback: 'nearest', bypassActiveSpace: true });
    };
    if (picked && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const raf = window.requestAnimationFrame;
      raf(() => raf(() => raf(focus)));
    } else {
      focus();
    }
  }, [focusHistoryMark, locateHistoryMark, onNavigateToPage, onRequestSheetClose, selectHistoryMark]);

  const exportCsv = useCallback(async () => {
    if (shown.length === 0) { showToast('No markups to save.', 'info'); return; }
    try {
      const name = snapshot.documentName || 'Document';
      const csv = markupCsv(shown, { nameOf, documentName: String(name).replace(/\.pdf$/i, '') });
      const { deliverCsv } = await import('../utils/exportPdfBytes.js');
      const result = await deliverCsv(csv, markupCsvFileName(name), { title: 'Save markups' });
      if (result !== 'canceled') showToast(`Saved ${shown.length} markup${shown.length === 1 ? '' : 's'} as CSV`, 'success');
    } catch (err) {
      console.warn('[markups] CSV not saved', err);
      showToast('The CSV couldn’t be saved.');
    }
  }, [shown, nameOf, snapshot.documentName]);

  const csvButton = headActionsHost
    ? createPortal(<SectionIconButton icon="download" label="Save list as CSV" data-markups-csv="true" onClick={exportCsv} />, headActionsHost)
    : null;

  return (
    <div className={`markups-panel${phone ? ' is-phone' : ''}`} data-testid="markups-panel">
      {csvButton}
      <div className="markups-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={query}
          placeholder="Search markups"
          aria-label="Search markups"
          data-markups-search="true"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`markups-filter-btn${filtersOpen || filterCount ? ' is-on' : ''}`}
          aria-expanded={filtersOpen}
          aria-label={filterCount ? `Filters (${filterCount} on)` : 'Filters'}
          data-markups-filter-toggle="true"
          {...tip('Filters', 'below')}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Icon name="filter" size={14} />
          {filterCount > 0 && <span className="markups-filter-btn__count nums">{filterCount}</span>}
        </button>
      </div>
      {filtersOpen && (
        <div className="markups-filters" data-markups-filters="true">
          <FilterGroup title="Type" testId="type" items={facets.types} chosen={filters.types} onToggle={(id) => setFilters((f) => ({ ...f, types: toggleIn(f.types, id) }))} />
          <FilterGroup title="Who" testId="who" items={facets.authors} chosen={filters.authors} onToggle={(id) => setFilters((f) => ({ ...f, authors: toggleIn(f.authors, id) }))} />
          <FilterGroup title="Layer" testId="layer" items={facets.layers} chosen={filters.layers} onToggle={(id) => setFilters((f) => ({ ...f, layers: toggleIn(f.layers, id) }))} />
          <div className="markups-filter-foot">
            {hasMeasures && (
              <button
                type="button"
                className={`markups-chip${filters.measuresOnly ? ' is-on' : ''}`}
                aria-pressed={filters.measuresOnly}
                data-markups-measures-only="true"
                onClick={() => setFilters((f) => ({ ...f, measuresOnly: !f.measuresOnly }))}
              >
                Measurements only
              </button>
            )}
            {filterCount > 0 && (
              <button type="button" className="markups-text-btn" onClick={() => setFilters({ types: null, authors: null, layers: null, measuresOnly: false })}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
      <div className="markups-count">
        <span data-markups-count={shown.length}>
          {shown.length === rows.length ? `${rows.length} markup${rows.length === 1 ? '' : 's'}` : `${shown.length} of ${rows.length} markups`}
        </span>
        {!headActionsHost && shown.length > 0 && (
          <button type="button" className="markups-text-btn" data-markups-csv="true" onClick={exportCsv}>
            <Icon name="download" size={14} /> CSV
          </button>
        )}
      </div>
      {totals.length > 0 && (
        <div className="markups-totals" data-markups-totals="true">
          {totals.map((t) => (
            <span key={`${t.kind}|${t.unit}`} className="markups-total" data-markups-total={t.kind}>
              <span className="markups-total__name">{t.name}</span>
              <span className="nums">{t.quantity} {t.unit}</span>
            </span>
          ))}
        </div>
      )}
      <div className="markups-list" role="list">
        {rows.length === 0 && <div className="markups-empty">No markups yet.</div>}
        {rows.length > 0 && shown.length === 0 && <div className="markups-empty">No markups match.</div>}
        {groups.map((group) => (
          <div key={group.pageNumber} className="markups-page" role="presentation">
            <div className="markups-page__head">Page {group.pageNumber}</div>
            {group.rows.map((row) => (
              <button
                key={`${row.kind}:${row.id}`}
                type="button"
                role="listitem"
                className="markups-row"
                data-markup-id={row.id}
                onClick={() => goTo(row)}
              >
                <span className="markups-row__glyph" style={row.color ? { color: row.color } : undefined}>
                  <Icon name={row.glyph} size={15} />
                </span>
                <span className="markups-row__main">
                  <span className="markups-row__title">
                    {row.measure ? <><strong className="nums">{row.measure.text}</strong> <span className="markups-row__type">{row.typeName}</span></> : (row.text || row.typeName)}
                  </span>
                  <span className="markups-row__meta">
                    {[row.measure || !row.text ? null : row.typeName, row.authorId === 'pdf' ? 'No author' : nameOf(row.authorId), row.layerName && rows.some((r) => r.layerId !== row.layerId) ? row.layerName : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
