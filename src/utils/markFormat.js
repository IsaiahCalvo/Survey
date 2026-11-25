/**
 * Copy format / Paste format on the mark menu (Nightly 'copy-format',
 * KAL-718). Drawboard's More menu has Copy Format and Paste Format: one mark's
 * look - line colour and opacity, fill colour and opacity, line width, line
 * style (cloud too) and arrow heads - put on other marks.
 *
 * Copying reads the bar's own style (selectionRestyle readRestyleStyle /
 * readCalloutRestyleStyle); pasting replays it as the bar's own changes
 * (applyRestyleChange / calloutRestylePatch), so each mark takes only what it
 * has, exactly as when the same values are picked on the bar.
 */

import {
  applyRestyleChange,
  calloutRestylePatch,
  readCalloutRestyleStyle,
  readRestyleStyle,
} from './selectionRestyle.js';

const FIELDS = ['strokeColor', 'strokeOpacity', 'fillColor', 'fillOpacity', 'width', 'lineStyle', 'cloudIntensity', 'arrowheadStyle', 'arrowBothEnds'];

const legacyCalloutOf = (object) => (object?.data?.type === 'callout'
  ? (object.data.legacyCallout || null)
  : null);

// A shape with its line switched off still has a look (its fill, its 0% line).
const hasLook = (style) => Boolean(style) && Object.values(style).some((value) => value != null);

/**
 * The format to keep for a page object (a mark, or a callout's page object),
 * or null when it has no look to copy (a highlight, a count pin, an image).
 */
export function copyMarkFormat(object) {
  if (!object || typeof object !== 'object') return null;
  if (object.data?.type === 'text-markup') return null;
  const callout = legacyCalloutOf(object);
  const style = callout ? readCalloutRestyleStyle(callout) : readRestyleStyle(object);
  if (!hasLook(style)) return null;
  const format = {};
  FIELDS.forEach((key) => {
    if (style[key] != null) format[key] = style[key];
  });
  return Object.freeze(format);
}

/** Whether a page object has a look Copy format can keep. */
export function canCopyMarkFormat(object) {
  return copyMarkFormat(object) != null;
}

/**
 * The bar changes that put `format` on a mark, in the order the bar would
 * make them (a colour before its opacity, so a 0% line stays off).
 */
export function markFormatChanges(format) {
  if (!format) return [];
  const changes = [];
  if (format.strokeColor) changes.push({ kind: 'strokeColor', color: format.strokeColor });
  if (format.strokeOpacity != null) changes.push({ kind: 'strokeOpacity', opacity: format.strokeOpacity });
  if (format.fillColor) changes.push({ kind: 'fillColor', color: format.fillColor });
  if (format.fillOpacity != null) changes.push({ kind: 'fillOpacity', opacity: format.fillOpacity });
  if (format.width != null) changes.push({ kind: 'width', width: format.width });
  if (format.lineStyle) {
    changes.push(format.lineStyle === 'cloud'
      ? { kind: 'lineStyle', style: 'cloud', cloudIntensity: format.cloudIntensity || 2 }
      : { kind: 'lineStyle', style: format.lineStyle });
  }
  if (format.arrowheadStyle) {
    const both = format.arrowBothEnds === true;
    changes.push({ kind: 'arrowhead', style: format.arrowheadStyle, bothEnds: both });
    changes.push({ kind: 'arrowBothEnds', on: both });
  }
  return changes;
}

/** The mark with `format` on it, or null when nothing changed. */
export function applyMarkFormat(annotation, format) {
  let current = annotation;
  let changed = false;
  markFormatChanges(format).forEach((change) => {
    const next = applyRestyleChange(current, change);
    if (next) { current = next; changed = true; }
  });
  return changed ? current : null;
}

/** One callout.style patch carrying `format`, or null when nothing changed. */
export function markFormatCalloutPatch(callout, format) {
  if (!callout) return null;
  let working = callout;
  let patch = null;
  markFormatChanges(format).forEach((change) => {
    const step = calloutRestylePatch(working, change);
    if (!step) return;
    patch = { ...(patch || {}), ...step };
    working = { ...working, style: { ...(working.style || {}), ...step } };
  });
  return patch;
}

/**
 * The page with `format` on each member ([{ index }]) that `mayChange`
 * allows, or null when no mark changed.
 */
export function applyMarkFormatToPage(pageJSON, members, format, mayChange = () => true) {
  if (!pageJSON || !Array.isArray(pageJSON.objects) || !Array.isArray(members) || !format) return null;
  let objects = null;
  members.forEach(({ index }) => {
    const current = (objects || pageJSON.objects)[index];
    if (!current || !mayChange(current)) return;
    const next = applyMarkFormat(current, format);
    if (!next) return;
    if (!objects) objects = pageJSON.objects.slice();
    objects[index] = next;
  });
  return objects ? { ...pageJSON, objects } : null;
}
