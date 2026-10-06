// What the tool bar loads when marks are picked (owner Test 45, 2026-10-06:
// "Whatever annotation you click on, the formatting of the toolbar needs to
// reflect that constantly, whether you're changing it or just clicking to see
// how it's set").
//
// The bar's Width / Style / bump size / arrowhead / colour-picker values are
// viewer state. They used to be loaded by three separate effects - one per
// picked shape, one per picked callout, one per multi-pick group - each keyed
// on its own object's identity. Switching the pick from a shape to a callout
// (or back) passes through ONE render in which the old pick and the new pick
// are both held, so the group effect saw a two-mark "group" and loaded the OLD
// mark's values after the callout's own loader had run; once the old pick
// cleared, nothing reloaded (the callout had not changed). Result: a solid
// callout picked after a cloud rectangle read "Cloud, 2.5 pt".
//
// One resolver now answers "what does the bar show for the pick as it is
// now", and the viewer loads it whenever that answer changes - so whatever
// transient state a pick switch passes through, the settled pick always wins.

import { colorToHex, colorToOpacity, readCalloutRestyleStyle, readRestyleStyle } from './selectionRestyle.js';
import { isCounterMark } from './markToolGroup.js';

const EMPTY = Object.freeze({
  strokeColor: null,
  strokeOpacity: null,
  fillColor: null,
  fillOpacity: null,
  width: null,
  lineStyle: null,
  cloudIntensity: null,
  arrowheadStyle: null,
  arrowBothEnds: null,
});

const visible = (paint) => !!paint && paint !== 'transparent' && paint !== 'none';

/**
 * A counter's bar values: its pin colour is the fill, its number colour the
 * "stroke", its size the radius (the counter's own bar - not a restyle field).
 */
export function readCounterBarValues(annotation) {
  const fill = annotation?.fill || annotation?.data?.color || null;
  const number = annotation?.data?.numberColor || null;
  const radius = Number(annotation?.radius);
  return {
    ...EMPTY,
    strokeColor: visible(number) ? colorToHex(number) : null,
    strokeOpacity: visible(number) ? colorToOpacity(number) : null,
    fillColor: visible(fill) ? colorToHex(fill) : null,
    fillOpacity: visible(fill) ? colorToOpacity(fill) : 0,
    width: Number.isFinite(radius) && radius > 0 ? radius : null,
  };
}

/** The bar values of ONE picked page mark (null fields = the mark has no such setting). */
export function readPickedMarkBarValues(annotation) {
  if (!annotation || typeof annotation !== 'object') return { ...EMPTY };
  if (isCounterMark(annotation)) return readCounterBarValues(annotation);
  const style = readRestyleStyle(annotation);
  return { ...EMPTY, ...style, arrowBothEnds: style.arrowBothEnds ?? null };
}

/**
 * What the bar loads for the pick as it is NOW, or null when the bar is not
 * working for a pick (pickBarTool !== 'select': the armed tool's settings).
 * Precedence: a multi-pick group (its summary), else the one picked or typed-in
 * callout, else the one picked page mark. `key` changes whenever the pick or
 * any of its values changes, so a pick switch always ends on a load of the
 * settled pick.
 *
 * @param {{ pickBarTool: string, group?: { key: string, summary: { values: object } }|null,
 *   callout?: { id: string, callout: object }|null, annotation?: object|null, annotationKey?: string }} input
 * @returns {{ key: string, values: object }|null}
 */
export function resolvePickBarValues({
  pickBarTool,
  group = null,
  callout = null,
  annotation = null,
  annotationKey = '',
} = {}) {
  if (pickBarTool !== 'select') return null;
  let key;
  let values;
  if (group?.summary?.values) {
    key = `group:${group.key || ''}`;
    values = { ...EMPTY, ...group.summary.values };
  } else if (callout?.callout) {
    key = `callout:${callout.id || ''}`;
    values = { ...EMPTY, ...readCalloutRestyleStyle(callout.callout), arrowBothEnds: null };
  } else if (annotation) {
    key = `mark:${annotationKey}`;
    values = readPickedMarkBarValues(annotation);
  } else {
    return null;
  }
  return { key: `${key}|${JSON.stringify(values)}`, values };
}
