/**
 * autoSelectAfterCommit.js — who gets picked the instant they are drawn.
 *
 * Intended UX (2026-09-16, Drawboard PDF contract, measured the same day):
 * finish dragging out a shape and the new mark is ALREADY selected — its
 * handles are showing — while the tool stays armed. So the very next drag on
 * empty page draws another one, and a drag that starts on a handle resizes the
 * one just drawn. Before this, Survey left the new mark unselected and the user
 * had to switch to Select and click it before they could nudge or resize it.
 *
 * Free-form ink is the deliberate exception. Drawboard leaves a pen or
 * highlighter stroke unselected, and it is right to: you draw ink in runs, and
 * handles popping up around every stroke would sit in the way of the next one.
 *
 * Text and callout are not on this list because they do something stronger
 * already — both drop straight into their text editor on creation, which is
 * Drawboard's behaviour for them too. Selecting them as well would fight the
 * caret.
 *
 * Survey markers are not on this list either: they are not annotation objects,
 * they live in the survey module's own store with its own selection.
 */

// Every tool whose committed mark is selected the moment it lands.
// Cloud variants are a border style on rect / ellipse / polygon / polyline, not
// separate tools, so they are covered by the entries already here.
export const AUTO_SELECT_AFTER_COMMIT_TOOLS = Object.freeze([
  'rect',
  'ellipse',
  'line',
  'arrow',
  'polygon',
  'polyline',
  'counter',
]);

// Tools whose marks are deliberately left unselected after they commit.
export const NO_AUTO_SELECT_TOOLS = Object.freeze([
  'pen',
  'highlighter',
  'survey-marker',
  'text',
  'callout',
]);

/**
 * @param {string} tool the tool that just committed a mark
 * @returns {boolean} true when the new mark should come up already selected
 */
export function shouldAutoSelectAfterCommit(tool) {
  if (typeof tool !== 'string' || !tool) return false;
  return AUTO_SELECT_AFTER_COMMIT_TOOLS.includes(tool);
}
