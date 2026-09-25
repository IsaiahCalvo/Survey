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
// The JSON of one message's marks. Only the fields that changed are sent
// when the sender knows the mark's previous look (a recolour is ~100 B, a
// delete ~40 B); a partly erased pen stroke carries its new outline
// (~5-30 KB). Bigger edits ride the WAL only (w34 review: keep it compact).
export const LIVE_EDIT_MAX_JSON_BYTES = 32 * 1024;
const MAX_PATCH_FIELDS = 200;
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
 * `baseOf(key)` = the mark as other screens most likely show it now (the
 * sender's copy before this edit): then only the top-level fields that
 * differ are sent, `{ k, p, s: { field: value }, u: [removed field] }`,
 * when that is smaller than the whole mark `{ k, p, o }`.
 * Returns null when there is nothing to send or it is too big to be worth it.
 */
export function buildLiveEditEntries(materialized, { maxJsonBytes = LIVE_EDIT_MAX_JSON_BYTES, baseOf = null } = {}) {
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
    const object = withoutLiveFlags(value.object);
    const base = typeof baseOf === 'function' ? withoutLiveFlags(baseOf(key)) : null;
    const patch = base && typeof base === 'object' ? topLevelPatch(base, object) : null;
    if (patch && patch.bytes < jsonLength(object)) {
      entries.push({ k: key, p: page, s: patch.set, ...(patch.unset.length ? { u: patch.unset } : {}) });
    } else {
      entries.push({ k: key, p: page, o: object });
    }
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

function jsonLength(value) {
  try { return JSON.stringify(value)?.length || 0; } catch { return Infinity; }
}

// Top-level fields of `next` that differ from `base` (by JSON value).
function topLevelPatch(base, next) {
  const set = {};
  const unset = [];
  for (const [field, value] of Object.entries(next)) {
    if (!Object.prototype.hasOwnProperty.call(base, field) || jsonLength(base[field]) !== jsonLength(value)
      || JSON.stringify(base[field]) !== JSON.stringify(value)) {
      set[field] = value;
    }
  }
  for (const field of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) unset.push(field);
  }
  if (Object.keys(set).length + unset.length > MAX_PATCH_FIELDS) return null;
  return { set, unset, bytes: jsonLength(set) + jsonLength(unset) };
}

/**
 * Receiver: a patch entry applied onto the mark as this screen shows it.
 * null when there is nothing to apply it to, or the result is not that mark.
 */
export function applyLiveEditPatch(base, patch, key) {
  if (!base || typeof base !== 'object' || !patch) return null;
  const next = { ...withoutLiveFlags(base), ...withoutLiveFlags(patch.set) };
  for (const field of patch.unset || []) delete next[field];
  return markIdOf(next) === key ? next : null;
}

/**
 * Receiver: a v2 message, validated. null when malformed or not for us.
 * Returns { writerId, clientSeq, entries: Map<key, { page, object } |
 * { page, patch: { set, unset } } | null> } (a patch still needs a base:
 * applyLiveEditPatch).
 */
export function parseLiveEditPayload(payload, { ownWriterId = null } = {}) {
  if (!isPlainObject(payload) || payload.v !== LIVE_EDIT_VERSION) return null;
  const writerId = typeof payload.w === 'string' ? payload.w : '';
  const clientSeq = Number(payload.s);
  if (!writerId || writerId.length > 256 || writerId === ownWriterId) return null;
  if (!Number.isSafeInteger(clientSeq) || clientSeq <= 0) return null;
  if (!Array.isArray(payload.e) || payload.e.length === 0 || payload.e.length > LIVE_EDIT_MAX_ENTRIES) return null;
  // Receivers enforce the size too (a forged sender is not bound by ours).
  if (jsonLength(payload.e) > LIVE_EDIT_MAX_JSON_BYTES * 2) return null;
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
    if (entry.o === undefined && isPlainObject(entry.s)) {
      const unset = entry.u === undefined ? [] : entry.u;
      if (!Array.isArray(unset) || unset.length > MAX_PATCH_FIELDS) return null;
      if (!unset.every((field) => typeof field === 'string' && field.length > 0 && field.length <= 128)) return null;
      if (Object.keys(entry.s).length > MAX_PATCH_FIELDS) return null;
      // Identity can never be changed by a patch.
      if (unset.includes('data') || unset.includes('id')) return null;
      if ('id' in entry.s || ('data' in entry.s && markIdOf({ data: entry.s.data }) !== key)) return null;
      entries.set(key, { page, patch: { set: withoutLiveFlags(entry.s), unset } });
      continue;
    }
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
  // An edit of a mark this screen does not hold at all (deleted here
  // meanwhile, or its row and preview both still on the way) is NOT shown:
  // it would bring a deleted mark back until the row decides (review B).
  return next;
}

// A counter's number depends on its whole series; the sender computes the
// mark alone. Keep the number this screen shows until the row lands. The
// adjusted copy is remembered (same object every render) and counts as the
// untouched overlay for the capture (review A).
const DERIVED_FROM = new WeakMap(); // adjusted copy -> overlay object
const COUNTER_COPIES = new WeakMap(); // overlay object -> { displayNumber, seriesStart, copy }
function keepCounterNumbers(overlayObject, current) {
  if (overlayObject?.data?.type !== 'counter' || current?.data?.type !== 'counter') return overlayObject;
  const { displayNumber, seriesStart } = current.data;
  if (overlayObject.data.displayNumber === displayNumber && overlayObject.data.seriesStart === seriesStart) {
    return overlayObject;
  }
  const cached = COUNTER_COPIES.get(overlayObject);
  if (cached && cached.displayNumber === displayNumber && cached.seriesStart === seriesStart) return cached.copy;
  const copy = { ...overlayObject, data: { ...overlayObject.data, displayNumber, seriesStart } };
  COUNTER_COPIES.set(overlayObject, { displayNumber, seriesStart, copy });
  DERIVED_FROM.set(copy, overlayObject);
  return copy;
}

const fieldJson = (value) => {
  try { return JSON.stringify(value) ?? 'undefined'; } catch { return String(Math.random()); }
};

// Would writing `merged` over `delivered` write a field the OTHER screen's
// in-flight edit changed (overlay vs delivered)? Then the user's edit was
// made on top of that screen's unsaved geometry or style, and saving it
// would save their unsaved part too (review A: a partly erased stroke moved
// on another screen baked the erase into the mark). Such an edit is not
// applied.
function writesInFlightFields(delivered, overlay, merged) {
  for (const field of new Set([...Object.keys(merged), ...Object.keys(delivered)])) {
    if (field === LIVE_EDIT_FLAG || field === LIVE_PREVIEW_FLAG) continue;
    const saved = fieldJson(delivered[field]);
    if (fieldJson(merged[field]) === saved) continue;
    if (fieldJson(overlay[field]) !== saved) return true;
  }
  return false;
}

/**
 * Capture: take other screens' in-flight edits back out of a page list the
 * screen hands to the store, so none of them is ever written.
 *
 *   resolveToken(token) → { key, object, page } | null  the overlay handed out
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
      const ownId = markIdOf(object);
      if (record && ownId != null && ownId !== record.key) {
        // An overlay copy spread into a DIFFERENT mark: that mark is the
        // user's own; the flag only rode along (review A).
        present.add(ownId);
        kept.push(withoutLiveFlags(object));
        continue;
      }
      const key = record?.key ?? ownId;
      const untouched = Boolean(record)
        && (object === record.object || DERIVED_FROM.get(object) === record.object);
      const delivered = key != null ? deliveredOf(key) : null;
      if (!delivered) {
        // The document does not hold it. The overlay copy itself is never
        // written. Any other copy (an Undo bringing back a mark the user
        // deleted while an overlay showed it) is an ordinary object: the
        // capture's own rules decide (a mark deleted by someone else stays
        // deleted), without the flag (review A).
        if (untouched || key == null) continue;
        present.add(key);
        kept.push(withoutLiveFlags(object));
        continue;
      }
      present.add(key);
      let substitute = delivered;
      const mayTranslate = translate && !(noTranslateKeys && noTranslateKeys.has(key));
      const docPage = docPageOf(key);
      const back = (to) => {
        if (swaps) swaps.push({ pageKey: pageNumber, from: object, to, toPage: String(docPage ?? pageNumber), key });
      };
      if (record && !untouched) {
        if (!mayTranslate) {
          back(delivered); // not applied: the screen goes back to the document's copy
        } else {
          // The user changed the overlay copy: only THEIR change is written,
          // onto the document's copy — unless it touches what the other
          // screen is changing (then it is not applied).
          const overlay = withoutLiveFlags(record.object);
          const merged = mergeEditOntoCurrent(delivered, overlay, withoutLiveFlags(object));
          if (merged && merged !== delivered) {
            if (writesInFlightFields(delivered, overlay, merged)) {
              back(delivered);
            } else {
              substitute = merged;
              editedKeys.push(key);
              back(merged);
            }
          }
        }
      }
      // Where the substitute goes: the document's page when the copy sits
      // where the overlay put it (another screen moved it across pages);
      // otherwise where this screen has it (a page was inserted, deleted or
      // moved here meanwhile: review A).
      const onOverlayPage = record?.page != null && String(record.page) === String(pageNumber);
      const targetPage = onOverlayPage && docPage != null ? docPage : pageNumber;
      if (String(targetPage) !== String(pageNumber)) moved.push([String(targetPage), substitute]);
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
