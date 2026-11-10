/**
 * MarkupsPanel - every mark in the document in one list (behind the
 * 'markup-list' flag, Nightly). Drawboard Projects + PDF Pro trial audit
 * 2026-11-09: both list a sheet's markups grouped by kind, with author,
 * search and export; Survey only had History (changes, not marks).
 *
 * Search by words (kind, text, measurement, "p3", author), narrow by kind,
 * person or layer or to measurements only, see the measurements' totals,
 * click a row to go to the mark and pick it, copy the list as CSV (with each
 * measurement's quantity and unit). Reads the live page lists, so it follows
 * edits as they happen. Pure rules: utils/markupList.js.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../Icons';
import ValueSelect from '../components/ValueSelect';
import './MarkupsPanel.css';
import { supabase } from '../supabaseClient';
import { useTooltip } from '../components/Tooltip';
import { showToast } from '../utils/toast';
import { listCommentPeople } from '../services/markComments.js';
import {
  authorLabel,
  buildMarkupRows,
  filterMarkupRows,
  groupMarkupRows,
  markupRowsToCsv,
  markupTotals,
} from '../utils/markupList.js';

function safeName(name) {
  return String(name || 'document').replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document';
}

export default function MarkupsPanel({
  annotationsByPage = null,
  layerState = null,
  viewerId = null,
  documentId = null,
  documentName = '',
  isActive = false,
  onOpenMark = null,
  // Phone: the sheet steps down so the picked mark shows.
  onRequestSheetClose = undefined,
}) {
  const tip = useTooltip();
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState(() => new Set());
  const [author, setAuthor] = useState('');
  const [layer, setLayer] = useState('');
  const [measuresOnly, setMeasuresOnly] = useState(false);
  const [closed, setClosed] = useState(() => new Set());
  const [people, setPeople] = useState([]);

  // Names for the people on the document (best effort; ids still group).
  useEffect(() => {
    if (!isActive || !documentId) return undefined;
    let live = true;
    listCommentPeople(supabase, documentId)
      .then((list) => { if (live) setPeople(list); })
      .catch(() => { /* "Someone" stands in */ });
    return () => { live = false; };
  }, [isActive, documentId]);

  const peopleById = useMemo(() => new Map(people.map((p) => [String(p.id), p])), [people]);
  const labelFor = useMemo(() => (id) => authorLabel(id, { viewerId, peopleById }), [viewerId, peopleById]);
  // Only build while the panel is in view: a big set has thousands of marks.
  const rows = useMemo(() => (isActive ? buildMarkupRows(annotationsByPage, { layerState }) : []), [isActive, annotationsByPage, layerState]);
  const kindCounts = useMemo(() => groupMarkupRows(rows).map((g) => ({ kind: g.kind, label: g.label, count: g.rows.length })), [rows]);
  const authors = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.authorId || ''))];
    return ids.map((id) => ({ id, label: labelFor(id || null) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, labelFor]);
  // Layers (Layers beta): only offered when the marks sit on more than one.
  const layers = useMemo(() => {
    const seen = new Map();
    for (const row of rows) if (row.layerId && !seen.has(row.layerId)) seen.set(row.layerId, row.layerName || 'Layer');
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [rows]);
  const manyLayers = layers.length > 1;
  const hasMeasures = useMemo(() => rows.some((r) => r.measure), [rows]);
  const shown = useMemo(() => filterMarkupRows(rows, {
    query,
    kinds,
    authors: author ? new Set([author]) : null,
    layers: layer ? new Set([layer]) : null,
    measuresOnly,
    labelFor,
  }), [rows, query, kinds, author, layer, measuresOnly, labelFor]);
  const groups = useMemo(() => groupMarkupRows(shown), [shown]);
  const totals = useMemo(() => markupTotals(shown), [shown]);

  const toggleKind = (kind) => setKinds((prev) => {
    const next = new Set(prev);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });
  const toggleGroup = (kind) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });

  const downloadCsv = () => {
    if (!shown.length) return;
    try {
      const blob = new Blob([markupRowsToCsv(shown, { labelFor })], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName(documentName)}_markups.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`${shown.length} ${shown.length === 1 ? 'markup' : 'markups'} saved as CSV`, 'success');
    } catch {
      showToast('Could not save the list', 'error');
    }
  };

  const filtered = query || kinds.size > 0 || author || layer || measuresOnly;
  const csvTip = tip('Save this list as CSV', 'below');

  return (
    <div className="markups-panel" data-testid="markups-panel">
      <div className="markups-panel__head">
        <div className="markups-panel__search">
          <Icon name="search" size={14} color="currentColor" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markups"
            aria-label="Search markups"
          />
        </div>
        <button
          type="button"
          className="markups-panel__icon-btn"
          aria-label="Save this list as CSV"
          disabled={!shown.length}
          onClick={downloadCsv}
          {...csvTip}
        >
          <Icon name="download" size={16} color="currentColor" />
        </button>
      </div>

      {kindCounts.length > 1 && (
        <div className="markups-panel__chips" role="group" aria-label="Show kinds">
          {kindCounts.map((k) => (
            <button
              key={k.kind}
              type="button"
              className={`markups-panel__chip${kinds.has(k.kind) ? ' is-on' : ''}`}
              aria-pressed={kinds.has(k.kind) ? 'true' : 'false'}
              data-markup-kind-chip={k.kind}
              onClick={() => toggleKind(k.kind)}
            >
              {k.label} <span className="markups-panel__count">{k.count}</span>
            </button>
          ))}
        </div>
      )}

      {authors.length > 1 && (
        <div className="markups-panel__author">
          <span aria-hidden="true">By</span>
          <ValueSelect
            label="Made by"
            size="sm"
            value={author}
            options={[{ value: '', label: 'Everyone' }, ...authors.map((a) => ({ value: a.id, label: a.label }))]}
            onChange={setAuthor}
          />
        </div>
      )}

      {(manyLayers || hasMeasures) && (
        <div className="markups-panel__author" data-markups-more-filters="true">
          {manyLayers && (
            <>
              <span aria-hidden="true">Layer</span>
              <ValueSelect
                label="Layer"
                size="sm"
                value={layer}
                options={[{ value: '', label: 'All layers' }, ...layers.map((l) => ({ value: l.id, label: l.label }))]}
                onChange={setLayer}
              />
            </>
          )}
          {hasMeasures && (
            <button
              type="button"
              className={`markups-panel__chip${measuresOnly ? ' is-on' : ''}`}
              aria-pressed={measuresOnly ? 'true' : 'false'}
              data-markups-measures-only="true"
              onClick={() => setMeasuresOnly((on) => !on)}
            >
              Measurements only
            </button>
          )}
        </div>
      )}

      <div className="markups-panel__summary" aria-live="polite">
        {rows.length === 0
          ? 'No markups yet. Marks you draw show up here.'
          : filtered
            ? `${shown.length} of ${rows.length} markups`
            : `${rows.length} ${rows.length === 1 ? 'markup' : 'markups'}`}
        {filtered && (
          <button type="button" className="markups-panel__clear" onClick={() => { setQuery(''); setKinds(new Set()); setAuthor(''); setLayer(''); setMeasuresOnly(false); }}>
            Clear
          </button>
        )}
      </div>

      {totals.length > 0 && (
        <div className="markups-panel__totals" data-markups-totals="true" aria-label="Measurement totals">
          {totals.map((t) => (
            <span key={`${t.kind}|${t.unit}`} className="markups-panel__total" data-markups-total={t.kind}>
              <span className="markups-panel__total-name">{t.name}</span>
              <span className="markups-panel__total-value">{t.quantity.toLocaleString()} {t.unit}</span>
            </span>
          ))}
        </div>
      )}

      <div className="markups-panel__list" role="list">
        {groups.map((group) => {
          const open = !closed.has(group.kind);
          return (
            <div key={group.kind} className="markups-panel__group" role="listitem">
              <button
                type="button"
                className="markups-panel__group-head"
                aria-expanded={open ? 'true' : 'false'}
                onClick={() => toggleGroup(group.kind)}
              >
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color="currentColor" />
                <span>{group.label}</span>
                <span className="markups-panel__count">{group.rows.length}</span>
              </button>
              {open && group.rows.map((row) => (
                <button
                  key={`${row.pageNumber}:${row.id}`}
                  type="button"
                  className="markups-panel__row"
                  data-markup-row={row.id}
                  onClick={() => { onRequestSheetClose?.(); onOpenMark?.(row); }}
                >
                  <span className="markups-panel__dot" style={{ background: row.color || 'var(--text-3)' }} aria-hidden="true" />
                  <span className="markups-panel__main">
                    <span className="markups-panel__title">
                      {/* A caption that already holds the reading ("Room 101 · 17' 0\"")
                          reads as it is, not with the reading a second time in front. */}
                      {row.measure?.text && !String(row.text || '').includes(row.measure.text)
                        ? <><strong>{row.measure.text}</strong> {row.text}</>
                        : (row.text || row.kindLabel)}
                    </span>
                    <span className="markups-panel__meta">
                      {[row.measure ? row.measure.name : null, labelFor(row.authorId), manyLayers ? row.layerName : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="markups-panel__page">p. {row.pageNumber}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
