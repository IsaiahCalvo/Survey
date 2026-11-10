// Export filters (Nightly, flag 'export-filters'; Drawboard Projects round 2).
//
// Drawboard's export dialog can keep only some authors' marks and only some
// layers, and can add the drawing's comments as a CSV. Survey's Export PDF
// dialog (flag 'export-modes') gets the same:
//   - "Who": one chip per person whose marks are on the document (marks,
//     callouts and Survey Markers); marks with no author (the ones the PDF
//     came with, or drawn before authors were kept) are "No author".
//   - "Layers": one chip per layer that holds marks (with the 'layers' beta).
//   - "Comments (.csv)": the document's comment threads, one row each.
// Pure: no React, no pdf-lib, no Supabase, so node tests import it.

import { getAnnotationAuthorId, getSurveyMarkerAuthorId } from '../lib/collab/permissionScope.js';
import { DEFAULT_LAYER_ID, normalizeLayerState, resolveLayerId } from './layers.js';

export const NO_AUTHOR = 'pdf';

const markAuthor = (object) => {
  const id = getAnnotationAuthorId(object);
  return typeof id === 'string' && id ? id : NO_AUTHOR;
};
const markerAuthor = (marker) => {
  const id = getSurveyMarkerAuthorId(marker);
  return typeof id === 'string' && id ? id : NO_AUTHOR;
};
const isCalloutObject = (object) => object?.data?.type === 'callout';

function eachMark(annotationsByPage, fn) {
  for (const pageData of Object.values(annotationsByPage || {})) {
    for (const object of Array.isArray(pageData?.objects) ? pageData.objects : []) {
      if (object) fn(object);
    }
  }
}

/**
 * Who has marks on the document, most marks first: [{ id, count }]. A callout
 * is counted once (its page object), Survey Markers by their own author.
 */
export function exportAuthors({ annotationsByPage = {}, surveyMarkers = {} } = {}) {
  const counts = new Map();
  const add = (id) => counts.set(id, (counts.get(id) || 0) + 1);
  eachMark(annotationsByPage, (object) => add(markAuthor(object)));
  for (const marker of Object.values(surveyMarkers || {})) if (marker) add(markerAuthor(marker));
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)));
}

/** Layers that hold marks, in the layer list's order: [{ id, name, count }]. */
export function exportLayers({ annotationsByPage = {} } = {}, layerState) {
  const state = normalizeLayerState(layerState);
  const counts = new Map();
  eachMark(annotationsByPage, (object) => {
    const id = resolveLayerId(object, state);
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return state.layers.filter((l) => counts.has(l.id)).map((l) => ({ id: l.id, name: l.name, count: counts.get(l.id) }));
}

/** True when the filter keeps everything (no chip turned off). */
export function exportFilterIsAll(filter) {
  return !filter || (!Array.isArray(filter.authors) && !Array.isArray(filter.layers));
}

/**
 * The marks to export under `filter` ({ authors: ids | null, layers: ids |
 * null }; null = all). Returns new { annotationsByPage, callouts,
 * surveyMarkers }; a page with nothing filtered keeps its object. Callouts
 * follow their page object's author and layer; Survey Markers have no layer,
 * so only the Who filter applies to them.
 */
export function applyExportFilter({ annotationsByPage = {}, callouts = [], surveyMarkers = {} } = {}, filter = null, layerState = null) {
  if (exportFilterIsAll(filter)) return { annotationsByPage, callouts, surveyMarkers };
  const authors = Array.isArray(filter.authors) ? new Set(filter.authors.map(String)) : null;
  const layers = Array.isArray(filter.layers) ? new Set(filter.layers.map(String)) : null;
  const state = normalizeLayerState(layerState);
  const keepMark = (object) => (
    (!authors || authors.has(markAuthor(object)))
    && (!layers || layers.has(resolveLayerId(object, state)))
  );
  const droppedCallouts = new Set();
  const nextByPage = {};
  for (const [key, pageData] of Object.entries(annotationsByPage || {})) {
    if (!Array.isArray(pageData?.objects)) { nextByPage[key] = pageData; continue; }
    const kept = pageData.objects.filter((object) => {
      if (!object) return false;
      const keep = keepMark(object);
      if (!keep && isCalloutObject(object) && object?.data?.id != null) droppedCallouts.add(String(object.data.id));
      return keep;
    });
    nextByPage[key] = kept.length === pageData.objects.length ? pageData : { ...pageData, objects: kept };
  }
  const nextCallouts = (Array.isArray(callouts) ? callouts : []).filter((callout) => {
    if (!callout) return false;
    if (droppedCallouts.has(String(callout.id))) return false;
    // A callout not (yet) mirrored on a page object: judge it by its own fields.
    if (authors && !authors.has(markAuthor(callout))) return false;
    if (layers && !layers.has(String(callout.layerId || DEFAULT_LAYER_ID))) return false;
    return true;
  });
  const nextMarkers = {};
  for (const [id, marker] of Object.entries(surveyMarkers || {})) {
    if (marker && (!authors || authors.has(markerAuthor(marker)))) nextMarkers[id] = marker;
  }
  return { annotationsByPage: nextByPage, callouts: nextCallouts, surveyMarkers: nextMarkers };
}

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) || /^[=+\-@]/.test(text)
    ? `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
    : text;
};

/**
 * The document's comments as CSV, one row per comment, threads together
 * (first comment, then its replies). Deleted comments are left out.
 * `nameOf(id)` turns an author id into a name.
 */
export function commentsCsv(comments, { nameOf = () => '', documentName = '' } = {}) {
  const list = (Array.isArray(comments) ? comments : []).filter((c) => c && !c.deletedAt);
  const roots = list.filter((c) => !c.threadId);
  const byThread = new Map(roots.map((r) => [r.id, []]));
  for (const c of list) if (c.threadId && byThread.has(c.threadId)) byThread.get(c.threadId).push(c);
  const rows = [['Document', 'Page', 'Thread', 'Reply', 'Author', 'Date', 'Edited', 'Comment']];
  roots
    .sort((a, b) => (a.pageNumber - b.pageNumber) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .forEach((root, i) => {
      [root, ...byThread.get(root.id)].forEach((c, j) => {
        rows.push([
          documentName,
          c.pageNumber,
          i + 1,
          j === 0 ? '' : j,
          nameOf(c.authorId) || 'Someone',
          c.createdAt || '',
          c.editedAt ? 'yes' : '',
          c.body,
        ]);
      });
    });
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** "Plan A-101 comments.csv" beside the PDF. */
export function commentsCsvFileName(pdfName) {
  const base = String(pdfName || 'Document').replace(/\.pdf$/i, '').trim() || 'Document';
  return `${base} comments.csv`;
}
