/**
 * smartFillTemplateShapes.js — where Smart fill finds the tag shapes the user
 * taught it (owner 2026-10-22, beta).
 *
 * Taught shapes live in the open survey template (template.smartFillShapes),
 * so a company's template carries them to everyone who uses it, on any
 * drawing. PDFViewer publishes the open template's shapes and a save function
 * here; the Smart fill provider and the page layer read them without the page
 * layers carrying the template. With no template open (or none that can be
 * saved), shapes are kept in this browser instead.
 *
 * Teaching new shapes is on hold (owner 2026-10-27): the viewer no longer
 * offers Teach a tag shape, the shapes menu or Find more. Shapes already
 * saved still help a tap, and the template editor still lists and removes
 * them. `save` takes an updater (list -> list), one template write.
 */
import { useSyncExternalStore } from 'react';
import { isTemplateShape, MAX_TEMPLATE_SHAPES } from './smartFillTemplates.js';

const LOCAL_KEY = 'smartFill:templateShapes:v1';
export const SMART_FILL_SHAPES_CHANGED_EVENT = 'smart-fill-template-shapes-changed';

let active = { templateId: null, templateName: '', shapes: [], save: null };

function emit() {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(SMART_FILL_SHAPES_CHANGED_EVENT)); } catch { /* no window events */ }
}

function loadLocal() {
  try {
    const list = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(list) ? list.filter(isTemplateShape) : [];
  } catch {
    return [];
  }
}

/**
 * PDFViewer: the open survey template's shapes and how to change them.
 * `save(update)` stores `update(shapes)` and resolves once stored; null =
 * this template can't be saved.
 */
export function setActiveSmartFillTemplate({ templateId = null, templateName = '', shapes = [], save = null } = {}) {
  const clean = Array.isArray(shapes) ? shapes.filter(isTemplateShape) : [];
  const same = active.templateId === templateId && active.save === save
    && active.shapes.length === clean.length && active.shapes.every((s, i) => s.id === clean[i].id && s.name === clean[i].name);
  active = { templateId, templateName, shapes: clean, save: typeof save === 'function' ? save : null };
  if (!same) emit();
}

/** Every taught shape Smart fill should use now: the template's, then this browser's. */
export function getSmartFillTemplateShapes() {
  const local = typeof window === 'undefined' ? [] : loadLocal();
  const ids = new Set(active.shapes.map((s) => s.id));
  return [...active.shapes, ...local.filter((s) => !ids.has(s.id))];
}

/** Name of the template a taught shape will be saved into, or '' for this browser. */
export function getSmartFillTemplateName() {
  return active.save ? active.templateName || 'this template' : '';
}

/**
 * Save a taught shape. Goes into the open template when it can be saved,
 * else into this browser. Resolves to { ok, where: 'template' | 'browser' }.
 */
export async function saveSmartFillTemplateShape(shape) {
  if (!isTemplateShape(shape)) return { ok: false, where: null };
  if (active.save) {
    try {
      await active.save((list) => withTemplateShape(list, shape));
      return { ok: true, where: 'template' };
    } catch {
      // Fall through: keep it in this browser so the teaching isn't lost.
    }
  }
  try {
    const next = [shape, ...loadLocal().filter((s) => s.id !== shape.id)].slice(0, MAX_TEMPLATE_SHAPES);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    emit();
    return { ok: true, where: 'browser' };
  } catch {
    return { ok: false, where: null };
  }
}

/** A template's shape list with `shape` added (newest first, capped). */
export function withTemplateShape(list, shape) {
  const current = Array.isArray(list) ? list.filter(isTemplateShape) : [];
  return [shape, ...current.filter((s) => s.id !== shape.id)].slice(0, MAX_TEMPLATE_SHAPES);
}

/** Every taught shape with where it is kept ('template' | 'browser'). */
export function listSmartFillShapes() {
  const ids = new Set(active.shapes.map((s) => s.id));
  const local = typeof window === 'undefined' ? [] : loadLocal();
  return [
    ...active.shapes.map((shape) => ({ shape, where: 'template' })),
    ...local.filter((s) => !ids.has(s.id)).map((shape) => ({ shape, where: 'browser' })),
  ];
}

let listCache = { key: null, list: [] };
function listSnapshot() {
  const list = listSmartFillShapes();
  const key = list.map(({ shape, where }) => `${where}:${shape.id}:${shape.name}`).join('|');
  if (key !== listCache.key) listCache = { key, list };
  return listCache.list;
}
function subscribeShapes(listener) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SMART_FILL_SHAPES_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SMART_FILL_SHAPES_CHANGED_EVENT, listener);
}
const EMPTY = [];
/** React: the shape list, kept current. */
export function useSmartFillShapes() {
  return useSyncExternalStore(subscribeShapes, listSnapshot, () => EMPTY);
}

/** Change the list a shape is kept in. Resolves to 'template' | 'browser', or null. */
async function changeShapes(id, update) {
  if (active.save && active.shapes.some((s) => s.id === id)) {
    try {
      await active.save((list) => update(Array.isArray(list) ? list.filter(isTemplateShape) : []));
      return 'template';
    } catch {
      return null;
    }
  }
  try {
    const local = loadLocal();
    if (!local.some((s) => s.id === id)) return null;
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(update(local)));
    emit();
    return 'browser';
  } catch {
    return null;
  }
}

/** Rename a taught shape. Resolves true once stored. */
export function renameSmartFillShape(id, name) {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return Promise.resolve(false);
  return changeShapes(id, (list) => list.map((s) => (s.id === id ? { ...s, name: clean } : s))).then(Boolean);
}

/**
 * Remove a taught shape. Resolves to { ok, undo } where undo() puts it back
 * where it was kept: this browser, or the same template. If that template is
 * no longer the open one (or can't be saved), undo() resolves false rather
 * than hand the shape to a different template's users.
 */
export async function removeSmartFillShape(id) {
  let removed = null;
  let at = -1;
  const templateId = active.templateId;
  const where = await changeShapes(id, (list) => {
    at = list.findIndex((s) => s.id === id);
    removed = at >= 0 ? list[at] : null;
    return list.filter((s) => s.id !== id);
  });
  if (!where || !removed) return { ok: false, undo: null };
  const shape = removed;
  const index = at;
  const undo = async () => {
    const putBack = (list) => {
      const rest = (Array.isArray(list) ? list.filter(isTemplateShape) : []).filter((s) => s.id !== shape.id);
      return [...rest.slice(0, index), shape, ...rest.slice(index)].slice(0, MAX_TEMPLATE_SHAPES);
    };
    if (where === 'template') {
      if (!active.save || active.templateId !== templateId) return false;
      try { await active.save(putBack); return true; } catch { return false; }
    }
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(putBack(loadLocal())));
      emit();
      return true;
    } catch {
      return false;
    }
  };
  return { ok: true, undo };
}

// --- "Teach a tag shape" (the box tool) -------------------------------------
// Armed from the tool bar; the next drag on a page boxes a tag to teach. With
// a preset (a picked outline: 'circle', 'hexagon', ...) the box sizes that
// outline instead of reading one from the drawing.
let teachArmed = false;
let teachPreset = null;
const teachListeners = new Set();

export function getSmartFillTeachArmed() {
  return teachArmed;
}

export function getSmartFillTeachPreset() {
  return teachArmed ? teachPreset : null;
}

export function setSmartFillTeachArmed(armed, { preset = null } = {}) {
  const next = Boolean(armed);
  const nextPreset = next ? preset || null : null;
  if (next === teachArmed && nextPreset === teachPreset) return;
  teachArmed = next;
  teachPreset = nextPreset;
  for (const listener of [...teachListeners]) {
    try { listener(); } catch { /* a listener's failure is its own */ }
  }
}

function subscribeTeach(listener) {
  teachListeners.add(listener);
  return () => teachListeners.delete(listener);
}

export function useSmartFillTeachArmed() {
  return useSyncExternalStore(subscribeTeach, getSmartFillTeachArmed, getSmartFillTeachArmed);
}

/** Test-only. */
export function resetSmartFillTemplateShapesForTests() {
  active = { templateId: null, templateName: '', shapes: [], save: null };
  teachArmed = false;
  teachPreset = null;
  listCache = { key: null, list: [] };
}
