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
 * PDFViewer: the open survey template's shapes and how to save one into it.
 * `save(shape)` resolves once stored; null = this template can't be saved.
 */
export function setActiveSmartFillTemplate({ templateId = null, templateName = '', shapes = [], save = null } = {}) {
  const clean = Array.isArray(shapes) ? shapes.filter(isTemplateShape) : [];
  const same = active.templateId === templateId && active.save === save
    && active.shapes.length === clean.length && active.shapes.every((s, i) => s.id === clean[i].id);
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
      await active.save(shape);
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

// --- "Teach a tag shape" (the box tool) -------------------------------------
// Armed from the tool bar; the next drag on a page boxes a tag to teach.
let teachArmed = false;
const teachListeners = new Set();

export function getSmartFillTeachArmed() {
  return teachArmed;
}

export function setSmartFillTeachArmed(armed) {
  const next = Boolean(armed);
  if (next === teachArmed) return;
  teachArmed = next;
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
}
