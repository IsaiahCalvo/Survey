// Kept apart from selectionRestyle.js (which re-exports it): AppShell and the
// phone chrome load with the home screen, and importing it from there dragged
// the ink geometry and polygon clipping into the first visit (launch audit
// 2026-10-30).

/**
 * True when the picked marks disagree on any colour the combined paint swatch
 * shows (border, fill, or either one's opacity). The swatch then wears the
 * custom disc's rainbow ring and plus instead of one mark's paint (owner
 * 2026-10-04, Test 43). A property only some members carry (an arrow has no
 * fill) is compared among the members that have it, so a circle and an arrow
 * with the same border are not mixed.
 */
export function isPaintSelectionMixed(mixed) {
  if (!mixed) return false;
  return !!(mixed.strokeColor || mixed.fillColor || mixed.strokeOpacity || mixed.fillOpacity);
}
