/**
 * mobileSurveyRailFit.js - how many survey discs fit the phone tool rail
 * (phone survey round, 2026-10-13; used by mobile/MobileSurveyRail.jsx, the
 * split between the two columns is utils/surveyPickLists planPhoneSurveyRail).
 *
 * The numbers are the rail's CSS tokens (mobile/mobilePdfViewer.css), pinned
 * by tests/mobileSurveyRail.test.mjs:
 *   - one disc slot: the 24px disc (--mobile-rail-disc) + the 4px gap
 *     between discs (--mobile-rail-sub-gap) = 28px;
 *   - a column adds 4px: 3px padding top and bottom (--rail-sub-pad) and two
 *     1px borders, less the one gap its last disc does not have;
 *   - the short rule between the two columns with the column gap on each
 *     side: 5 + (1 + 3 + 3) + 5 = 17px (--mobile-rail-gap, the divider and
 *     its --rail-divider-margin).
 */
export const RAIL_DISC_PITCH = 28;
export const RAIL_COLUMN_EXTRA = 4;
export const RAIL_COLUMN_SEPARATOR = 17;

/** How many discs the survey columns can hold in `availPx` of rail. */
export function railDiscSlots(availPx, { bothColumns = true } = {}) {
  if (!Number.isFinite(availPx)) return null;
  const fixed = bothColumns ? (2 * RAIL_COLUMN_EXTRA + RAIL_COLUMN_SEPARATOR) : RAIL_COLUMN_EXTRA;
  return Math.max(0, Math.floor((availPx - fixed) / RAIL_DISC_PITCH));
}
