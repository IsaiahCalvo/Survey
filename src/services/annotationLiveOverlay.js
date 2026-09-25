// src/services/annotationLiveOverlay.js
//
// w32 (2026-09-25): live EDITS on other screens, display only.
//
// w30 made a NEW mark show on other screens in ~50-150 ms (a Yjs preview on
// the private `anno-live:<doc>` channel). Every other change — a move, a
// resize, a recolour, a partial or whole erase, a delete — still waited for
// its WAL row (~0.3-0.7 s, more under load). Now the sender also broadcasts
// what the screen SHOWS for each mark the edit touched (v2 message):
//
//   { v: 2, w: writerId, s: clientSeq, e: [ { k, p, o } | { k, d: 1 } ] }
//
// k = storage key, p = page, o = the mark as the sender's screen draws it
// (stored fields + eraser lanes applied), d: 1 = the mark is gone. It is keyed
// by the edit's WAL row (writer id + client_seq) exactly like a v1 preview.
//
// The receiver shows it as an OVERLAY on top of its own document: the mark is
// drawn as `o` (or hidden) until the row with that key is applied (the doc
// then holds the change), a later row from the same writer is applied, the
// overlay is 12 s old, or the channel closes. Nothing of it is ever written:
//   * every overlay object carries LIVE_EDIT_FLAG (a token naming the message
//     and mark), so any copy of it is recognised by the capture;
//   * an untouched overlay copy is replaced, for the capture, by the copy of
//     the mark the document last handed the screen (nothing is written);
//   * an edit the user made ON an overlay copy (dragged the moved mark, say)
//     is written as ONLY the user's own change, applied onto the document's
//     copy (mergeEditOntoCurrent), never the other screen's in-flight fields;
//   * a mark an overlay hides is put back for the capture, so hiding it can
//     never be captured as this screen deleting it.
//
// This module is pure (no Yjs, no network): parsing, the display merge and
// the capture translation. annotationDocSync.js owns the state.

import { mergeEditOntoCurrent } from '../utils/dragCommitMerge.js';

export const LIVE_EDIT_VERSION = 2;
export const LIVE_EDIT_FLAG = '__surveyLiveEdit';
// Mirrors annotationDocSync's LIVE_PREVIEW_FLAG (a new mark's preview).
export const LIVE_PREVIEW_FLAG = '__surveyLivePreview';
export const LIVE_EDIT_MAX_ENTRIES = 64;
// The JSON of one message's marks. A pen stroke is ~5-15 KB, a partly
// erased one ~20-40 KB (outline polygons). Bigger edits ride the WAL only.
export const LIVE_EDIT_MAX_JSON_BYTES = 96 * 1024;
export const LIVE_EDIT_EXPIRE_MS = 12_000;

const MAX_KEY_LENGTH = 512;
const MAX_PAGE = 100_000;

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function markIdOf(object) {
  if (!object || typeof object !== 'object') return null;
  const id = (object.data && typeof object.data === 'object' ? object.data.id : undefined)
    ?? object.id ?? object.annotationId ?? object.pdfAnnotationId;
  return (typeof id === 'string' && id) || (typeof id === 'number' ? String(id) : null);
}

// The object without the live flags (a sender never re-broadcasts another
// screen's overlay marker; a paste or capture never keeps one).
export function withoutLiveFlags(object) {
  if (!object || typeof object !== 'object') return object;
  if (!(LIVE_EDIT_FLAG in object) && !(LIVE_PREVIEW_FLAG in object)) return object;
  const { [LIVE_EDIT_FLAG]: _edit, [LIVE_PREVIEW_FLAG]: _preview, ...rest } = object;
  return rest;
}

/**
 * Sender: the message entries for the marks an edit touched.
 * `materialized` is Map<key, { page, object } | null> (materializeAnnotationKeys).
 * Returns null when there is nothing to send or it is too big to be worth it.
 */
export function buildLiveEditEntries(materialized, { maxJsonBytes = LIVE_EDIT_MAX_JSON_BYTES } = {}) {
  if (!materialized || materialized.size === 0 || materialized.size > LIVE_EDIT_MAX_ENTRIES) return null;
  const entries = [];
  for (const [key, value] of materialized) {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
    if (!value) {
      entries.push({ k: key, d: 1 });
      continue;
    }
    const page = Number(value.page);
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return null;
    // A mark whose screen copy is another screen's in-flight preview/overlay
    // never reaches this point (the capture strips those), but never
    // forward the markers anyway.
    entries.push({ k: key, p: page, o: withoutLiveFlags(value.object) });
  }
  let bytes = 0;
  try {
    bytes = JSON.stringify(entries).length;
  } catch {
    return null;
  }
  if (bytes > maxJsonBytes) return null;
  return { entries, bytes };
}

/**
 * Receiver: a v2 message, validated. null when malformed or not for us.
 * Returns { writerId, clientSeq, entries: Map<key, { page, object } | null> }.
 */
export function parseLiveEditPayload(payload, { ownWriterId = null } = {}) {
  if (!isPlainObject(payload) || payload.v !== LIVE_EDIT_VERSION) return null;
  const writerId = typeof payload.w === 'string' ? payload.w : '';
  const clientSeq = Number(payload.s);
  if (!writerId || writerId.length > 256 || writerId === ownWriterId) return null;
  if (!Number.isSafeInteger(clientSeq) || clientSeq <= 0) return null;
  if (!Array.isArray(payload.e) || payload.e.length === 0 || payload.e.length > LIVE_EDIT_MAX_ENTRIES) return null;
  const entries = new Map();
  for (const entry of payload.e) {
    if (!isPlainObject(entry)) return null;
    const key = entry.k;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
    if (entries.has(key)) return null;
    if (entry.d === 1) {
      entries.set(key, null);
      continue;
    }
    const page = Number(entry.p);
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return null;
    if (!isPlainObject(entry.o)) return null;
    // The mark's own id must be its key (identity is the map key).
    if (markIdOf(entry.o) !== key) return null;
    entries.set(key, { page, object: withoutLiveFlags(entry.o) });
  }
  return { writerId, clientSeq, entries };
}

export function liveEditToken(writerId, clientSeq, key) {
  return `${writerId}\u0000${clientSeq}\u0000${key}`;
}

/**
 * The screen: `byPage` (read from the document) with other screens'
 * in-flight new marks (`previewsByPage`, w30) added and in-flight edits
 * (`edits`: Map<key, { page, object } | null>, newest per mark) applied.
 * `docPageOf(key)` = the page the document keeps the mark on (null if the
 * document does not hold it). Same byPage back when there is nothing to do.
 */
export function mergeLiveOverlays(byPage, { previewsByPage = null, edits = null, docPageOf = () => null } = {}) {
  const hasPreviews = previewsByPage && Object.keys(previewsByPage).length > 0;
  const hasEdits = edits && edits.size > 0;
  if (!hasPreviews && !hasEdits) return byPage;
  const next = { ...(byPage || {}) };
  const copied = new Set();
  const pageObjects = (pageNumber) => {
    const key = String(pageNumber);
    if (!copied.has(key)) {
      const page = next[key] || { objects: [] };
      next[key] = { ...page, objects: [...(page.objects || [])] };
      copied.add(key);
    }
    return next[key].objects;
  };
  const placed = new Set();
  if (hasEdits) {
    for (const [key, overlay] of edits) {
      const docPage = docPageOf(key);
      if (docPage == null) continue;
      const objects = next[String(docPage)]?.objects;
      const index = Array.isArray(objects) ? objects.findIndex((object) => markIdOf(object) === key) : -1;
      if (index < 0) continue;
      placed.add(key);
      const list = pageObjects(docPage);
      const current = list[index];
      if (!overlay) {
        list.splice(index, 1);
      } else if (String(overlay.page) === String(docPage)) {
        list[index] = keepCounterNumbers(overlay.object, current);
      } else {
        list.splice(index, 1);
        pageObjects(overlay.page).push(keepCounterNumbers(overlay.object, current));
      }
    }
  }
  if (hasPreviews) {
    for (const [pageNumber, objects] of Object.entries(previewsByPage)) {
      const present = new Set((next[pageNumber]?.objects || []).map(markIdOf).filter((id) => id != null));
      const added = [];
      for (const object of objects || []) {
        const id = markIdOf(object);
        if (id != null && present.has(id)) continue;
        if (id != null && hasEdits && edits.has(id)) {
          // An edit of a mark that is itself still a preview.
          placed.add(id);
          const overlay = edits.get(id);
          if (!overlay) continue;
          if (String(overlay.page) === String(pageNumber)) added.push(overlay.object);
          else pageObjects(overlay.page).push(overlay.object);
          continue;
        }
        added.push(object);
      }
      if (added.length > 0) pageObjects(pageNumber).push(...added);
    }
  }
  if (hasEdits) {
    // An edit overlay of a mark this screen does not hold at all (its row and
    // preview are both still on the way): shown as the sender draws it.
    for (const [key, overlay] of edits) {
      if (placed.has(key) || !overlay) continue;
      if (docPageOf(key) != null) continue; // held, but filtered off this list
      const list = pageObjects(overlay.page);
      if (list.some((object) => markIdOf(object) === key)) continue;
      list.push(overlay.object);
    }
  }
  return next;
}

// A counter's number depends on its whole series; the sender computes the
// mark alone. Keep the number this screen shows until the row lands.
function keepCounterNumbers(overlayObject, current) {
  if (overlayObject?.data?.type !== 'counter' || current?.data?.type !== 'counter') return overlayObject;
  const { displayNumber, seriesStart } = current.data;
  if (overlayObject.data.displayNumber === displayNumber && overlayObject.data.seriesStart === seriesStart) {
    return overlayObject;
  }
  return { ...overlayObject, data: { ...overlayObject.data, displayNumber, seriesStart } };
}

/**
 * Capture: take other screens' in-flight edits back out of a page list the
 * screen hands to the store, so none of them is ever written.
 *
 *   resolveToken(token) → { key, object } | null  the overlay object handed out
 *   deliveredOf(key)    → the document's copy last handed to the screen, or
 *                         null when the document does not hold the mark
 *   docPageOf(key)      → page the document keeps it on
 *   hiddenKeys          → marks an active overlay hides (deleted elsewhere)
 *   translate           → false for an eraser gesture: a survivor built on an
 *                         overlay copy is another screen's geometry erased,
 *                         so it is not applied at all (the mark stays as the
 *                         document holds it); noTranslateKeys does the same
 *                         for some marks only
 *
 * Returns { byPage, swaps, editedKeys }: byPage for the capture (same object
 * when nothing changed); swaps = screen corrections { pageKey, from, to,
 * toPage, key } (an edit made on an overlay is shown as saved: the user's
 * change on the document's copy); editedKeys = marks the user changed.
 */
export function stripLiveEditObjects(byPage, {
  resolveToken,
  deliveredOf,
  docPageOf,
  hiddenKeys = null,
  swaps = null,
  translate = true,
  noTranslateKeys = null,
}) {
  if (!byPage || typeof byPage !== 'object') return { byPage, editedKeys: [] };
  const hidden = hiddenKeys && hiddenKeys.size > 0 ? hiddenKeys : null;
  let changed = false;
  const next = {};
  const moved = []; // [targetPage, object] substitutes that belong on another page
  const present = new Set();
  const editedKeys = [];
  for (const [pageNumber, page] of Object.entries(byPage)) {
    const objects = Array.isArray(page?.objects) ? page.objects : null;
    if (!objects) {
      next[pageNumber] = page;
      continue;
    }
    let pageChanged = false;
    const kept = [];
    for (const object of objects) {
      const token = object && typeof object === 'object' ? object[LIVE_EDIT_FLAG] : undefined;
      if (typeof token !== 'string') {
        const id = markIdOf(object);
        if (id != null) present.add(id);
        kept.push(object);
        continue;
      }
      pageChanged = true;
      const record = resolveToken(token);
      const key = record?.key ?? markIdOf(object);
      const delivered = key != null ? deliveredOf(key) : null;
      if (!delivered) {
        // The document does not hold it (an in-flight mark, or deleted since):
        // never written. An edit made on it is taken off the screen; the
        // untouched overlay copy stays on screen until its row decides.
        if (swaps && record && object !== record.object) {
          swaps.push({ pageKey: pageNumber, from: object, to: null, toPage: pageNumber, key });
        }
        continue;
      }
      present.add(key);
      let substitute = delivered;
      const mayTranslate = translate && !(noTranslateKeys && noTranslateKeys.has(key));
      if (record && object !== record.object && !mayTranslate) {
        // Not applied: the screen goes back to the document's copy.
        if (swaps) swaps.push({ pageKey: pageNumber, from: object, to: delivered, toPage: String(docPageOf(key) ?? pageNumber), key });
      } else if (record && object !== record.object) {
        // The user changed the overlay copy: only THEIR change is written,
        // onto the document's copy.
        const merged = mergeEditOntoCurrent(delivered, withoutLiveFlags(record.object), withoutLiveFlags(object));
        if (merged && merged !== delivered) {
          substitute = merged;
          editedKeys.push(key);
          if (swaps) swaps.push({ pageKey: pageNumber, from: object, to: merged, toPage: String(docPageOf(key) ?? pageNumber), key });
        }
      }
      const targetPage = docPageOf(key);
      if (targetPage != null && String(targetPage) !== String(pageNumber)) moved.push([String(targetPage), substitute]);
      else kept.push(substitute);
    }
    if (pageChanged) changed = true;
    next[pageNumber] = pageChanged ? { ...page, objects: kept } : page;
  }
  if (hidden) {
    for (const key of hidden) {
      if (present.has(key)) continue;
      const delivered = deliveredOf(key);
      const targetPage = docPageOf(key);
      if (!delivered || targetPage == null) continue;
      moved.push([String(targetPage), delivered]);
      present.add(key);
    }
  }
  for (const [pageNumber, object] of moved) {
    const page = next[pageNumber] || { objects: [] };
    next[pageNumber] = { ...page, objects: [...(page.objects || []), object] };
    changed = true;
  }
  return { byPage: changed ? next : byPage, editedKeys };
}

// Anything (an erase intent, a history entry) that carries an overlay copy.
export function carriesLiveEditFlag(value) {
  const stack = [value];
  let visited = 0;
  while (stack.length > 0 && visited < 200_000) {
    const node = stack.pop();
    visited += 1;
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const item of node) if (item && typeof item === 'object') stack.push(item);
      continue;
    }
    if (typeof node[LIVE_EDIT_FLAG] === 'string') return true;
    for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push(child);
  }
  return false;
}
