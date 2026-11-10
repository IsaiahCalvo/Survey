/**
 * MarkupsPanel - every mark in the document in one list (behind the
 * 'markup-list' flag, Nightly). Drawboard Projects + PDF Pro trial audit
 * 2026-11-09: both list a sheet's markups grouped by kind, with author,
 * search and export; Survey only had History (changes, not marks).
 *
 * Search by words (kind, text, "p3", author), narrow by kind or person,
 * click a row to go to the mark and pick it, copy the list as CSV. Reads the
 * live page lists, so it follows edits as they happen. Pure rules:
 * utils/markupList.js.
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
} from '../utils/markupList.js';

function safeName(name) {
  return String(name || 'document').replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document';
}

export default function MarkupsPanel({
  annotationsByPage = null,
  viewerId = null,
  documentId = null,
  documentName = '',
  isActive = false,
  onOpenMark = null,
}) {
  const tip = useTooltip();
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState(() => new Set());
  const [author, setAuthor] = useState('');
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
  const rows = useMemo(() => (isActive ? buildMarkupRows(annotationsByPage) : []), [isActive, annotationsByPage]);
  const kindCounts = useMemo(() => groupMarkupRows(rows).map((g) => ({ kind: g.kind, label: g.label, count: g.rows.length })), [rows]);
  const authors = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.authorId || ''))];
    return ids.map((id) => ({ id, label: labelFor(id || null) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, labelFor]);
  const shown = useMemo(() => filterMarkupRows(rows, {
    query,
    kinds,
    authors: author ? new Set([author]) : null,
    labelFor,
  }), [rows, query, kinds, author, labelFor]);
  const groups = useMemo(() => groupMarkupRows(shown), [shown]);

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

  const filtered = query || kinds.size > 0 || author;
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

      <div className="markups-panel__summary" aria-live="polite">
        {rows.length === 0
          ? 'No markups yet. Marks you draw show up here.'
          : filtered
            ? `${shown.length} of ${rows.length} markups`
            : `${rows.length} ${rows.length === 1 ? 'markup' : 'markups'}`}
        {filtered && (
          <button type="button" className="markups-panel__clear" onClick={() => { setQuery(''); setKinds(new Set()); setAuthor(''); }}>
            Clear
          </button>
        )}
      </div>

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
                  onClick={() => onOpenMark?.(row)}
                >
                  <span className="markups-panel__dot" style={{ background: row.color || 'var(--text-3)' }} aria-hidden="true" />
                  <span className="markups-panel__main">
                    <span className="markups-panel__title">{row.text || row.kindLabel}</span>
                    <span className="markups-panel__meta">{labelFor(row.authorId)}</span>
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
